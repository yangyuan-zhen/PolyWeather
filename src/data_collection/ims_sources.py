from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call


class ImsSourceMixin:
    """Fetch realtime observations from Israel Meteorological Service (IMS).

    Uses the hourly_observations_full endpoint which provides 10-minute data.
    In this feed, TD = Temperature Dry (dry-bulb in °C), NOT dew point.
    TT / TX1 / TN1 only exist in the plain hourly_observations endpoint.

    Station 225 = Lod Airport (Ben Gurion / LLBG), elevation 40 m.
    """

    IMS_LOD_AIRPORT_STATION = "225"
    IMS_OBSERVATIONS_URL = "https://ims.gov.il/en/hourly_observations_full"

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

            def _f(key: str, source: dict = latest) -> Optional[float]:
                raw = source.get(key)
                if raw is None:
                    return None
                try:
                    return float(raw)
                except (ValueError, TypeError):
                    return None

            # TD = Temperature Dry (dry-bulb °C) in the 10-minute feed
            temp = _f("TD")
            rh = _f("RH")
            # WS = wind speed in m/s (10-min average); convert to km/h and knots
            wind_ms = _f("WS")
            wind_kmh = round(wind_ms * 3.6, 1) if wind_ms is not None else None
            wind_kt = round(wind_ms * 1.94384, 1) if wind_ms is not None else None
            wind_dir = _f("WD")

            # Compute max / min so far today from all 10-min slots
            today_prefix = latest_time[:10]
            td_vals = []
            for t, stations in obs_map.items():
                if t.startswith(today_prefix):
                    td = _f("TD", source=(stations.get(station_id) or {}))
                    if td is not None:
                        td_vals.append(td)
            max_so_far = round(max(td_vals), 1) if td_vals else None
            min_so_far = round(min(td_vals), 1) if td_vals else None

            result: Dict = {
                "current": {
                    "temp": temp,
                    "humidity": rh,
                    "wind_speed_kmh": wind_kmh,
                    "wind_speed_kt": wind_kt,
                    "wind_dir": wind_dir,
                    "max_temp_so_far": max_so_far,
                    "min_temp_so_far": min_so_far,
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
                "IMS Lod Airport (s{}) {}: temp={}°C RH={}% wind={}km/h max={} min={}",
                station_id,
                latest_time,
                temp,
                rh,
                wind_kmh,
                max_so_far,
                min_so_far,
            )
            return result

        except Exception:
            logger.exception("IMS fetch failed for station {}", station_id)
            record_source_call("ims", "station", "error", _elapsed_ms())
            return None
