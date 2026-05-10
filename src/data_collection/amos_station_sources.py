"""AMOS (Aerodrome Meteorological Observation System) real-time data source.

Fetches runway-level observations from global.amo.go.kr for Korean airports.
Provides per-runway wind, temperature, pressure, visibility, RVR, cloud data.
"""

from __future__ import annotations

import re
import time
from html import unescape
from datetime import datetime
from typing import Any, Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call

AMOS_BASE_URL = "https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do"
AMOS_AIRPORT_QUERY_KEYS = (
    "stnCd",
    "icao",
    "airport",
    "airportCd",
    "airPort",
)

AMOS_AIRPORT_CODES: Dict[str, Dict[str, str]] = {
    "seoul": {
        "icao": "RKSI",
        "stn_id": "113",
        "label_ko": "인천공항",
        "label_en": "Incheon Intl",
    },
    "busan": {
        "icao": "RKPK",
        "stn_id": "153",
        "label_ko": "김해공항",
        "label_en": "Gimhae Intl",
    },
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


def _amos_to_lines(text: str) -> list[str]:
    """Convert the AMOS HTML/plain text page to parseable text lines."""
    normalized = unescape(str(text or ""))
    # The public AMOS page is table-heavy.  Preserve cell boundaries as
    # whitespace/newlines so regexes work both on raw HTML and crawler text.
    normalized = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", normalized)
    normalized = re.sub(r"(?i)</\s*(?:tr|div|p|li|h\d|table)\s*>", "\n", normalized)
    normalized = re.sub(r"<[^>]+>", " ", normalized)
    normalized = normalized.replace("\xa0", " ")
    return [re.sub(r"\s+", " ", line).strip() for line in normalized.splitlines() if line.strip()]


def _amos_is_runway_token(value: str) -> bool:
    text = str(value or "").strip()
    return bool(
        re.match(r"^\d{2}[LRC]?$", text, re.I)
        or re.match(r"^[NS]\s+[LR]$", text, re.I)
    )


def _amos_parse_cell_table(lines: list[str]) -> Optional[dict[str, Any]]:
    """Parse the actual AMOS HTML table after it has been flattened to cells."""
    runway_rows: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        token = lines[i].strip()
        if (
            _amos_is_runway_token(token)
            and i + 3 < len(lines)
            and lines[i + 1].upper() == "AVG"
            and lines[i + 2].upper() == "MIN"
            and lines[i + 3].upper() == "MAX"
        ):
            row: dict[str, Any] = {"runway": token.upper()}
            i += 4
            while i < len(lines):
                label = lines[i].strip()
                upper = label.upper()
                if (
                    _amos_is_runway_token(label)
                    and i + 3 < len(lines)
                    and lines[i + 1].upper() == "AVG"
                    and lines[i + 2].upper() == "MIN"
                    and lines[i + 3].upper() == "MAX"
                ):
                    break
                if upper == "WD" and i + 3 < len(lines):
                    wd = [_amos_safe_float(lines[i + j]) for j in range(1, 4)]
                    if all(v is not None for v in wd):
                        row["wind_direction"] = (int(wd[0]), int(wd[1]), int(wd[2]))
                    i += 4
                    continue
                if upper == "WS" and i + 3 < len(lines):
                    ws = [_amos_safe_float(lines[i + j]) for j in range(1, 4)]
                    if all(v is not None for v in ws):
                        row["wind_speed"] = (float(ws[0]), float(ws[1]), float(ws[2]))
                    i += 4
                    continue
                if upper == "MOR" and i + 1 < len(lines):
                    mor = _amos_safe_float(lines[i + 1])
                    if mor is not None and "visibility_mor" not in row:
                        row["visibility_mor"] = int(mor)
                    i += 2
                    continue
                if upper == "RVR" and i + 1 < len(lines):
                    rvr = _amos_safe_float(str(lines[i + 1]).lstrip("P"))
                    if rvr is not None and "rvr" not in row:
                        row["rvr"] = int(rvr)
                    i += 2
                    continue
                if upper.startswith("TEMP") and i + 1 < len(lines):
                    row["temp"] = _amos_safe_float(lines[i + 1])
                    i += 2
                    continue
                if upper.startswith("DEW") and i + 1 < len(lines):
                    row["dew"] = _amos_safe_float(lines[i + 1])
                    i += 2
                    continue
                if upper == "QNH (HPA)" and i + 1 < len(lines):
                    row["pressure_hpa"] = _amos_safe_float(lines[i + 1])
                    i += 2
                    continue
                i += 1
            runway_rows.append(row)
            continue
        i += 1

    if len(runway_rows) < 2:
        return None

    runway_pairs: list[tuple[str, str]] = []
    temperatures: list[tuple[Optional[float], Optional[float]]] = []
    pressures_hpa: list[Optional[float]] = []
    wind_directions: list[Optional[tuple[int, int, int]]] = []
    wind_speeds: list[Optional[tuple[float, float, float]]] = []
    visibility_mor: list[Optional[int]] = []
    rvr_values: list[Optional[int]] = []

    for idx in range(0, len(runway_rows) - 1, 2):
        first = runway_rows[idx]
        second = runway_rows[idx + 1]
        runway_pairs.append((str(first["runway"]), str(second["runway"])))
        temp = first.get("temp")
        dew = first.get("dew")
        if temp is None and second.get("temp") is not None:
            temp = second.get("temp")
            dew = second.get("dew")
        temperatures.append((temp, dew))
        pressures_hpa.append(first.get("pressure_hpa") or second.get("pressure_hpa"))
        wind_directions.append(first.get("wind_direction") or second.get("wind_direction"))
        wind_speeds.append(first.get("wind_speed") or second.get("wind_speed"))
        visibility_mor.append(first.get("visibility_mor") or second.get("visibility_mor"))
        rvr_values.append(first.get("rvr") or second.get("rvr"))

    return {
        "runway_pairs": runway_pairs,
        "temperatures": temperatures,
        "pressures_hpa": pressures_hpa,
        "wind_directions": wind_directions,
        "wind_speeds": wind_speeds,
        "visibility_mor": visibility_mor,
        "rvr": rvr_values,
    }


def _amos_parse_runway_table(text: str) -> dict[str, Any]:
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
    lines = _amos_to_lines(text)
    cell_table = _amos_parse_cell_table(lines)
    if cell_table and cell_table.get("runway_pairs"):
        return cell_table

    normalized_text = "\n".join(lines)

    runway_pairs: list[tuple[str, str]] = []
    temperatures: list[tuple[float, float]] = []
    pressures_hpa: list[float] = []
    wind_directions: list[tuple[int, int, int]] = []
    wind_speeds: list[tuple[float, float, float]] = []
    visibility_mor: list[int] = []
    rvr: list[int] = []

    pending_temp: float | None = None

    # Current public page format is line/table-cell based:
    #   15R AVG MIN MAX
    #   WD 240 220 250
    #   WS 4.7 2.9 6.8
    #   TEMP(℃) 13.7
    #   DEW (℃) 9.8
    #   QNH (hPa) 1021.0
    #   33L AVG MIN MAX
    # Older crawler output may use "15R/33L" and "TEMP/DEW 13.7/9.8".
    for line in lines:
        runway_header = re.match(r"^(\d{2}[LR]?)\s+AVG\s+MIN\s+MAX\b", line, re.I)
        if runway_header:
            continue

        pair_match = re.match(r"^(\d{2}[LR]?)\s*/\s*(\d{2}[LR]?)$", line)
        if not pair_match:
            pair_match = re.match(r"^(\d{2}[LR]?)\s+(\d{2}[LR]?)$", line)
        if pair_match:
            pair = (pair_match.group(1), pair_match.group(2))
            # Ignore bare duplicated orientation rows such as "15 33" when
            # richer L/R pair labels are present nearby, but keep them as a
            # fallback for airports without side designators.
            if pair not in runway_pairs:
                runway_pairs.append(pair)
            continue

        wd = re.match(r"^WD\s+(\d+)\s+(\d+)\s+(\d+)\b", line, re.I)
        if wd:
            wind_directions.append((int(wd.group(1)), int(wd.group(2)), int(wd.group(3))))
            continue

        ws = re.match(r"^WS\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\b", line, re.I)
        if ws:
            wind_speeds.append((float(ws.group(1)), float(ws.group(2)), float(ws.group(3))))
            continue

        temp_dew = re.search(
            r"TEMP\s*/\s*DEW\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)",
            line,
            re.I,
        )
        if temp_dew:
            temperatures.append((float(temp_dew.group(1)), float(temp_dew.group(2))))
            continue

        temp_match = re.search(r"TEMP\s*\([^)]*\)\s*(\d+(?:\.\d+)?)", line, re.I)
        if temp_match:
            pending_temp = float(temp_match.group(1))
            continue

        dew_match = re.search(r"DEW\s*\([^)]*\)\s*(\d+(?:\.\d+)?)", line, re.I)
        if dew_match and pending_temp is not None:
            temperatures.append((pending_temp, float(dew_match.group(1))))
            pending_temp = None
            continue

        qnh = re.search(r"QNH\s*(?:\(\s*hPa\s*\))?\s*(\d+(?:\.\d+)?)", line, re.I)
        if qnh:
            pressures_hpa.append(float(qnh.group(1)))
            continue

        mor = re.match(r"^MOR\s+(\d+)", line, re.I)
        if mor:
            visibility_mor.append(int(mor.group(1)))
            continue

        rvr_match = re.match(r"^RVR\s+P?(\d+)", line, re.I)
        if rvr_match:
            rvr.append(int(rvr_match.group(1)))

    # Prefer concrete runway-side pairs (15L/33R) over repeated orientation
    # rows (15/33).  If no paired label exists, pair runway headers in order.
    side_pairs = [p for p in runway_pairs if any(ch in "".join(p) for ch in ("L", "R", "C"))]
    if side_pairs:
        runway_pairs = side_pairs
    elif not runway_pairs:
        headers = re.findall(r"^(\d{2}[LRC]?)\s+AVG\s+MIN\s+MAX\b", normalized_text, re.I | re.M)
        runway_pairs = [
            (headers[i], headers[i + 1])
            for i in range(0, len(headers) - 1, 2)
        ]

    return {
        "runway_pairs": runway_pairs,
        "temperatures": temperatures,
        "pressures_hpa": pressures_hpa,
        "wind_directions": wind_directions,
        "wind_speeds": wind_speeds,
        "visibility_mor": visibility_mor,
        "rvr": rvr,
    }


class AmosStationSourceMixin:
    """Mixin that adds AMOS runway-level data fetching to WeatherDataCollector."""

    amos_cache_ttl_sec: int = 300  # 5 minutes

    def _amos_get_page(self, icao: str) -> Optional[str]:
        """Fetch the AMOS page.

        The AMOS site loads Incheon (RKSI) by default.  Keep the default URL
        for RKSI and try common airport-code query keys for other airports;
        only accept a response when the requested ICAO is present, so ignored
        parameters cannot accidentally attach RKSI data to Busan/RKPK.
        """
        started = time.perf_counter()
        icao = str(icao or "").strip().upper()
        stn_id = next(
            (
                meta.get("stn_id")
                for meta in AMOS_AIRPORT_CODES.values()
                if meta.get("icao") == icao
            ),
            None,
        )
        urls = [(AMOS_BASE_URL, None)]
        if stn_id:
            urls = [(AMOS_BASE_URL, {"stnId": stn_id})]
        if icao != "RKSI" and not stn_id:
            urls = [f"{AMOS_BASE_URL}?{key}={icao}" for key in AMOS_AIRPORT_QUERY_KEYS]

        try:
            for url_item in urls:
                getter = getattr(self, "_http_get_text", None)
                post_data = None
                if isinstance(url_item, tuple):
                    url, post_data = url_item
                else:
                    url = url_item
                if post_data is None and callable(getter):
                    text = str(getter(url))
                elif hasattr(self, "session"):
                    if post_data is not None:
                        resp = self.session.post(
                            url,
                            data=post_data,
                            timeout=float(getattr(self, "timeout", 4.0)),
                        )
                    else:
                        resp = self.session.get(url, timeout=float(getattr(self, "timeout", 4.0)))
                    resp.raise_for_status()
                    text = resp.text
                else:
                    return None

                if text and re.search(rf"\({icao}\)|\b(?:METAR|TAF)\s+{icao}\b", text, re.I):
                    record_source_call("amos", "page", "success", (time.perf_counter() - started) * 1000.0)
                    return text
            logger.debug("AMOS page did not expose requested airport {}", icao)
            return None
        except Exception as exc:
            logger.debug("AMOS page fetch failed icao={}: {}", icao, exc)
            record_source_call("amos", "page", "error", (time.perf_counter() - started) * 1000.0)
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
            icao_pattern = re.escape(icao)
            metar_match = re.search(rf"METAR\s+{icao_pattern}\s.*?=", html, re.DOTALL)
            metar_line = metar_match.group(0) if metar_match else ""
            metar_line = re.sub(r"\s+", " ", metar_line).strip()

            # Parse TAF line
            taf_match = re.search(rf"TAF\s+{icao_pattern}\s.*?=", html, re.DOTALL)
            taf_line = taf_match.group(0) if taf_match else ""
            taf_line = re.sub(r"\s+", " ", taf_line).strip()

            # METAR is the authoritative aerodrome observation
            metar_temp_c, metar_dew_c = _amos_extract_metar_temperature(metar_line)
            pressure_hpa = _amos_extract_metar_qnh(metar_line)
            wind_kt = _amos_extract_metar_wind(metar_line)

            # Runway-level temperatures from individual sensor pairs
            runway_data = _amos_parse_runway_table(html)
            runway_temps = runway_data.get("temperatures") or []
            runway_pressures = [
                float(p)
                for p in (runway_data.get("pressures_hpa") or [])
                if p is not None
            ]

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
