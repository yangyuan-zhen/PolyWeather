from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from src.utils.metrics import record_source_call


NMC_CITY_REFERENCES: Dict[str, Dict[str, Any]] = {
    "shanghai": {
        "region_label": "浦东",
        "page_url": "https://m.nmc.cn/publish/forecast/ASH/pudong.html",
        "station_code": "atcMf",
    },
    "beijing": {
        "region_label": "顺义",
        "page_url": "https://m.nmc.cn/publish/forecast/ABJ/shunyi.html",
        "station_code": "MKoqG",
    },
    "chongqing": {
        "region_label": "渝北",
        "page_url": "https://m.nmc.cn/publish/forecast/ACQ/yubei.html",
        "station_code": "xFVYU",
    },
    "chengdu": {
        "region_label": "双流",
        "page_url": "https://m.nmc.cn/publish/forecast/ASC/shuangliu.html",
        "station_code": "grFhZ",
    },
    "wuhan": {
        "region_label": "武汉",
        "page_url": "https://m.nmc.cn/publish/forecast/AHB/wuhan.html",
        "station_code": "bSpCz",
    },
    "shenzhen": {
        "region_label": "深圳",
        "page_url": "https://m.nmc.cn/publish/forecast/AGD/shenzuo.html",
        "station_code": "AhpEU",
    },
}


class NmcSourceMixin:
    @staticmethod
    def _nmc_optional_float(value: Any) -> Optional[float]:
        if value in (None, "", "9999", 9999, 9999.0):
            return None
        try:
            return float(value)
        except Exception:
            return None

    def _resolve_nmc_station_code(self, city: str) -> Optional[str]:
        city_key = str(city or "").strip().lower()
        meta = NMC_CITY_REFERENCES.get(city_key) or {}
        station_code = str(meta.get("station_code") or "").strip()
        if station_code:
            return station_code

        page_url = str(meta.get("page_url") or "").strip()
        if not page_url:
            return None

        try:
            resp = self.session.get(page_url, timeout=self.timeout)
            resp.raise_for_status()
            match = re.search(
                r"renderWeatherRealPanel\('([^']+)',\s*'([^']+)'\)",
                resp.text,
            )
            if not match:
                return None
            station_code = str(match.group(1) or "").strip()
            if station_code:
                meta["station_code"] = station_code
                return station_code
        except Exception as exc:
            logger.warning("NMC station code resolve failed city={} error={}", city_key, exc)
        return None

    def fetch_nmc_region_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        meta = NMC_CITY_REFERENCES.get(city_key) or {}
        if not meta:
            record_source_call("nmc", "current", "unsupported_city", (time.perf_counter() - started) * 1000.0)
            return None

        cache_key = f"{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._nmc_cache_lock:
            cached = self._nmc_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.nmc_cache_ttl_sec:
                record_source_call("nmc", "current", "cache_hit", (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        station_code = self._resolve_nmc_station_code(city_key)
        if not station_code:
            record_source_call("nmc", "current", "missing_station_code", (time.perf_counter() - started) * 1000.0)
            return None

        try:
            url = f"https://www.nmc.cn/rest/real/{station_code}"
            resp = self.session.get(url, timeout=self.timeout)
            resp.raise_for_status()
            payload = resp.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("weather"), dict):
                record_source_call("nmc", "current", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            weather = payload.get("weather") or {}
            temp_c = weather.get("temperature")
            if temp_c in (None, "", "9999"):
                record_source_call("nmc", "current", "no_temperature", (time.perf_counter() - started) * 1000.0)
                return None
            temp_c = float(temp_c)
            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)

            station = payload.get("station") or {}
            result = {
                "source": "nmc",
                "timestamp": datetime.utcnow().isoformat(),
                "station_code": station_code,
                "station_name": station.get("city") or meta.get("region_label") or city_key.title(),
                "page_url": meta.get("page_url"),
                "publish_time": payload.get("publish_time"),
                "current": {
                    "temp": temp,
                    "humidity": self._nmc_optional_float(weather.get("humidity")),
                    "rain": self._nmc_optional_float(weather.get("rain")),
                    "airpressure": self._nmc_optional_float(weather.get("airpressure")),
                    "wx_desc": weather.get("info"),
                    "wind_direction": (payload.get("wind") or {}).get("direct"),
                    "wind_power": (payload.get("wind") or {}).get("power"),
                },
            }
            with self._nmc_cache_lock:
                self._nmc_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("nmc", "current", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as exc:
            logger.warning("NMC current fetch failed city={} code={} error={}", city_key, station_code, exc)
            with self._nmc_cache_lock:
                stale = self._nmc_cache.get(cache_key)
                if stale:
                    record_source_call("nmc", "current", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("nmc", "current", "error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_nmc_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> List[Dict[str, Any]]:
        current = self.fetch_nmc_region_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        meta = NMC_CITY_REFERENCES.get(str(city or "").strip().lower()) or {}
        city_meta = self.CITY_REGISTRY.get(str(city or "").strip().lower()) or {}
        return [
            {
                "name": f"{meta.get('region_label') or current.get('station_name')}区域实况 (NMC)",
                "station_label": f"{meta.get('region_label') or current.get('station_name')}区域实况 (NMC)",
                "lat": city_meta.get("lat"),
                "lon": city_meta.get("lon"),
                "temp": current.get("current", {}).get("temp"),
                "istNo": current.get("station_code"),
                "icao": current.get("station_code"),
                "source": "nmc",
                "source_label": "NMC",
                "obs_time": current.get("publish_time"),
                "page_url": current.get("page_url"),
                "humidity": current.get("current", {}).get("humidity"),
                "rain": current.get("current", {}).get("rain"),
                "airpressure": current.get("current", {}).get("airpressure"),
                "wx_desc": current.get("current", {}).get("wx_desc"),
                "wind_direction_text": current.get("current", {}).get("wind_direction"),
                "wind_power_text": current.get("current", {}).get("wind_power"),
            }
        ]
