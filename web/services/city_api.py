"""City API service functions used by the city router."""

from __future__ import annotations

import os
import asyncio
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from loguru import logger

import web.routes as legacy_routes
from web.services.request_timing import ServerTimingRecorder

_RECENT_DEB_CACHE: Optional[Dict[str, Dict[str, object]]] = None
_RECENT_DEB_CACHE_TS = 0.0
_RECENT_DEB_REFRESHING = False
_RECENT_DEB_LOCK = threading.Lock()
_RECENT_DEB_CACHE_TTL_SEC = max(
    60,
    int(os.getenv("POLYWEATHER_CITIES_DEB_RECENT_CACHE_TTL_SEC", "300") or "300"),
)
_CITY_FULL_REFRESH_INFLIGHT: Dict[str, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_FULL_STALE_REFRESH_TASKS: Dict[str, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_FULL_REFRESH_LOCK = asyncio.Lock()
CityDetailPayloadCacheKey = Tuple[str, str, str, str, str, int]
CityDetailBatchResponseCacheKey = Tuple[Tuple[str, ...], bool, str, str, str, str]
_CITY_DETAIL_PAYLOAD_CACHE: Dict[CityDetailPayloadCacheKey, Dict[str, Any]] = {}
_CITY_DETAIL_PAYLOAD_CACHE_TS: Dict[CityDetailPayloadCacheKey, float] = {}
_CITY_DETAIL_PAYLOAD_INFLIGHT: Dict[CityDetailPayloadCacheKey, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_DETAIL_PAYLOAD_EPOCH: Dict[str, int] = {}
_CITY_DETAIL_PAYLOAD_LOCK = asyncio.Lock()
_CITY_DETAIL_BATCH_RESPONSE_CACHE: Dict[CityDetailBatchResponseCacheKey, Dict[str, Any]] = {}
_CITY_DETAIL_BATCH_RESPONSE_CACHE_TS: Dict[CityDetailBatchResponseCacheKey, float] = {}
_CITY_DETAIL_BATCH_RESPONSE_INFLIGHT: Dict[CityDetailBatchResponseCacheKey, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_DETAIL_BATCH_RESPONSE_LOCK = asyncio.Lock()


def _city_detail_payload_cache_ttl() -> float:
    try:
        value = float(os.getenv("POLYWEATHER_CITY_DETAIL_PAYLOAD_CACHE_TTL_SEC", "8") or "8")
    except ValueError:
        value = 8.0
    return max(0.0, min(30.0, value))


def _city_detail_batch_response_cache_ttl() -> float:
    try:
        value = float(
            os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_RESPONSE_CACHE_TTL_SEC", "12")
            or "12"
        )
    except ValueError:
        value = 12.0
    return max(0.0, min(30.0, value))


async def _overlay_cached_wunderground(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return await run_in_threadpool(
        legacy_routes._overlay_latest_wunderground_current,
        city,
        payload,
    )


async def _refresh_city_full_cache_singleflight(city: str, force_refresh: bool) -> Dict[str, Any]:
    key = f"{city}:{bool(force_refresh)}"
    async with _CITY_FULL_REFRESH_LOCK:
        task = _CITY_FULL_REFRESH_INFLIGHT.get(key)
        if task is None:
            async def _run_refresh() -> Dict[str, Any]:
                try:
                    return await run_in_threadpool(
                        legacy_routes._refresh_city_full_cache,
                        city,
                        force_refresh,
                    )
                finally:
                    await _invalidate_city_detail_payload_cache(city)

            task = asyncio.create_task(_run_refresh())
            _CITY_FULL_REFRESH_INFLIGHT[key] = task
    try:
        return await task
    finally:
        if task.done():
            async with _CITY_FULL_REFRESH_LOCK:
                if _CITY_FULL_REFRESH_INFLIGHT.get(key) is task:
                    _CITY_FULL_REFRESH_INFLIGHT.pop(key, None)


async def _invalidate_city_detail_payload_cache(city: str) -> None:
    normalized = str(city or "").strip().lower()
    if not normalized:
        return
    async with _CITY_DETAIL_PAYLOAD_LOCK:
        _CITY_DETAIL_PAYLOAD_EPOCH[normalized] = _CITY_DETAIL_PAYLOAD_EPOCH.get(normalized, 0) + 1
        old_keys = [key for key in _CITY_DETAIL_PAYLOAD_CACHE if key[0] == normalized]
        for key in old_keys:
            _CITY_DETAIL_PAYLOAD_CACHE.pop(key, None)
            _CITY_DETAIL_PAYLOAD_CACHE_TS.pop(key, None)


async def _refresh_city_full_data(city: str, force_refresh: bool) -> Dict[str, Any]:
    await _invalidate_city_detail_payload_cache(city)
    return await _refresh_city_full_cache_singleflight(city, force_refresh)


def _start_city_full_stale_refresh(city: str) -> None:
    normalized = str(city or "").strip().lower()
    if not normalized:
        return
    existing = _CITY_FULL_STALE_REFRESH_TASKS.get(normalized)
    if existing is not None and not existing.done():
        return

    task = asyncio.create_task(_refresh_city_full_data(city, False))
    _CITY_FULL_STALE_REFRESH_TASKS[normalized] = task

    def _cleanup(done: "asyncio.Task[Dict[str, Any]]") -> None:
        if _CITY_FULL_STALE_REFRESH_TASKS.get(normalized) is done:
            _CITY_FULL_STALE_REFRESH_TASKS.pop(normalized, None)
        try:
            done.result()
        except Exception as exc:  # pragma: no cover - defensive background guard
            logger.warning("city full stale refresh failed city={}: {}", city, exc)

    task.add_done_callback(_cleanup)


async def _get_city_full_data(city: str, *, force_refresh: bool) -> Dict[str, Any]:
    if force_refresh:
        return await _refresh_city_full_data(city, True)
    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "full", city)
    if cached_entry:
        payload = cached_entry.get("payload") or {}
        if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_FULL_CACHE_TTL_SEC):
            if payload:
                _start_city_full_stale_refresh(city)
                return await _overlay_cached_wunderground(city, payload)
            return await _refresh_city_full_data(city, False)
        return await _overlay_cached_wunderground(city, payload)
    return await _refresh_city_full_data(city, False)


def _city_detail_payload_cache_key(
    data: Dict[str, Any],
    market_slug: Optional[str],
    target_date: Optional[str],
    resolution: Optional[str],
) -> CityDetailPayloadCacheKey:
    city = str(data.get("city") or data.get("name") or "").strip().lower()
    fingerprint = str(
        data.get("updated_at_ts")
        or data.get("updated_at")
        or data.get("local_time")
        or data.get("local_date")
        or id(data)
    )
    generation = _CITY_DETAIL_PAYLOAD_EPOCH.get(city, 0)
    return (
        city,
        str(resolution or "10m"),
        str(market_slug or ""),
        str(target_date or ""),
        fingerprint,
        generation,
    )


async def _build_city_detail_payload_cached(
    data: Dict[str, Any],
    market_slug: Optional[str],
    target_date: Optional[str],
    resolution: Optional[str],
) -> Dict[str, Any]:
    ttl = _city_detail_payload_cache_ttl()
    if ttl <= 0:
        return await run_in_threadpool(
            legacy_routes._build_city_detail_payload,
            data,
            market_slug,
            target_date,
            resolution,
        )

    key = _city_detail_payload_cache_key(data, market_slug, target_date, resolution)
    now_ts = time.time()
    async with _CITY_DETAIL_PAYLOAD_LOCK:
        cached = _CITY_DETAIL_PAYLOAD_CACHE.get(key)
        cached_ts = _CITY_DETAIL_PAYLOAD_CACHE_TS.get(key, 0.0)
        if cached is not None and now_ts - cached_ts < ttl:
            return cached
        task = _CITY_DETAIL_PAYLOAD_INFLIGHT.get(key)
        if task is None:
            task = asyncio.create_task(
                run_in_threadpool(
                    legacy_routes._build_city_detail_payload,
                    data,
                    market_slug,
                    target_date,
                    resolution,
                ),
            )
            _CITY_DETAIL_PAYLOAD_INFLIGHT[key] = task
    try:
        payload = await task
    finally:
        if task.done():
            async with _CITY_DETAIL_PAYLOAD_LOCK:
                if _CITY_DETAIL_PAYLOAD_INFLIGHT.get(key) is task:
                    _CITY_DETAIL_PAYLOAD_INFLIGHT.pop(key, None)

    async with _CITY_DETAIL_PAYLOAD_LOCK:
        _CITY_DETAIL_PAYLOAD_CACHE[key] = payload
        _CITY_DETAIL_PAYLOAD_CACHE_TS[key] = time.time()
        if len(_CITY_DETAIL_PAYLOAD_CACHE) > 256:
            oldest_keys = sorted(
                _CITY_DETAIL_PAYLOAD_CACHE_TS,
                key=lambda item: _CITY_DETAIL_PAYLOAD_CACHE_TS.get(item, 0.0),
            )[:64]
            for old_key in oldest_keys:
                _CITY_DETAIL_PAYLOAD_CACHE.pop(old_key, None)
                _CITY_DETAIL_PAYLOAD_CACHE_TS.pop(old_key, None)
    return payload


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
        return await _get_city_full_data(city, force_refresh=force_refresh)
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
    timer = ServerTimingRecorder(
        request,
        log_name="city_detail_timing",
        prefix="city_detail",
        state_attr="city_detail_server_timing",
    )
    outcome = "ok"
    status_code = 200
    try:
        timer.measure("assert_entitlement", lambda: legacy_routes._assert_entitlement(request))
        city = timer.measure("normalize_city", lambda: legacy_routes._normalize_city_or_404(name))
        data = await timer.measure_async(
            "full_data",
            lambda: _get_city_full_data(city, force_refresh=force_refresh),
        )

        return await timer.measure_async(
            "detail_payload",
            lambda: _build_city_detail_payload_cached(
                data,
                market_slug,
                target_date,
                resolution,
            ),
        )
    except HTTPException as exc:
        outcome = f"http_{exc.status_code}"
        status_code = exc.status_code
        raise
    except Exception:
        outcome = "exception"
        status_code = 500
        raise
    finally:
        timer.finish(outcome=outcome, status_code=status_code)


def _parse_batch_city_names(raw_cities: str, *, limit: int) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in str(raw_cities or "").split(","):
        raw = item.strip()
        if not raw:
            continue
        city = legacy_routes._normalize_city_or_404(raw)
        if city in seen:
            continue
        seen.add(city)
        out.append(city)
        if len(out) >= limit:
            break
    return out


def _city_detail_batch_response_cache_key(
    city_names: List[str],
    *,
    force_refresh: bool,
    market_slug: Optional[str],
    target_date: Optional[str],
    resolution: Optional[str],
    scope: str,
) -> CityDetailBatchResponseCacheKey:
    return (
        tuple(city_names),
        bool(force_refresh),
        str(market_slug or ""),
        str(target_date or ""),
        str(resolution or "10m"),
        str(scope or "full"),
    )


def _normalize_city_detail_scope(scope: Optional[str]) -> str:
    raw = str(scope or "full").strip().lower()
    if raw in {"chart", "charts", "terminal", "terminal_chart"}:
        return "chart"
    return "full"


def _chart_scoped_city_detail(detail: Dict[str, Any]) -> Dict[str, Any]:
    overview = detail.get("overview") if isinstance(detail.get("overview"), dict) else {}
    timeseries = detail.get("timeseries") if isinstance(detail.get("timeseries"), dict) else {}
    forecast = detail.get("forecast") if isinstance(detail.get("forecast"), dict) else {}
    airport_primary_today_obs = (
        detail.get("airport_primary_today_obs")
        or overview.get("airport_primary_today_obs")
        or []
    )
    forecast_daily = (
        (forecast.get("daily") if isinstance(forecast, dict) else None)
        or timeseries.get("forecast_daily")
        or []
    )
    local_date = detail.get("local_date") or overview.get("local_date")
    local_time = detail.get("local_time") or overview.get("local_time")

    scoped = {
        "city": detail.get("city") or overview.get("name"),
        "fetched_at": detail.get("fetched_at"),
        "local_date": local_date,
        "local_time": local_time,
        "overview": {
            "name": overview.get("name"),
            "display_name": overview.get("display_name"),
            "local_date": local_date,
            "local_time": local_time,
            "temp_symbol": overview.get("temp_symbol"),
            "current_temp": overview.get("current_temp"),
            "deb_prediction": overview.get("deb_prediction"),
            "settlement_source": overview.get("settlement_source"),
            "settlement_source_label": overview.get("settlement_source_label"),
        },
        "timeseries": {
            "hourly": timeseries.get("hourly") or detail.get("hourly") or {},
            "metar_today_obs": timeseries.get("metar_today_obs") or [],
            "settlement_today_obs": timeseries.get("settlement_today_obs") or [],
            "forecast_daily": forecast_daily,
        },
        "hourly": timeseries.get("hourly") or detail.get("hourly") or {},
        "models_hourly": detail.get("models_hourly") or {},
        "deb": detail.get("deb") or {},
        "forecast": {
            "today_high": forecast.get("today_high") if isinstance(forecast, dict) else None,
            "daily": forecast_daily,
        },
        "multi_model_daily": detail.get("multi_model_daily") or {},
        "probabilities": detail.get("probabilities") or {"mu": None, "distribution": []},
        "runway_plate_history": detail.get("runway_plate_history") or {},
        "runway_band_history": detail.get("runway_band_history") or [],
        "amos": detail.get("amos") or {},
        "airport_current": detail.get("airport_current") or {},
        "airport_primary": detail.get("airport_primary") or overview.get("airport_primary") or {},
        "airport_primary_today_obs": airport_primary_today_obs,
        "official": {"airport_primary_today_obs": airport_primary_today_obs},
        "wunderground_current": detail.get("wunderground_current") or {},
        "settlement_station": detail.get("settlement_station") or overview.get("settlement_station") or {},
    }
    return scoped


def _apply_city_detail_scope(detail: Dict[str, Any], scope: str) -> Dict[str, Any]:
    if scope == "chart":
        return _chart_scoped_city_detail(detail)
    return detail


async def _build_city_detail_batch_item_async(
    city: str,
    *,
    force_refresh: bool,
    market_slug: Optional[str],
    target_date: Optional[str],
    resolution: Optional[str],
    detail_scope: str = "full",
    timing_recorder: Optional[ServerTimingRecorder] = None,
) -> Tuple[str, Dict[str, Any]]:
    if timing_recorder is not None:
        data = await timing_recorder.measure_async(
            f"full_data_{city}",
            lambda: _get_city_full_data(city, force_refresh=force_refresh),
        )
        detail = await timing_recorder.measure_async(
            f"detail_payload_{city}",
            lambda: _build_city_detail_payload_cached(
                data,
                market_slug,
                target_date,
                resolution,
            ),
        )
    else:
        data = await _get_city_full_data(city, force_refresh=force_refresh)
        detail = await _build_city_detail_payload_cached(
            data,
            market_slug,
            target_date,
            resolution,
        )
    return city, _apply_city_detail_scope(detail, detail_scope)


def _city_detail_batch_concurrency() -> int:
    try:
        value = int(os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_CONCURRENCY", "3") or "3")
    except ValueError:
        value = 3
    return max(1, min(6, value))


def _city_detail_batch_partial_timeout_seconds() -> Optional[float]:
    try:
        timeout_ms = int(
            os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS", "8500")
            or "8500"
        )
    except ValueError:
        timeout_ms = 8500
    if timeout_ms <= 0:
        return None
    return max(0.001, min(60.0, timeout_ms / 1000.0))


async def get_city_detail_batch_payload(
    request: Request,
    *,
    cities: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    resolution: Optional[str] = "10m",
    scope: Optional[str] = "full",
    limit: int = 12,
) -> Dict[str, Any]:
    timer = ServerTimingRecorder(
        request,
        log_name="city_detail_batch_timing",
        prefix="city_detail_batch",
        state_attr="city_detail_batch_server_timing",
    )
    outcome = "ok"
    status_code = 200
    try:
        timer.measure("assert_entitlement", lambda: legacy_routes._assert_entitlement(request))
        city_names = timer.measure(
            "parse_cities",
            lambda: _parse_batch_city_names(
                cities,
                limit=max(1, min(24, int(limit or 12))),
            ),
        )
        if not city_names:
            return {
                "cities": [],
                "details": {},
                "errors": {},
                "missing": [],
                "partial": False,
            }
        detail_scope = _normalize_city_detail_scope(scope)

        async def _build_uncached_payload() -> Dict[str, Any]:
            semaphore = asyncio.Semaphore(_city_detail_batch_concurrency())

            async def _build_with_limit(city: str) -> Tuple[str, Dict[str, Any]]:
                async with semaphore:
                    return await _build_city_detail_batch_item_async(
                        city,
                        force_refresh=force_refresh,
                        market_slug=market_slug,
                        target_date=target_date,
                        resolution=resolution,
                        detail_scope=detail_scope,
                        timing_recorder=timer,
                    )

            task_by_city = {
                city: asyncio.create_task(_build_with_limit(city))
                for city in city_names
            }
            task_city_lookup = {task: city for city, task in task_by_city.items()}
            done, pending = await timer.measure_async(
                "build_details",
                lambda: asyncio.wait(
                    task_by_city.values(),
                    timeout=_city_detail_batch_partial_timeout_seconds(),
                ),
            )
            details: Dict[str, Any] = {}
            errors: Dict[str, str] = {}
            missing: List[str] = []
            for task in done:
                city = task_city_lookup[task]
                try:
                    result_city, payload = task.result()
                except Exception as exc:
                    errors[city] = str(exc)
                    continue
                details[result_city] = payload

            for task in pending:
                city = task_city_lookup[task]
                missing.append(city)
                task.cancel()

            missing_set = set(missing)
            missing = [city for city in city_names if city in missing_set]
            return {
                "cities": city_names,
                "details": details,
                "errors": errors,
                "missing": missing,
                "partial": bool(missing or errors),
            }

        cache_ttl = _city_detail_batch_response_cache_ttl()
        cache_key = _city_detail_batch_response_cache_key(
            city_names,
            force_refresh=force_refresh,
            market_slug=market_slug,
            target_date=target_date,
            resolution=resolution,
            scope=detail_scope,
        )
        if cache_ttl > 0 and not force_refresh:
            now_ts = time.time()
            async with _CITY_DETAIL_BATCH_RESPONSE_LOCK:
                cached = _CITY_DETAIL_BATCH_RESPONSE_CACHE.get(cache_key)
                cached_ts = _CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.get(cache_key, 0.0)
                if cached is not None and now_ts - cached_ts < cache_ttl:
                    outcome = "cache_hit"
                    return cached
                task = _CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.get(cache_key)
                owner = False
                if task is None:
                    owner = True
                    task = asyncio.create_task(_build_uncached_payload())
                    _CITY_DETAIL_BATCH_RESPONSE_INFLIGHT[cache_key] = task

            try:
                payload = await timer.measure_async(
                    "build_or_wait_cached_batch",
                    lambda: task,
                )
            finally:
                if owner and task.done():
                    async with _CITY_DETAIL_BATCH_RESPONSE_LOCK:
                        if _CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.get(cache_key) is task:
                            _CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.pop(cache_key, None)
            if payload.get("partial"):
                outcome = "partial"
            elif not owner:
                outcome = "shared_inflight"

            if owner:
                async with _CITY_DETAIL_BATCH_RESPONSE_LOCK:
                    if not payload.get("partial"):
                        _CITY_DETAIL_BATCH_RESPONSE_CACHE[cache_key] = payload
                        _CITY_DETAIL_BATCH_RESPONSE_CACHE_TS[cache_key] = time.time()
                        if len(_CITY_DETAIL_BATCH_RESPONSE_CACHE) > 128:
                            oldest_keys = sorted(
                                _CITY_DETAIL_BATCH_RESPONSE_CACHE_TS,
                                key=lambda item: _CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.get(item, 0.0),
                            )[:32]
                            for old_key in oldest_keys:
                                _CITY_DETAIL_BATCH_RESPONSE_CACHE.pop(old_key, None)
                                _CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.pop(old_key, None)
            return payload

        payload = await _build_uncached_payload()
        if payload.get("partial"):
            outcome = "partial"
        return payload
    except HTTPException as exc:
        outcome = f"http_{exc.status_code}"
        status_code = exc.status_code
        raise
    except Exception:
        outcome = "exception"
        status_code = 500
        raise
    finally:
        timer.finish(outcome=outcome, status_code=status_code)
