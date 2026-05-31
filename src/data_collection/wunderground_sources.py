from __future__ import annotations

import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
from loguru import logger

from src.utils.metrics import record_source_call
from src.utils.refresh_policy import OBSERVATION_REFRESH_SEC


DEFAULT_WEATHER_COM_API_KEY = "6532d6454b8aa370768e63d6ba5a832e"

ICAO_COUNTRY_PREFIXES = {
    "C": "CA",
    "E": "GB",
    "K": "US",
    "L": "FR",
    "M": "MX",
    "O": "SA",
    "R": "JP",
    "S": "BR",
    "V": "HK",
    "W": "SG",
    "Z": "CN",
}

ICAO_COUNTRY_EXACT_PREFIXES = {
    "ED": "DE",
    "EF": "FI",
    "EG": "GB",
    "EH": "NL",
    "EP": "PL",
    "LE": "ES",
    "LF": "FR",
    "LI": "IT",
    "LL": "IL",
    "LT": "TR",
    "MM": "MX",
    "MP": "PA",
    "OE": "SA",
    "OP": "PK",
    "RC": "TW",
    "RJ": "JP",
    "RK": "KR",
    "RP": "PH",
    "SA": "AR",
    "SB": "BR",
    "VE": "IN",
    "VH": "HK",
    "VI": "IN",
    "WM": "MY",
    "WS": "SG",
    "WI": "ID",
    "FA": "ZA",
    "CY": "CA",
}

WU_PATH_COUNTRY_ALIASES = {
    "uk": "GB",
}


class WundergroundHistoricalMixin:
    def _ensure_wunderground_historical_cache(self) -> None:
        if not hasattr(self, "_wunderground_historical_cache"):
            self._wunderground_historical_cache = {}
        if not hasattr(self, "_wunderground_historical_cache_lock"):
            self._wunderground_historical_cache_lock = threading.Lock()
        if not hasattr(self, "_wunderground_negative_cache"):
            self._wunderground_negative_cache = {}
        if not hasattr(self, "wunderground_negative_cache_ttl_sec"):
            self.wunderground_negative_cache_ttl_sec = max(
                60,
                int(os.getenv("WUNDERGROUND_NEGATIVE_CACHE_TTL_SEC", "900")),
            )
        if not hasattr(self, "wunderground_historical_cache_ttl_sec"):
            self.wunderground_historical_cache_ttl_sec = max(
                30,
                int(
                    os.getenv(
                        "WUNDERGROUND_HISTORICAL_CACHE_TTL_SEC",
                        str(OBSERVATION_REFRESH_SEC),
                    )
                ),
            )

    def _wunderground_api_key(self) -> str:
        return (
            os.getenv("POLYWEATHER_WUNDERGROUND_API_KEY")
            or os.getenv("WUNDERGROUND_API_KEY")
            or DEFAULT_WEATHER_COM_API_KEY
        ).strip()

    def _wunderground_country_from_url(self, city_meta: Dict[str, Any]) -> Optional[str]:
        url = str(city_meta.get("settlement_url") or "").strip().lower()
        match = re.search(r"/history/daily/([^/]+)/", url)
        if not match:
            return None
        raw = match.group(1).strip().upper()
        return WU_PATH_COUNTRY_ALIASES.get(raw.lower(), raw)

    def _wunderground_country_from_icao(self, icao: str) -> Optional[str]:
        icao = str(icao or "").strip().upper()
        if len(icao) >= 2 and icao[:2] in ICAO_COUNTRY_EXACT_PREFIXES:
            return ICAO_COUNTRY_EXACT_PREFIXES[icao[:2]]
        if icao[:1] in ICAO_COUNTRY_PREFIXES:
            return ICAO_COUNTRY_PREFIXES[icao[:1]]
        return None

    def _wunderground_location_id(self, city: str) -> Optional[str]:
        normalized = str(city or "").strip().lower()
        city_meta = (getattr(self, "CITY_REGISTRY", {}) or {}).get(normalized) or {}
        station_code = (
            str(city_meta.get("wunderground_station_code") or "").strip()
            or str(city_meta.get("settlement_station_code") or "").strip()
            or str(city_meta.get("icao") or "").strip()
        )
        if not station_code and hasattr(self, "get_icao_code"):
            station_code = str(self.get_icao_code(city) or "").strip()
        station_code = station_code.upper()
        if not station_code:
            return None

        country_code = (
            str(city_meta.get("wunderground_country_code") or "").strip().upper()
            or self._wunderground_country_from_url(city_meta)
            or self._wunderground_country_from_icao(station_code)
        )
        if not country_code:
            return None
        return f"{station_code}:9:{country_code}"

    @staticmethod
    def _wu_local_date(utc_offset: int, local_date: Optional[str]) -> str:
        if local_date:
            return str(local_date).replace("-", "")[:8]
        now_local = datetime.now(timezone.utc) + timedelta(seconds=int(utc_offset or 0))
        return now_local.strftime("%Y%m%d")

    @staticmethod
    def _wu_float(value: Any) -> Optional[float]:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        if not (numeric == numeric):
            return None
        return numeric

    @staticmethod
    def _wu_temp_value(value: float) -> int | float:
        return round(value, 1) if isinstance(value, float) and value % 1 else int(value)

    def _wu_request_headers(self) -> Dict[str, str]:
        return {
            "Accept": "application/json",
            "User-Agent": getattr(self, "user_agent", "PolyWeather/1.0"),
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }

    def _parse_wunderground_current_point(
        self,
        data: Dict[str, Any],
        *,
        units: str,
        utc_offset: int,
        local_date_iso: str,
    ) -> Optional[Dict[str, Any]]:
        observation = data.get("observation") if isinstance(data, dict) else None
        if not isinstance(observation, dict):
            return None

        unit_bucket_name = "imperial" if units == "e" else "metric"
        unit_bucket = observation.get(unit_bucket_name)
        if not isinstance(unit_bucket, dict):
            unit_bucket = observation.get("metric") if isinstance(observation.get("metric"), dict) else {}
        temp = self._wu_float(unit_bucket.get("temp") if isinstance(unit_bucket, dict) else None)
        if temp is None:
            return None

        ts = observation.get("obs_time") or observation.get("valid_time_gmt")
        local_dt = None
        raw_local = str(observation.get("obs_time_local") or "").strip()
        if raw_local:
            try:
                local_dt = datetime.strptime(raw_local, "%Y-%m-%dT%H:%M:%S%z")
                ts = int(local_dt.timestamp())
            except ValueError:
                local_dt = None
        if local_dt is None:
            try:
                utc_dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except (TypeError, ValueError, OSError):
                return None
            local_dt = utc_dt + timedelta(seconds=int(utc_offset or 0))
        if local_dt.strftime("%Y-%m-%d") != local_date_iso:
            return None
        if units == "m" and hasattr(self, "_is_plausible_metar_temp_c"):
            if not self._is_plausible_metar_temp_c(temp, "", str(observation.get("obs_id") or "")):
                return None

        max_24h = self._wu_float(
            unit_bucket.get("temp_max_24hour") if isinstance(unit_bucket, dict) else None
        )
        return {
            "ts": int(ts),
            "time": local_dt.strftime("%H:%M"),
            "temp": self._wu_temp_value(temp),
            "max_24h": self._wu_temp_value(max_24h) if max_24h is not None else None,
            "wx_desc": observation.get("phrase_32char")
            or observation.get("phrase_22char")
            or observation.get("phrase_12char"),
        }

    def fetch_wunderground_historical(
        self,
        city: str,
        *,
        use_fahrenheit: bool = False,
        utc_offset: int = 0,
        local_date: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Fetch Wunderground/weather.com intraday history for the city-local day."""
        started = time.perf_counter()
        self._ensure_wunderground_historical_cache()

        api_key = self._wunderground_api_key()
        location_id = self._wunderground_location_id(city)
        if not api_key or not location_id:
            record_source_call("wunderground", "historical", "missing_location", 0.0)
            return None

        date_key = self._wu_local_date(utc_offset, local_date)
        units = "e" if use_fahrenheit else "m"
        cache_key = f"wu:{location_id}:{units}:{date_key}"
        now_ts = time.time()
        with self._wunderground_historical_cache_lock:
            cached = self._wunderground_historical_cache.get(cache_key)
            if cached and now_ts - float(cached.get("t", 0)) < self.wunderground_historical_cache_ttl_sec:
                return dict(cached["d"])
            negative_cached = self._wunderground_negative_cache.get(cache_key)
            if negative_cached and now_ts - float(negative_cached.get("t", 0)) < self.wunderground_negative_cache_ttl_sec:
                record_source_call(
                    "wunderground",
                    "historical",
                    "negative_cached",
                    (time.perf_counter() - started) * 1000.0,
                )
                return None

        current_url = (
            "https://api.weather.com/v1/location/"
            f"{quote(location_id, safe=':')}/observations/current.json"
            f"?apiKey={quote(api_key)}&units={units}"
        )
        url = (
            "https://api.weather.com/v1/location/"
            f"{quote(location_id, safe=':')}/observations/historical.json"
            f"?apiKey={quote(api_key)}&units={units}&startDate={date_key}&endDate={date_key}"
        )

        current_data: Optional[Dict[str, Any]] = None
        try:
            current_response = self._http_get(
                current_url,
                timeout=float(os.getenv("WUNDERGROUND_CURRENT_TIMEOUT_SEC", "4")),
                headers=self._wu_request_headers(),
            )
            if current_response.status_code != 204:
                current_response.raise_for_status()
                parsed_current = current_response.json()
                if isinstance(parsed_current, dict):
                    current_data = parsed_current
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "Wunderground current fetch failed city={} location={} error={}",
                city,
                location_id,
                exc,
            )

        try:
            response = self._http_get(
                url,
                timeout=float(os.getenv("WUNDERGROUND_HISTORICAL_TIMEOUT_SEC", "4")),
                headers=self._wu_request_headers(),
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "Wunderground historical fetch failed city={} location={} error={}",
                city,
                location_id,
                exc,
            )
            if (
                isinstance(exc, httpx.HTTPStatusError)
                and exc.response is not None
                and 400 <= exc.response.status_code < 500
            ):
                with self._wunderground_historical_cache_lock:
                    self._wunderground_negative_cache[cache_key] = {
                        "t": time.time(),
                        "status": exc.response.status_code,
                    }
            record_source_call(
                "wunderground",
                "historical",
                "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None

        observations = data.get("observations") if isinstance(data, dict) else []
        if not isinstance(observations, list) or not observations:
            record_source_call(
                "wunderground",
                "historical",
                "empty",
                (time.perf_counter() - started) * 1000.0,
            )
            return None

        local_date_iso = f"{date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}"
        points = []
        for row in observations:
            if not isinstance(row, dict):
                continue
            temp = self._wu_float(row.get("temp"))
            ts = row.get("valid_time_gmt")
            if temp is None or ts is None:
                continue
            try:
                utc_dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except (TypeError, ValueError, OSError):
                continue
            local_dt = utc_dt + timedelta(seconds=int(utc_offset or 0))
            if local_dt.strftime("%Y-%m-%d") != local_date_iso:
                continue
            if not use_fahrenheit and hasattr(self, "_is_plausible_metar_temp_c"):
                if not self._is_plausible_metar_temp_c(temp, city, str(row.get("obs_id") or location_id)):
                    continue
            points.append(
                {
                    "ts": int(ts),
                    "time": local_dt.strftime("%H:%M"),
                    "temp": self._wu_temp_value(temp),
                    "wx_desc": row.get("wx_phrase"),
                }
            )

        current_point = (
            self._parse_wunderground_current_point(
                current_data,
                units=units,
                utc_offset=utc_offset,
                local_date_iso=local_date_iso,
            )
            if isinstance(current_data, dict)
            else None
        )
        if current_point:
            points = [point for point in points if point.get("ts") != current_point["ts"]]
            points.append(current_point)

        if not points:
            record_source_call(
                "wunderground",
                "historical",
                "empty_local_day",
                (time.perf_counter() - started) * 1000.0,
            )
            return None

        points.sort(key=lambda item: item["ts"])
        latest = points[-1]
        max_point = points[0]
        for point in points[1:]:
            if float(point["temp"]) > float(max_point["temp"]):
                max_point = point
        if current_point and current_point.get("max_24h") is not None:
            current_max = current_point["max_24h"]
            if float(current_max) > float(max_point["temp"]):
                max_point = {
                    "ts": current_point["ts"],
                    "time": current_point["time"],
                    "temp": current_max,
                    "wx_desc": current_point.get("wx_desc"),
                }

        station_code = location_id.split(":", 1)[0]
        payload = {
            "source": "wunderground_historical",
            "source_code": "wunderground",
            "source_label": "Wunderground historical/current.json",
            "station_code": station_code,
            "location_id": location_id,
            "local_date": local_date_iso,
            "temp_symbol": "°F" if use_fahrenheit else "°C",
            "temp": latest["temp"],
            "latest_temp": latest["temp"],
            "obs_time": latest["time"],
            "max_so_far": max_point["temp"],
            "daily_high": max_point["temp"],
            "max_temp_time": max_point["time"],
            "today_obs": [{"time": p["time"], "temp": p["temp"]} for p in points],
            "observation_count": len(points),
            "api_units": units,
            "current_json_used": bool(current_point),
        }
        with self._wunderground_historical_cache_lock:
            self._wunderground_historical_cache[cache_key] = {
                "t": time.time(),
                "d": payload,
            }
            self._wunderground_negative_cache.pop(cache_key, None)
        record_source_call(
            "wunderground",
            "historical",
            "success",
            (time.perf_counter() - started) * 1000.0,
        )
        return dict(payload)
