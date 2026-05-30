"""City API service functions used by the city router."""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from loguru import logger

import web.routes as legacy_routes

_RECENT_DEB_CACHE: Optional[Dict[str, Dict[str, object]]] = None
_RECENT_DEB_CACHE_TS = 0.0
_RECENT_DEB_REFRESHING = False
_RECENT_DEB_LOCK = threading.Lock()
_RECENT_DEB_CACHE_TTL_SEC = max(
    60,
    int(os.getenv("POLYWEATHER_CITIES_DEB_RECENT_CACHE_TTL_SEC", "300") or "300"),
)


async def _overlay_cached_wunderground(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return await run_in_threadpool(
        legacy_routes._overlay_latest_wunderground_current,
        city,
        payload,
    )


def _default_deb_recent() -> Dict[str, object]:
    return {
        "tier": "other",
        "hit_rate": None,
        "sample_count": 0,
        "mae": None,
        "last_date": None,
    }


def _refresh_recent_deb_cache() -> Dict[str, Dict[str, object]]:
    global _RECENT_DEB_CACHE, _RECENT_DEB_CACHE_TS, _RECENT_DEB_REFRESHING

    try:
        index = legacy_routes._build_recent_deb_performance_index()
        with _RECENT_DEB_LOCK:
            _RECENT_DEB_CACHE = index
            _RECENT_DEB_CACHE_TS = time.time()
        return index
    except Exception as exc:
        logger.warning(f"Recent DEB performance cache refresh failed: {exc}")
        with _RECENT_DEB_LOCK:
            return _RECENT_DEB_CACHE or {}
    finally:
        with _RECENT_DEB_LOCK:
            _RECENT_DEB_REFRESHING = False


def _get_recent_deb_cache() -> Optional[Dict[str, Dict[str, object]]]:
    with _RECENT_DEB_LOCK:
        if (
            _RECENT_DEB_CACHE is not None
            and time.time() - _RECENT_DEB_CACHE_TS < _RECENT_DEB_CACHE_TTL_SEC
        ):
            return _RECENT_DEB_CACHE
    return None


def _start_recent_deb_refresh() -> None:
    global _RECENT_DEB_REFRESHING

    with _RECENT_DEB_LOCK:
        if _RECENT_DEB_REFRESHING:
            return
        _RECENT_DEB_REFRESHING = True

    thread = threading.Thread(
        target=_refresh_recent_deb_cache,
        name="cities-recent-deb-refresh",
        daemon=True,
    )
    thread.start()


def _build_cities_payload(
    deb_recent_index: Optional[Dict[str, Dict[str, object]]] = None,
) -> Dict[str, Any]:
    out = []
    deb_recent_index = deb_recent_index or {}
    for name, info in legacy_routes.CITIES.items():
        risk = legacy_routes.CITY_RISK_PROFILES.get(name, {})
        city_meta = legacy_routes.CITY_REGISTRY.get(name, {}) or {}
        deb_recent = deb_recent_index.get(name, _default_deb_recent())
        settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
        provider = legacy_routes.get_country_network_provider(name)
        out.append(
            {
                "name": name,
                "display_name": str(city_meta.get("display_name") or city_meta.get("name") or name.title()),
                "lat": info["lat"],
                "lon": info["lon"],
                "utc_offset_seconds": legacy_routes.get_city_utc_offset_seconds(name),
                "risk_level": risk.get("risk_level", "low"),
                "risk_emoji": risk.get("risk_emoji", "🟢"),
                "airport": risk.get("airport_name", ""),
                "icao": risk.get("icao", ""),
                "temp_unit": "fahrenheit" if info["f"] else "celsius",
                "is_major": city_meta.get("is_major", True),
                "settlement_source": settlement_source,
                "settlement_source_label": legacy_routes.SETTLEMENT_SOURCE_LABELS.get(
                    settlement_source,
                    settlement_source.upper(),
                ),
                "settlement_station_code": city_meta.get("settlement_station_code") or city_meta.get("icao"),
                "settlement_station_label": city_meta.get("settlement_station_label") or city_meta.get("airport_name"),
                "network_provider": provider.provider_code,
                "network_provider_label": provider.provider_label,
                "deb_recent_tier": deb_recent.get("tier", "other"),
                "deb_recent_hit_rate": deb_recent.get("hit_rate"),
                "deb_recent_sample_count": deb_recent.get("sample_count", 0),
                "deb_recent_mae": deb_recent.get("mae"),
                "deb_recent_last_date": deb_recent.get("last_date"),
            }
        )
    return {"cities": out}


async def list_cities_payload(request: Request) -> Dict[str, Any]:
    try:
        refresh_recent = str(
            request.query_params.get("refresh_deb_recent") or "",
        ).strip().lower() in {"1", "true", "yes"}
        if refresh_recent:
            deb_recent_index = await run_in_threadpool(_refresh_recent_deb_cache)
        else:
            deb_recent_index = _get_recent_deb_cache()
            if deb_recent_index is None:
                _start_recent_deb_refresh()
                deb_recent_index = {}
        return await run_in_threadpool(_build_cities_payload, deb_recent_index)
    except Exception as exc:
        logger.error(f"Error in list_cities: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def get_city_detail_payload(
    request: Request,
    name: str,
    *,
    force_refresh: bool = False,
    depth: str = "panel",
) -> Dict[str, Any]:
    city = legacy_routes._normalize_city_or_404(name)
    normalized_depth = str(depth or "panel").strip().lower()
    if normalized_depth == "full":
        legacy_routes._assert_entitlement(request)
        detail_mode = "full"
    elif normalized_depth == "market":
        legacy_routes._assert_entitlement(request)
        detail_mode = "market"
    elif normalized_depth == "nearby":
        detail_mode = "nearby"
    else:
        detail_mode = "panel"
    if detail_mode == "full":
        if force_refresh:
            return await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, True)
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "full", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_FULL_CACHE_TTL_SEC):
                return await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, False)
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        return await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, False)
    if detail_mode == "panel":
        if force_refresh:
            return await run_in_threadpool(legacy_routes._refresh_city_panel_cache, city, True)
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "panel", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_PANEL_CACHE_TTL_SEC):
                return await run_in_threadpool(legacy_routes._refresh_city_panel_cache, city, False)
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        return await run_in_threadpool(legacy_routes._refresh_city_panel_cache, city, False)
    if detail_mode == "nearby":
        if force_refresh:
            return await run_in_threadpool(legacy_routes._refresh_city_nearby_cache, city, True)
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "nearby", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_NEARBY_CACHE_TTL_SEC):
                return await run_in_threadpool(legacy_routes._refresh_city_nearby_cache, city, False)
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        return await run_in_threadpool(legacy_routes._refresh_city_nearby_cache, city, False)
    if detail_mode == "market":
        if force_refresh:
            return await run_in_threadpool(legacy_routes._refresh_city_market_cache, city, True)
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "market", city)
        if cached_entry:
            if not legacy_routes._market_analysis_cache_is_fresh(cached_entry):
                return await run_in_threadpool(legacy_routes._refresh_city_market_cache, city, False)
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        return await run_in_threadpool(legacy_routes._refresh_city_market_cache, city, False)
    return await run_in_threadpool(legacy_routes._analyze, city, force_refresh, False, detail_mode)


async def get_city_summary_payload(
    _request: Request,
    name: str,
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    city = legacy_routes._normalize_city_or_404(name)
    if force_refresh:
        return await run_in_threadpool(legacy_routes._refresh_city_summary_cache, city, True)
    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "summary", city)
    if cached_entry:
        if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_SUMMARY_CACHE_TTL_SEC):
            return await run_in_threadpool(legacy_routes._refresh_city_summary_cache, city, False)
        return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
    return await run_in_threadpool(legacy_routes._refresh_city_summary_cache, city, False)


async def get_city_detail_aggregate_payload(
    request: Request,
    name: str,
    *,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    resolution: Optional[str] = "10m",
) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    city = legacy_routes._normalize_city_or_404(name)
    if force_refresh:
        data = await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, True)
    else:
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "full", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_FULL_CACHE_TTL_SEC):
                data = await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, False)
            else:
                data = await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        else:
            data = await run_in_threadpool(legacy_routes._refresh_city_full_cache, city, False)

    return await run_in_threadpool(
        legacy_routes._build_city_detail_payload,
        data,
        market_slug,
        target_date,
        resolution,
    )



