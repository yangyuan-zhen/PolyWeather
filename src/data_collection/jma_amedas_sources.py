from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from src.utils.metrics import record_source_call


JMA_AMEDAS_STATIONS: Dict[str, Dict[str, Any]] = {
    "tokyo": {
        "station_code": "44166",
        "station_label": "羽田 10分实况 (JMA)",
        "lat": 35.5533,
        "lon": 139.78,
    },
}


class JmaAmedasSourceMixin:
    def _jma_http_get_text(self, url: str) -> str:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            response = getter(url)
        else:
            response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.text

    @staticmethod
    def _jma_safe_float(value: Any) -> Optional[float]:
        try:
            if value in (None, "", "///"):
                return None
            return float(value)
        except Exception:
            return None

    def fetch_jma_amedas_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        meta = JMA_AMEDAS_STATIONS.get(city_key) or {}
        if not meta:
            record_source_call("jma_amedas", "current", "unsupported_city", (time.perf_counter() - started) * 1000.0)
            return None

        cache_key = f"{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._jma_cache_lock:
            cached = self._jma_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.jma_cache_ttl_sec:
                record_source_call("jma_amedas", "current", "cache_hit", (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            latest_time_text = self._jma_http_get_text(
                "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt"
            ).strip()
            latest_dt = datetime.fromisoformat(latest_time_text)
            bucket_hour = (latest_dt.hour // 3) * 3
            bucket_key = f"{latest_dt.strftime('%Y%m%d')}_{bucket_hour:02d}"
            station_code = str(meta.get("station_code") or "").strip()
            url = f"https://www.jma.go.jp/bosai/amedas/data/point/{station_code}/{bucket_key}.json"

            getter = getattr(self, "_http_get_json", None)
            if callable(getter):
                payload = getter(url)
            else:
                response = self.session.get(url, timeout=self.timeout)
                response.raise_for_status()
                payload = response.json()

            if not isinstance(payload, dict) or not payload:
                record_source_call("jma_amedas", "current", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            latest_key = sorted(payload.keys())[-1]
            row = payload.get(latest_key) or {}
            temp_pair = row.get("temp") or []
            temp_c = self._jma_safe_float(temp_pair[0] if isinstance(temp_pair, list) and temp_pair else None)
            if temp_c is None:
                record_source_call("jma_amedas", "current", "no_temperature", (time.perf_counter() - started) * 1000.0)
                return None

            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)
            obs_time = None
            try:
                obs_time = datetime.strptime(str(latest_key), "%Y%m%d%H%M%S").isoformat()
            except Exception:
                obs_time = str(latest_key)

            result = {
                "source": "jma_amedas",
                "timestamp": datetime.utcnow().isoformat(),
                "station_code": station_code,
                "station_name": meta.get("station_label") or "羽田 10分实况 (JMA)",
                "obs_time": obs_time,
                "current": {
                    "temp": temp,
                },
            }
            with self._jma_cache_lock:
                self._jma_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("jma_amedas", "current", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as exc:
            logger.warning("JMA AMeDAS current fetch failed city={} error={}", city_key, exc)
            with self._jma_cache_lock:
                stale = self._jma_cache.get(cache_key)
                if stale:
                    record_source_call("jma_amedas", "current", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("jma_amedas", "current", "error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_jma_amedas_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> List[Dict[str, Any]]:
        current = self.fetch_jma_amedas_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        meta = JMA_AMEDAS_STATIONS.get(str(city or "").strip().lower()) or {}
        return [
            {
                "name": meta.get("station_label") or "羽田 10分实况 (JMA)",
                "station_label": meta.get("station_label") or "羽田 10分实况 (JMA)",
                "lat": meta.get("lat"),
                "lon": meta.get("lon"),
                "temp": (current.get("current") or {}).get("temp"),
                "icao": current.get("station_code"),
                "istNo": current.get("station_code"),
                "source": "jma",
                "source_label": "JMA",
                "obs_time": current.get("obs_time"),
            }
        ]
