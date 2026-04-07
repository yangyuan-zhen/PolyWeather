from __future__ import annotations

import csv
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from src.database.runtime_state import (
    OfficialIntradayObservationRepository,
    STATE_STORAGE_DUAL,
    STATE_STORAGE_SQLITE,
    get_state_storage_mode,
)


_official_intraday_repo = OfficialIntradayObservationRepository()


class SettlementSourceMixin:
    IMGW_METEO_API_BASE = "https://meteo.imgw.pl/api/v1"
    IMGW_METEO_API_TOKEN = "p4DXKjsYadfBV21TYrDk"
    NOAA_WRH_MESO_TOKEN = "7c76618b66c74aee913bdbae4b448bdd"
    NOAA_WRH_TIMESERIES_REFERER_BASE = "https://www.weather.gov/wrh/timeseries?site="

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
    def _js_round(value: Any) -> Optional[int]:
        parsed = SettlementSourceMixin._safe_float(value)
        if parsed is None:
            return None
        return int(math.floor(float(parsed) + 0.5))

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

    def _get_settlement_series_lock(self) -> threading.Lock:
        lock = getattr(self, "_settlement_series_lock", None)
        if lock is not None:
            return lock
        lock = threading.Lock()
        setattr(self, "_settlement_series_lock", lock)
        return lock

    @staticmethod
    def _sort_temp_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        def _key(item: Dict[str, Any]) -> tuple:
            raw = str(item.get("time") or "")
            try:
                hh, mm = raw.split(":")
                return int(hh), int(mm)
            except Exception:
                return (99, 99)

        return sorted(points, key=_key)

    def _update_hko_today_obs(
        self,
        *,
        station_code: str,
        obs_iso: Optional[str],
        current_temp: Optional[float],
    ) -> List[Dict[str, Any]]:
        return self._update_official_today_obs(
            source_code="hko",
            station_code=station_code,
            obs_iso=obs_iso,
            current_temp=current_temp,
            utc_offset_seconds=28800,
        )

    def _update_official_today_obs(
        self,
        *,
        source_code: str,
        station_code: str,
        obs_iso: Optional[str],
        current_temp: Optional[float],
        utc_offset_seconds: int,
    ) -> List[Dict[str, Any]]:
        if not obs_iso or current_temp is None:
            return []

        try:
            obs_dt = datetime.fromisoformat(str(obs_iso).replace("Z", "+00:00"))
        except Exception:
            return []
        if obs_dt.tzinfo is None:
            obs_dt = obs_dt.replace(tzinfo=timezone.utc)
        local_tz = timezone(timedelta(seconds=int(utc_offset_seconds or 0)))
        local_dt = obs_dt.astimezone(local_tz)
        date_str = local_dt.strftime("%Y-%m-%d")
        time_str = local_dt.strftime("%H:%M")
        mode = get_state_storage_mode()
        if mode not in {STATE_STORAGE_DUAL, STATE_STORAGE_SQLITE}:
            return [{"time": time_str, "temp": round(float(current_temp), 1)}]

        lock = self._get_settlement_series_lock()
        with lock:
            _official_intraday_repo.upsert_point(
                source_code=source_code,
                station_code=station_code,
                target_date=date_str,
                observation_time=time_str,
                value=round(float(current_temp), 1),
                payload={"time": time_str, "temp": round(float(current_temp), 1)},
            )
            points = _official_intraday_repo.load_points(
                source_code=source_code,
                station_code=station_code,
                target_date=date_str,
            )
            return self._sort_temp_points(points)

    def fetch_hko_settlement_current(
        self,
        *,
        station_code: str = "HKO",
        station_name: str = "HK Observatory",
        station_candidates: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized_station_code = str(station_code or "HKO").strip() or "HKO"
        normalized_station_name = str(station_name or "HK Observatory").strip() or "HK Observatory"
        candidate_names = [
            str(item).strip()
            for item in (station_candidates or [normalized_station_name])
            if str(item).strip()
        ]
        if not candidate_names:
            candidate_names = [normalized_station_name]

        cache_key = f"hko:{normalized_station_code.lower()}"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            base = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather"
            temp_csv = self._http_get(f"{base}/latest_1min_temperature.csv", timeout=self.timeout)
            temp_csv.raise_for_status()
            maxmin_csv = self._http_get(f"{base}/latest_since_midnight_maxmin.csv", timeout=self.timeout)
            maxmin_csv.raise_for_status()
            humidity_csv = self._http_get(f"{base}/latest_1min_humidity.csv", timeout=self.timeout)
            humidity_csv.raise_for_status()
            wind_csv = self._http_get(f"{base}/latest_10min_wind.csv", timeout=self.timeout)
            wind_csv.raise_for_status()

            temp_rows = self._csv_rows(temp_csv.text)
            maxmin_rows = self._csv_rows(maxmin_csv.text)
            humidity_rows = self._csv_rows(humidity_csv.text)
            wind_rows = self._csv_rows(wind_csv.text)

            temp_row = self._pick_station_row(temp_rows, candidate_names)
            maxmin_row = self._pick_station_row(maxmin_rows, candidate_names)
            humidity_row = self._pick_station_row(humidity_rows, candidate_names)
            wind_row = self._pick_station_row(wind_rows, candidate_names)
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
            today_obs = self._update_hko_today_obs(
                station_code=normalized_station_code,
                obs_iso=obs_iso,
                current_temp=current_temp,
            )
            derived_max_time = None
            if today_obs and max_so_far is not None:
                hottest = max(today_obs, key=lambda item: float(item.get("temp") or -999))
                hottest_temp = self._safe_float(hottest.get("temp"))
                if hottest_temp is not None and abs(hottest_temp - float(max_so_far)) <= 0.05:
                    derived_max_time = str(hottest.get("time") or "").strip() or None

            payload: Dict[str, Any] = {
                "source": "hko",
                "source_label": "HKO",
                "station_code": normalized_station_code,
                "station_name": normalized_station_name,
                "observation_time": obs_iso,
                "current": {
                    "temp": round(current_temp, 1) if current_temp is not None else None,
                    "max_temp_so_far": round(max_so_far, 1) if max_so_far is not None else None,
                    "max_temp_time": derived_max_time,
                    "today_low": round(min_so_far, 1) if min_so_far is not None else None,
                    "humidity": round(humidity, 1) if humidity is not None else None,
                    "wind_speed_kt": wind_speed_kt,
                    "wind_dir": wind_dir,
                },
                "today_obs": today_obs,
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, payload)
            return payload
        except Exception as exc:
            logger.warning(f"HKO settlement fetch failed station={normalized_station_code}: {exc}")
            return None

    def fetch_cwa_taipei_settlement_current(self) -> Optional[Dict[str, Any]]:
        cache_key = "cwa:taipei:466920"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"
            response = self._http_get(
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
            res = self._http_get_json(url, timeout=self.timeout)
            return float(res["weatherForecast"][0]["forecastMaxtemp"]["value"])
        except Exception as exc:
            logger.warning(f"HKO Forecast request failed: {exc}")
            return None

    def fetch_cwa_taipei_forecast(self) -> Optional[float]:
        try:
            if not self.cwa_open_data_auth:
                return None
            url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061"
            res = self._http_get_json(
                url,
                params={"Authorization": self.cwa_open_data_auth, "format": "JSON", "elementName": "MaxT"},
                timeout=self.timeout,
            )
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

    def fetch_noaa_station_settlement_current(
        self,
        *,
        station_code: str = "RCTP",
        station_name: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized_station_code = str(station_code or "RCTP").strip().upper() or "RCTP"
        cache_key = f"noaa:{normalized_station_code.lower()}"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            response = self._http_get(
                "https://api.synopticdata.com/v2/stations/timeseries",
                params={
                    "STID": normalized_station_code,
                    "showemptystations": 1,
                    "recent": 2880,
                    "complete": 1,
                    "token": self.NOAA_WRH_MESO_TOKEN,
                    "obtimezone": "local",
                },
                headers={
                    "Referer": f"{self.NOAA_WRH_TIMESERIES_REFERER_BASE}{normalized_station_code}",
                    "Origin": "https://www.weather.gov",
                    "User-Agent": "Mozilla/5.0",
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
            stations = payload.get("STATION") or []
            station = stations[0] if isinstance(stations, list) and stations else None
            if not isinstance(station, dict):
                return None

            obs = station.get("OBSERVATIONS") or {}
            stamps = obs.get("date_time") or []
            temps = obs.get("air_temp_set_1") or []
            humidity_list = obs.get("relative_humidity_set_1") or []
            wind_speed_list = obs.get("wind_speed_set_1") or []
            wind_dir_list = obs.get("wind_direction_set_1") or []
            if not isinstance(stamps, list) or not isinstance(temps, list) or not stamps or not temps:
                return None

            today_rows: List[tuple[datetime, int]] = []
            latest_dt: Optional[datetime] = None
            latest_temp: Optional[int] = None
            latest_humidity: Optional[float] = None
            latest_wind_speed_ms: Optional[float] = None
            latest_wind_dir: Optional[float] = None

            for idx, stamp in enumerate(stamps):
                raw_temp = temps[idx] if idx < len(temps) else None
                rounded_temp = self._js_round(raw_temp)
                if rounded_temp is None:
                    continue
                try:
                    dt = datetime.strptime(str(stamp), "%Y-%m-%dT%H:%M:%S%z")
                except Exception:
                    continue
                if latest_dt is None or dt >= latest_dt:
                    latest_dt = dt
                    latest_temp = rounded_temp
                    latest_humidity = self._safe_float(humidity_list[idx] if idx < len(humidity_list) else None)
                    latest_wind_speed_ms = self._safe_float(wind_speed_list[idx] if idx < len(wind_speed_list) else None)
                    latest_wind_dir = self._safe_float(wind_dir_list[idx] if idx < len(wind_dir_list) else None)
            if latest_dt is None or latest_temp is None:
                return None

            target_date = latest_dt.date()
            for idx, stamp in enumerate(stamps):
                raw_temp = temps[idx] if idx < len(temps) else None
                rounded_temp = self._js_round(raw_temp)
                if rounded_temp is None:
                    continue
                try:
                    dt = datetime.strptime(str(stamp), "%Y-%m-%dT%H:%M:%S%z")
                except Exception:
                    continue
                if dt.date() == target_date:
                    today_rows.append((dt, rounded_temp))

            max_so_far = None
            max_temp_time = None
            today_low = None
            if today_rows:
                max_so_far = max(temp for _, temp in today_rows)
                today_low = min(temp for _, temp in today_rows)
                for dt, temp in today_rows:
                    if temp == max_so_far:
                        max_temp_time = dt.strftime("%H:%M")
                        break
            today_obs = [
                {"time": dt.strftime("%H:%M"), "temp": temp}
                for dt, temp in today_rows
            ]

            result = {
                "source": "noaa",
                "source_label": "NOAA",
                "station_code": normalized_station_code,
                "station_name": str(station_name or station.get("NAME") or normalized_station_code),
                "observation_time": latest_dt.isoformat(),
                "current": {
                    "temp": latest_temp,
                    "max_temp_so_far": max_so_far,
                    "max_temp_time": max_temp_time,
                    "today_low": today_low,
                    "humidity": round(latest_humidity, 1) if latest_humidity is not None else None,
                    "wind_speed_kt": round(float(latest_wind_speed_ms) * 1.943844, 1) if latest_wind_speed_ms is not None else None,
                    "wind_dir": latest_wind_dir,
                },
                "today_obs": today_obs,
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, result)
            return result
        except Exception as exc:
            logger.warning(
                f"NOAA settlement fetch failed station={normalized_station_code}: {exc}"
            )
            return None

    def _imgw_api_get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        try:
            query = {"token": self.IMGW_METEO_API_TOKEN}
            if isinstance(params, dict):
                query.update(params)
            response = self._http_get(
                f"{self.IMGW_METEO_API_BASE}/{path}",
                params=query,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json() if response.content else None
        except Exception as exc:
            logger.warning(f"IMGW API request failed path={path}: {exc}")
            return None

    def fetch_imgw_synoptic_station_current(
        self,
        localization: str,
        *,
        display_name: Optional[str] = None,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        cache_key = f"imgw:synoptic:{str(localization or '').strip().lower()}"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        location_payload = self._imgw_api_get("geo/search", {"name": localization})
        location_rows = (location_payload or {}).get("data") or []
        if not isinstance(location_rows, list) or not location_rows:
            return None
        location_row = location_rows[0] if isinstance(location_rows[0], dict) else None
        if not isinstance(location_row, dict):
            return None

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        synoptic_payload = self._imgw_api_get(
            "forecast/synoptic",
            {"date": date_str, "localization": localization},
        )
        data = (synoptic_payload or {}).get("data") or {}
        if not isinstance(data, dict) or not data:
            return None

        latest_row = None
        for key in sorted(data.keys()):
            row = data.get(key)
            if isinstance(row, dict) and row.get("temp") is not None:
                latest_row = row
        if not isinstance(latest_row, dict):
            return None

        temp_kelvin = self._safe_float(latest_row.get("temp"))
        if temp_kelvin is None:
            return None
        temp_c = temp_kelvin - 273.15
        temp_value = (temp_c * 9 / 5) + 32 if use_fahrenheit else temp_c
        wind_speed_ms = self._safe_float(latest_row.get("ws"))

        payload = {
            "name": display_name or str(location_row.get("name") or localization),
            "lat": self._safe_float(location_row.get("lat")),
            "lon": self._safe_float(location_row.get("lon")),
            "temp": round(temp_value, 1),
            "icao": "IMGW",
            "istNo": "IMGW",
            "wind_dir": self._safe_float(latest_row.get("wd")),
            "wind_speed": wind_speed_ms,
            "wind_speed_kt": round(float(wind_speed_ms) * 1.943844, 1) if wind_speed_ms is not None else None,
            "source": "imgw_synoptic",
            "raw_time": latest_row.get("fd"),
        }
        if payload["lat"] is None or payload["lon"] is None:
            return None
        self._set_settlement_cache(cache_key, payload)
        return payload

    def fetch_settlement_current(self, city: str) -> Optional[Dict[str, Any]]:
        normalized = str(city or "").strip().lower()
        try:
            from src.data_collection.city_registry import CITY_REGISTRY

            city_meta = CITY_REGISTRY.get(normalized) or {}
            settlement_source = str(city_meta.get("settlement_source") or "").strip().lower()
            if settlement_source == "wunderground":
                logger.info("Settlement current skipped city={} source=wunderground reason=crawler_removed", city)
                return None
            if settlement_source == "hko":
                raw_candidates = city_meta.get("settlement_station_candidates") or []
                if isinstance(raw_candidates, str):
                    station_candidates = [raw_candidates]
                else:
                    station_candidates = [
                        str(item).strip()
                        for item in raw_candidates
                        if str(item).strip()
                    ]
                station_name = (
                    str(city_meta.get("settlement_station_label") or "").strip()
                    or (station_candidates[0] if station_candidates else "HK Observatory")
                )
                station_code = (
                    str(city_meta.get("settlement_station_code") or "").strip()
                    or str(city_meta.get("icao") or "").strip()
                    or "HKO"
                )
                return self.fetch_hko_settlement_current(
                    station_code=station_code,
                    station_name=station_name,
                    station_candidates=station_candidates,
                )
            if settlement_source == "noaa":
                station_code = (
                    str(city_meta.get("settlement_station_code") or "").strip()
                    or str(city_meta.get("icao") or "").strip()
                    or normalized.upper()
                )
                station_name = (
                    str(city_meta.get("settlement_station_label") or "").strip()
                    or station_code
                )
                return self.fetch_noaa_station_settlement_current(
                    station_code=station_code,
                    station_name=station_name,
                )
        except Exception as exc:
            logger.warning(f"Settlement source dispatch failed city={city}: {exc}")
        if normalized == "taipei":
            return self.fetch_noaa_station_settlement_current(
                station_code="RCTP",
                station_name="Taiwan Taoyuan International Airport",
            )
        return None
