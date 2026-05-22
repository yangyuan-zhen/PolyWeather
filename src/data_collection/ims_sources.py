from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call


class ImsSourceMixin:
    """Fetch realtime observations from Israel Meteorological Service (IMS).

    The IMS public API at /en/hourly_observations returns a JSON payload with
    data.hourly_observations_map keyed by timestamp and station ID, covering all
    active IMS stations for the current day.

    Station 225 = Lod Airport (Ben Gurion / LLBG), elevation 40 m.
    """

    IMS_LOD_AIRPORT_STATION = "225"
    IMS_OBSERVATIONS_URL = "https://ims.gov.il/en/hourly_observations"

    def fetch_from_ims(self, station_id: str = "225") -> Optional[Dict]:
        started = datetime.now()

        def _elapsed_ms() -> float:
            return (datetime.now() - started).total_seconds() * 1000.0

        try:
            resp = self._http_get(self.IMS_OBSERVATIONS_URL, timeout=self.timeout)
            if resp.status_code != 200:
                logger.warning("IMS API returned HTTP {}", resp.status_code)
                record_source_call("ims", "station", "error", _elapsed_ms())
                return None

            body = resp.json()
            obs_map = (body.get("data") or {}).get("hourly_observations_map") or {}
            if not obs_map:
                record_source_call("ims", "station", "empty", _elapsed_ms())
                return None

            latest_time = max(obs_map.keys())
            latest = obs_map[latest_time].get(station_id) or {}
            if not latest:
                record_source_call("ims", "station", "empty", _elapsed_ms())
                return None

            def _f(key: str) -> Optional[float]:
                raw = latest.get(key)
                if raw is None:
                    return None
                try:
                    return float(raw)
                except (ValueError, TypeError):
                    return None

            temp = _f("TT")
            rh = _f("RH")
            wind_kmh = _f("FF")
            wind_dir = _f("DD")
            tx1 = _f("TX1")
            tn1 = _f("TN1")
            td = _f("TD")

            wind_kt = round(wind_kmh / 1.852, 1) if wind_kmh is not None else None

            result: Dict = {
                "current": {
                    "temp": temp,
                    "humidity": rh,
                    "wind_speed_kmh": wind_kmh,
                    "wind_speed_kt": wind_kt,
                    "wind_dir": wind_dir,
                    "dew_point": td,
                    "max_temp_so_far": tx1,
                    "min_temp_so_far": tn1,
                },
                "obs_time": latest_time,
                "station_id": station_id,
                "station_label": "Lod Airport",
                "lat": 32.002943,
                "lon": 34.891534,
                "elevation_m": 40,
            }
            record_source_call("ims", "station", "success", _elapsed_ms())
            logger.info(
                "IMS Lod Airport (s{}) {}: temp={}°C RH={}% wind={}km/h",
                station_id,
                latest_time,
                temp,
                rh,
                wind_kmh,
            )
            return result

        except Exception:
            logger.exception("IMS fetch failed for station {}", station_id)
            record_source_call("ims", "station", "error", _elapsed_ms())
            return None
