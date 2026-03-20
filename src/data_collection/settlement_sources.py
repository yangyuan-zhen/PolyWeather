from __future__ import annotations

import csv
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger


class SettlementSourceMixin:
    def _get_settlement_cache(self, key: str) -> Optional[Dict[str, Any]]:
        now_ts = time.time()
        with self._settlement_cache_lock:
            cached = self._settlement_cache.get(key)
            if cached and now_ts - float(cached.get("t", 0)) < self.settlement_cache_ttl_sec:
                return cached.get("d")
        return None

    def _set_settlement_cache(self, key: str, payload: Dict[str, Any]) -> None:
        with self._settlement_cache_lock:
            self._settlement_cache[key] = {"t": time.time(), "d": payload}

    @staticmethod
    def _csv_rows(text: str) -> List[Dict[str, str]]:
        normalized = str(text or "").lstrip("﻿")
        if not normalized.strip():
            return []
        return [row for row in csv.DictReader(normalized.splitlines()) if isinstance(row, dict)]

    @staticmethod
    def _hko_parse_local_iso(raw_yyyymmddhhmm: Optional[str]) -> Optional[str]:
        raw = str(raw_yyyymmddhhmm or "").strip()
        if len(raw) != 12 or not raw.isdigit():
            return None
        try:
            dt = datetime.strptime(raw, "%Y%m%d%H%M").replace(
                tzinfo=timezone(timedelta(hours=8))
            )
            return dt.isoformat()
        except Exception:
            return None

    @staticmethod
    def _hko_compass_to_deg(compass: Optional[str]) -> Optional[float]:
        value = str(compass or "").strip().upper()
        if not value:
            return None
        mapping = {
            "N": 0.0,
            "NNE": 22.5,
            "NE": 45.0,
            "ENE": 67.5,
            "E": 90.0,
            "ESE": 112.5,
            "SE": 135.0,
            "SSE": 157.5,
            "S": 180.0,
            "SSW": 202.5,
            "SW": 225.0,
            "WSW": 247.5,
            "W": 270.0,
            "WNW": 292.5,
            "NW": 315.0,
            "NNW": 337.5,
        }
        return mapping.get(value)

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text in {"***", "N/A", "NA"}:
            return None
        try:
            return float(text)
        except Exception:
            return None

    @staticmethod
    def _pick_station_row(
        rows: List[Dict[str, str]], candidates: List[str]
    ) -> Optional[Dict[str, str]]:
        if not rows:
            return None
        normalized_map = {
            str(name).strip().lower(): row
            for row in rows
            for name in [row.get("Automatic Weather Station")]
            if isinstance(row, dict) and name
        }
        for name in candidates:
            hit = normalized_map.get(str(name).strip().lower())
            if hit:
                return hit
        for row in rows:
            station = str(row.get("Automatic Weather Station") or "").strip().lower()
            if "observatory" in station:
                return row
        return rows[0] if rows else None

    def fetch_hko_settlement_current(self) -> Optional[Dict[str, Any]]:
        cache_key = "hko:hong_kong"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            base = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather"
            temp_csv = self.session.get(f"{base}/latest_1min_temperature.csv", timeout=self.timeout)
            temp_csv.raise_for_status()
            maxmin_csv = self.session.get(f"{base}/latest_since_midnight_maxmin.csv", timeout=self.timeout)
            maxmin_csv.raise_for_status()
            humidity_csv = self.session.get(f"{base}/latest_1min_humidity.csv", timeout=self.timeout)
            humidity_csv.raise_for_status()
            wind_csv = self.session.get(f"{base}/latest_10min_wind.csv", timeout=self.timeout)
            wind_csv.raise_for_status()

            temp_rows = self._csv_rows(temp_csv.text)
            maxmin_rows = self._csv_rows(maxmin_csv.text)
            humidity_rows = self._csv_rows(humidity_csv.text)
            wind_rows = self._csv_rows(wind_csv.text)

            station_candidates = ["HK Observatory", "Hong Kong Observatory"]
            temp_row = self._pick_station_row(temp_rows, station_candidates)
            maxmin_row = self._pick_station_row(maxmin_rows, station_candidates)
            humidity_row = self._pick_station_row(humidity_rows, station_candidates)
            wind_row = self._pick_station_row(wind_rows, station_candidates)
            if not temp_row or not maxmin_row:
                return None

            obs_raw = temp_row.get("Date time") or maxmin_row.get("Date time")
            obs_iso = self._hko_parse_local_iso(obs_raw)
            current_temp = self._safe_float(temp_row.get("Air Temperature(degree Celsius)"))
            max_so_far = self._safe_float(maxmin_row.get("Maximum Air Temperature Since Midnight(degree Celsius)"))
            min_so_far = self._safe_float(maxmin_row.get("Minimum Air Temperature Since Midnight(degree Celsius)"))
            humidity = self._safe_float(humidity_row.get("Relative Humidity(percent)")) if humidity_row else None
            wind_speed_kmh = self._safe_float(wind_row.get("10-Minute Mean Speed(km/hour)")) if wind_row else None
            wind_speed_kt = round(float(wind_speed_kmh) / 1.852, 1) if wind_speed_kmh is not None else None
            wind_dir = self._hko_compass_to_deg(
                wind_row.get("10-Minute Mean Wind Direction(Compass points)") if wind_row else None
            )

            payload: Dict[str, Any] = {
                "source": "hko",
                "source_label": "HKO",
                "station_code": "HKO",
                "station_name": "HK Observatory",
                "observation_time": obs_iso,
                "current": {
                    "temp": round(current_temp, 1) if current_temp is not None else None,
                    "max_temp_so_far": round(max_so_far, 1) if max_so_far is not None else None,
                    "max_temp_time": None,
                    "today_low": round(min_so_far, 1) if min_so_far is not None else None,
                    "humidity": round(humidity, 1) if humidity is not None else None,
                    "wind_speed_kt": wind_speed_kt,
                    "wind_dir": wind_dir,
                },
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, payload)
            return payload
        except Exception as exc:
            logger.warning(f"HKO settlement fetch failed: {exc}")
            return None

    def fetch_cwa_taipei_settlement_current(self) -> Optional[Dict[str, Any]]:
        cache_key = "cwa:taipei:466920"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"
            response = self.session.get(
                url,
                params={"Authorization": self.cwa_open_data_auth, "format": "JSON", "StationId": "466920"},
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json() if response.content else {}
            stations = (data.get("records") or {}).get("Station") or []
            if isinstance(stations, dict):
                station = stations
            elif isinstance(stations, list) and stations:
                station = stations[0]
            else:
                station = None
            if not isinstance(station, dict):
                return None

            wx = station.get("WeatherElement") or {}
            if not isinstance(wx, dict):
                wx = {}
            daily_extreme = wx.get("DailyExtreme") or {}
            high_info = (((daily_extreme.get("DailyHigh") or {}).get("TemperatureInfo") or {}))
            low_info = (((daily_extreme.get("DailyLow") or {}).get("TemperatureInfo") or {}))
            high_time_raw = (((high_info.get("Occurred_at") or {}).get("DateTime")))
            high_hhmm = None
            if high_time_raw and "T" in str(high_time_raw):
                try:
                    high_hhmm = datetime.fromisoformat(str(high_time_raw)).strftime("%H:%M")
                except Exception:
                    high_hhmm = str(high_time_raw).split("T")[1][:5]

            obs_time_raw = (station.get("ObsTime") or {}).get("DateTime")
            wind_speed_ms = self._safe_float(wx.get("WindSpeed"))
            payload: Dict[str, Any] = {
                "source": "cwa",
                "source_label": "CWA",
                "station_code": str(station.get("StationId") or "466920"),
                "station_name": str(station.get("StationName") or "臺北"),
                "observation_time": str(obs_time_raw or "").strip() or None,
                "current": {
                    "temp": self._safe_float(wx.get("AirTemperature")),
                    "max_temp_so_far": self._safe_float(high_info.get("AirTemperature")),
                    "max_temp_time": high_hhmm,
                    "today_low": self._safe_float(low_info.get("AirTemperature")),
                    "humidity": self._safe_float(wx.get("RelativeHumidity")),
                    "wind_speed_kt": round(float(wind_speed_ms) * 1.943844, 1) if wind_speed_ms is not None else None,
                    "wind_dir": self._safe_float(wx.get("WindDirection")),
                },
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, payload)
            return payload
        except Exception as exc:
            logger.warning(f"CWA settlement fetch failed: {exc}")
            return None

    def fetch_hko_forecast(self) -> Optional[float]:
        try:
            url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"
            res = self.session.get(url, timeout=self.timeout).json()
            return float(res["weatherForecast"][0]["forecastMaxtemp"]["value"])
        except Exception as exc:
            logger.warning(f"HKO Forecast request failed: {exc}")
            return None

    def fetch_cwa_taipei_forecast(self) -> Optional[float]:
        try:
            if not self.cwa_open_data_auth:
                return None
            url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061"
            res = self.session.get(
                url,
                params={"Authorization": self.cwa_open_data_auth, "format": "JSON", "elementName": "MaxT"},
                timeout=self.timeout,
            ).json()
            locs = res.get("records", {}).get("Locations", [])[0].get("Location", [])
            if not locs:
                return None
            loc = locs[0]
            for weather_element in loc.get("WeatherElement", []):
                if weather_element.get("ElementName") == "MaxT":
                    return float(weather_element["Time"][0]["ElementValue"][0]["Temperature"])
            return None
        except Exception as exc:
            logger.warning(f"CWA Forecast request failed: {exc}")
            return None

    def fetch_settlement_current(self, city: str) -> Optional[Dict[str, Any]]:
        normalized = str(city or "").strip().lower()
        if normalized == "hong kong":
            return self.fetch_hko_settlement_current()
        if normalized == "taipei":
            return self.fetch_cwa_taipei_settlement_current()
        return None
