from __future__ import annotations

import html
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from src.utils.metrics import record_source_call


RUSSIA_MOSCOW_STATIONS: Dict[str, Dict[str, Any]] = {
    "27524": {
        "station_code": "27524",
        "station_label": "Vnukovo",
        "lat": 55.5870,
        "lon": 37.2500,
    },
    "27518": {
        "station_code": "27518",
        "station_label": "Podmoskovnaya",
        "lat": 55.7084,
        "lon": 37.1823,
    },
    "27515": {
        "station_code": "27515",
        "station_label": "Nemchinovka",
        "lat": 55.7065,
        "lon": 37.3719,
    },
    "27504": {
        "station_code": "27504",
        "station_label": "Moscow (Butovo)",
        "lat": 55.5780,
        "lon": 37.5541,
    },
    "27416": {
        "station_code": "27416",
        "station_label": "Moscow (Strogino)",
        "lat": 55.7976,
        "lon": 37.3982,
    },
    "27605": {
        "station_code": "27605",
        "station_label": "Moscow (Balchug)",
        "lat": 55.7455,
        "lon": 37.6300,
    },
}


class RussiaStationSourceMixin:
    def _ru_http_get_text(self, url: str) -> str:
        getter = getattr(self, "_http_get", None)
        if callable(getter):
            response = getter(url)
        else:
            response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.text

    @staticmethod
    def _ru_safe_float(value: Any) -> Optional[float]:
        try:
            if value in (None, "", "-", "—"):
                return None
            text = str(value).strip().replace(",", ".")
            return float(text)
        except Exception:
            return None

    @staticmethod
    def _ru_distance_km(
        lat1: Optional[float],
        lon1: Optional[float],
        lat2: Optional[float],
        lon2: Optional[float],
    ) -> Optional[float]:
        if None in (lat1, lon1, lat2, lon2):
            return None
        try:
            r = 6371.0
            d_lat = math.radians(float(lat2) - float(lat1))
            d_lon = math.radians(float(lon2) - float(lon1))
            a = (
                math.sin(d_lat / 2) ** 2
                + math.cos(math.radians(float(lat1)))
                * math.cos(math.radians(float(lat2)))
                * math.sin(d_lon / 2) ** 2
            )
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            return round(r * c, 2)
        except Exception:
            return None

    @staticmethod
    def _ru_clean_cell(cell_html: str) -> str:
        text = re.sub(r"<[^>]+>", " ", str(cell_html or ""))
        text = html.unescape(text)
        text = text.replace("\xa0", " ")
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    @classmethod
    def _ru_parse_table_rows(cls, table_html: str) -> List[List[str]]:
        rows: List[List[str]] = []
        for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.S | re.I):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.S | re.I)
            cleaned = [cls._ru_clean_cell(cell) for cell in cells]
            if cleaned:
                rows.append(cleaned)
        return rows

    @staticmethod
    def _ru_build_obs_time(hour_text: str, day_month_text: str) -> Optional[str]:
        hour_match = re.search(r"(\d{1,2})", str(hour_text or ""))
        day_match = re.search(r"(\d{1,2})\.(\d{1,2})", str(day_month_text or ""))
        if not hour_match or not day_match:
            return None
        hour = int(hour_match.group(1))
        day = int(day_match.group(1))
        month = int(day_match.group(2))
        now_utc = datetime.now(timezone.utc)
        year = now_utc.year
        try:
            candidate = datetime(year, month, day, hour, 0, tzinfo=timezone.utc)
        except ValueError:
            return None
        if candidate > now_utc and (candidate - now_utc).days > 40:
            candidate = datetime(year - 1, month, day, hour, 0, tzinfo=timezone.utc)
        return candidate.isoformat()

    def _ru_parse_station_current_from_weather_html(self, html_text: str) -> Optional[Dict[str, Any]]:
        tables = re.findall(r"<table[^>]*>(.*?)</table>", html_text, flags=re.S | re.I)
        if len(tables) < 2:
            return None
        time_rows = self._ru_parse_table_rows(tables[0])
        data_rows = self._ru_parse_table_rows(tables[1])
        if len(time_rows) < 2 or len(data_rows) < 2:
            return None

        pair_count = min(len(time_rows), len(data_rows)) - 1
        for idx in range(pair_count):
            time_row = time_rows[idx + 1]
            data_row = data_rows[idx + 1]
            if len(time_row) < 2 or len(data_row) < 6:
                continue
            temp_c = self._ru_safe_float(data_row[5])
            if temp_c is None:
                continue
            obs_time = self._ru_build_obs_time(time_row[0], time_row[1])
            return {
                "temp_c": round(temp_c, 1),
                "obs_time": obs_time,
                "raw_hour": time_row[0],
                "raw_day_month": time_row[1],
            }
        return None

    def _ru_cached_station_current(
        self,
        station_code: str,
        station_meta: Dict[str, Any],
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        cache_key = f"{station_code}:{use_fahrenheit}"
        now_ts = time.time()
        with self._ru_station_cache_lock:
            cached = self._ru_station_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.ru_station_cache_ttl_sec:
                return cached["d"]

        started = time.perf_counter()
        try:
            url = f"https://www.pogodaiklimat.ru/weather.php?id={station_code}"
            html_text = self._ru_http_get_text(url)
            parsed = self._ru_parse_station_current_from_weather_html(html_text)
            if not parsed:
                record_source_call(
                    "ru_station_web",
                    "current",
                    "empty",
                    (time.perf_counter() - started) * 1000.0,
                )
                return None
            obs_time = parsed.get("obs_time")
            max_stale_sec = max(
                0,
                int(getattr(self, "ru_station_max_stale_sec", 72 * 3600)),
            )
            if obs_time and max_stale_sec > 0:
                try:
                    obs_dt = datetime.fromisoformat(str(obs_time))
                    obs_age_sec = (datetime.now(timezone.utc) - obs_dt).total_seconds()
                    if obs_age_sec > max_stale_sec:
                        logger.info(
                            "Russia station web row is stale station={} obs_time={} age_hours={:.1f}",
                            station_code,
                            obs_time,
                            obs_age_sec / 3600.0,
                        )
                        record_source_call(
                            "ru_station_web",
                            "current",
                            "stale_row",
                            (time.perf_counter() - started) * 1000.0,
                        )
                        return None
                except Exception:
                    pass
            temp_c = parsed.get("temp_c")
            if temp_c is None:
                record_source_call(
                    "ru_station_web",
                    "current",
                    "no_temperature",
                    (time.perf_counter() - started) * 1000.0,
                )
                return None
            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)
            result = {
                "station_code": station_code,
                "station_label": station_meta.get("station_label") or f"RU {station_code}",
                "name": station_meta.get("station_label") or f"RU {station_code}",
                "lat": station_meta.get("lat"),
                "lon": station_meta.get("lon"),
                "temp": temp,
                "obs_time": parsed.get("obs_time"),
                "source": "ru_station_web",
                "source_label": "Russia station web",
                "source_code": "ru_station_web",
                "is_official": True,
                "is_airport_station": station_code == "27524",
                "is_settlement_anchor": False,
                "page_url": f"https://www.pogodaiklimat.ru/weather.php?id={station_code}",
            }
            with self._ru_station_cache_lock:
                self._ru_station_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call(
                "ru_station_web",
                "current",
                "success",
                (time.perf_counter() - started) * 1000.0,
            )
            return result
        except Exception as exc:
            logger.warning("Russia station web fetch failed station={} error={}", station_code, exc)
            with self._ru_station_cache_lock:
                stale = self._ru_station_cache.get(cache_key)
                if stale:
                    record_source_call(
                        "ru_station_web",
                        "current",
                        "stale_cache",
                        (time.perf_counter() - started) * 1000.0,
                    )
                    return stale["d"]
            record_source_call(
                "ru_station_web",
                "current",
                "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return None

    def fetch_russia_moscow_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> List[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        if city_key != "moscow":
            record_source_call(
                "ru_station_web",
                "nearby",
                "unsupported_city",
                (time.perf_counter() - started) * 1000.0,
            )
            return []

        city_meta = self.CITY_REGISTRY.get(city_key) or {}
        anchor_lat = self._ru_safe_float(city_meta.get("lat"))
        anchor_lon = self._ru_safe_float(city_meta.get("lon"))
        rows: List[Dict[str, Any]] = []
        try:
            for station_code, station_meta in RUSSIA_MOSCOW_STATIONS.items():
                current = self._ru_cached_station_current(
                    station_code,
                    station_meta,
                    use_fahrenheit=use_fahrenheit,
                )
                if not current:
                    continue
                row = dict(current)
                row["distance_km"] = self._ru_distance_km(
                    anchor_lat,
                    anchor_lon,
                    self._ru_safe_float(row.get("lat")),
                    self._ru_safe_float(row.get("lon")),
                )
                row["icao"] = station_code
                row["istNo"] = station_code
                rows.append(row)
            rows.sort(
                key=lambda item: (
                    item.get("distance_km") is None,
                    item.get("distance_km") if item.get("distance_km") is not None else 9999,
                    item.get("station_label") or "",
                )
            )
            trimmed = rows[:6]
            record_source_call(
                "ru_station_web",
                "nearby",
                "success" if trimmed else "empty",
                (time.perf_counter() - started) * 1000.0,
            )
            return trimmed
        except Exception as exc:
            logger.warning("Russia station nearby fetch failed city={} error={}", city_key, exc)
            record_source_call(
                "ru_station_web",
                "nearby",
                "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return []
