"""CoWIN (Community Weather Information Network) 1-minute real-time data source.

Fetches 1-minute temperature from HKU CoWIN API for Hong Kong.
Station 6087 (保良局陳守仁小學) provides true 1-minute observations.
No API key required.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import requests
from loguru import logger

from src.utils.metrics import record_source_call

COWIN_BASE_URL = os.getenv("COWIN_BASE_URL", "").strip() or "https://cowin.hku.hk"
COWIN_SERIES_URL = f"{COWIN_BASE_URL}/API/data/CoWIN/series"
COWIN_STATION_ID = int(os.getenv("COWIN_HK_STATION_ID", "6087"))
COWIN_STATION_LABEL = os.getenv("COWIN_HK_STATION_LABEL", "").strip() or "保良局陳守仁小學 1min (CoWIN)"


class CowinSourceMixin:

    def _cowin_http_get(self, url: str) -> requests.Response:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            resp = getter(url)
            return resp
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp

    def fetch_cowin_obs_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        if city_key != "hong kong":
            return None

        cache_key = f"cowin_obs:{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._cowin_obs_cache_lock:
            cached = self._cowin_obs_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.cowin_obs_cache_ttl_sec:
                record_source_call("cowin_obs", "current", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            # Fetch last 10 minutes to get the latest reading
            now = datetime.now(timezone.utc)
            end_dt = now.strftime("%Y-%m-%dT%H:%M:%S")
            start_dt = (now - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S")

            params = {
                "station_id": COWIN_STATION_ID,
                "element_id": "temp",
                "start_dt": start_dt,
                "end_dt": end_dt,
            }
            resp = self._cowin_http_get(COWIN_SERIES_URL + "?" + "&".join(
                f"{k}={v}" for k, v in params.items()
            ))
            payload = resp.json() if resp.content else {}
        except Exception as exc:
            logger.warning("CoWIN obs fetch failed city={} error={}", city_key, exc)
            with self._cowin_obs_cache_lock:
                stale = self._cowin_obs_cache.get(cache_key)
                if stale:
                    record_source_call("cowin_obs", "current", "stale_cache",
                                       (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("cowin_obs", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return None

        minutely = payload.get("minutely") if isinstance(payload, dict) else None
        if not minutely or not isinstance(minutely, list) or not minutely:
            record_source_call("cowin_obs", "current", "no_data",
                               (time.perf_counter() - started) * 1000.0)
            return None

        latest = minutely[-1]
        try:
            temp_c = float(latest["value1"])
        except (KeyError, ValueError, TypeError):
            record_source_call("cowin_obs", "current", "no_temperature",
                               (time.perf_counter() - started) * 1000.0)
            return None

        obs_time = str(latest.get("obstime") or "").strip()

        temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)

        result = {
            "source": "cowin_obs",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "station_code": str(COWIN_STATION_ID),
            "station_name": COWIN_STATION_LABEL,
            "icao": f"COWIN{COWIN_STATION_ID}",
            "obs_time": obs_time or datetime.now(timezone.utc).isoformat(),
            "current": {
                "temp": temp,
            },
            "temp_c": temp_c,
        }

        with self._cowin_obs_cache_lock:
            self._cowin_obs_cache[cache_key] = {"d": result, "t": now_ts}
        record_source_call("cowin_obs", "current", "success",
                           (time.perf_counter() - started) * 1000.0)
        return result

    def fetch_cowin_obs_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> list[Dict[str, Any]]:
        current = self.fetch_cowin_obs_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        return [
            {
                "name": COWIN_STATION_LABEL,
                "station_label": COWIN_STATION_LABEL,
                "lat": 22.3050,
                "lon": 114.1670,
                "temp": (current.get("current") or {}).get("temp"),
                "icao": f"COWIN{COWIN_STATION_ID}",
                "istNo": str(COWIN_STATION_ID),
                "source": "cowin_obs",
                "source_label": "CoWIN 6087",
                "obs_time": current.get("obs_time"),
            }
        ]
