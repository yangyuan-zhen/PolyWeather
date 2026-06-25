"""City API service functions used by the city router."""

from __future__ import annotations

import os
import asyncio
import threading
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from loguru import logger

from src.data_collection.forecast_source_bundle import (
    _multi_model_cache_key,
    fetch_open_meteo_forecast_bundle,
)
from src.data_collection.multi_model_freshness import multi_model_forecasts_for_local_date
import web.routes as legacy_routes
from web.analysis_service import _runway_history_temp_for_city
from web.services.canonical_temperature import build_city_weather_from_canonical
from web.services.latest_observation_overlay import (
    overlay_latest_amos_observation,
    overlay_latest_amsc_observation,
    overlay_latest_cwa_observation,
    overlay_latest_hko_observation,
    overlay_latest_jma_amedas_observation,
    overlay_latest_mgm_observation,
    parse_observation_epoch,
)
from web.services.request_timing import ServerTimingRecorder

_RECENT_DEB_CACHE: Optional[Dict[str, Dict[str, object]]] = None
_RECENT_DEB_CACHE_TS = 0.0
_RECENT_DEB_REFRESHING = False
_RECENT_DEB_LOCK = threading.Lock()
_RECENT_DEB_CACHE_TTL_SEC = max(
    60,
    int(os.getenv("POLYWEATHER_CITIES_DEB_RECENT_CACHE_TTL_SEC", "300") or "300"),
)
CityDetailPayloadCacheKey = Tuple[str, str, str, str, str, int]
CityChartDetailPayloadCacheKey = Tuple[str, str, str, int]
CityDetailBatchResponseCacheKey = Tuple[Tuple[str, ...], bool, str, str, str, str]
_CITY_DETAIL_PAYLOAD_CACHE: Dict[CityDetailPayloadCacheKey, Dict[str, Any]] = {}
_CITY_DETAIL_PAYLOAD_CACHE_TS: Dict[CityDetailPayloadCacheKey, float] = {}
_CITY_DETAIL_PAYLOAD_INFLIGHT: Dict[CityDetailPayloadCacheKey, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_DETAIL_PAYLOAD_EPOCH: Dict[str, int] = {}
_CITY_DETAIL_PAYLOAD_LOCK = asyncio.Lock()
_CITY_CHART_DETAIL_PAYLOAD_CACHE: Dict[CityChartDetailPayloadCacheKey, Dict[str, Any]] = {}
_CITY_CHART_DETAIL_PAYLOAD_CACHE_TS: Dict[CityChartDetailPayloadCacheKey, float] = {}
_CITY_CHART_DETAIL_PAYLOAD_LOCK = asyncio.Lock()
_CITY_DETAIL_BATCH_RESPONSE_CACHE: Dict[CityDetailBatchResponseCacheKey, Dict[str, Any]] = {}
_CITY_DETAIL_BATCH_RESPONSE_CACHE_TS: Dict[CityDetailBatchResponseCacheKey, float] = {}
_CITY_DETAIL_BATCH_RESPONSE_INFLIGHT: Dict[CityDetailBatchResponseCacheKey, "asyncio.Task[Dict[str, Any]]"] = {}
_CITY_DETAIL_BATCH_RESPONSE_LOCK = asyncio.Lock()
_CITY_DETAIL_BATCH_BUILD_SEMAPHORE: Optional[threading.BoundedSemaphore] = None
_CITY_DETAIL_BATCH_BUILD_SEMAPHORE_SIZE = 0
_CITY_DETAIL_BATCH_BUILD_SEMAPHORE_LOCK = threading.Lock()


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


def _city_chart_optional_overlay_timeout_sec() -> float:
    try:
        timeout_ms = int(
            os.getenv("POLYWEATHER_CITY_CHART_OPTIONAL_OVERLAY_TIMEOUT_MS", "3000")
            or "3000"
        )
    except ValueError:
        timeout_ms = 3000
    return max(0.001, min(3.0, timeout_ms / 1000.0))


async def _run_optional_city_chart_overlay(
    *,
    city: str,
    overlay_name: str,
    payload: Dict[str, Any],
    fn: Callable[..., Dict[str, Any]],
    args: Tuple[Any, ...],
) -> Dict[str, Any]:
    timeout_sec = _city_chart_optional_overlay_timeout_sec()
    try:
        return await asyncio.wait_for(
            run_in_threadpool(fn, *args),
            timeout=timeout_sec,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "city chart optional overlay timed out city={} overlay={} timeout_sec={}; returning cached payload",
            city,
            overlay_name,
            timeout_sec,
        )
        return payload
    except Exception as exc:
        logger.debug(
            "city chart optional overlay skipped city={} overlay={}: {}",
            city,
            overlay_name,
            exc,
        )
        return payload


async def _run_latest_observation_city_chart_overlay(
    *,
    city: str,
    overlay_name: str,
    payload: Dict[str, Any],
    fn: Callable[..., Dict[str, Any]],
    args: Tuple[Any, ...],
) -> Dict[str, Any]:
    try:
        return await run_in_threadpool(fn, *args)
    except Exception as exc:
        logger.debug(
            "city chart latest observation overlay skipped city={} overlay={}: {}",
            city,
            overlay_name,
            exc,
        )
        return payload


async def _overlay_latest_observation_sources(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    latest_payload = payload
    latest_payload = await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="amsc_latest_raw",
        payload=latest_payload,
        fn=overlay_latest_amsc_observation,
        args=(legacy_routes._CACHE_DB, city, latest_payload),
    )
    latest_payload = await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="jma_amedas_latest",
        payload=latest_payload,
        fn=overlay_latest_jma_amedas_observation,
        args=(legacy_routes._weather, city, latest_payload, legacy_routes._CACHE_DB),
    )
    latest_payload = await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="amos_latest_raw",
        payload=latest_payload,
        fn=overlay_latest_amos_observation,
        args=(legacy_routes._CACHE_DB, city, latest_payload),
    )
    latest_payload = await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="mgm_latest_raw",
        payload=latest_payload,
        fn=overlay_latest_mgm_observation,
        args=(legacy_routes._CACHE_DB, city, latest_payload),
    )
    latest_payload = await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="hko_latest_raw",
        payload=latest_payload,
        fn=overlay_latest_hko_observation,
        args=(legacy_routes._CACHE_DB, city, latest_payload),
    )
    return await _run_latest_observation_city_chart_overlay(
        city=city,
        overlay_name="cwa_taipei",
        payload=latest_payload,
        fn=overlay_latest_cwa_observation,
        args=(legacy_routes._weather, city, latest_payload, legacy_routes._CACHE_DB),
    )


async def _get_cached_city_payload(city: str, kind: str) -> Dict[str, Any]:
    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, kind, city)
    if not isinstance(cached_entry, dict):
        return {}
    payload = cached_entry.get("payload")
    return payload if isinstance(payload, dict) else {}


async def _get_canonical_city_payload(city: str, *, detail_depth: str = "panel") -> Dict[str, Any]:
    try:
        row = await run_in_threadpool(legacy_routes._CACHE_DB.get_canonical_temperature, city)
    except Exception:
        return {}
    if not isinstance(row, dict):
        return {}
    canonical = row.get("payload") or row
    if not isinstance(canonical, dict):
        return {}
    payload = build_city_weather_from_canonical(city, canonical)
    if not isinstance(payload, dict) or not payload:
        return {}
    city_meta = legacy_routes.CITY_REGISTRY.get(city, {}) or {}
    city_info = legacy_routes.CITIES.get(city, {}) or {}
    risk = legacy_routes.CITY_RISK_PROFILES.get(city, {}) or {}
    payload.update(
        {
            "detail_depth": detail_depth,
            "display_name": str(city_meta.get("display_name") or city_meta.get("name") or city.title()),
            "lat": city_info.get("lat"),
            "lon": city_info.get("lon"),
            "temp_symbol": canonical.get("temp_symbol") or payload.get("temp_symbol") or ("°F" if city_info.get("f") else "°C"),
            "risk": {
                "level": risk.get("risk_level", "low"),
                "emoji": risk.get("risk_emoji", "🟢"),
                "airport": risk.get("airport_name", ""),
                "icao": risk.get("icao", ""),
                "distance_km": risk.get("distance_km", 0),
                "warning": risk.get("warning", ""),
            },
            "probabilities": {"mu": None, "distribution": []},
        }
    )
    return await run_in_threadpool(
        overlay_latest_amsc_observation,
        legacy_routes._CACHE_DB,
        city,
        payload,
    )


def _enqueue_collector_refresh_request(
    city: str,
    kind: str,
    *,
    reason: str = "canonical_fallback",
) -> bool:
    try:
        enqueue = getattr(legacy_routes._CACHE_DB, "enqueue_observation_refresh_request", None)
        if not callable(enqueue):
            return False
        return bool(
            enqueue(
                city=city,
                kind=kind,
                priority="high",
                reason=reason,
            )
        )
    except Exception as exc:
        logger.debug("collector refresh enqueue failed city={} kind={}: {}", city, kind, exc)
        return False


def _request_city_cache_refresh(
    city: str,
    kind: str,
) -> None:
    _enqueue_collector_refresh_request(city, kind)


def _request_city_full_refresh(city: str) -> None:
    _enqueue_collector_refresh_request(city, "full")


def _build_initializing_city_payload(city: str, *, detail_depth: str) -> Dict[str, Any]:
    city_meta = legacy_routes.CITY_REGISTRY.get(city, {}) or {}
    city_info = legacy_routes.CITIES.get(city, {}) or {}
    risk = legacy_routes.CITY_RISK_PROFILES.get(city, {}) or {}
    return {
        "city": city,
        "name": city,
        "display_name": str(city_meta.get("display_name") or city_meta.get("name") or city.title()),
        "detail_depth": detail_depth,
        "status": "initializing",
        "stale": True,
        "stale_reason": "collector_refresh_queued",
        "lat": city_info.get("lat"),
        "lon": city_info.get("lon"),
        "temp_symbol": "°F" if city_info.get("f") else "°C",
        "risk": {
            "level": risk.get("risk_level", "low"),
            "emoji": risk.get("risk_emoji", "🟢"),
            "airport": risk.get("airport_name", ""),
            "icao": risk.get("icao", ""),
            "distance_km": risk.get("distance_km", 0),
            "warning": risk.get("warning", ""),
        },
        "current": {
            "temp": None,
            "source_code": None,
            "settlement_source": None,
            "settlement_source_label": None,
            "obs_time": None,
            "freshness": {
                "freshness_status": "missing",
                "freshness_reason": "collector_refresh_queued",
            },
            "observation_status": "initializing",
        },
        "airport_current": {},
        "airport_primary": {},
        "canonical_temperature": None,
        "deb": {"prediction": None},
        "probabilities": {"mu": None, "distribution": []},
        "hourly": {"times": [], "temps": []},
        "multi_model_daily": {},
    }


def _queue_and_build_initializing_city_payload(city: str, *, kind: str) -> Dict[str, Any]:
    _enqueue_collector_refresh_request(city, kind, reason="cold_start")
    return _build_initializing_city_payload(city, detail_depth=kind)


async def _refresh_city_payload_with_stale_timeout(
    city: str,
    kind: str,
) -> Dict[str, Any]:
    cached_before_refresh = await _get_cached_city_payload(city, kind)
    if not cached_before_refresh:
        canonical_payload = await _get_canonical_city_payload(city, detail_depth=kind)
        if canonical_payload:
            _enqueue_collector_refresh_request(city, kind, reason="force_refresh")
            logger.warning(
                "city force refresh returning canonical latest without sync refresh city={} kind={}",
                city,
                kind,
            )
            return canonical_payload
        return _queue_and_build_initializing_city_payload(city, kind=kind)

    _enqueue_collector_refresh_request(city, kind, reason="force_refresh")
    logger.warning(
        "city force refresh queued collector refresh city={} kind={}; returning cached payload",
        city,
        kind,
    )
    latest_payload = await run_in_threadpool(
        overlay_latest_amsc_observation,
        legacy_routes._CACHE_DB,
        city,
        cached_before_refresh,
    )
    return await _overlay_cached_wunderground(city, latest_payload)


async def _refresh_city_cache_with_stale_timeout(
    city: str,
    kind: str,
) -> Dict[str, Any]:
    return await _refresh_city_payload_with_stale_timeout(
        city,
        kind,
    )


def _start_city_cache_stale_refresh(
    city: str,
    kind: str,
) -> None:
    normalized = str(city or "").strip().lower()
    cache_kind = str(kind or "").strip().lower()
    if not normalized or not cache_kind:
        return
    _enqueue_collector_refresh_request(normalized, cache_kind, reason="stale_refresh")


async def _overlay_cached_wunderground(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    latest_payload = await _overlay_cached_canonical_observation(city, payload)
    latest_payload = await _overlay_latest_observation_sources(city, latest_payload)
    return await run_in_threadpool(
        legacy_routes._overlay_latest_wunderground_current,
        city,
        latest_payload,
    )


def _observation_block_epoch(block: Any) -> Optional[int]:
    if not isinstance(block, dict):
        return None
    freshness = block.get("freshness") if isinstance(block.get("freshness"), dict) else {}
    values = (
        block.get("observed_at"),
        block.get("observation_time"),
        block.get("obs_time"),
        freshness.get("observed_at"),
    )
    epochs = [epoch for epoch in (parse_observation_epoch(value) for value in values) if epoch is not None]
    return max(epochs) if epochs else None


def _payload_observation_epoch(payload: Dict[str, Any]) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    blocks = (
        payload.get("current"),
        payload.get("airport_primary"),
        payload.get("airport_current"),
    )
    epochs = [epoch for epoch in (_observation_block_epoch(block) for block in blocks) if epoch is not None]
    return max(epochs) if epochs else None


_SOURCE_BOUND_OBSERVATION_FIELDS = {
    "altim",
    "cloud_desc",
    "clouds",
    "clouds_raw",
    "current_local_date",
    "humidity",
    "last_observation_local_date",
    "max_temp_time",
    "obs_time_epoch",
    "pressure_hpa",
    "raw_max_so_far",
    "raw_metar",
    "receipt_time",
    "report_time",
    "stale_for_today",
    "visibility_km",
    "visibility_mi",
    "wind_dir",
    "wind_speed_kt",
    "wu_settlement",
    "wx_desc",
}


def _float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _latest_observation_local_context(
    city: str,
    latest_payload: Dict[str, Any],
) -> Dict[str, str]:
    epoch = _payload_observation_epoch(latest_payload)
    if epoch is None:
        return {}
    try:
        offset_sec = int((legacy_routes.CITIES.get(city) or {}).get("tz") or 0)
    except Exception:
        offset_sec = 0
    local_dt = datetime.fromtimestamp(epoch, timezone.utc) + timedelta(seconds=offset_sec)
    return {
        "local_date": local_dt.strftime("%Y-%m-%d"),
        "local_time": local_dt.strftime("%H:%M"),
    }


def _latest_airport_primary_point(
    latest_payload: Dict[str, Any],
    *,
    local_time: str,
) -> List[Dict[str, Any]]:
    if not local_time:
        return []
    airport = latest_payload.get("airport_primary") if isinstance(latest_payload.get("airport_primary"), dict) else {}
    current = latest_payload.get("current") if isinstance(latest_payload.get("current"), dict) else {}
    temp = _float_or_none(airport.get("temp") if airport else None)
    if temp is None:
        temp = _float_or_none(current.get("temp") if current else None)
    if temp is None:
        return []
    return [{"time": local_time, "temp": round(float(temp), 1)}]


def _observation_source_code(block: Any) -> str:
    if not isinstance(block, dict):
        return ""
    for key in ("source_code", "settlement_source", "source"):
        value = str(block.get(key) or "").strip().lower()
        if value:
            return value
    return ""


def _merge_latest_observation_block(base_block: Any, latest_block: Dict[str, Any]) -> Dict[str, Any]:
    base = dict(base_block) if isinstance(base_block, dict) else {}
    latest_source = _observation_source_code(latest_block)
    if latest_source:
        base = {
            key: value
            for key, value in base.items()
            if key not in _SOURCE_BOUND_OBSERVATION_FIELDS or key in latest_block
        }
    return {**base, **latest_block}


def _replace_airport_primary_today_obs(
    payload: Dict[str, Any],
    points: List[Dict[str, Any]],
) -> None:
    payload["airport_primary_today_obs"] = points
    official = payload.get("official")
    if isinstance(official, dict):
        official["airport_primary_today_obs"] = points


def _clear_previous_day_observation_series(payload: Dict[str, Any], *, local_date: str) -> None:
    for key in ("metar_today_obs", "metar_recent_obs", "settlement_today_obs"):
        if key in payload:
            payload[key] = []
    timeseries = payload.get("timeseries")
    if isinstance(timeseries, dict):
        for key in ("metar_today_obs", "metar_recent_obs", "settlement_today_obs"):
            if key in timeseries:
                timeseries[key] = []
    metar_status = payload.get("metar_status")
    if isinstance(metar_status, dict):
        metar_status["available_for_today"] = False
        metar_status["stale_for_today"] = True
        metar_status["current_local_date"] = local_date


def _sync_latest_mgm_summary(
    payload: Dict[str, Any],
    latest_payload: Dict[str, Any],
    *,
    local_time: str,
) -> None:
    latest_current = latest_payload.get("current") if isinstance(latest_payload.get("current"), dict) else {}
    latest_airport = (
        latest_payload.get("airport_primary")
        if isinstance(latest_payload.get("airport_primary"), dict)
        else {}
    )
    latest_source = _observation_source_code(latest_current) or _observation_source_code(latest_airport)
    if latest_source != "mgm":
        return
    temp = _float_or_none(latest_airport.get("temp") if latest_airport else None)
    if temp is None:
        temp = _float_or_none(latest_current.get("temp") if latest_current else None)
    if temp is None:
        return
    payload["mgm"] = {
        "temp": round(float(temp), 1),
        "time": local_time,
        "feels_like": round(float(temp), 1),
        "humidity": None,
        "wind_dir": None,
        "wind_speed_ms": None,
        "pressure": None,
        "cloud_cover": None,
        "rain_24h": None,
        "today_high": None,
        "today_low": None,
        "station_code": latest_airport.get("station_code") or latest_current.get("station_code"),
        "station_name": latest_airport.get("station_name") or latest_current.get("station_name"),
        "hourly": [],
    }


def _merge_latest_observation_payload(
    city: str,
    payload: Dict[str, Any],
    latest_payload: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(latest_payload, dict):
        return payload
    latest_epoch = _payload_observation_epoch(latest_payload)
    if latest_epoch is None:
        return payload
    current_epoch = _payload_observation_epoch(payload)
    if current_epoch is not None and current_epoch >= latest_epoch:
        return payload

    next_payload = deepcopy(payload)
    for key in ("current", "airport_primary", "airport_current"):
        latest_block = latest_payload.get(key)
        if not isinstance(latest_block, dict) or not latest_block:
            continue
        next_payload[key] = _merge_latest_observation_block(next_payload.get(key), latest_block)
    if isinstance(latest_payload.get("canonical_temperature"), dict):
        next_payload["canonical_temperature"] = latest_payload["canonical_temperature"]
    if latest_payload.get("updated_at"):
        next_payload["updated_at"] = latest_payload.get("updated_at")
    if latest_payload.get("temp_symbol"):
        next_payload["temp_symbol"] = latest_payload.get("temp_symbol")

    local_context = _latest_observation_local_context(city, latest_payload)
    if local_context:
        previous_local_date = str(next_payload.get("local_date") or "")
        next_payload.update(local_context)
        if previous_local_date and previous_local_date != local_context["local_date"]:
            _replace_airport_primary_today_obs(
                next_payload,
                _latest_airport_primary_point(
                    latest_payload,
                    local_time=local_context["local_time"],
                ),
            )
            _clear_previous_day_observation_series(next_payload, local_date=local_context["local_date"])
        _sync_latest_mgm_summary(
            next_payload,
            latest_payload,
            local_time=local_context["local_time"],
        )
    return next_payload


async def _overlay_cached_canonical_observation(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        return payload
    canonical_payload = await _get_canonical_city_payload(city, detail_depth=str(payload.get("detail_depth") or "full"))
    if not canonical_payload:
        return payload
    return _merge_latest_observation_payload(city, payload, canonical_payload)


def _overlay_cached_runway_history_from_db(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        return payload
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city:
        return payload

    risk = payload.get("risk") if isinstance(payload.get("risk"), dict) else {}
    city_risk = legacy_routes.CITY_RISK_PROFILES.get(normalized_city, {}) or {}
    city_meta = legacy_routes.CITY_REGISTRY.get(normalized_city, {}) or {}
    icao = str(
        risk.get("icao")
        or city_risk.get("icao")
        or city_meta.get("icao")
        or ""
    ).strip().upper()
    if not icao:
        return payload

    try:
        rows = legacy_routes._CACHE_DB.get_runway_obs_recent(icao, minutes=24 * 60)
    except Exception as exc:
        logger.debug("chart runway DB overlay skipped city={} icao={}: {}", normalized_city, icao, exc)
        return payload
    if not rows:
        return payload

    use_fahrenheit = (
        "F" in str(payload.get("temp_symbol") or "").upper()
        or bool((legacy_routes.CITIES.get(normalized_city, {}) or {}).get("f"))
    )
    runway_history: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        runway = str(row.get("runway") or "").strip().upper()
        time_val = row.get("otime_utc") or row.get("created_at")
        if not runway or not time_val:
            continue
        temp_val = _runway_history_temp_for_city(normalized_city, row)
        if temp_val is None:
            continue
        if use_fahrenheit:
            temp_val = temp_val * 9.0 / 5.0 + 32.0
        runway_history.setdefault(runway, []).append(
            {
                "time": str(time_val),
                "temp": round(float(temp_val), 1),
            }
        )

    if not runway_history:
        return payload

    next_payload = deepcopy(payload)
    next_payload["runway_plate_history"] = runway_history
    return next_payload


def _start_city_full_stale_refresh(city: str) -> None:
    normalized = str(city or "").strip().lower()
    if not normalized:
        return
    _enqueue_collector_refresh_request(normalized, "full", reason="stale_refresh")


async def _get_city_full_data(city: str, *, force_refresh: bool) -> Dict[str, Any]:
    if force_refresh:
        return await _refresh_city_payload_with_stale_timeout(
            city,
            "full",
        )
    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "full", city)
    if cached_entry:
        payload = cached_entry.get("payload") or {}
        if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_FULL_CACHE_TTL_SEC):
            if payload:
                _start_city_full_stale_refresh(city)
                return await _overlay_cached_wunderground(city, payload)
            canonical_payload = await _get_canonical_city_payload(city, detail_depth="full")
            if canonical_payload:
                _request_city_full_refresh(city)
                return canonical_payload
            return _queue_and_build_initializing_city_payload(city, kind="full")
        return await _overlay_cached_wunderground(city, payload)
    canonical_payload = await _get_canonical_city_payload(city, detail_depth="full")
    if canonical_payload:
        _request_city_full_refresh(city)
        return canonical_payload
    return _queue_and_build_initializing_city_payload(city, kind="full")


async def _get_city_chart_data(city: str, *, force_refresh: bool) -> Dict[str, Any]:
    if force_refresh:
        payload = await _get_city_full_data(city, force_refresh=True)
        payload = await _overlay_cached_canonical_observation(city, payload)
        payload = await _run_optional_city_chart_overlay(
            city=city,
            overlay_name="runway_history",
            payload=payload,
            fn=_overlay_cached_runway_history_from_db,
            args=(city, payload),
        )
        payload = await _run_optional_city_chart_overlay(
            city=city,
            overlay_name="multi_model_hourly",
            payload=payload,
            fn=_overlay_cached_multi_model_hourly,
            args=(city, payload),
        )
        payload = await _overlay_latest_observation_sources(city, payload)
        payload = await _run_optional_city_chart_overlay(
            city=city,
            overlay_name="wunderground_current",
            payload=payload,
            fn=legacy_routes._overlay_latest_wunderground_current,
            args=(city, payload),
        )
        return _floor_chart_forecast_with_observed_high(payload)

    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "full", city)
    if cached_entry:
        payload = cached_entry.get("payload") or {}
        if payload:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_FULL_CACHE_TTL_SEC):
                _start_city_full_stale_refresh(city)
            payload = await _overlay_cached_canonical_observation(city, payload)
            payload = await _run_optional_city_chart_overlay(
                city=city,
                overlay_name="runway_history",
                payload=payload,
                fn=_overlay_cached_runway_history_from_db,
                args=(city, payload),
            )
            payload = await _run_optional_city_chart_overlay(
                city=city,
                overlay_name="multi_model_hourly",
                payload=payload,
                fn=_overlay_cached_multi_model_hourly,
                args=(city, payload),
            )
            payload = await _overlay_latest_observation_sources(city, payload)
            payload = await _run_optional_city_chart_overlay(
                city=city,
                overlay_name="wunderground_current",
                payload=payload,
                fn=legacy_routes._overlay_latest_wunderground_current,
                args=(city, payload),
            )
            return _floor_chart_forecast_with_observed_high(payload)

    return {
        "name": city,
        "display_name": str((legacy_routes.CITY_REGISTRY.get(city, {}) or {}).get("display_name") or city.title()),
    }


def _overlay_cached_multi_model_hourly(city: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current_multi_model = payload.get("multi_model") if isinstance(payload.get("multi_model"), dict) else {}
    local_date = _payload_local_date(payload)
    if _multi_model_hourly_covers_local_date(current_multi_model, local_date):
        return payload

    city_info = legacy_routes.CITIES.get(city) if isinstance(getattr(legacy_routes, "CITIES", None), dict) else None
    if not isinstance(city_info, dict):
        return payload
    lat = city_info.get("lat")
    lon = city_info.get("lon")
    if lat is None or lon is None:
        return payload

    cached_bundle = fetch_open_meteo_forecast_bundle(
        legacy_routes._weather,
        city=city,
        lat=lat,
        lon=lon,
        use_fahrenheit=bool(city_info.get("f")),
        include_multi_model=True,
        cache_only=True,
    )
    cached_multi_model = cached_bundle.get("multi_model") if isinstance(cached_bundle, dict) else None
    if isinstance(cached_multi_model, dict) and _multi_model_hourly_covers_local_date(cached_multi_model, local_date):
        return {
            **payload,
            "multi_model": {
                **current_multi_model,
                **cached_multi_model,
            },
        }

    fresh_multi_model = _refresh_multi_model_hourly_if_stale(
        city=city,
        lat=float(lat),
        lon=float(lon),
        use_fahrenheit=bool(city_info.get("f")),
        local_date=local_date,
        cached_multi_model=cached_multi_model,
    )
    if not _multi_model_hourly_covers_local_date(fresh_multi_model, local_date):
        return payload

    return {
        **payload,
        "multi_model": {
            **current_multi_model,
            **fresh_multi_model,
        },
    }


def _floor_chart_forecast_with_observed_high(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        return payload

    local_date = _payload_local_date(payload)
    observed_floor = _observed_temperature_floor(payload)
    daily_models = _multi_model_daily_models_for_date(payload.get("multi_model"), local_date)

    next_payload = payload
    if daily_models and local_date:
        existing_daily = (
            payload.get("multi_model_daily")
            if isinstance(payload.get("multi_model_daily"), dict)
            else {}
        )
        current_entry = existing_daily.get(local_date) if isinstance(existing_daily, dict) else {}
        current_models = current_entry.get("models") if isinstance(current_entry, dict) else {}
        merged_models = {
            **(current_models if isinstance(current_models, dict) else {}),
            **daily_models,
        }
        if current_models != merged_models:
            next_payload = deepcopy(next_payload)
            next_daily = dict(next_payload.get("multi_model_daily") or {})
            next_entry = dict(next_daily.get(local_date) or {})
            next_entry["models"] = merged_models
            next_daily[local_date] = next_entry
            next_payload["multi_model_daily"] = next_daily

    if observed_floor is None:
        return next_payload

    rounded_floor = round(float(observed_floor), 1)
    next_payload = _floor_forecast_today_high(next_payload, local_date, rounded_floor)
    next_payload = _floor_deb_prediction(next_payload, rounded_floor)
    next_payload = _floor_deb_hourly_path(next_payload, rounded_floor)
    next_payload = _floor_multi_model_daily_deb(next_payload, local_date, rounded_floor)
    next_payload = _floor_probability_mu(next_payload, rounded_floor)
    return next_payload


def _observed_temperature_floor(payload: Dict[str, Any]) -> Optional[float]:
    values: List[float] = []

    def add(value: Any) -> None:
        parsed = _float_or_none(value)
        if parsed is not None:
            values.append(parsed)

    for key in ("current", "airport_current", "airport_primary", "canonical_temperature"):
        block = payload.get(key) if isinstance(payload.get(key), dict) else {}
        for value_key in ("max_so_far", "max_temp_so_far", "today_high", "temp", "temp_c"):
            add(block.get(value_key))

    amos = payload.get("amos") if isinstance(payload.get("amos"), dict) else {}
    for value_key in ("max_so_far", "max_temp_so_far", "today_high", "temp", "temp_c"):
        add(amos.get(value_key))
    amos_current = amos.get("current") if isinstance(amos.get("current"), dict) else {}
    for value_key in ("max_so_far", "max_temp_so_far", "today_high", "temp", "temp_c"):
        add(amos_current.get(value_key))

    for series_key in ("airport_primary_today_obs", "metar_today_obs", "settlement_today_obs"):
        _collect_observed_series_temps(payload.get(series_key), values)

    timeseries = payload.get("timeseries") if isinstance(payload.get("timeseries"), dict) else {}
    for series_key in ("airport_primary_today_obs", "metar_today_obs", "settlement_today_obs"):
        _collect_observed_series_temps(timeseries.get(series_key), values)

    return max(values) if values else None


def _collect_observed_series_temps(series: Any, values: List[float]) -> None:
    if not isinstance(series, list):
        return
    for point in series:
        if not isinstance(point, dict):
            continue
        parsed = _first_float(point, ("temp", "temperature", "value"))
        if parsed is not None:
            values.append(parsed)


def _first_float(block: Dict[str, Any], keys: Tuple[str, ...]) -> Optional[float]:
    for key in keys:
        parsed = _float_or_none(block.get(key))
        if parsed is not None:
            return parsed
    return None


def _multi_model_daily_models_for_date(multi_model: Any, local_date: str) -> Dict[str, float]:
    return {
        model: round(value, 1)
        for model, value in multi_model_forecasts_for_local_date(
            multi_model,
            local_date,
        ).items()
    }


def _multi_model_daily_models_from_hourly(multi_model: Dict[str, Any], local_date: str) -> Dict[str, float]:
    times = multi_model.get("hourly_times") if isinstance(multi_model.get("hourly_times"), list) else []
    forecasts = (
        multi_model.get("hourly_forecasts")
        if isinstance(multi_model.get("hourly_forecasts"), dict)
        else {}
    )
    if not times or not forecasts:
        return {}

    day_indexes = [
        idx
        for idx, raw_time in enumerate(times)
        if str(raw_time or "").startswith(local_date)
    ]
    if not day_indexes:
        return {}

    models: Dict[str, float] = {}
    for model, raw_values in forecasts.items():
        if not isinstance(raw_values, list):
            continue
        model_values = [
            parsed
            for idx in day_indexes
            if idx < len(raw_values)
            for parsed in [_float_or_none(raw_values[idx])]
            if parsed is not None
        ]
        if model_values:
            models[str(model)] = round(max(model_values), 1)
    return models


def _floor_forecast_today_high(
    payload: Dict[str, Any],
    local_date: str,
    observed_floor: float,
) -> Dict[str, Any]:
    forecast = payload.get("forecast") if isinstance(payload.get("forecast"), dict) else {}
    today_high = _float_or_none(forecast.get("today_high"))
    daily = forecast.get("daily") if isinstance(forecast.get("daily"), list) else []
    needs_today_high = today_high is None or today_high < observed_floor
    needs_daily = False
    if local_date:
        found_today = False
        for entry in daily:
            if not isinstance(entry, dict) or str(entry.get("date") or "") != local_date:
                continue
            found_today = True
            max_temp = _first_float(entry, ("max_temp", "today_high"))
            if max_temp is None or max_temp < observed_floor:
                needs_daily = True
            break
        if daily and not found_today:
            needs_daily = True

    if not needs_today_high and not needs_daily:
        return payload

    next_payload = deepcopy(payload)
    next_forecast = dict(next_payload.get("forecast") or {})
    if needs_today_high:
        next_forecast["today_high"] = observed_floor
    if needs_daily and local_date:
        next_daily = []
        found_today = False
        for entry in daily:
            if not isinstance(entry, dict):
                next_daily.append(entry)
                continue
            next_entry = dict(entry)
            if str(next_entry.get("date") or "") == local_date:
                found_today = True
                max_temp = _first_float(next_entry, ("max_temp", "today_high"))
                if max_temp is None or max_temp < observed_floor:
                    next_entry["max_temp"] = observed_floor
            next_daily.append(next_entry)
        if not found_today:
            next_daily.insert(0, {"date": local_date, "max_temp": observed_floor})
        next_forecast["daily"] = next_daily
    next_payload["forecast"] = next_forecast
    return next_payload


def _floor_deb_prediction(payload: Dict[str, Any], observed_floor: float) -> Dict[str, Any]:
    deb = payload.get("deb") if isinstance(payload.get("deb"), dict) else {}
    prediction = _float_or_none(deb.get("prediction"))
    raw_prediction = _float_or_none(deb.get("raw_prediction"))
    needs_prediction = prediction is None or prediction < observed_floor
    needs_raw = raw_prediction is not None and raw_prediction < observed_floor
    overview = payload.get("overview") if isinstance(payload.get("overview"), dict) else {}
    overview_deb = _float_or_none(overview.get("deb_prediction"))
    needs_overview = overview_deb is not None and overview_deb < observed_floor
    if not needs_prediction and not needs_raw and not needs_overview:
        return payload

    next_payload = deepcopy(payload)
    next_deb = dict(next_payload.get("deb") or {})
    if needs_prediction:
        next_deb["prediction"] = observed_floor
        next_deb["observed_floor_applied"] = True
    if needs_raw:
        next_deb["raw_prediction"] = observed_floor
    next_payload["deb"] = next_deb
    if needs_overview:
        next_overview = dict(next_payload.get("overview") or {})
        next_overview["deb_prediction"] = observed_floor
        next_payload["overview"] = next_overview
    return next_payload


def _floor_deb_hourly_path(payload: Dict[str, Any], observed_floor: float) -> Dict[str, Any]:
    deb = payload.get("deb") if isinstance(payload.get("deb"), dict) else {}
    path = deb.get("hourly_path") if isinstance(deb.get("hourly_path"), dict) else {}
    temps = path.get("temps") if isinstance(path.get("temps"), list) else []
    parsed_temps = [_float_or_none(value) for value in temps]
    valid_temps = [value for value in parsed_temps if value is not None]
    if not valid_temps:
        return payload
    path_max = max(valid_temps)
    if path_max >= observed_floor:
        return payload

    offset = observed_floor - path_max
    next_payload = deepcopy(payload)
    next_deb = dict(next_payload.get("deb") or {})
    next_path = dict(next_deb.get("hourly_path") or {})
    next_path["temps"] = [
        round(value + offset, 1) if value is not None else raw_value
        for raw_value, value in zip(temps, parsed_temps)
    ]
    next_path["observed_floor_applied"] = True
    next_path["observed_floor_offset"] = round(offset, 1)
    next_deb["hourly_path"] = next_path
    next_deb["observed_floor_applied"] = True
    next_payload["deb"] = next_deb
    return next_payload


def _floor_multi_model_daily_deb(
    payload: Dict[str, Any],
    local_date: str,
    observed_floor: float,
) -> Dict[str, Any]:
    if not local_date:
        return payload
    daily = payload.get("multi_model_daily") if isinstance(payload.get("multi_model_daily"), dict) else {}
    if not daily or local_date not in daily:
        return payload
    entry = daily.get(local_date) if isinstance(daily.get(local_date), dict) else {}
    deb = entry.get("deb") if isinstance(entry.get("deb"), dict) else {}
    prediction = _float_or_none(deb.get("prediction"))
    raw_prediction = _float_or_none(deb.get("raw_prediction"))
    if (
        prediction is not None
        and prediction >= observed_floor
        and (raw_prediction is None or raw_prediction >= observed_floor)
    ):
        return payload

    next_payload = deepcopy(payload)
    next_daily = dict(next_payload.get("multi_model_daily") or {})
    next_entry = dict(next_daily.get(local_date) or {})
    next_deb = dict(next_entry.get("deb") or {})
    if prediction is None or prediction < observed_floor:
        next_deb["prediction"] = observed_floor
        next_deb["observed_floor_applied"] = True
    if raw_prediction is not None and raw_prediction < observed_floor:
        next_deb["raw_prediction"] = observed_floor
    next_entry["deb"] = next_deb
    next_daily[local_date] = next_entry
    next_payload["multi_model_daily"] = next_daily
    return next_payload


def _floor_probability_mu(payload: Dict[str, Any], observed_floor: float) -> Dict[str, Any]:
    probabilities = (
        payload.get("probabilities")
        if isinstance(payload.get("probabilities"), dict)
        else {}
    )
    mu = _float_or_none(probabilities.get("mu"))
    if mu is None or mu >= observed_floor:
        return payload
    next_payload = deepcopy(payload)
    next_probabilities = dict(next_payload.get("probabilities") or {})
    next_probabilities["mu"] = observed_floor
    next_payload["probabilities"] = next_probabilities
    return next_payload


def _payload_local_date(payload: Dict[str, Any]) -> str:
    overview = payload.get("overview") if isinstance(payload.get("overview"), dict) else {}
    return str(payload.get("local_date") or overview.get("local_date") or "").strip()


def _multi_model_has_hourly_payload(multi_model: Any) -> bool:
    if not isinstance(multi_model, dict):
        return False
    times = multi_model.get("hourly_times")
    forecasts = multi_model.get("hourly_forecasts")
    return bool(times) and isinstance(forecasts, dict) and bool(forecasts)


def _multi_model_hourly_covers_local_date(multi_model: Any, local_date: str) -> bool:
    if not _multi_model_has_hourly_payload(multi_model):
        return False
    wanted_date = str(local_date or "").strip()
    if not wanted_date:
        return True

    times = multi_model.get("hourly_times") or []
    forecasts = multi_model.get("hourly_forecasts") or {}
    for idx, raw_time in enumerate(times):
        if not str(raw_time or "").startswith(wanted_date):
            continue
        for values in forecasts.values():
            if isinstance(values, list) and idx < len(values) and values[idx] is not None:
                return True
    return False


def _evict_stale_multi_model_cache_entry(
    *,
    city: str,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
    local_date: str,
    cached_multi_model: Any,
) -> None:
    if _multi_model_hourly_covers_local_date(cached_multi_model, local_date):
        return
    try:
        key = _multi_model_cache_key(
            legacy_routes._weather,
            city,
            lat,
            lon,
            use_fahrenheit=use_fahrenheit,
        )
        with legacy_routes._weather._multi_model_cache_lock:
            entry = legacy_routes._weather._multi_model_cache.get(key)
            data = entry.get("data") if isinstance(entry, dict) else None
            if isinstance(data, dict) and not _multi_model_hourly_covers_local_date(data, local_date):
                legacy_routes._weather._multi_model_cache.pop(key, None)
    except Exception as exc:
        logger.debug("stale multi-model cache eviction skipped city={}: {}", city, exc)


def _refresh_multi_model_hourly_if_stale(
    *,
    city: str,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
    local_date: str,
    cached_multi_model: Any,
) -> Dict[str, Any]:
    _evict_stale_multi_model_cache_entry(
        city=city,
        lat=lat,
        lon=lon,
        use_fahrenheit=use_fahrenheit,
        local_date=local_date,
        cached_multi_model=cached_multi_model,
    )
    try:
        fresh = legacy_routes._weather.fetch_multi_model(
            lat,
            lon,
            city=city,
            use_fahrenheit=use_fahrenheit,
        )
    except Exception as exc:
        logger.debug("multi-model chart refresh skipped city={}: {}", city, exc)
        return {}
    return fresh if isinstance(fresh, dict) else {}


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


def _city_chart_detail_payload_cache_key(
    data: Dict[str, Any],
    resolution: Optional[str],
) -> CityChartDetailPayloadCacheKey:
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


async def _build_city_chart_detail_payload(
    data: Dict[str, Any],
    resolution: Optional[str],
) -> Dict[str, Any]:
    ttl = _city_detail_payload_cache_ttl()
    if ttl <= 0:
        return await run_in_threadpool(
            legacy_routes._build_city_chart_detail_payload,
            data,
            resolution,
        )

    key = _city_chart_detail_payload_cache_key(data, resolution)
    now_ts = time.time()
    async with _CITY_CHART_DETAIL_PAYLOAD_LOCK:
        cached = _CITY_CHART_DETAIL_PAYLOAD_CACHE.get(key)
        cached_ts = _CITY_CHART_DETAIL_PAYLOAD_CACHE_TS.get(key, 0.0)
        if cached is not None and now_ts - cached_ts < ttl:
            return cached

    payload = await run_in_threadpool(
        legacy_routes._build_city_chart_detail_payload,
        data,
        resolution,
    )

    async with _CITY_CHART_DETAIL_PAYLOAD_LOCK:
        _CITY_CHART_DETAIL_PAYLOAD_CACHE[key] = payload
        _CITY_CHART_DETAIL_PAYLOAD_CACHE_TS[key] = time.time()
        if len(_CITY_CHART_DETAIL_PAYLOAD_CACHE) > 256:
            oldest_keys = sorted(
                _CITY_CHART_DETAIL_PAYLOAD_CACHE_TS,
                key=lambda item: _CITY_CHART_DETAIL_PAYLOAD_CACHE_TS.get(item, 0.0),
            )[:64]
            for old_key in oldest_keys:
                _CITY_CHART_DETAIL_PAYLOAD_CACHE.pop(old_key, None)
                _CITY_CHART_DETAIL_PAYLOAD_CACHE_TS.pop(old_key, None)
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
            return await _refresh_city_cache_with_stale_timeout(
                city,
                "panel",
            )
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "panel", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_PANEL_CACHE_TTL_SEC):
                payload = cached_entry.get("payload") or {}
                if payload:
                    _start_city_cache_stale_refresh(city, "panel")
                    return await _overlay_cached_wunderground(city, payload)
                return _queue_and_build_initializing_city_payload(city, kind="panel")
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        canonical_payload = await _get_canonical_city_payload(city, detail_depth="panel")
        if canonical_payload:
            _request_city_cache_refresh(city, "panel")
            return canonical_payload
        return _queue_and_build_initializing_city_payload(city, kind="panel")
    if detail_mode == "nearby":
        if force_refresh:
            return await _refresh_city_cache_with_stale_timeout(
                city,
                "nearby",
            )
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "nearby", city)
        if cached_entry:
            if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_NEARBY_CACHE_TTL_SEC):
                payload = cached_entry.get("payload") or {}
                if payload:
                    _start_city_cache_stale_refresh(city, "nearby")
                    return await _overlay_cached_wunderground(city, payload)
                canonical_payload = await _get_canonical_city_payload(city, detail_depth="nearby")
                if canonical_payload:
                    _request_city_cache_refresh(city, "nearby")
                    return canonical_payload
                return _queue_and_build_initializing_city_payload(city, kind="nearby")
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        canonical_payload = await _get_canonical_city_payload(city, detail_depth="nearby")
        if canonical_payload:
            _request_city_cache_refresh(city, "nearby")
            return canonical_payload
        return _queue_and_build_initializing_city_payload(city, kind="nearby")
    if detail_mode == "market":
        if force_refresh:
            return await _refresh_city_cache_with_stale_timeout(
                city,
                "market",
            )
        cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "market", city)
        if cached_entry:
            if not legacy_routes._market_analysis_cache_is_fresh(cached_entry):
                payload = cached_entry.get("payload") or {}
                if payload:
                    _start_city_cache_stale_refresh(city, "market")
                    return await _overlay_cached_wunderground(city, payload)
                canonical_payload = await _get_canonical_city_payload(city, detail_depth="market")
                if canonical_payload:
                    _request_city_cache_refresh(city, "market")
                    return canonical_payload
                return _queue_and_build_initializing_city_payload(city, kind="market")
            return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
        canonical_payload = await _get_canonical_city_payload(city, detail_depth="market")
        if canonical_payload:
            _request_city_cache_refresh(city, "market")
            return canonical_payload
        return _queue_and_build_initializing_city_payload(city, kind="market")
    return _queue_and_build_initializing_city_payload(city, kind=detail_mode)


async def get_city_summary_payload(
    _request: Request,
    name: str,
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    city = legacy_routes._normalize_city_or_404(name)
    if force_refresh:
        return await _refresh_city_cache_with_stale_timeout(
            city,
            "summary",
        )
    cached_entry = await run_in_threadpool(legacy_routes._CACHE_DB.get_city_cache, "summary", city)
    if cached_entry:
        if not legacy_routes._city_cache_is_fresh(cached_entry, legacy_routes.CITY_SUMMARY_CACHE_TTL_SEC):
            payload = cached_entry.get("payload") or {}
            if payload:
                _start_city_cache_stale_refresh(city, "summary")
                return await _overlay_cached_wunderground(city, payload)
            return _queue_and_build_initializing_city_payload(city, kind="summary")
        return await _overlay_cached_wunderground(city, cached_entry.get("payload") or {})
    canonical_payload = await _get_canonical_city_payload(city, detail_depth="summary")
    if canonical_payload:
        _request_city_cache_refresh(city, "summary")
        return canonical_payload
    return _queue_and_build_initializing_city_payload(city, kind="summary")


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
        if isinstance(data, dict) and data.get("status") == "initializing":
            return data

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
    if detail_scope == "chart":
        if timing_recorder is not None:
            data = await timing_recorder.measure_async(
                f"chart_data_{city}",
                lambda: _get_city_chart_data(city, force_refresh=force_refresh),
            )
            detail = await timing_recorder.measure_async(
                f"chart_payload_{city}",
                lambda: _build_city_chart_detail_payload(data, resolution),
            )
        else:
            data = await _get_city_chart_data(city, force_refresh=force_refresh)
            detail = await _build_city_chart_detail_payload(data, resolution)
        return city, detail

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
        value = int(os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_CONCURRENCY", "1") or "1")
    except ValueError:
        value = 1
    return max(1, min(4, value))


def _city_detail_batch_global_concurrency() -> int:
    try:
        value = int(os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_GLOBAL_CONCURRENCY", "1") or "1")
    except ValueError:
        value = 1
    return max(1, min(4, value))


def _city_detail_batch_queue_wait_seconds() -> float:
    try:
        wait_ms = int(
            os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_QUEUE_WAIT_MS", "3000")
            or "3000"
        )
    except ValueError:
        wait_ms = 3000
    return max(0.0, min(5.0, wait_ms / 1000.0))


def _city_detail_batch_build_semaphore() -> threading.BoundedSemaphore:
    global _CITY_DETAIL_BATCH_BUILD_SEMAPHORE, _CITY_DETAIL_BATCH_BUILD_SEMAPHORE_SIZE
    size = _city_detail_batch_global_concurrency()
    with _CITY_DETAIL_BATCH_BUILD_SEMAPHORE_LOCK:
        if _CITY_DETAIL_BATCH_BUILD_SEMAPHORE is None or _CITY_DETAIL_BATCH_BUILD_SEMAPHORE_SIZE != size:
            _CITY_DETAIL_BATCH_BUILD_SEMAPHORE = threading.BoundedSemaphore(size)
            _CITY_DETAIL_BATCH_BUILD_SEMAPHORE_SIZE = size
        return _CITY_DETAIL_BATCH_BUILD_SEMAPHORE


def _city_detail_batch_partial_timeout_seconds() -> Optional[float]:
    try:
        timeout_ms = int(
            os.getenv("POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS", "8000")
            or "8000"
        )
    except ValueError:
        timeout_ms = 8000
    if timeout_ms <= 0:
        return None
    return max(0.001, min(60.0, timeout_ms / 1000.0))


def _city_detail_batch_partial_timeout_ms() -> Optional[int]:
    timeout_sec = _city_detail_batch_partial_timeout_seconds()
    if timeout_sec is None:
        return None
    return int(round(timeout_sec * 1000.0))


def _city_detail_batch_partial_reason(
    *,
    busy: bool,
    missing: List[str],
    errors: Dict[str, str],
) -> Optional[str]:
    if busy:
        return "busy"
    if missing and errors:
        return "timeout_error"
    if missing:
        return "timeout"
    if errors:
        return "error"
    return None


def _build_city_detail_batch_diagnostics(
    *,
    city_names: List[str],
    details: Dict[str, Any],
    errors: Dict[str, str],
    missing: List[str],
    resolution: Optional[str],
    detail_scope: str,
    force_refresh: bool,
    response_source: str,
    busy: bool = False,
    city_durations_ms: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    city_durations_ms = city_durations_ms or {}
    missing_set = set(missing)
    error_set = set(errors)
    detail_set = set(details)
    partial_reason = _city_detail_batch_partial_reason(
        busy=busy,
        missing=missing,
        errors=errors,
    )
    city_status: Dict[str, Dict[str, Any]] = {}
    for city in city_names:
        if busy:
            status = "busy"
        elif city in missing_set:
            status = "timeout"
        elif city in error_set:
            status = "error"
        elif city in detail_set:
            status = "ok"
        else:
            status = "missing"
        city_status[city] = {
            "status": status,
            "duration_ms": city_durations_ms.get(city),
        }
        if city in errors:
            city_status[city]["error"] = errors[city]

    return {
        "version": 1,
        "response_source": response_source,
        "partial": bool(partial_reason),
        "partial_reason": partial_reason,
        "requested_count": len(city_names),
        "completed_count": len(details),
        "missing_count": len(missing),
        "error_count": len(errors),
        "batch_concurrency": _city_detail_batch_concurrency(),
        "global_concurrency": _city_detail_batch_global_concurrency(),
        "partial_timeout_ms": _city_detail_batch_partial_timeout_ms(),
        "force_refresh": force_refresh,
        "resolution": resolution,
        "scope": detail_scope,
        "city_status": city_status,
    }


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
            build_semaphore = _city_detail_batch_build_semaphore()
            queue_wait_seconds = _city_detail_batch_queue_wait_seconds()
            acquired = await timer.measure_async(
                "wait_builder_slot",
                lambda: run_in_threadpool(
                    build_semaphore.acquire,
                    True,
                    queue_wait_seconds,
                ),
            )
            if not acquired:
                missing = list(city_names)
                errors: Dict[str, str] = {}
                details: Dict[str, Any] = {}
                return {
                    "cities": city_names,
                    "details": details,
                    "errors": errors,
                    "missing": missing,
                    "partial": True,
                    "busy": True,
                    "stale_reason": "city detail batch builder is busy",
                    "diagnostics": _build_city_detail_batch_diagnostics(
                        city_names=city_names,
                        details=details,
                        errors=errors,
                        missing=missing,
                        resolution=resolution,
                        detail_scope=detail_scope,
                        force_refresh=force_refresh,
                        response_source="busy",
                        busy=True,
                    ),
                }

            try:
                semaphore = asyncio.Semaphore(_city_detail_batch_concurrency())
                city_durations_ms: Dict[str, float] = {}

                async def _build_with_limit(city: str) -> Tuple[str, Dict[str, Any]]:
                    async with semaphore:
                        started = time.perf_counter()
                        try:
                            return await _build_city_detail_batch_item_async(
                                city,
                                force_refresh=force_refresh,
                                market_slug=market_slug,
                                target_date=target_date,
                                resolution=resolution,
                                detail_scope=detail_scope,
                                timing_recorder=timer,
                            )
                        finally:
                            city_durations_ms[city] = round(
                                (time.perf_counter() - started) * 1000.0,
                                1,
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
                    "diagnostics": _build_city_detail_batch_diagnostics(
                        city_names=city_names,
                        details=details,
                        errors=errors,
                        missing=missing,
                        resolution=resolution,
                        detail_scope=detail_scope,
                        force_refresh=force_refresh,
                        response_source="fresh_build",
                        city_durations_ms=city_durations_ms,
                    ),
                }
            finally:
                build_semaphore.release()

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
