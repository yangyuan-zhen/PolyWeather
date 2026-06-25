from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, Optional


def _parse_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text[:10]).date()
    except Exception:
        return None


def _numeric(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _date_strings_from_hourly(multi_model: Dict[str, Any]) -> set[str]:
    dates = set()
    for raw_time in multi_model.get("hourly_times") or []:
        text = str(raw_time or "")
        if len(text) >= 10:
            dates.add(text[:10])
    return dates


def _has_numeric_hourly_for_date(multi_model: Dict[str, Any], local_date: str) -> bool:
    times = multi_model.get("hourly_times") or []
    forecasts = multi_model.get("hourly_forecasts") or {}
    if not isinstance(forecasts, dict):
        return False
    for idx, raw_time in enumerate(times):
        if not str(raw_time or "").startswith(local_date):
            continue
        for values in forecasts.values():
            if isinstance(values, list) and idx < len(values) and _numeric(values[idx]) is not None:
                return True
    return False


def multi_model_has_current_window(multi_model: Any, *, today: Optional[date] = None) -> bool:
    """Return False when cached multi-model data is definitely older than today."""
    if not isinstance(multi_model, dict):
        return False
    today = today or datetime.now(timezone.utc).date()
    raw_date_values = []
    raw_date_values.extend(multi_model.get("dates") or [])
    daily = multi_model.get("daily_forecasts")
    if isinstance(daily, dict):
        raw_date_values.extend(daily.keys())
    raw_date_values.extend(_date_strings_from_hourly(multi_model))
    parsed_dates = [parsed for raw in raw_date_values for parsed in [_parse_date(raw)] if parsed]
    if not parsed_dates:
        return True
    return max(parsed_dates) >= today


def open_meteo_forecast_has_current_window(
    forecast: Any,
    *,
    today: Optional[date] = None,
) -> bool:
    """Return False when cached Open-Meteo forecast data is definitely older than today."""
    if not isinstance(forecast, dict):
        return False
    today = today or datetime.now(timezone.utc).date()
    raw_date_values = []
    daily = forecast.get("daily") if isinstance(forecast.get("daily"), dict) else {}
    raw_date_values.extend(daily.get("time") or [])
    hourly = forecast.get("hourly") if isinstance(forecast.get("hourly"), dict) else {}
    raw_date_values.extend(hourly.get("time") or [])
    parsed_dates = [parsed for raw in raw_date_values for parsed in [_parse_date(raw)] if parsed]
    if not parsed_dates:
        return True
    return max(parsed_dates) >= today


def multi_model_covers_local_date(multi_model: Any, local_date: str) -> bool:
    if not isinstance(multi_model, dict):
        return False
    wanted = str(local_date or "").strip()
    if not wanted:
        return bool(multi_model.get("forecasts"))

    daily = multi_model.get("daily_forecasts") if isinstance(multi_model.get("daily_forecasts"), dict) else {}
    day_models = daily.get(wanted) if isinstance(daily.get(wanted), dict) else {}
    if any(_numeric(value) is not None for value in day_models.values()):
        return True

    if _has_numeric_hourly_for_date(multi_model, wanted):
        return True

    dates = [str(value) for value in (multi_model.get("dates") or [])]
    if dates:
        return wanted in dates

    has_dated_payload = bool(daily) or bool(multi_model.get("hourly_times"))
    return bool(multi_model.get("forecasts")) and not has_dated_payload


def multi_model_forecasts_for_local_date(multi_model: Any, local_date: str) -> Dict[str, float]:
    if not isinstance(multi_model, dict) or not multi_model_covers_local_date(multi_model, local_date):
        return {}
    wanted = str(local_date or "").strip()
    models: Dict[str, float] = {}

    daily = multi_model.get("daily_forecasts") if isinstance(multi_model.get("daily_forecasts"), dict) else {}
    day_models = daily.get(wanted) if isinstance(daily.get(wanted), dict) else {}
    for model, value in day_models.items():
        parsed = _numeric(value)
        if parsed is not None:
            models[str(model)] = parsed

    times = multi_model.get("hourly_times") or []
    hourly = multi_model.get("hourly_forecasts") if isinstance(multi_model.get("hourly_forecasts"), dict) else {}
    day_indexes = [
        idx
        for idx, raw_time in enumerate(times)
        if wanted and str(raw_time or "").startswith(wanted)
    ]
    for model, values in hourly.items():
        if not isinstance(values, list):
            continue
        day_values = [
            parsed
            for idx in day_indexes
            if idx < len(values)
            for parsed in [_numeric(values[idx])]
            if parsed is not None
        ]
        if day_values:
            current = models.get(str(model))
            models[str(model)] = max(day_values) if current is None else max(current, max(day_values))

    if models:
        return models

    forecasts = multi_model.get("forecasts") if isinstance(multi_model.get("forecasts"), dict) else {}
    for model, value in forecasts.items():
        parsed = _numeric(value)
        if parsed is not None:
            models[str(model)] = parsed
    return models
