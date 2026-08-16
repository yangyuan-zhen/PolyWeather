"""City DEB + multi-model forecast API for external consumers.

Returns a compact per-city payload: the DEB blend prediction, the model
consensus weights, and the multi-model daily forecasts (3 days) for a fixed
watchlist of cities (10 mainland-China + international monitors).

Authentication: same entitlement token as the other pro endpoints.

IMPORTANT: the per-city analysis runs on a thread pool but the endpoint must
NEVER block the event loop waiting for results (future.result() in an async
handler starves /healthz and every other request).  Use asyncio gates.
"""

from __future__ import annotations

import asyncio
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
    "lau fau shan",
]

_MAX_CITIES = 64
_FORECAST_CONCURRENCY = 2


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


@router.get("/api/cities/deb-forecast")
async def city_deb_forecast(
    request: Request,
    cities: str = "",
):
    """DEB + multi-model forecasts for the watchlist (or a custom city list)."""
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

    # Bound concurrency so a cold 23-city sweep cannot saturate the process;
    # await results so the event loop (and /healthz) stays responsive.
    semaphore = asyncio.Semaphore(_FORECAST_CONCURRENCY)
    loop = asyncio.get_running_loop()

    async def _run(city: str) -> Optional[Dict[str, Any]]:
        async with semaphore:
            return await loop.run_in_executor(None, _build_city_forecast, city)

    payloads = await asyncio.gather(*(_run(city) for city in resolved))

    results: Dict[str, Any] = {}
    for city, payload in zip(resolved, payloads):
        if payload is not None:
            results[city] = payload

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "temp_symbol_default": "°C",
        "count": len(results),
        "cities": results,
    }
