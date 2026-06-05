"""CoWIN (Community Weather Information Network) 1-minute real-time data source.

Fetches 1-minute temperature from HKU CoWIN API for Hong Kong.
Station 6087 (保良局陳守仁小學) provides true 1-minute observations.
No API key required.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import requests
from loguru import logger

from src.data_collection.observation_source_gate import run_observation_source
from src.utils.metrics import record_source_call

COWIN_BASE_URL = os.getenv("COWIN_BASE_URL", "").strip() or "https://cowin.hku.hk"
COWIN_SERIES_URL = f"{COWIN_BASE_URL}/API/data/CoWIN/series"
COWIN_STATION_ID = int(os.getenv("COWIN_HK_STATION_ID", "6087"))
COWIN_STATION_LABEL = os.getenv("COWIN_HK_STATION_LABEL", "").strip() or "保良局陳守仁小學 1min (CoWIN)"
COWIN_HK_UTC_OFFSET_SECONDS = 8 * 60 * 60


def _cowin_tls_fallback_enabled() -> bool:
    raw = os.getenv("COWIN_ALLOW_INSECURE_TLS_FALLBACK", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _is_tls_certificate_error(exc: Exception) -> bool:
    return "CERTIFICATE_VERIFY_FAILED" in str(exc).upper()


def _cowin_obs_time_to_iso(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone(timedelta(seconds=COWIN_HK_UTC_OFFSET_SECONDS)))
    return dt.isoformat()


class CowinSourceMixin:

    def _cowin_http_get(self, url: str) -> requests.Response:
        getter = getattr(self, "_http_get", None)
        try:
            if callable(getter):
                return getter(url)
            resp = self.session.get(url, timeout=self.timeout)
            resp.raise_for_status()
            return resp
        except Exception as exc:
            if not _cowin_tls_fallback_enabled() or not _is_tls_certificate_error(exc):
                raise
            logger.warning(
                "CoWIN TLS verification failed; retrying unverified HTTPS for public station data: {}",
                exc,
            )
            requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]
            resp = requests.get(
                url,
                timeout=self.timeout,
                verify=False,
                headers={"User-Agent": getattr(self, "user_agent", "PolyWeather/1.0")},
            )
            resp.raise_for_status()
            return resp

    def _cowin_series_payload(self, params: Dict[str, Any]) -> Dict[str, Any]:
        resp = self._cowin_http_get(COWIN_SERIES_URL + "?" + urlencode(params))
        return resp.json() if resp.content else {}

    @staticmethod
    def _cowin_local_day_bounds(now_utc: Optional[datetime] = None) -> tuple[str, datetime, datetime]:
        utc_now = now_utc or datetime.now(timezone.utc)
        if utc_now.tzinfo is None:
            utc_now = utc_now.replace(tzinfo=timezone.utc)
        else:
            utc_now = utc_now.astimezone(timezone.utc)
        hk_tz = timezone(timedelta(seconds=COWIN_HK_UTC_OFFSET_SECONDS))
        local_now = utc_now.astimezone(hk_tz)
        local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        return local_now.strftime("%Y-%m-%d"), local_start, local_now

    def fetch_cowin_obs_current(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        city_key = str(city or "").strip().lower()
        interval_sec = max(
            30,
            int(os.getenv("POLYWEATHER_OBSERVATION_COLLECTOR_COWIN_SEC", "60") or "60"),
        )
        return run_observation_source(
            "cowin_obs",
            city_key,
            interval_sec,
            lambda: self._fetch_cowin_obs_current_uncached(
                city_key,
                use_fahrenheit=use_fahrenheit,
            ),
        )

    def _fetch_cowin_obs_current_uncached(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        if city_key != "hong kong":
            return None

        cache_key = f"cowin_obs:{city_key}:{use_fahrenheit}"
        now_ts = time.time()
        with self._cowin_obs_cache_lock:
            cached = self._cowin_obs_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.cowin_obs_cache_ttl_sec:
                record_source_call("cowin_obs", "current", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            # CoWIN series API expects Hong Kong local timestamps.
            hk_tz = timezone(timedelta(seconds=COWIN_HK_UTC_OFFSET_SECONDS))
            now = datetime.now(timezone.utc).astimezone(hk_tz)
            end_dt = now.strftime("%Y-%m-%dT%H:%M:%S")
            start_dt = (now - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S")

            params = {
                "station_id": COWIN_STATION_ID,
                "element_id": "temp",
                "start_dt": start_dt,
                "end_dt": end_dt,
            }
            payload = self._cowin_series_payload(params)
        except Exception as exc:
            logger.warning("CoWIN obs fetch failed city={} error={}", city_key, exc)
            with self._cowin_obs_cache_lock:
                stale = self._cowin_obs_cache.get(cache_key)
                if stale:
                    record_source_call("cowin_obs", "current", "stale_cache",
                                       (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("cowin_obs", "current", "error",
                               (time.perf_counter() - started) * 1000.0)
            return None

        minutely = payload.get("minutely") if isinstance(payload, dict) else None
        if not minutely or not isinstance(minutely, list) or not minutely:
            record_source_call("cowin_obs", "current", "no_data",
                               (time.perf_counter() - started) * 1000.0)
            return None

        latest = minutely[-1]
        try:
            temp_c = float(latest["value1"])
        except (KeyError, ValueError, TypeError):
            record_source_call("cowin_obs", "current", "no_temperature",
                               (time.perf_counter() - started) * 1000.0)
            return None

        obs_time = _cowin_obs_time_to_iso(latest.get("obstime")) or str(latest.get("obstime") or "").strip()

        temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)

        result = {
            "source": "cowin_obs",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "station_code": str(COWIN_STATION_ID),
            "station_name": COWIN_STATION_LABEL,
            "icao": f"COWIN{COWIN_STATION_ID}",
            "obs_time": obs_time or datetime.now(timezone.utc).isoformat(),
            "current": {
                "temp": temp,
            },
            "temp_c": temp_c,
        }

        with self._cowin_obs_cache_lock:
            self._cowin_obs_cache[cache_key] = {"d": result, "t": now_ts}
        record_source_call("cowin_obs", "current", "success",
                           (time.perf_counter() - started) * 1000.0)
        return result

    def fetch_cowin_obs_today_series(
        self,
        city: str,
        use_fahrenheit: bool = False,
        now_utc: Optional[datetime] = None,
    ) -> list[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        if city_key != "hong kong":
            return []

        local_date_str, start_local, end_local = self._cowin_local_day_bounds(now_utc)
        cache_key = f"cowin_obs_today:{city_key}:{use_fahrenheit}:{local_date_str}"
        now_ts = time.time()
        with self._cowin_obs_cache_lock:
            cached = self._cowin_obs_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.cowin_obs_cache_ttl_sec:
                record_source_call("cowin_obs", "today_series", "cache_hit",
                                   (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            payload = self._cowin_series_payload(
                {
                    "station_id": COWIN_STATION_ID,
                    "element_id": "temp",
                    "start_dt": start_local.strftime("%Y-%m-%dT%H:%M:%S"),
                    "end_dt": end_local.strftime("%Y-%m-%dT%H:%M:%S"),
                }
            )
        except Exception as exc:
            logger.warning("CoWIN today series fetch failed city={} error={}", city_key, exc)
            record_source_call("cowin_obs", "today_series", "error",
                               (time.perf_counter() - started) * 1000.0)
            return []

        minutely = payload.get("minutely") if isinstance(payload, dict) else None
        if not isinstance(minutely, list) or not minutely:
            record_source_call("cowin_obs", "today_series", "no_data",
                               (time.perf_counter() - started) * 1000.0)
            return []

        hk_tz = timezone(timedelta(seconds=COWIN_HK_UTC_OFFSET_SECONDS))
        points_by_time: Dict[str, Dict[str, Any]] = {}
        for row in minutely:
            if not isinstance(row, dict):
                continue
            obs_iso = _cowin_obs_time_to_iso(row.get("obstime"))
            if not obs_iso:
                continue
            try:
                obs_dt = datetime.fromisoformat(obs_iso.replace("Z", "+00:00")).astimezone(hk_tz)
                temp_c = float(row["value1"])
            except (KeyError, ValueError, TypeError):
                continue
            if obs_dt.strftime("%Y-%m-%d") != local_date_str:
                continue
            temp = round(temp_c * 9 / 5 + 32, 1) if use_fahrenheit else round(temp_c, 1)
            time_label = obs_dt.strftime("%H:%M")
            points_by_time[time_label] = {"time": time_label, "temp": temp}

        points = sorted(points_by_time.values(), key=lambda item: item["time"])
        with self._cowin_obs_cache_lock:
            self._cowin_obs_cache[cache_key] = {"d": points, "t": now_ts}
        record_source_call("cowin_obs", "today_series", "success",
                           (time.perf_counter() - started) * 1000.0)
        return points

    def fetch_cowin_obs_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> list[Dict[str, Any]]:
        current = self.fetch_cowin_obs_current(city, use_fahrenheit=use_fahrenheit)
        if not current:
            return []
        return [
            {
                "name": COWIN_STATION_LABEL,
                "station_label": COWIN_STATION_LABEL,
                "lat": 22.3050,
                "lon": 114.1670,
                "temp": (current.get("current") or {}).get("temp"),
                "icao": f"COWIN{COWIN_STATION_ID}",
                "istNo": str(COWIN_STATION_ID),
                "source": "cowin_obs",
                "source_label": "CoWIN 6087",
                "obs_time": current.get("obs_time"),
            }
        ]
