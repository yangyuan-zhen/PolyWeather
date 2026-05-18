"""MADIS HFMETAR 5-minute real-time data source.

Fetches NetCDF files from NOAA MADIS public archive.
HFMETAR data updates every 5 minutes (12 values/hour/station).
Public anonymous access — no API key required.

URL: https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/
"""

from __future__ import annotations

import gzip
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

from loguru import logger

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
        """Parse a MADIS HFMETAR NetCDF file and return per-station observations."""
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
            # MADIS HFMETAR uses these variable names
            icaos = [str(s).strip() for s in nc.variables.get("icaoId", [])[:]]
            temps = nc.variables.get("temperature", None)  # in Celsius
            dewpts = nc.variables.get("dewpoint", None)
            winds = nc.variables.get("windSpeed", None)
            pressures = nc.variables.get("seaLevelPress", None)
            obs_times = nc.variables.get("observationTime", None)

            n = len(icaos)
            for i in range(n):
                icao = str(icaos[i]).strip().upper()
                if not icao or icao == "0":
                    continue

                temp_c = None
                if temps is not None:
                    try:
                        v = float(temps[i])
                        if -90 < v < 60:
                            temp_c = round(v, 1)
                    except (ValueError, IndexError):
                        pass
                if temp_c is None:
                    continue  # skip stations without temperature

                dewp_c = None
                if dewpts is not None:
                    try:
                        v = float(dewpts[i])
                        if -90 < v < 60:
                            dewp_c = round(v, 1)
                    except (ValueError, IndexError):
                        pass

                wind_kt = None
                if winds is not None:
                    try:
                        w = float(winds[i])
                        if w >= 0:
                            wind_kt = round(w * 1.94384, 1)
                    except (ValueError, IndexError):
                        pass

                pressure_hpa = None
                if pressures is not None:
                    try:
                        p = float(pressures[i])
                        if 800 < p < 1100:
                            pressure_hpa = round(p, 1)
                    except (ValueError, IndexError):
                        pass

                obs_time = ""
                if obs_times is not None:
                    try:
                        ts = str(obs_times[i]).strip()
                        # Try to parse as epoch or ISO
                        if ts and ts != "0":
                            try:
                                epoch = int(float(ts))
                                dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
                                obs_time = dt.isoformat()
                            except (ValueError, OverflowError):
                                obs_time = ts
                    except (ValueError, IndexError):
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
