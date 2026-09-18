"""PolyWeather v1 forecast API for external consumers.

Returns a compact per-city payload: the DEB blend prediction, the model
consensus weights, and the multi-model daily forecasts (3 days) for a fixed
watchlist of cities (10 mainland-China + international monitors), plus the
production hourly temperature path and peak-time metadata.

Authentication: same entitlement token as the other pro endpoints.

Performance contract:
- The per-city analysis is expensive (cold ~13s, cache-hit ~0.36s), so the
  aggregated result is cached for FORECAST_RESULT_TTL_SEC (5 minutes).  A
  full sweep computes once; every request inside the TTL window slices the
  cached per-city payloads and answers in milliseconds.
- The endpoint must NEVER block the event loop waiting for thread results
  (future.result() in an async handler starves /healthz and every other
  request): per-city work runs on the default executor under an asyncio
  semaphore and is awaited.
"""

from __future__ import annotations

import asyncio
import math
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request

router = APIRouter(tags=["city-forecast"])

# Watchlist from the product spec: mainland-China settlement cities plus
# international monitor cities.
DEFAULT_FORECAST_CITIES: List[str] = [
    "beijing",
    "shanghai",
    "guangzhou",
    "chengdu",
    "chongqing",
    "qingdao",
    "wuhan",
    "jinan",
    "zhengzhou",
    "shenzhen",
    "seoul",
    "busan",
    "manila",
    "tel aviv",
    "madrid",
    "moscow",
    "sao paulo",
    "buenos aires",
    "mexico city",
    "cape town",
    "tokyo",
    "kuala lumpur",
    "amsterdam",
    "hong kong",
]

_MAX_CITIES = 64
_FORECAST_CONCURRENCY = 2
FORECAST_RESULT_TTL_SEC = 300  # 5-minute result cache per the ops recommendation

_FORECAST_CACHE: Dict[str, Dict[str, Any]] = {}
_FORECAST_CACHE_TS: float = 0.0
_FORECAST_CACHE_LOCK = threading.Lock()


def _normalize_hourly_time(value: Any) -> str:
    """Return the local HH:MM portion used by the public hourly curve."""
    text = str(value or "").strip()
    if "T" in text:
        text = text.split("T", 1)[1]
    if " " in text:
        text = text.rsplit(" ", 1)[-1]
    return text[:5]


def _build_curve_payload(
    times: Any,
    temps: Any,
    *,
    source: str,
    local_date: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Build a public, today-only curve and its peak metadata."""
    if not isinstance(times, list) or not isinstance(temps, list):
        return None

    curve_times: List[str] = []
    curve_temps: List[Optional[float]] = []
    for index, raw_time in enumerate(times):
        time_text = str(raw_time or "").strip()
        if not time_text:
            continue
        if (
            local_date
            and ("T" in time_text or " " in time_text)
            and not time_text.startswith(local_date)
        ):
            continue
        raw_temp = temps[index] if index < len(temps) else None
        try:
            temp = float(raw_temp) if raw_temp is not None else None
        except (TypeError, ValueError):
            temp = None
        if temp is not None and not math.isfinite(temp):
            temp = None
        curve_times.append(_normalize_hourly_time(time_text))
        curve_temps.append(temp)

    numeric_temps = [temp for temp in curve_temps if temp is not None]
    if not curve_times or not numeric_temps:
        return None

    peak_temp = max(numeric_temps)
    peak_times = [
        curve_times[index]
        for index, temp in enumerate(curve_temps)
        if temp is not None and math.isclose(temp, peak_temp, abs_tol=1e-9)
    ]
    return {
        "source": source,
        "times": curve_times,
        "temps": curve_temps,
        "peak_temp": peak_temp,
        "peak_times": peak_times,
    }


def _build_model_mean_curve(
    multi_model: Dict[str, Any], local_date: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Fallback to a same-index mean when no DEB/Open-Meteo curve is present."""
    times = multi_model.get("hourly_times")
    curves = multi_model.get("hourly_forecasts")
    if not isinstance(times, list) or not isinstance(curves, dict):
        return None

    mean_times: List[str] = []
    mean_temps: List[float] = []
    for index, raw_time in enumerate(times):
        time_text = str(raw_time or "").strip()
        if not time_text:
            continue
        if (
            local_date
            and ("T" in time_text or " " in time_text)
            and not time_text.startswith(local_date)
        ):
            continue
        values: List[float] = []
        for series in curves.values():
            if not isinstance(series, list) or index >= len(series):
                continue
            try:
                value = float(series[index])
            except (TypeError, ValueError):
                continue
            if math.isfinite(value):
                values.append(value)
        if values:
            mean_times.append(_normalize_hourly_time(time_text))
            mean_temps.append(round(sum(values) / len(values), 1))

    return _build_curve_payload(
        mean_times,
        mean_temps,
        source="multi_model_mean",
    )


def _build_public_hourly_forecast(
    data: Dict[str, Any],
    deb: Dict[str, Any],
    multi_model: Dict[str, Any],
) -> Dict[str, Any]:
    """Select the production curve, with deterministic fallbacks."""
    local_date = str(data.get("local_date") or "").strip() or None
    candidates = (
        (deb.get("hourly_path"), "deb_hourly_path"),
        (deb.get("hourly_consensus"), "deb_hourly_consensus"),
        (data.get("hourly"), "open_meteo"),
    )
    for candidate, source in candidates:
        if not isinstance(candidate, dict):
            continue
        curve = _build_curve_payload(
            candidate.get("times"),
            candidate.get("temps"),
            source=source,
            local_date=local_date,
        )
        if curve is not None:
            return curve

    fallback = _build_model_mean_curve(multi_model, local_date)
    if fallback is not None:
        return fallback
    return {
        "source": None,
        "times": [],
        "temps": [],
        "peak_temp": None,
        "peak_times": [],
    }


def _build_public_models_daily(
    data: Dict[str, Any], multi_model: Dict[str, Any]
) -> Dict[str, Dict[str, Any]]:
    """Expose raw daily models plus derived settlement-source models."""
    raw_daily = multi_model.get("daily_forecasts")
    daily: Dict[str, Dict[str, Any]] = {
        str(date): dict(values)
        for date, values in (raw_daily.items() if isinstance(raw_daily, dict) else [])
        if isinstance(values, dict)
    }

    # The analysis layer adds settlement forecasts such as HKO to the current
    # day's model set. Merge those values without replacing raw Open-Meteo
    # model values already present in the public payload.
    derived_daily = data.get("multi_model_daily")
    if not isinstance(derived_daily, dict):
        return daily
    for date, day_payload in derived_daily.items():
        if not isinstance(day_payload, dict):
            continue
        models = day_payload.get("models")
        if not isinstance(models, dict):
            continue
        target = daily.setdefault(str(date), {})
        for model, value in models.items():
            target.setdefault(str(model), value)
    return daily


def _cached_forecasts() -> Dict[str, Dict[str, Any]]:
    """Return the cached per-city payloads if fresh, else {}."""
    with _FORECAST_CACHE_LOCK:
        if _FORECAST_CACHE and time.time() - _FORECAST_CACHE_TS < FORECAST_RESULT_TTL_SEC:
            return dict(_FORECAST_CACHE)
        return {}


def _store_forecasts(payloads: Dict[str, Dict[str, Any]]) -> None:
    global _FORECAST_CACHE, _FORECAST_CACHE_TS
    with _FORECAST_CACHE_LOCK:
        _FORECAST_CACHE.clear()
        _FORECAST_CACHE.update(payloads)
        _FORECAST_CACHE_TS = time.time()


def _build_city_forecast(city: str) -> Optional[Dict[str, Any]]:
    """Extract the public DEB, hourly, and multi-model forecast payload."""
    from web.analysis_service import _analyze

    try:
        data = _analyze(city, force_refresh=False, detail_mode="panel")
    except Exception:
        return None
    if not isinstance(data, dict):
        return None

    deb = data.get("deb") if isinstance(data.get("deb"), dict) else {}
    multi_model = (
        data.get("multi_model") if isinstance(data.get("multi_model"), dict) else {}
    )
    forecast = data.get("forecast") if isinstance(data.get("forecast"), dict) else {}
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    daily_forecasts = _build_public_models_daily(data, multi_model)
    hourly_times = multi_model.get("hourly_times") or []
    hourly_forecasts = multi_model.get("hourly_forecasts") or {}
    hourly = _build_public_hourly_forecast(data, deb, multi_model)
    peak_times = hourly.get("peak_times") or []

    return {
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "utc_offset_seconds": data.get("utc_offset_seconds"),
        "temp_symbol": data.get("temp_symbol"),
        "current": {
            "temp": current.get("temp"),
            "max_so_far": current.get("max_so_far"),
            "max_temp_time": current.get("max_temp_time"),
        },
        "deb_prediction": deb.get("prediction"),
        "deb_weights": deb.get("weights_info"),
        "deb_quality": deb.get("quality_tier"),
        "forecast_today_high": forecast.get("today_high"),
        "forecast_max_temp_time": peak_times[0] if peak_times else None,
        "forecast_max_temp_times": peak_times,
        "forecast_max_temp_source": hourly.get("source"),
        "forecast_daily": forecast.get("daily") or [],
        "hourly": hourly,
        "models_daily": daily_forecasts,
        "models_hourly": {
            "times": hourly_times,
            "curves": hourly_forecasts,
        },
        "model_keys": multi_model.get("model_keys") or [],
    }


async def _compute_forecasts(resolved: List[str]) -> Dict[str, Dict[str, Any]]:
    """Compute per-city payloads for the given cities under a concurrency cap."""
    semaphore = asyncio.Semaphore(_FORECAST_CONCURRENCY)
    loop = asyncio.get_running_loop()

    async def _run(city: str) -> Optional[Dict[str, Any]]:
        async with semaphore:
            return await loop.run_in_executor(None, _build_city_forecast, city)

    payloads = await asyncio.gather(*(_run(city) for city in resolved))
    return {
        city: payload
        for city, payload in zip(resolved, payloads)
        if payload is not None
    }


async def _get_forecast_results(request: Request, cities: str) -> Dict[str, Any]:
    """Resolve, authorize, cache, and compute forecasts for public endpoints."""
    import web.routes as legacy_routes

    legacy_routes._assert_entitlement(request)

    selected: List[str] = []
    for raw in str(cities or "").split(","):
        name = raw.strip().lower().replace("_", " ").replace("-", " ")
        if name:
            selected.append(name)
    if not selected:
        selected = DEFAULT_FORECAST_CITIES

    from src.data_collection.city_registry import ALIASES, CITY_REGISTRY

    def _resolve(name: str) -> Optional[str]:
        if name in CITY_REGISTRY:
            return name
        alias = ALIASES.get(name)
        if alias and alias in CITY_REGISTRY:
            return alias
        return None

    resolved: List[str] = []
    for name in selected[: _MAX_CITIES]:
        canonical = _resolve(name)
        if canonical is not None:
            resolved.append(canonical)

    cached = _cached_forecasts()
    missing = [city for city in resolved if city not in cached]
    if missing:
        computed = await _compute_forecasts(missing)
        if computed:
            merged = dict(cached)
            merged.update(computed)
            _store_forecasts(merged)
        else:
            computed = {}
    else:
        computed = {}

    results: Dict[str, Any] = {}
    for city in resolved:
        payload = cached.get(city) or computed.get(city)
        if payload is not None:
            results[city] = payload

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "temp_symbol_default": "°C",
        "count": len(results),
        "cities": results,
    }


@router.get("/api/v1/forecasts")
async def v1_forecasts(
    request: Request,
    cities: str = "",
):
    """Stable PolyWeather API v1 forecast endpoint for external consumers."""
    payload = await _get_forecast_results(request, cities)
    forecasts: Dict[str, Any] = {}
    for city, legacy in payload["cities"].items():
        forecasts[city] = {
            "local_date": legacy.get("local_date"),
            "local_time": legacy.get("local_time"),
            "utc_offset_seconds": legacy.get("utc_offset_seconds"),
            "temp_symbol": legacy.get("temp_symbol"),
            "current": legacy.get("current")
            or {"temp": None, "max_so_far": None, "max_temp_time": None},
            "deb": {
                "prediction": legacy.get("deb_prediction"),
                "weights": legacy.get("deb_weights"),
                "quality": legacy.get("deb_quality"),
            },
            "forecast": {
                "today_high": legacy.get("forecast_today_high"),
                "max_temp_time": legacy.get("forecast_max_temp_time"),
                "max_temp_times": legacy.get("forecast_max_temp_times") or [],
                "max_temp_source": legacy.get("forecast_max_temp_source"),
            },
            "daily": legacy.get("forecast_daily") or [],
            "hourly": legacy.get("hourly")
            or {
                "source": None,
                "times": [],
                "temps": [],
                "peak_temp": None,
                "peak_times": [],
            },
            "models": {
                "keys": legacy.get("model_keys") or [],
                "daily": legacy.get("models_daily") or {},
                "hourly": legacy.get("models_hourly")
                or {"times": [], "curves": {}},
            },
        }
    return {
        "generated_at": payload["generated_at"],
        "temp_symbol_default": payload["temp_symbol_default"],
        "count": len(forecasts),
        "forecasts": forecasts,
    }
