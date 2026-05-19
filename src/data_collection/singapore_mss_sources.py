"""Singapore MSS 1-minute real-time temperature data source.

Fetches air temperature from data.gov.sg public API.
The API provides dry-bulb temperature (1-min mean) at ~1 min interval
from 15 stations across Singapore. Station S24 (Upper Changi Road North)
is the closest to Changi Airport (WSSS).

URL: https://api.data.gov.sg/v1/environment/air-temperature
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call

SINGAPORE_MSS_TEMP_URL = (
    os.getenv("SINGAPORE_MSS_BASE_URL", "").strip() or "https://api.data.gov.sg/v1/environment/air-temperature"
)

# Preferred station: closest to Changi Airport (WSSS)
PREFERRED_STATION_ID = "S24"
PREFERRED_STATION_NAME = "Upper Changi Road North"


def _parse_mss_reading(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract the preferred station's temperature from an API response."""
    items = raw.get("items") or []
    if not items:
        return None

    metadata = raw.get("metadata") or {}
    stations = metadata.get("stations") or []

    # Resolve station name
    station_name = ""
    for s in stations:
        if isinstance(s, dict) and s.get("id") == PREFERRED_STATION_ID:
            station_name = str(s.get("name") or PREFERRED_STATION_NAME)
            break
    if not station_name:
        station_name = PREFERRED_STATION_NAME

    # Take the most recent reading
    latest = items[-1]
    readings = latest.get("readings") or []
    ts = str(latest.get("timestamp") or "")

    for r in readings:
        if r.get("station_id") == PREFERRED_STATION_ID:
            temp_c = r.get("value")
            if temp_c is not None and -20 < temp_c < 55:
                # Observed at: use the API timestamp, which is UTC+8
                obs_time = ts
                if obs_time:
                    try:
                        dt = datetime.fromisoformat(obs_time)
                        obs_time = dt.astimezone(timezone.utc).isoformat()
                    except (ValueError, OverflowError):
                        pass

                return {
                    "station_id": PREFERRED_STATION_ID,
                    "station_name": station_name,
                    "temp_c": round(float(temp_c), 1),
                    "obs_time": obs_time,
                    "source": "sg_mss",
                }

    return None


class SingaporeMssSourceMixin:
    """Mixin that adds Singapore MSS 1-min data to WeatherDataCollector."""

    def _sg_mss_http_get(self, url: str) -> Optional[Dict[str, Any]]:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            resp = getter(url)
            if hasattr(resp, "json"):
                return resp.json()
            return resp
        try:
            resp = self.session.get(url, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return None

    def fetch_singapore_mss_current(self) -> Optional[Dict[str, Any]]:
        """Fetch latest Singapore MSS temperature for Changi station."""
        started = time.perf_counter()

        try:
            raw = self._sg_mss_http_get(SINGAPORE_MSS_TEMP_URL)
            if not raw:
                record_source_call(
                    "sg_mss", "current", "empty",
                    (time.perf_counter() - started) * 1000.0,
                )
                return None

            result = _parse_mss_reading(raw)
            if result:
                logger.info(
                    "Singapore MSS: station={} temp={}°C obs_time={}",
                    result["station_id"],
                    result["temp_c"],
                    result.get("obs_time", "?"),
                )
                record_source_call(
                    "sg_mss", "current", "success",
                    (time.perf_counter() - started) * 1000.0,
                )
            else:
                record_source_call(
                    "sg_mss", "current", "no_station",
                    (time.perf_counter() - started) * 1000.0,
                )
            return result

        except Exception as exc:
            logger.warning("Singapore MSS fetch failed: {}", exc)
            record_source_call(
                "sg_mss", "current", "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None
