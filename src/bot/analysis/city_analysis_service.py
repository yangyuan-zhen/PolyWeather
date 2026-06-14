from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from src.database.db_manager import DBManager
from src.data_collection.city_registry import CITY_REGISTRY
from web.services.canonical_temperature import build_city_weather_from_canonical


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _today_for_city(city_name: str) -> str:
    meta = CITY_REGISTRY.get(str(city_name or "").strip().lower()) or {}
    offset = int(meta.get("tz_offset") or 0)
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(seconds=offset))).strftime("%Y-%m-%d")


def _first_forecast_high(payload: Dict[str, Any], city_name: str) -> Optional[float]:
    deb = payload.get("deb") if isinstance(payload.get("deb"), dict) else {}
    value = _safe_float(deb.get("prediction"))
    if value is not None:
        return value

    local_date = str(payload.get("local_date") or _today_for_city(city_name)).strip()
    daily = payload.get("multi_model_daily")
    if isinstance(daily, dict):
        dates = [local_date] if local_date in daily else sorted(daily.keys())
        for date_key in dates:
            entry = daily.get(date_key)
            if not isinstance(entry, dict):
                continue
            daily_deb = entry.get("deb") if isinstance(entry.get("deb"), dict) else {}
            value = _safe_float(daily_deb.get("prediction"))
            if value is not None:
                return value
            models = entry.get("models") if isinstance(entry.get("models"), dict) else {}
            values = sorted(
                value
                for value in (_safe_float(item) for item in models.values())
                if value is not None
            )
            if values:
                return values[len(values) // 2]

    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    for key in ("max_so_far", "max_temp_so_far", "temp"):
        value = _safe_float(current.get(key))
        if value is not None:
            return value
    return None


def _city_cache_payload_to_weather_data(city_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    city_key = str(city_name or "").strip().lower()
    meta = CITY_REGISTRY.get(city_key) or {}
    offset = int(meta.get("tz_offset") or 0)
    local_date = str(payload.get("local_date") or _today_for_city(city_key)).strip()
    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    airport_current = (
        payload.get("airport_current")
        if isinstance(payload.get("airport_current"), dict)
        else current
    )
    current_temp = _safe_float(current.get("temp"))
    if current_temp is None:
        current_temp = _safe_float(airport_current.get("temp"))
    max_so_far = _safe_float(current.get("max_so_far"))
    if max_so_far is None:
        max_so_far = _safe_float(current.get("max_temp_so_far"))
    if max_so_far is None:
        max_so_far = _safe_float(airport_current.get("max_so_far"))
    if max_so_far is None:
        max_so_far = _safe_float(airport_current.get("max_temp_so_far"))

    forecast_high = _first_forecast_high(payload, city_key)
    dates = [local_date] if local_date else []
    highs = [forecast_high] if forecast_high is not None else []
    observed_at = str(
        current.get("observed_at")
        or current.get("observation_time")
        or airport_current.get("observation_time")
        or airport_current.get("obs_time")
        or ""
    ).strip()
    metar_current = {
        "temp": current_temp,
        "max_temp_so_far": max_so_far,
        "max_temp_time": current.get("max_time") or current.get("max_temp_time"),
        "wind_speed_kt": current.get("wind_speed_kt") or airport_current.get("wind_speed_kt"),
        "wind_dir": current.get("wind_dir") or airport_current.get("wind_dir"),
        "visibility_mi": current.get("visibility_mi") or airport_current.get("visibility_mi"),
        "humidity": current.get("humidity") or airport_current.get("humidity"),
        "clouds": current.get("clouds") or airport_current.get("clouds") or [],
        "wx_desc": current.get("wx_desc") or airport_current.get("wx_desc"),
    }
    weather_data = {
        "open-meteo": {
            "utc_offset": offset,
            "current": {"local_time": payload.get("local_time")},
            "daily": {
                "time": dates,
                "temperature_2m_max": highs,
            },
        },
        "metar": {
            "observation_time": observed_at,
            "current": metar_current,
        },
        "settlement_current": {
            "observation_time": observed_at,
            "current": dict(metar_current),
        },
        "amos": payload.get("amos") if isinstance(payload.get("amos"), dict) else {},
        "deb": payload.get("deb") if isinstance(payload.get("deb"), dict) else {},
        "multi_model": payload.get("multi_model") if isinstance(payload.get("multi_model"), dict) else {},
    }
    return weather_data


class CityAnalysisService:
    """City analysis adapter with lazy imports to trim cold startup."""

    def __init__(self, weather: Any, cache_db: Optional[Any] = None):
        self.weather = weather
        self.cache_db = cache_db or DBManager()

    def resolve_city(self, city_input: str):
        from src.analysis.city_query_service import resolve_city_name

        return resolve_city_name(city_input)

    def build_city_report(self, city_name: str, city_query_cost: int) -> str:
        coords = self.weather.get_coordinates(city_name)
        if not coords:
            raise ValueError(f"未找到城市坐标: {city_name}")

        payload = self._load_cached_city_payload(city_name)
        if not payload:
            self._enqueue_refresh(city_name)
            raise RuntimeError("城市天气缓存正在初始化，请稍后重试")
        weather_data = _city_cache_payload_to_weather_data(city_name, payload)

        from src.analysis.city_query_service import build_city_query_report

        return build_city_query_report(
            city_name=city_name,
            weather_data=weather_data,
            city_query_cost=city_query_cost,
        )

    def _load_cached_city_payload(self, city_name: str) -> Optional[Dict[str, Any]]:
        city_key = str(city_name or "").strip().lower()
        getter = getattr(self.cache_db, "get_city_cache", None)
        if callable(getter):
            for kind in ("panel", "full", "summary"):
                entry = getter(kind, city_key)
                payload = entry.get("payload") if isinstance(entry, dict) else None
                if isinstance(payload, dict):
                    return payload

        canonical_getter = getattr(self.cache_db, "get_canonical_temperature", None)
        canonical_entry = canonical_getter(city_key) if callable(canonical_getter) else None
        canonical = (
            canonical_entry.get("payload")
            if isinstance(canonical_entry, dict) and isinstance(canonical_entry.get("payload"), dict)
            else canonical_entry
        )
        return (
            build_city_weather_from_canonical(city_key, canonical)
            if isinstance(canonical, dict)
            else None
        )

    def _enqueue_refresh(self, city_name: str) -> None:
        enqueue = getattr(self.cache_db, "enqueue_observation_refresh_request", None)
        if not callable(enqueue):
            return
        enqueue(
            city=str(city_name or "").strip().lower(),
            kind="panel",
            priority="high",
            reason="bot_city_report",
        )
