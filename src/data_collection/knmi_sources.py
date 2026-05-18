"""KNMI (Royal Netherlands Meteorological Institute) data source.

Fetches 10-minute weather observations from the KNMI Data Platform
for Amsterdam Schiphol airport (WMO 06240, station 240).
Uses netCDF4; requires libhdf5-dev on Linux.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call

KNMI_DATASET = "10-minute-in-situ-meteorological-observations"
KNMI_VERSION = "1.0"
KNMI_API_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"
KNMI_STATION = {
    "amsterdam": {
        "station": "06240",
        "icao": "EHAM",
        "label": "Schiphol 10min (KNMI)",
    },
}


class KnmiSourceMixin:
    def _knmi_api_key(self) -> str:
        import os
        return str(os.getenv("KNMI_API_KEY") or "").strip()

    def _knmi_http_get(self, url: str, api_key: str = "") -> bytes:
        """Download file. Does NOT send auth header — download URLs are pre-signed S3 links."""
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            resp = getter(url)
            return resp.content if hasattr(resp, "content") else resp
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.content

    def _knmi_http_get_json(self, url: str, api_key: str) -> Dict:
        headers = {"Authorization": api_key}
        getter = getattr(self, "_http_get_json", None)
        if callable(getter):
            return getter(url, headers=headers)
        resp = self.session.get(url, timeout=self.timeout, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def fetch_knmi_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        meta = KNMI_STATION.get(city_key) or {}
        if not meta:
            record_source_call("knmi", "current", "unsupported_city",
                               (time.perf_counter() - started) * 1000.0)
            return None

        api_key = self._knmi_api_key()
        if not api_key:
            logger.warning("KNMI_API_KEY not set, skipping fetch")
            return None

        cache_key = f"knmi:{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._knmi_cache_lock:
            cached = self._knmi_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.knmi_cache_ttl_sec:
                record_source_call("knmi", "current", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        base = f"{KNMI_API_BASE}/datasets/{KNMI_DATASET}/versions/{KNMI_VERSION}"

        try:
            # Get latest file
            resp = self._knmi_http_get_json(
                f"{base}/files?maxKeys=1&sorting=desc&orderBy=created",
                api_key,
            )
            files = resp.get("files") or []
            if not files:
                record_source_call("knmi", "current", "no_files",
                                   (time.perf_counter() - started) * 1000.0)
                return None

            fname = files[0]["filename"]

            # Get download URL
            url_resp = self._knmi_http_get_json(f"{base}/files/{fname}/url", api_key)
            download_url = url_resp.get("temporaryDownloadUrl")
            if not download_url:
                record_source_call("knmi", "current", "no_download_url",
                                   (time.perf_counter() - started) * 1000.0)
                return None

            # Download and parse NetCDF
            nc_bytes = self._knmi_http_get(download_url, api_key)

            try:
                from netCDF4 import Dataset
                nc = Dataset(fname, memory=nc_bytes)
            except ImportError:
                logger.error("netCDF4 not installed; KNMI data unavailable")
                record_source_call("knmi", "current", "netcdf4_missing",
                                   (time.perf_counter() - started) * 1000.0)
                return None

            try:
                stn = meta["station"]
                # Find station index
                station_var = nc.variables.get("station_id") or nc.variables.get("station")
                station_ids = []
                for s in (station_var[:] if station_var is not None else []):
                    try:
                        val = str(int(s))
                    except Exception:
                        val = str(s).strip()
                    station_ids.append(val)

                try:
                    idx = station_ids.index(stn)
                except ValueError:
                    try:
                        idx = station_ids.index(str(int(stn)))
                    except (ValueError, TypeError):
                        idx = -1

                if idx < 0 or idx >= len(station_ids):
                    logger.warning("KNMI station {} not found in file", stn)
                    nc.close()
                    return None

                # Extract latest timestep for temperature
                ta = nc.variables.get("ta", None)
                if ta is None:
                    nc.close()
                    return None

                data = ta[:]
                latest_temp = float(data[-1, idx]) if data.ndim == 2 else float(data[-1])

                # Wind speed
                ff = nc.variables.get("ff", None)
                wind_ms = None
                if ff is not None:
                    wind_data = ff[:]
                    wind_ms = float(wind_data[-1, idx] if wind_data.ndim == 2 else wind_data[-1])

                # Pressure
                p0 = nc.variables.get("p0", None)
                pressure_hpa = None
                if p0 is not None:
                    p_data = p0[:]
                    pressure_hpa = float(p_data[-1, idx] if p_data.ndim == 2 else p_data[-1])
                    if pressure_hpa > 5000:
                        pressure_hpa = pressure_hpa / 100.0

                nc.close()

                if latest_temp < -90 or latest_temp > 60:
                    record_source_call("knmi", "current", "bad_value",
                                       (time.perf_counter() - started) * 1000.0)
                    return None

                temp_c = round(float(latest_temp), 1)
                wind_kt = round(wind_ms * 1.94384, 1) if wind_ms is not None else None
                if pressure_hpa is not None:
                    pressure_hpa = round(float(pressure_hpa), 1)

                temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else temp_c

                # Extract obs time from filename: KMDS__OPER_P___10M_OBS_L2_202605121150.nc
                import re
                obs_time = None
                time_match = re.search(r"(\d{12})", fname)
                if time_match:
                    ts = time_match.group(1)
                    obs_dt = datetime.strptime(ts, "%Y%m%d%H%M")
                    obs_time = obs_dt.isoformat()

                result = {
                    "source": "knmi",
                    "timestamp": datetime.utcnow().isoformat(),
                    "station_code": stn,
                    "station_name": meta["label"],
                    "icao": meta["icao"],
                    "obs_time": obs_time or datetime.utcnow().isoformat(),
                    "current": {
                        "temp": temp,
                    },
                    "temp_c": temp_c,
                    "wind_kt": wind_kt,
                    "pressure_hpa": pressure_hpa,
                }

                with self._knmi_cache_lock:
                    self._knmi_cache[cache_key] = {"d": result, "t": now_ts}
                record_source_call("knmi", "current", "success",
                                   (time.perf_counter() - started) * 1000.0)
                return result

            finally:
                try:
                    nc.close()
                except Exception:
                    pass

        except Exception as exc:
            logger.warning("KNMI current fetch failed city={} error={}", city_key, exc)
            with self._knmi_cache_lock:
                stale = self._knmi_cache.get(cache_key)
                if stale:
                    record_source_call("knmi", "current", "stale_cache",
                                       (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("knmi", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_knmi_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> list[Dict[str, Any]]:
        current = self.fetch_knmi_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        meta = KNMI_STATION.get(str(city or "").strip().lower()) or {}
        return [
            {
                "name": meta.get("label") or "Schiphol 10min (KNMI)",
                "station_label": meta.get("label"),
                "lat": 52.3081,
                "lon": 4.7642,
                "temp": (current.get("current") or {}).get("temp"),
                "icao": meta.get("icao"),
                "istNo": meta.get("station"),
                "source": "knmi",
                "source_label": "KNMI",
                "obs_time": current.get("obs_time"),
            }
        ]
