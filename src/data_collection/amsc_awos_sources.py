"""AMSC AWOS runway observation source for China mainland airports.

The AMSC `getWindPlate` endpoint exposes runway-point air temperature fields:
TDZ_TEMP (touchdown zone), MID_TEMP (mid runway), and END_TEMP (runway end).
These values are air temperatures reported by runway observation positions,
not pavement/surface temperatures.
"""

from __future__ import annotations

import json
import os
import ssl
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

from loguru import logger

from src.utils.metrics import record_source_call

AMSC_AWOS_BASE_URL = os.getenv("AMSC_AWOS_BASE_URL", "").strip()

AMSC_AWOS_AIRPORTS: Dict[str, Dict[str, str]] = {
    "shanghai": {"icao": "ZSPD", "label": "Shanghai Pudong"},
    "beijing": {"icao": "ZBAA", "label": "Beijing Capital"},
    "guangzhou": {"icao": "ZGGG", "label": "Guangzhou Baiyun"},
    "chengdu": {"icao": "ZUUU", "label": "Chengdu Shuangliu"},
    "chongqing": {"icao": "ZUCK", "label": "Chongqing Jiangbei"},
    "wuhan": {"icao": "ZHHH", "label": "Wuhan Tianhe"},
    "qingdao": {"icao": "ZSQD", "label": "Qingdao Jiaodong"},
}


def _amsc_supported_city_codes() -> Dict[str, str]:
    return {city: meta["icao"] for city, meta in AMSC_AWOS_AIRPORTS.items()}


def _amsc_safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"-", "--", "null", "None"}:
        return None
    try:
        parsed = float(text)
    except (TypeError, ValueError):
        return None
    if not -80.0 < parsed < 80.0:
        return None
    return parsed


def _amsc_split_runway_pair(label: str) -> tuple[str, str]:
    parts = [part.strip() for part in str(label or "").split("/") if part.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    runway = str(label or "").strip() or "--"
    return runway, runway


def _amsc_wind_dir(*candidates: Any) -> Optional[int]:
    """Parse wind direction from AMSC fields (degrees)."""
    for value in candidates:
        parsed = _amsc_safe_float(value)
        if parsed is not None and 0 <= parsed <= 360:
            return int(round(parsed))
    return None


def _amsc_parse_rvr(value: Any) -> Optional[int]:
    """Parse RVR field like 'P2000' → 2000 (meters)."""
    text = str(value or "").strip().upper()
    if not text or text in {"--", "-", "NULL", "NONE"}:
        return None
    text = text.lstrip("PM")
    parsed = _amsc_safe_float(text)
    return int(round(parsed)) if parsed is not None else None


def _amsc_parse_utc_time(value: Any) -> tuple[Optional[str], Optional[str]]:
    text = str(value or "").strip()
    if not text:
        return None, None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            utc_dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            local_dt = utc_dt + timedelta(hours=8)
            return utc_dt.isoformat(), local_dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    return text, None


def _amsc_parse_wind_plate_payload(
    payload: Dict[str, Any],
    *,
    city_key: str,
    icao: str,
) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    if payload.get("errCode") is not None:
        return None
    if payload.get("code") not in (None, 200, "200"):
        return None

    data = payload.get("data")
    if not isinstance(data, dict) or not data:
        return None

    airport_meta = AMSC_AWOS_AIRPORTS.get(city_key, {"icao": icao, "label": icao})
    runway_pairs = []
    runway_temps = []
    point_temperatures = []
    valid_values = []
    observation_time = None
    observation_time_local = None
    raw_metar = None

    for key, raw_row in data.items():
        if not isinstance(raw_row, dict):
            continue
        runway_label = str(raw_row.get("RNO") or key or "").strip()
        if not runway_label:
            continue
        tdz = _amsc_safe_float(raw_row.get("TDZ_TEMP"))
        mid = _amsc_safe_float(raw_row.get("MID_TEMP"))
        end = _amsc_safe_float(raw_row.get("END_TEMP"))
        points = [value for value in (tdz, mid, end) if value is not None]
        if not points:
            continue

        if observation_time is None:
            observation_time, observation_time_local = _amsc_parse_utc_time(raw_row.get("OTIME"))
        if raw_metar is None and raw_row.get("METAR"):
            raw_metar = str(raw_row.get("METAR"))

        runway_pairs.append(_amsc_split_runway_pair(runway_label))
        best_temp = tdz if tdz is not None else max(points)
        runway_temps.append((best_temp, None))
        valid_values.extend(points)

        # Wind: prefer TDZ point, fallback to END
        wind_dir = _amsc_wind_dir(
            raw_row.get("TDZ_WIND_D10"),
            raw_row.get("END_WIND_D10"),
        )
        wind_speed = _amsc_safe_float(
            raw_row.get("TDZ_WIND_F10") or raw_row.get("END_WIND_F10")
        )
        # RVR / MOR: prefer 1-min average
        raw_rvr = (
            raw_row.get("TDZ_RVR_1A") or raw_row.get("END_RVR_1A")
            or raw_row.get("TDZ_RVR_10A") or raw_row.get("END_RVR_10A")
        )
        rvr = _amsc_parse_rvr(raw_rvr)
        raw_mor = (
            raw_row.get("TDZ_MOR_1A") or raw_row.get("END_MOR_1A")
            or raw_row.get("TDZ_MOR_10A") or raw_row.get("END_MOR_10A")
        )
        mor = _amsc_safe_float(raw_mor)
        # Humidity: prefer TDZ, fallback to END, then MID
        humidity = _amsc_safe_float(
            raw_row.get("TDZ_HUMID") or raw_row.get("END_HUMID") or raw_row.get("MID_HUMID")
        )

        target_max = max(points)
        point_temperatures.append(
            {
                "runway": runway_label,
                "tdz_temp": tdz,
                "mid_temp": mid,
                "end_temp": end,
                "target_runway_max": target_max,
                "wind_dir": wind_dir,
                "wind_speed": wind_speed,
                "rvr": rvr,
                "mor": mor,
                "humidity": humidity,
            }
        )

    if not valid_values or not runway_pairs:
        return None

    max_temp = round(max(valid_values), 1)
    min_temp = round(min(valid_values), 1)
    avg_temp = round(sum(valid_values) / len(valid_values), 1)

    return {
        "temp": max_temp,
        "temp_c": max_temp,
        "temp_source": "runway_max",
        "runway_temps": runway_temps,
        "runway_temp_range": (min_temp, max_temp),
        "runway_temp_avg": avg_temp,
        "source": "amsc_awos",
        "source_label": f"AMSC AWOS {airport_meta.get('label', icao)} ({icao})",
        "source_code": "amsc_awos",
        "network_type": "amsc_awos",
        "icao": icao,
        "station_label": airport_meta.get("label") or icao,
        "raw_metar": raw_metar,
        "raw_taf": None,
        "wind_dir": next((pt.get("wind_dir") for pt in point_temperatures if pt.get("wind_dir") is not None), None) if point_temperatures else None,
        "wind_speed": point_temperatures[0].get("wind_speed") if point_temperatures else None,
        "runway_obs": {
            "runway_pairs": runway_pairs,
            "temperatures": runway_temps,
            "point_temperatures": point_temperatures,
        },
        "observation_source": "AMSC AWOS runway-point air temperature",
        "observation_source_zh": "AMSC AWOS 跑道观测气温",
        "observation_time": observation_time,
        "observation_time_local": observation_time_local,
    }


class AmscAwosSourceMixin:
    """Mixin that adds AMSC AWOS runway-point air temperatures."""

    def _amsc_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Referer": os.getenv("AMSC_AWOS_REFERER", "https://www.amsc.net.cn/"),
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
            ),
        }
        cookie = os.getenv("POLYWEATHER_AMSC_COOKIE", "").strip()
        session_id = os.getenv("POLYWEATHER_AMSC_SESSION_ID", "").strip()
        if cookie:
            headers["Cookie"] = cookie
        elif session_id:
            headers["sessionId"] = session_id
            headers["app"] = "AMS"
        return headers

    def _amsc_http_get_json(self, url: str, *, headers: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = Request(url, headers=headers or {})
        with urlopen(req, timeout=getattr(self, "timeout", 10.0), context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def fetch_amsc_awos_current(
        self,
        city_key: str,
        *,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        del use_fahrenheit  # AMSC reports Celsius; project UI converts elsewhere if needed.
        normalized_city = str(city_key or "").strip().lower()
        airport_meta = AMSC_AWOS_AIRPORTS.get(normalized_city)
        if not airport_meta:
            return None
        icao = airport_meta["icao"]
        url = f"{AMSC_AWOS_BASE_URL}?cccc={quote(icao)}"
        started = time.perf_counter()
        try:
            payload = self._amsc_http_get_json(url, headers=self._amsc_headers())
            result = _amsc_parse_wind_plate_payload(
                payload or {},
                city_key=normalized_city,
                icao=icao,
            )
            if result:
                record_source_call(
                    "amsc_awos",
                    "current",
                    "success",
                    (time.perf_counter() - started) * 1000.0,
                )
            else:
                record_source_call(
                    "amsc_awos",
                    "current",
                    "empty",
                    (time.perf_counter() - started) * 1000.0,
                )
            return result
        except Exception as exc:
            logger.warning("AMSC AWOS fetch failed city={} icao={}: {}", normalized_city, icao, exc)
            record_source_call(
                "amsc_awos",
                "current",
                "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None
