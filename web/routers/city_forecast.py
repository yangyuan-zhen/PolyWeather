"""City DEB + multi-model forecast API for external consumers.

Returns a compact per-city payload: the DEB blend prediction, the model
consensus weights, and the multi-model daily forecasts (3 days) for a fixed
watchlist of cities (10 mainland-China + international monitors).

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
    "hong kong",
]

_MAX_CITIES = 64
_FORECAST_CONCURRENCY = 2
FORECAST_RESULT_TTL_SEC = 300  # 5-minute result cache per the ops recommendation

_FORECAST_CACHE: Dict[str, Dict[str, Any]] = {}
_FORECAST_CACHE_TS: float = 0.0
_FORECAST_CACHE_LOCK = threading.Lock()


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
    """Extract DEB + multi-model daily forecasts for one city (cache-first)."""
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
    daily_forecasts = multi_model.get("daily_forecasts") or {}

    return {
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "deb_prediction": deb.get("prediction"),
        "deb_weights": deb.get("weights_info"),
        "deb_quality": deb.get("quality_tier"),
        "forecast_daily": forecast.get("daily") or [],
        "models_daily": daily_forecasts,
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


@router.get("/api/cities/deb-forecast")
async def city_deb_forecast(
    request: Request,
    cities: str = "",
):
    """DEB + multi-model forecasts for the watchlist (or a custom city list).

    Serves from the 5-minute result cache; missing cities (first call, TTL
    expiry, or a custom list extending the cache) are computed on demand.
    """
    import web.routes as legacy_routes

    legacy_routes._assert_entitlement(request)

    selected: List[str] = []
    for raw in str(cities or "").split(","):
        name = raw.strip().lower().replace("_", " ").replace("-", " ")
        if name:
            selected.append(name)
    if not selected:
        selected = DEFAULT_FORECAST_CITIES

    from src.data_collection.city_registry import CITY_REGISTRY

    resolved: List[str] = [
        name for name in selected[: _MAX_CITIES] if name in CITY_REGISTRY
    ]

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
