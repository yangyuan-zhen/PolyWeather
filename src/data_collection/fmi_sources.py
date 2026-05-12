"""FMI (Finnish Meteorological Institute) open data source.

Fetches 10-minute airport weather observations from opendata.fmi.fi
for Helsinki-Vantaa airport (EFHK, WMO 2974, FMISID 100968).
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call

FMI_BASE_URL = "https://opendata.fmi.fi/wfs"
FMI_STATION = {
    "helsinki": {
        "fmisid": "100968",
        "wmo": "2974",
        "icao": "EFHK",
        "label": "Helsinki-Vantaa 10min (FMI)",
        "query_place": "helsinki-vantaa_airport",
    },
}


class FmiSourceMixin:
    def _fmi_http_get_text(self, url: str) -> str:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            response = getter(url)
        else:
            response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.text

    def fetch_fmi_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        meta = FMI_STATION.get(city_key) or {}
        if not meta:
            record_source_call("fmi", "current", "unsupported_city",
                               (time.perf_counter() - started) * 1000.0)
            return None

        cache_key = f"fmi:{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._fmi_cache_lock:
            cached = self._fmi_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.fmi_cache_ttl_sec:
                record_source_call("fmi", "current", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            from datetime import timezone as tz

            place = meta["query_place"]
            end_time = datetime.now(tz.utc)
            start_time = end_time.replace(minute=end_time.minute // 10 * 10, second=0, microsecond=0)
            end_str = end_time.strftime("%Y-%m-%dT%H:%M:%SZ")
            start_str = (start_time - __import__("datetime").timedelta(minutes=20)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )

            url = (
                f"{FMI_BASE_URL}?service=WFS&version=2.0.0&request=getFeature"
                f"&storedquery_id=fmi::observations::weather::timevaluepair"
                f"&place={place}"
                f"&parameters=t2m,ws_10min,p_sea"
                f"&starttime={start_str}&endtime={end_str}"
            )

            xml_text = self._fmi_http_get_text(url)

            # Parse per-parameter observation blocks
            blocks = re.split(r"<om:observedProperty\s", xml_text)
            latest_values: Dict[str, Any] = {}
            obs_time = None

            for block in blocks:
                # Determine parameter
                param_match = re.search(r'param=(\w+)', block)
                if not param_match:
                    continue
                param = param_match.group(1)

                # Extract all time-value pairs
                tvps = re.findall(
                    r"<wml2:MeasurementTVP>.*?<wml2:time>(.*?)</wml2:time>\s*<wml2:value>(.*?)</wml2:value>",
                    block,
                    re.DOTALL,
                )
                if tvps:
                    latest_time, latest_val = tvps[-1]
                    obs_time = latest_time
                    try:
                        latest_values[param] = float(latest_val)
                    except (ValueError, TypeError):
                        pass

            temp_c = latest_values.get("t2m")
            wind_ms = latest_values.get("ws_10min")
            pressure_hpa = latest_values.get("p_sea")

            if temp_c is None:
                record_source_call("fmi", "current", "no_temperature",
                                   (time.perf_counter() - started) * 1000.0)
                return None

            # Convert wind from m/s to kt
            wind_kt = round(wind_ms * 1.94384, 1) if wind_ms is not None else None

            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)

            result = {
                "source": "fmi",
                "timestamp": datetime.utcnow().isoformat(),
                "station_code": meta["fmisid"],
                "station_name": meta["label"],
                "wmo": meta["wmo"],
                "icao": meta["icao"],
                "obs_time": obs_time,
                "current": {
                    "temp": temp,
                },
                "temp_c": temp_c,
                "wind_kt": wind_kt,
                "pressure_hpa": pressure_hpa,
            }

            with self._fmi_cache_lock:
                self._fmi_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("fmi", "current", "success",
                               (time.perf_counter() - started) * 1000.0)
            return result

        except Exception as exc:
            logger.warning("FMI current fetch failed city={} error={}", city_key, exc)
            with self._fmi_cache_lock:
                stale = self._fmi_cache.get(cache_key)
                if stale:
                    record_source_call("fmi", "current", "stale_cache",
                                       (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("fmi", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_fmi_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> list[Dict[str, Any]]:
        current = self.fetch_fmi_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        meta = FMI_STATION.get(str(city or "").strip().lower()) or {}
        return [
            {
                "name": meta.get("label") or "Helsinki-Vantaa 10min (FMI)",
                "station_label": meta.get("label"),
                "lat": 60.32937,
                "lon": 24.97274,
                "temp": (current.get("current") or {}).get("temp"),
                "icao": meta.get("icao"),
                "istNo": meta.get("fmisid"),
                "source": "fmi",
                "source_label": "FMI",
                "obs_time": current.get("obs_time"),
            }
        ]
