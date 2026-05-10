"""AMOS (Aerodrome Meteorological Observation System) real-time data source.

Fetches runway-level observations from global.amo.go.kr for Korean airports.
Provides per-runway wind, temperature, pressure, visibility, RVR, cloud data.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call

AMOS_BASE_URL = "https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do"

AMOS_AIRPORT_CODES: Dict[str, Dict[str, str]] = {
    "seoul": {
        "icao": "RKSI",
        "label_ko": "인천공항",
        "label_en": "Incheon Intl",
    },
    "busan": {
        "icao": "RKPK",
        "label_ko": "김해공항",
        "label_en": "Gimhae Intl",
    },
}

AMOS_STATION_IDS: Dict[str, str] = {
    "RKSI": "471080",  # Incheon
    "RKPK": "471530",  # Gimhae (Busan)
}


def _amos_safe_float(value: str | None) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in ("-", "null", ""):
        return None
    try:
        return float(text)
    except (ValueError, TypeError):
        return None


def _amos_extract_metar_temperature(metar_line: str) -> tuple[Optional[float], Optional[float]]:
    """Extract temperature and dew point from a METAR string like 'RKSI ... 17/08 ...'."""
    match = re.search(r"\b(\d{2})/(\d{2})\b", metar_line)
    if match:
        t = _amos_safe_float(match.group(1))
        d = _amos_safe_float(match.group(2))
        if t is not None and t > 50:
            t = None  # unlikely air temp
        return t, d
    return None, None


def _amos_extract_metar_qnh(metar_line: str) -> Optional[float]:
    """Extract QNH from METAR like 'Q1015'."""
    match = re.search(r"\bQ(\d{4})\b", metar_line)
    if match:
        return _amos_safe_float(match.group(1))
    return None


def _amos_extract_metar_wind(metar_line: str) -> Optional[float]:
    """Extract wind speed in knots from METAR like '22014KT'."""
    match = re.search(r"\b(\d{3})(\d{2,3})KT\b", metar_line)
    if match:
        return _amos_safe_float(match.group(2))
    return None


def _amos_parse_runway_table(text: str) -> list[dict[str, Any]]:
    """Parse the runway-level data from AMOS page HTML text.

    The page shows data organized by runway direction pairs.
    We match patterns like:
      WD 230 (220-250)
      WS 14.2 (10.9-18.7)
      CROSS R14
      HEADTAIL +8
      MOR 10000 RVR P2000
      TEMP/DEW 16.5/9.2
      PRECIP 0 QNH 1015.8
    """
    # Match runway pair headers like 15L/33R
    rwy_pattern = re.compile(r"(\d{2}[LR]?)\s*/\s*(\d{2}[LR]?)")
    runway_pairs = rwy_pattern.findall(text)

    # Temperature/Dew pattern
    temp_pattern = re.compile(r"TEMP\s*/\s*DEW\s*(\d+\.?\d*)\s*/\s*(\d+\.?\d*)")

    # Pressure pattern
    qnh_pattern = re.compile(r"QNH\s*(\d+\.?\d*)\s*hPa")

    # Wind direction pattern
    wd_pattern = re.compile(r"WD\s*(\d+)\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)")

    # Wind speed pattern
    ws_pattern = re.compile(r"WS\s*(\d+\.?\d*)\s*\(\s*(\d+\.?\d*)\s*-\s*(\d+\.?\d*)\s*\)")

    # Visibility pattern
    mor_pattern = re.compile(r"MOR\s*(\d+)")

    # RVR pattern
    rvr_pattern = re.compile(r"RVR\s*P?(\d+)")

    temps = temp_pattern.findall(text)
    qnhs = qnh_pattern.findall(text)

    wd_matches = list(wd_pattern.finditer(text))
    ws_matches = list(ws_pattern.finditer(text))
    mor_matches = list(mor_pattern.finditer(text))
    rvr_matches = list(rvr_pattern.finditer(text))

    return {
        "runway_pairs": [(r[0], r[1]) for r in runway_pairs],
        "temperatures": [(float(t[0]), float(t[1])) for t in temps],
        "pressures_hpa": [float(q) for q in qnhs],
        "wind_directions": [(int(m.group(1)), int(m.group(2)), int(m.group(3))) for m in wd_matches],
        "wind_speeds": [(float(m.group(1)), float(m.group(2)), float(m.group(3))) for m in ws_matches],
        "visibility_mor": [int(m.group(1)) for m in mor_matches],
        "rvr": [int(m.group(1)) for m in rvr_matches],
    }


class AmosStationSourceMixin:
    """Mixin that adds AMOS runway-level data fetching to WeatherDataCollector."""

    amos_cache_ttl_sec: int = 300  # 5 minutes

    def _amos_get_page(self, icao: str) -> Optional[str]:
        """Fetch the AMOS page for a given ICAO code."""
        started = time.perf_counter()
        try:
            # Try multiple URL patterns
            urls = [
                f"{AMOS_BASE_URL}?icao={icao}",
                f"{AMOS_BASE_URL}?stn={AMOS_STATION_IDS.get(icao, '')}",
                AMOS_BASE_URL,  # default page (usually RKSI)
            ]
            for url in urls:
                try:
                    getter = getattr(self, "_http_get_text", None)
                    if callable(getter):
                        text = str(getter(url))
                    else:
                        if not hasattr(self, "session"):
                            break
                        response = self.session.get(
                            url, timeout=float(getattr(self, "timeout", 4.0))
                        )
                        response.raise_for_status()
                        text = response.text
                    if text and icao in text.upper():
                        record_source_call(
                            "amos", "page", "success",
                            (time.perf_counter() - started) * 1000.0,
                        )
                        return text
                except Exception:
                    continue
            return None
        except Exception as exc:
            logger.debug("AMOS page fetch failed icao={}: {}", icao, exc)
            record_source_call(
                "amos", "page", "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None

    def fetch_amos_official_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Fetch AMOS runway-level observations for Seoul or Busan.

        Temperature priority:
        1. METAR temperature (official aerodrome sensor, authoritative)
        2. Median of runway sensor temperatures (fallback; individual runway
           sensors may differ by 0.5-1.0°C due to location/altitude on the airfield)

        Returns a dict with: temp, temp_c, dew, dew_c, pressure_hpa, wind_kt,
        temp_source ("metar" or "runway_median"), runway_temps (list of per-runway
        (temp, dew) tuples), raw_metar, raw_taf, runway_data, source.
        """
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        airport_meta = AMOS_AIRPORT_CODES.get(city_key)
        if not airport_meta:
            return None

        icao = airport_meta["icao"]
        try:
            html = self._amos_get_page(icao)
            if not html:
                return None

            # Parse METAR line
            metar_match = re.search(r"METAR\s+(RKSI|RKPK)\s.*?=", html, re.DOTALL)
            metar_line = metar_match.group(0) if metar_match else ""
            metar_line = re.sub(r"\s+", " ", metar_line).strip()

            # Parse TAF line
            taf_match = re.search(r"TAF\s+(RKSI|RKPK)\s.*?=", html, re.DOTALL)
            taf_line = taf_match.group(0) if taf_match else ""
            taf_line = re.sub(r"\s+", " ", taf_line).strip()

            # METAR is the authoritative aerodrome observation
            metar_temp_c, metar_dew_c = _amos_extract_metar_temperature(metar_line)
            pressure_hpa = _amos_extract_metar_qnh(metar_line)
            wind_kt = _amos_extract_metar_wind(metar_line)

            # Runway-level temperatures from individual sensor pairs
            runway_data = _amos_parse_runway_table(html)
            runway_temps = runway_data.get("temperatures") or []
            runway_pressures = runway_data.get("pressures_hpa") or []

            # Primary: METAR (official aerodrome sensor)
            # Fallback: median of runway sensors (if METAR unavailable)
            # Runway sensors may differ by 0.5-1.0°C from METAR due to
            # different locations/altitudes on the airfield
            temp_c: Optional[float] = metar_temp_c
            dew_c: Optional[float] = metar_dew_c
            temp_source = "metar"

            if temp_c is None and runway_temps:
                runway_temps_only = [t[0] for t in runway_temps if t[0] is not None and -50 < float(t[0]) < 60]
                if runway_temps_only:
                    sorted_t = sorted(runway_temps_only)
                    mid = len(sorted_t) // 2
                    temp_c = float(sorted_t[mid]) if len(sorted_t) % 2 else float((sorted_t[mid-1] + sorted_t[mid]) / 2)
                    temp_source = "runway_median"

            if dew_c is None and runway_temps:
                runway_dews = [t[1] for t in runway_temps if t[1] is not None and -50 < float(t[1]) < 60]
                if runway_dews:
                    sorted_d = sorted(runway_dews)
                    mid = len(sorted_d) // 2
                    dew_c = float(sorted_d[mid]) if len(sorted_d) % 2 else float((sorted_d[mid-1] + sorted_d[mid]) / 2)

            if pressure_hpa is None and runway_pressures:
                sorted_p = sorted(runway_pressures)
                mid = len(sorted_p) // 2
                pressure_hpa = float(sorted_p[mid]) if len(sorted_p) % 2 else float((sorted_p[mid-1] + sorted_p[mid]) / 2)

            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit and temp_c is not None else temp_c
            dew = round(dew_c * 9 / 5 + 32, 1) if use_fahrenheit and dew_c is not None else dew_c

            result: Dict[str, Any] = {
                "temp": temp,
                "temp_c": temp_c,
                "dew": dew,
                "dew_c": dew_c,
                "pressure_hpa": pressure_hpa,
                "wind_kt": wind_kt,
                "temp_source": temp_source,
                "runway_temps": runway_temps,
                "source": "amos",
                "source_label": f"AMOS {airport_meta['label_en']} ({icao})",
                "source_code": "amos",
                "icao": icao,
                "station_label": airport_meta["label_ko"],
                "station_label_en": airport_meta["label_en"],
                "is_official": True,
                "is_airport_station": True,
                "is_settlement_anchor": False,
                "network_type": "amos",
                "raw_metar": metar_line or None,
                "raw_taf": taf_line or None,
                "runway_obs": runway_data if runway_data.get("temperatures") else None,
                "observation_source": "AMOS runway sensors",
                "observation_source_zh": "AMOS 跑道传感器",
                "observation_time": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            }

            record_source_call(
                "amos", "current", "success",
                (time.perf_counter() - started) * 1000.0,
            )
            return result

        except Exception as exc:
            logger.warning("AMOS fetch failed city={}: {}", city_key, exc)
            record_source_call(
                "amos", "current", "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None
