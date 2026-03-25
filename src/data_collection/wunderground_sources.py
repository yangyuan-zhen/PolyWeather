from __future__ import annotations

import re
from datetime import datetime, timezone
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

        fallback_icao = str(icao or "").strip()
        station_name = station_label or self._wu_extract_station_name(html, fallback_icao)
        display_temp, display_unit = self._wu_extract_station_temperature(
            html,
            station_name=station_name,
        )
        temp_c = self._wu_to_celsius(display_temp, display_unit)
        if temp_c is None:
            logger.warning(f"Wunderground temperature parse failed city={city} url={url}")
            return None

        city_meta = CITY_REGISTRY.get(normalized_city) or {}
        utc_offset_seconds = int(city_meta.get("tz_offset") or 0)
        obs_iso = datetime.now(timezone.utc).isoformat()
        today_obs = self._update_official_today_obs(
            source_code="wunderground",
            station_code=fallback_icao or normalized_city,
            obs_iso=obs_iso,
            current_temp=temp_c,
            utc_offset_seconds=utc_offset_seconds,
        )
        max_so_far = None
        max_temp_time = None
        today_low = None
        if today_obs:
            hottest = max(today_obs, key=lambda item: float(item.get("temp") or -999))
            coldest = min(today_obs, key=lambda item: float(item.get("temp") or 999))
            max_so_far = self._wu_to_celsius(float(hottest.get("temp")), "C")
            today_low = self._wu_to_celsius(float(coldest.get("temp")), "C")
            max_temp_time = str(hottest.get("time") or "").strip() or None

        payload: Dict[str, Any] = {
            "source": "wunderground",
            "source_label": "Wunderground",
            "station_code": fallback_icao or None,
            "station_name": station_name or fallback_icao or str(city or "").title(),
            "observation_time": obs_iso,
            "source_url": url,
            "current": {
                "temp": temp_c,
                "display_temp": display_temp,
                "display_unit": display_unit,
                "max_temp_so_far": max_so_far,
                "max_temp_time": max_temp_time,
                "today_low": today_low,
                "humidity": None,
                "wind_speed_kt": None,
                "wind_dir": None,
            },
            "today_obs": today_obs,
            "unit": "celsius",
        }
        self._set_settlement_cache(cache_key, payload)
        return payload
