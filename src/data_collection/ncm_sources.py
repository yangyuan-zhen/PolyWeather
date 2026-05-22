from __future__ import annotations

import os
from datetime import datetime
from typing import Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call


class NcmSourceMixin:
    """Fetch realtime observations from Saudi NCM via the Meteomatics API.

    API base: https://api-mm.ncm.gov.sa/
    Docs:     https://api-doc.ncm.gov.sa/en/api/getting-started

    Auth via HTTP Basic Auth: username + password (set in .env as
    NCM_API_USERNAME / NCM_API_PASSWORD).

    Station for Jeddah: "Mataar Municipality" (ID 36) near OEJN.
    Uses source=mix-obs for real-time station observations.

    Parameters:
      t_2m:C           — temperature at 2 m (°C)
      wind_speed_10m:ms — wind speed at 10 m (m/s)
      sfc_pressure:hPa  — surface pressure (hPa)
      dew_point_2m:C    — dew point at 2 m (°C)
      relative_humidity_2m:p — relative humidity (%)
    """

    NCM_API_BASE = "https://api-mm.ncm.gov.sa"
    # Station 36 = Mataar Municipality (21.60 N, 39.25 E), closest to OEJN.
    # Use lat/lon for automatic nearest-station routing.
    JEDDAH_LAT = "21.6702"
    JEDDAH_LON = "39.1525"
    JEDDAH_STATION_ID = "36"
    PARAMS = "t_2m:C,wind_speed_10m:ms,sfc_pressure:hPa,dew_point_2m:C,relative_humidity_2m:p"

    def _ncm_auth(self) -> Optional[tuple]:
        username = os.getenv("NCM_API_USERNAME", "").strip()
        password = os.getenv("NCM_API_PASSWORD", "").strip()
        if not username or not password:
            return None
        return (username, password)

    def fetch_from_ncm(self) -> Optional[Dict]:
        """Fetch latest observation for Jeddah from NCM."""
        started = datetime.now()
        auth = self._ncm_auth()
        if not auth:
            logger.warning("NCM credentials not configured (NCM_API_USERNAME / NCM_API_PASSWORD)")
            record_source_call("ncm", "station", "noauth", 0)
            return None

        def _elapsed_ms() -> float:
            return (datetime.now() - started).total_seconds() * 1000.0

        now_utc = datetime.utcnow()
        valid_time = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        location = f"{self.JEDDAH_LAT},{self.JEDDAH_LON}"
        url = f"{self.NCM_API_BASE}/{valid_time}/{self.PARAMS}/{location}/json?source=mix-obs"

        try:
            resp = self._http_get(url, auth=auth, timeout=self.timeout)
            if resp.status_code == 401:
                logger.error("NCM API authentication failed — check NCM_API_USERNAME / NCM_API_PASSWORD")
                record_source_call("ncm", "station", "auth_error", _elapsed_ms())
                return None
            if resp.status_code != 200:
                logger.warning("NCM API returned HTTP {}", resp.status_code)
                record_source_call("ncm", "station", "error", _elapsed_ms())
                return None

            body = resp.json()
            if not body:
                record_source_call("ncm", "station", "empty", _elapsed_ms())
                return None

            def _first_value(key: str) -> Optional[float]:
                """NCM returns per-parameter arrays; extract the first value."""
                arr = body.get(key) if isinstance(body, dict) else None
                if arr and isinstance(arr, list) and len(arr) > 0:
                    try:
                        return float(arr[0])
                    except (ValueError, TypeError):
                        pass
                return None

            temp = _first_value("t_2m:C")
            wind_ms = _first_value("wind_speed_10m:ms")
            pressure = _first_value("sfc_pressure:hPa")
            dew_point = _first_value("dew_point_2m:C")
            humidity = _first_value("relative_humidity_2m:p")

            wind_kmh = round(wind_ms * 3.6, 1) if wind_ms is not None else None
            wind_kt = round(wind_ms * 1.94384, 1) if wind_ms is not None else None

            result: Dict = {
                "current": {
                    "temp": temp,
                    "humidity": humidity,
                    "wind_speed_kmh": wind_kmh,
                    "wind_speed_kt": wind_kt,
                    "pressure": pressure,
                    "dew_point": dew_point,
                },
                "obs_time": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "station_label": "Jeddah OEJN (NCM)",
                "lat": float(self.JEDDAH_LAT),
                "lon": float(self.JEDDAH_LON),
            }
            record_source_call("ncm", "station", "success", _elapsed_ms())
            logger.info(
                "NCM Jeddah {}: temp={}°C RH={}% wind={}km/h p={}hPa",
                valid_time,
                temp,
                humidity,
                wind_kmh,
                pressure,
            )
            return result

        except Exception:
            logger.exception("NCM fetch failed for Jeddah")
            record_source_call("ncm", "station", "error", _elapsed_ms())
            return None
