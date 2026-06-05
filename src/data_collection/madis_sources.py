"""MADIS HFMETAR 5-minute real-time data source.

Fetches NetCDF files from NOAA MADIS public archive.
HFMETAR data updates every 5 minutes (12 values/hour/station).
Public anonymous access — no API key required.

URL: https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/
"""

from __future__ import annotations

import gzip
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

from loguru import logger

from src.data_collection.observation_source_gate import run_observation_source
from src.utils.metrics import record_source_call

MADIS_HFMETAR_URL = (
    "https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/"
)


class MadisSourceMixin:
    """Mixin that adds MADIS HFMETAR 5-min data to WeatherDataCollector."""

    def _madis_http_get(self, url: str) -> bytes:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            resp = getter(url)
            return resp.content if hasattr(resp, "content") else resp
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.content

    def _madis_latest_file(self) -> Optional[str]:
        """Find the most recent HFMETAR NetCDF file."""
        try:
            # The MADIS HFMETAR directory listing returns HTML
            html = self._madis_http_get(MADIS_HFMETAR_URL).decode("utf-8", errors="replace")
            import re
            # Match file names like 20260514_1200.gz or 202605141200.gz
            matches = re.findall(r'(\d{8}[_ ]?\d{4})\.gz', html)
            if not matches:
                logger.warning("MADIS: no HFMETAR files found in directory listing")
                return None
            # Sort by timestamp descending
            matches.sort(reverse=True)
            latest = matches[0].replace(" ", "_")
            return f"{latest}.gz"
        except Exception as exc:
            logger.warning("MADIS: failed to list HFMETAR files: {}", exc)
            return None

    def _madis_parse_hfmetar(
        self, nc_bytes: bytes, fname: str
    ) -> List[Dict[str, Any]]:
        """Parse a MADIS HFMETAR NetCDF file and return per-station observations.

        NOAA restructured the netCDF layout (2026-05): stationId replaces icaoId,
        temperatures are in Kelvin, altimeter in Pascal.
        """
        try:
            from netCDF4 import Dataset
            nc = Dataset(fname, memory=nc_bytes)
        except ImportError:
            logger.error("netCDF4 not installed; MADIS data unavailable")
            return []
        except Exception as exc:
            logger.warning("MADIS: netCDF4 open failed: {}", exc)
            return []

        results: List[Dict[str, Any]] = []
        try:
            station_ids = nc.variables.get("stationId")
            temps = nc.variables.get("temperature")  # Kelvin
            dewpts = nc.variables.get("dewpoint")    # Kelvin
            winds = nc.variables.get("windSpeed")    # m/s
            pressures = nc.variables.get("altimeter")  # Pa
            obs_times = nc.variables.get("observationTime")  # epoch seconds

            if station_ids is None:
                logger.warning("MADIS: stationId variable not found in netCDF")
                return []

            n = station_ids.shape[0]
            for i in range(n):
                # Decode stationId (char array per row)
                try:
                    import numpy as np
                    row = station_ids[i]
                    if isinstance(row, np.ndarray):
                        sid_bytes = b"".join(row.tobytes().split(b"\x00")[:1])
                        icao = sid_bytes.decode("ascii", errors="replace").strip()
                    else:
                        icao = str(row).strip()
                except Exception:
                    icao = ""

                icao = icao.upper()
                if not icao or len(icao) != 4:
                    continue

                # Temperature (Kelvin → Celsius)
                temp_c = None
                if temps is not None:
                    try:
                        v = float(temps[i])
                        if 180 < v < 340:  # valid Kelvin range (-93C to +67C)
                            temp_c = round(v - 273.15, 1)
                    except (ValueError, IndexError):
                        pass
                if temp_c is None:
                    continue

                # Dewpoint (Kelvin → Celsius)
                dewp_c = None
                if dewpts is not None:
                    try:
                        v = float(dewpts[i])
                        if 180 < v < 340:
                            dewp_c = round(v - 273.15, 1)
                    except (ValueError, IndexError):
                        pass

                # Wind (m/s → kt)
                wind_kt = None
                if winds is not None:
                    try:
                        w = float(winds[i])
                        if 0 <= w < 200:
                            wind_kt = round(w * 1.94384, 1)
                    except (ValueError, IndexError):
                        pass

                # Pressure (Pa → hPa)
                pressure_hpa = None
                if pressures is not None:
                    try:
                        p = float(pressures[i])
                        if 50000 < p < 120000:  # valid Pa range
                            pressure_hpa = round(p / 100.0, 1)
                    except (ValueError, IndexError):
                        pass

                # Observation time (epoch seconds)
                obs_time = ""
                if obs_times is not None:
                    try:
                        ts = obs_times[i]
                        dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
                        obs_time = dt.isoformat()
                    except Exception:
                        pass

                results.append({
                    "icao": icao,
                    "temp_c": temp_c,
                    "dewp_c": dewp_c,
                    "wind_kt": wind_kt,
                    "pressure_hpa": pressure_hpa,
                    "obs_time": obs_time,
                    "source": "madis_hfmetar",
                })

        except Exception as exc:
            logger.warning("MADIS: HFMETAR parse error: {}", exc)
        finally:
            try:
                nc.close()
            except Exception:
                pass

        return results

    def fetch_madis_hfmetar(self) -> List[Dict[str, Any]]:
        """Fetch latest MADIS HFMETAR data and return parsed observations."""
        interval_sec = max(
            60,
            int(os.getenv("POLYWEATHER_OBSERVATION_COLLECTOR_MADIS_SEC", "300") or "300"),
        )
        return run_observation_source(
            "madis_hfmetar",
            "global",
            interval_sec,
            self._fetch_madis_hfmetar_uncached,
        ) or []

    def _fetch_madis_hfmetar_uncached(self) -> List[Dict[str, Any]]:
        """Fetch latest MADIS HFMETAR data without source-level gate."""
        started = time.perf_counter()

        fname = self._madis_latest_file()
        if not fname:
            record_source_call("madis_hfmetar", "current", "no_file",
                               (time.perf_counter() - started) * 1000.0)
            return []

        try:
            url = f"{MADIS_HFMETAR_URL}{fname}"
            raw = self._madis_http_get(url)

            # Decompress gzip
            try:
                nc_bytes = gzip.decompress(raw)
            except gzip.BadGzipFile:
                # Maybe not compressed
                nc_bytes = raw

            results = self._madis_parse_hfmetar(nc_bytes, fname)
            if results:
                logger.info("MADIS HFMETAR: {} stations from {}", len(results), fname)
                record_source_call("madis_hfmetar", "current", "success",
                                   (time.perf_counter() - started) * 1000.0)
            else:
                record_source_call("madis_hfmetar", "current", "empty",
                                   (time.perf_counter() - started) * 1000.0)
            return results

        except Exception as exc:
            logger.warning("MADIS HFMETAR fetch failed: {}", exc)
            record_source_call("madis_hfmetar", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return []
