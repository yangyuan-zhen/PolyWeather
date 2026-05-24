"""City and city-analysis API routes."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Query, Request

from web.services.city_api import (
    get_city_detail_aggregate_payload,
    get_city_detail_payload,
    get_city_market_scan_payload,
    get_city_summary_payload,
    list_cities_payload,
)

router = APIRouter(tags=["city"])

def _all_city_keys() -> List[str]:
    from src.data_collection.city_registry import CITY_REGISTRY

    return sorted(CITY_REGISTRY.keys())


def _city_display_name(city: str) -> str:
    from src.data_collection.city_registry import CITY_REGISTRY

    meta = CITY_REGISTRY.get(city) or {}
    icao = str(meta.get("icao") or "").strip()
    display = str(meta.get("display_name") or city).strip()
    return f"{display} ({icao})" if icao else display


_MODEL_RANGE_CITIES: List[str] = _all_city_keys()
_MODEL_RANGE_NAMES: Dict[str, str] = {c: _city_display_name(c) for c in _MODEL_RANGE_CITIES}


@router.get("/api/cities")
async def list_cities(request: Request):
    return await list_cities_payload(request)


def _extract_city_model_range(city: str, _force_refresh: bool) -> Optional[Dict[str, Any]]:
    """Extract cached model range data without triggering fresh analysis."""
    from web.analysis_service import _cache, _analysis_cache_key

    for detail_mode in ("full", "panel", "nearby", "market"):
        cache_key = _analysis_cache_key(city, detail_mode)
        cached = _cache.get(cache_key)
        if cached and isinstance(cached.get("d"), dict):
            result = cached["d"]
            if isinstance(result.get("multi_model"), dict) and result["multi_model"]:
                break
    else:
        return None

    if not isinstance(result, dict):
        return None

    deb = result.get("deb") if isinstance(result, dict) else None
    deb_pred = deb.get("prediction") if isinstance(deb, dict) else None

    models = result.get("multi_model") if isinstance(result, dict) else {}
    model_min: Optional[float] = None
    model_max: Optional[float] = None
    spread: Optional[float] = None
    spread_label: str = ""

    if isinstance(models, dict):
        vals = sorted([v for v in models.values() if isinstance(v, (int, float))])
        if len(vals) >= 2:
            model_min = vals[0]
            model_max = vals[-1]
            spread = model_max - model_min
            if spread <= 2.0:
                spread_label = "低分歧"
            elif spread <= 4.0:
                spread_label = "中等分歧"
            else:
                spread_label = "高分歧"

    return {
        "id": city,
        "name": _MODEL_RANGE_NAMES.get(city, city),
        "deb": round(deb_pred, 1) if deb_pred is not None else None,
        "model_min": round(model_min, 1) if model_min is not None else None,
        "model_max": round(model_max, 1) if model_max is not None else None,
        "spread": round(spread, 1) if spread is not None else None,
        "spread_label": spread_label,
    }


@router.get("/api/cities/model-range")
async def cities_model_range(
    request: Request,
    force_refresh: bool = Query(False),
):
    """Return DEB prediction and model range for all monitored cities."""
    rows: List[Dict[str, Any]] = []
    for city in _MODEL_RANGE_CITIES:
        row = _extract_city_model_range(city, force_refresh)
        if row is not None:
            rows.append(row)

    rows.sort(key=lambda r: str(r.get("id") or ""))
    return {"cities": rows}


@router.get("/api/city/{name}")
async def city_detail(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
    depth: str = "panel",
):
    return await get_city_detail_payload(
        request,
        name,
        force_refresh=force_refresh,
        depth=depth,
    )


@router.get("/api/city/{name}/summary")
async def city_summary(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
):
    return await get_city_summary_payload(
        request,
        name,
        force_refresh=force_refresh,
    )


@router.get("/api/city/{name}/detail")
async def city_detail_aggregate(
    request: Request,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
):
    return await get_city_detail_aggregate_payload(
        request,
        name,
        force_refresh=force_refresh,
        market_slug=market_slug,
        target_date=target_date,
    )


@router.get("/api/city/{name}/market-scan")
async def city_market_scan(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
):
    return await get_city_market_scan_payload(
        request,
        background_tasks,
        name,
        force_refresh=force_refresh,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
