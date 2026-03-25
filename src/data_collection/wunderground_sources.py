from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from loguru import logger
from src.data_collection.city_registry import CITY_REGISTRY


class WundergroundSourceMixin:
    _WU_PAGE_TTL_SEC = 180

    def _fetch_wunderground_page(self, url: str) -> Optional[str]:
        cache_key = f"wu:page:{url}"
        cached = self._get_settlement_cache(cache_key)
        if isinstance(cached, dict):
            html = str(cached.get("html") or "")
            if html:
                return html

        try:
            response = self.session.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": url,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            html = str(response.text or "")
            if not html:
                return None
            ttl_backup = getattr(self, "settlement_cache_ttl_sec", self._WU_PAGE_TTL_SEC)
            try:
                self.settlement_cache_ttl_sec = self._WU_PAGE_TTL_SEC
                self._set_settlement_cache(cache_key, {"html": html})
            finally:
                self.settlement_cache_ttl_sec = ttl_backup
            return html
        except Exception as exc:
            logger.warning(f"Wunderground page fetch failed url={url}: {exc}")
            return None

    def _fetch_wunderground_history_page(self, url: str) -> Optional[str]:
        if not url:
            return None
        cache_key = f"wu:history:{url}"
        cached = self._get_settlement_cache(cache_key)
        if isinstance(cached, dict):
            html = str(cached.get("html") or "")
            if html:
                return html

        try:
            response = self.session.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": url,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            html = str(response.text or "")
            if not html:
                return None
            ttl_backup = getattr(self, "settlement_cache_ttl_sec", self._WU_PAGE_TTL_SEC)
            try:
                self.settlement_cache_ttl_sec = self._WU_PAGE_TTL_SEC
                self._set_settlement_cache(cache_key, {"html": html})
            finally:
                self.settlement_cache_ttl_sec = ttl_backup
            return html
        except Exception as exc:
            logger.warning(f"Wunderground history page fetch failed url={url}: {exc}")
            return None

    @staticmethod
    def _wu_extract_app_state(html: str) -> Optional[Dict[str, Any]]:
        match = re.search(
            r'<script id="app-root-state" type="application/json">(.*?)</script>',
            html,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return None
        try:
            payload = json.loads(str(match.group(1) or ""))
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None

    @staticmethod
    def _wu_extract_station_history_url(html: str) -> Optional[str]:
        match = re.search(
            r'<div[^>]*class="station-name"[^>]*>\s*<a[^>]+href="([^"]*?/history/daily/[^"]+)"',
            html,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return None
        href = str(match.group(1) or "").strip()
        if not href:
            return None
        if href.startswith("http://") or href.startswith("https://"):
            return href
        return f"https://www.wunderground.com{href}"

    @staticmethod
    def _wu_extract_station_id_from_history_url(url: Optional[str]) -> Optional[str]:
        text = str(url or "").strip()
        if not text:
            return None
        match = re.search(r"/history/daily/(?:[^/]+/){1,3}([^/]+)/date/", text, re.IGNORECASE)
        return str(match.group(1) or "").strip() or None if match else None

    @staticmethod
    def _wu_extract_station_name_from_history_url(url: Optional[str]) -> Optional[str]:
        text = str(url or "").strip()
        if not text:
            return None
        match = re.search(r"/history/daily/(?:[^/]+/){1,3}([^/]+)/date/", text, re.IGNORECASE)
        return str(match.group(1) or "").strip() or None if match else None

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            return float(text)
        except Exception:
            return None

    @staticmethod
    def _wu_extract_station_name(html: str, fallback_icao: str) -> Optional[str]:
        pattern = re.compile(
            r'</lib-display-unit>\s*([^<]+?)\s*</a>',
            re.IGNORECASE,
        )
        for match in pattern.finditer(html):
            candidate = re.sub(r"\s+", " ", str(match.group(1) or "")).strip()
            if fallback_icao.lower() in candidate.lower() or "station" in candidate.lower():
                return candidate
        return None

    @staticmethod
    def _wu_extract_station_temperature(
        html: str,
        *,
        station_name: Optional[str],
    ) -> tuple[Optional[float], Optional[str]]:
        station_anchor = station_name or "Station"
        station_pos = html.find(station_anchor)
        if station_pos < 0:
            station_pos = html.lower().find("station-name")
        if station_pos < 0:
            return None, None

        window_start = max(0, station_pos - 1800)
        window = html[window_start:station_pos]
        temp_match = re.search(
            r'wu-value[^>]*>\s*(-?\d+(?:\.\d+)?)\s*</span>.*?<span[^>]*>\s*([CF])\s*</span>',
            window,
            re.IGNORECASE | re.DOTALL,
        )
        if not temp_match:
            return None, None

        try:
            value = float(temp_match.group(1))
        except Exception:
            return None, None
        unit = str(temp_match.group(2) or "").upper().strip() or None
        return value, unit

    @staticmethod
    def _wu_to_celsius(value: Optional[float], unit: Optional[str]) -> Optional[float]:
        if value is None:
            return None
        normalized = str(unit or "").upper().strip()
        if normalized == "F":
            return round((float(value) - 32.0) * 5.0 / 9.0, 1)
        return round(float(value), 1)

    @staticmethod
    def _wu_parse_observation_iso(raw: Optional[str], utc_offset_seconds: int) -> Optional[str]:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.strptime(text, "%Y-%m-%dT%H:%M:%S%z")
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            pass
        try:
            parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
            parsed = parsed.replace(tzinfo=timezone(timedelta(seconds=utc_offset_seconds)))
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            return None

    @staticmethod
    def _wu_parse_history_time(raw: Any, utc_offset_seconds: int) -> Optional[str]:
        if raw is None:
            return None
        if isinstance(raw, (int, float)):
            try:
                return datetime.fromtimestamp(float(raw), timezone.utc).isoformat()
            except Exception:
                return None
        text = str(raw).strip()
        if not text:
            return None
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
        ):
            try:
                parsed = datetime.strptime(text, fmt)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone(timedelta(seconds=utc_offset_seconds)))
                return parsed.astimezone(timezone.utc).isoformat()
            except Exception:
                continue
        return None

    @classmethod
    def _wu_observation_temp_c(cls, obs: Dict[str, Any]) -> Optional[float]:
        if not isinstance(obs, dict):
            return None
        metric = obs.get("metric")
        if isinstance(metric, dict):
            for key in ("temp", "temperature", "tempAvg", "temperatureAvg"):
                value = cls._safe_float(metric.get(key))
                if value is not None:
                    return round(float(value), 1)
        imperial = obs.get("imperial")
        if isinstance(imperial, dict):
            for key in ("temp", "temperature", "tempAvg", "temperatureAvg"):
                value = cls._safe_float(imperial.get(key))
                if value is not None:
                    return cls._wu_to_celsius(value, "F")
        for key in ("temp", "temperature"):
            value = cls._safe_float(obs.get(key))
            if value is not None:
                return round(float(value), 1)
        return None

    @classmethod
    def _wu_observation_time_iso(cls, obs: Dict[str, Any], utc_offset_seconds: int) -> Optional[str]:
        if not isinstance(obs, dict):
            return None
        for key in ("validTimeLocal", "obsTimeLocal", "observationTime", "timestamp", "validTimeUtc", "epoch"):
            value = obs.get(key)
            parsed = cls._wu_parse_history_time(value, utc_offset_seconds)
            if parsed:
                return parsed
        return None

    @classmethod
    def _wu_iter_lists(cls, node: Any):
        if isinstance(node, dict):
            for value in node.values():
                yield from cls._wu_iter_lists(value)
        elif isinstance(node, list):
            yield node
            for item in node:
                yield from cls._wu_iter_lists(item)

    @classmethod
    def _wu_extract_history_observations(
        cls,
        app_state: Dict[str, Any],
        *,
        utc_offset_seconds: int,
    ) -> list[dict[str, Any]]:
        best: list[dict[str, Any]] = []
        for candidate in cls._wu_iter_lists(app_state):
            if not candidate or not all(isinstance(item, dict) for item in candidate):
                continue
            parsed: list[dict[str, Any]] = []
            seen_times: set[str] = set()
            for item in candidate:
                temp_c = cls._wu_observation_temp_c(item)
                time_iso = cls._wu_observation_time_iso(item, utc_offset_seconds)
                if temp_c is None or not time_iso:
                    continue
                try:
                    local_dt = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(
                        timezone(timedelta(seconds=utc_offset_seconds))
                    )
                except Exception:
                    continue
                hhmm = local_dt.strftime("%H:%M")
                if hhmm in seen_times:
                    continue
                seen_times.add(hhmm)
                parsed.append({"time": hhmm, "temp": round(float(temp_c), 1)})
            if len(parsed) > len(best):
                best = parsed
        return best

    @staticmethod
    def _wu_find_current_observation_block(
        app_state: Dict[str, Any],
        *,
        icao: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        normalized_icao = str(icao or "").strip().upper()
        fallback_block: Optional[Dict[str, Any]] = None
        for value in app_state.values():
            if not isinstance(value, dict):
                continue
            url = str(value.get("u") or "")
            body = value.get("b")
            if not isinstance(body, dict) or "observations/current" not in url:
                continue
            if normalized_icao and f"icaoCode={normalized_icao}" in url:
                return body
            if fallback_block is None:
                fallback_block = body
        return fallback_block

    def fetch_wunderground_settlement_current(
        self,
        city: str,
        *,
        url: str,
        station_label: Optional[str] = None,
        icao: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized_city = str(city or "").strip().lower()
        cache_key = f"wu:settlement:{normalized_city}"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        html = self._fetch_wunderground_page(url)
        if not html:
            return None

        city_meta = CITY_REGISTRY.get(normalized_city) or {}
        utc_offset_seconds = int(city_meta.get("tz_offset") or 0)
        fallback_icao = str(icao or "").strip().upper()
        history_url = self._wu_extract_station_history_url(html)
        station_id = self._wu_extract_station_id_from_history_url(history_url)
        station_name = (
            station_label
            or self._wu_extract_station_name(html, fallback_icao)
            or self._wu_extract_station_name_from_history_url(history_url)
            or fallback_icao
            or str(city or "").title()
        )

        app_state = self._wu_extract_app_state(html) or {}
        current_block = self._wu_find_current_observation_block(app_state, icao=fallback_icao)

        display_temp = None
        display_unit = "F"
        obs_iso = None
        humidity = None
        wind_speed_kt = None
        wind_dir = None
        wx_phrase = None
        dewpoint_c = None
        official_high_c = None
        official_low_c = None

        if current_block:
            display_temp = self._safe_float(current_block.get("temperature"))
            obs_iso = self._wu_parse_observation_iso(
                current_block.get("validTimeLocal"),
                utc_offset_seconds,
            )
            humidity = self._safe_float(current_block.get("relativeHumidity"))
            wind_speed_kt = self._safe_float(current_block.get("windSpeed"))
            wind_dir = str(current_block.get("windDirectionCardinal") or "").strip() or None
            wx_phrase = str(current_block.get("wxPhraseLong") or "").strip() or None
            dewpoint_c = self._wu_to_celsius(
                self._safe_float(current_block.get("temperatureDewPoint")),
                "F",
            )
            official_high_c = self._wu_to_celsius(
                self._safe_float(
                    current_block.get("temperatureMaxSince7Am")
                    or current_block.get("temperatureMax24Hour")
                ),
                "F",
            )
            official_low_c = self._wu_to_celsius(
                self._safe_float(current_block.get("temperatureMin24Hour")),
                "F",
            )

        if display_temp is None:
            display_temp, display_unit = self._wu_extract_station_temperature(
                html,
                station_name=station_name,
            )
        temp_c = self._wu_to_celsius(self._safe_float(display_temp), display_unit)
        if temp_c is None:
            logger.warning(f"Wunderground temperature parse failed city={city} url={url}")
            return None

        obs_iso = obs_iso or datetime.now(timezone.utc).isoformat()
        today_obs: list[dict[str, Any]] = []
        history_html = self._fetch_wunderground_history_page(history_url) if history_url else None
        history_state = self._wu_extract_app_state(history_html or "") if history_html else None
        history_obs = (
            self._wu_extract_history_observations(
                history_state or {},
                utc_offset_seconds=utc_offset_seconds,
            )
            if isinstance(history_state, dict)
            else []
        )
        if history_obs:
            today_obs = history_obs
            for point in history_obs:
                point_time = str(point.get("time") or "").strip()
                point_temp = self._safe_float(point.get("temp"))
                if not point_time or point_temp is None:
                    continue
                try:
                    local_dt = datetime.strptime(point_time, "%H:%M").replace(
                        year=datetime.now(timezone(timedelta(seconds=utc_offset_seconds))).year,
                        month=datetime.now(timezone(timedelta(seconds=utc_offset_seconds))).month,
                        day=datetime.now(timezone(timedelta(seconds=utc_offset_seconds))).day,
                        tzinfo=timezone(timedelta(seconds=utc_offset_seconds)),
                    )
                    self._update_official_today_obs(
                        source_code="wunderground",
                        station_code=station_id or fallback_icao or normalized_city,
                        obs_iso=local_dt.astimezone(timezone.utc).isoformat(),
                        current_temp=point_temp,
                        utc_offset_seconds=utc_offset_seconds,
                    )
                except Exception:
                    continue
        else:
            today_obs = self._update_official_today_obs(
                source_code="wunderground",
                station_code=station_id or fallback_icao or normalized_city,
                obs_iso=obs_iso,
                current_temp=temp_c,
                utc_offset_seconds=utc_offset_seconds,
            )

        sampled_max = None
        sampled_max_time = None
        sampled_low = None
        if today_obs:
            hottest = max(today_obs, key=lambda item: float(item.get("temp") or -999))
            coldest = min(today_obs, key=lambda item: float(item.get("temp") or 999))
            sampled_max = self._wu_to_celsius(float(hottest.get("temp")), "C")
            sampled_max_time = str(hottest.get("time") or "").strip() or None
            sampled_low = self._wu_to_celsius(float(coldest.get("temp")), "C")

        max_so_far = official_high_c if official_high_c is not None else sampled_max
        today_low = official_low_c if official_low_c is not None else sampled_low
        max_temp_time = sampled_max_time
        if max_so_far is not None and abs(float(max_so_far) - float(temp_c)) < 0.05:
            try:
                local_obs = datetime.fromisoformat(obs_iso.replace("Z", "+00:00")).astimezone(
                    timezone(timedelta(seconds=utc_offset_seconds))
                )
                max_temp_time = local_obs.strftime("%H:%M")
            except Exception:
                pass

        payload: Dict[str, Any] = {
            "source": "wunderground",
            "source_label": "Wunderground",
            "station_code": station_id or fallback_icao or None,
            "station_name": station_name,
            "observation_time": obs_iso,
            "source_url": url,
            "history_url": history_url,
            "current": {
                "temp": temp_c,
                "display_temp": display_temp,
                "display_unit": display_unit,
                "max_temp_so_far": max_so_far,
                "max_temp_time": max_temp_time,
                "today_low": today_low,
                "humidity": humidity,
                "wind_speed_kt": wind_speed_kt,
                "wind_dir": wind_dir,
                "cloud_desc": wx_phrase,
                "dewpoint": dewpoint_c,
            },
            "today_obs": today_obs,
            "unit": "celsius",
        }
        self._set_settlement_cache(cache_key, payload)
        return payload
