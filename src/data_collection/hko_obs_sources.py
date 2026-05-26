"""HKO (Hong Kong Observatory) 1-minute real-time data source.

Fetches 1-minute temperature from HKO's public regional-weather API
for Hong Kong Observatory (HKO) and Lau Fau Shan (LFS) stations.
No API key required.
"""

from __future__ import annotations

import csv
import os
import io
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from loguru import logger

# pyrefly: ignore [missing-import]
from src.utils.metrics import record_source_call

HKO_BASE_URL = os.getenv("HKO_BASE_URL", "").strip() or "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather"
HKO_STATIONS = {
    "hong kong": {
        "code": "HK Observatory",
        "icao": "HKO",
        "label": "HK Observatory 1min (HKO)",
    },
    "shenzhen": {
        "code": "Lau Fau Shan",
        "icao": "LFS",
        "label": "流浮山天文台 1min (HKO)",
    },
}


class HkoObsSourceMixin:
    session: Any
    timeout: Any
    _hko_obs_cache: Dict[str, Any]
    _hko_obs_cache_lock: Any
    hko_obs_cache_ttl_sec: Any

    def _hko_http_get(self, url: str) -> str:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            resp = getter(url)
            return str(resp.text) if hasattr(resp, "text") else str(resp)
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.text

    def fetch_hko_obs_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = (city or "").strip().lower()
        meta = HKO_STATIONS.get(city_key) or {}
        if not meta:
            return None

        cache_key = f"hko_obs:{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._hko_obs_cache_lock:
            cached = self._hko_obs_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.hko_obs_cache_ttl_sec:
                record_source_call("hko_obs", "current", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            csv_text = self._hko_http_get(
                f"{HKO_BASE_URL}/latest_1min_temperature.csv"
            )
            reader = csv.DictReader(io.StringIO(csv_text))
            temp_c = None
            obs_time = None
            for row in reader:
                if row.get("Automatic Weather Station", "").strip() == meta["code"]:
                    try:
                        temp_c = float(row["Air Temperature(degree Celsius)"])
                    except (ValueError, TypeError):
                        pass
                    obs_time = row.get("Date time", "")[:12]
                    break

            if temp_c is None:
                record_source_call("hko_obs", "current", "no_temperature",
                                   (time.perf_counter() - started) * 1000.0)
                return None

            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)
            obs_iso = None
            if obs_time and len(obs_time) == 12:
                try:
                    dt = datetime.strptime(obs_time, "%Y%m%d%H%M")
                    obs_iso = dt.isoformat()
                except Exception:
                    obs_iso = obs_time

            result = {
                "source": "hko_obs",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "station_code": meta["code"],
                "station_name": meta["label"],
                "icao": meta["icao"],
                "obs_time": obs_iso or datetime.now(timezone.utc).isoformat(),
                "current": {
                    "temp": temp,
                },
                "temp_c": temp_c,
            }

            with self._hko_obs_cache_lock:
                self._hko_obs_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("hko_obs", "current", "success",
                               (time.perf_counter() - started) * 1000.0)
            return result

        except Exception as exc:
            logger.warning("HKO obs fetch failed city={} error={}", city_key, exc)
            with self._hko_obs_cache_lock:
                stale = self._hko_obs_cache.get(cache_key)
                if stale:
                    record_source_call("hko_obs", "current", "stale_cache",
                                       (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("hko_obs", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_hko_obs_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> list[Dict[str, Any]]:
        current = self.fetch_hko_obs_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        meta = HKO_STATIONS.get((city or "").strip().lower()) or {}
        return [
            {
                "name": meta.get("label") or "HKO Station",
                "station_label": meta.get("label"),
                "lat": 22.3020,
                "lon": 114.1743,
                "temp": (current.get("current") or {}).get("temp"),
                "icao": meta.get("icao"),
                "istNo": meta.get("icao"),
                "source": "hko_obs",
                "source_label": "HKO",
                "obs_time": current.get("obs_time"),
            }
        ]
