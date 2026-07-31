from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.analysis.deb_algorithm import calculate_deb_prediction, calculate_dynamic_weights
from src.data_collection.nws_open_meteo_sources import (
    OPEN_METEO_MULTI_MODEL_ORDER,
    _parse_open_meteo_multi_model_daily,
)
from src.data_collection.multi_model_freshness import multi_model_forecasts_for_local_date
from src.data_collection.weathernext2_sources import (
    _load_artifact_payload as _load_weathernext2_artifact,
    _weathernext2_artifact_path,
)
from src.database.db_manager import DBManager
from src.utils.refresh_policy import SCAN_ROWS_REFRESH_SEC
from web.core import CITIES, _sf as _safe_float, _weather
from web.scan_terminal_filters import (
    market_region_from_tz_offset as _market_region_from_tz_offset,
    safe_int as _safe_int,
)
from web.services.canonical_temperature import build_city_weather_from_canonical
from web.services.city_payloads import aggregate_runway_history


SCAN_ROW_RUNWAY_HISTORY_RESOLUTION = "10m"
SCAN_ROW_MAX_RUNWAY_POINTS = 144
SCAN_TERMINAL_MULTI_MODEL_BATCH_SIZE = 20
_PANEL_CACHE_DB = DBManager()
_analyze = None  # compatibility hook for tests that assert scan terminal stays cache-only.
SCAN_PANEL_CACHE_MAX_AGE_SEC = max(300, int(SCAN_ROWS_REFRESH_SEC) * 3)


def _compact_runway_plate_history_for_scan(raw_history: Any) -> Dict[str, List[Dict[str, Any]]]:
    if not isinstance(raw_history, dict) or not raw_history:
        return {}
    compacted = aggregate_runway_history(raw_history, SCAN_ROW_RUNWAY_HISTORY_RESOLUTION)
    return {
        str(runway): points[-SCAN_ROW_MAX_RUNWAY_POINTS:]
        for runway, points in compacted.items()
        if isinstance(points, list) and points
    }


def _enqueue_scan_terminal_refresh(city: str, *, reason: str) -> None:
    enqueue = getattr(_PANEL_CACHE_DB, "enqueue_observation_refresh_request", None)
    if not callable(enqueue):
        return
    try:
        enqueue(
            city=city,
            kind="panel",
            priority="high",
            reason=reason,
        )
    except Exception:
        return


def _city_local_now(city: str, utc_offset_seconds: Optional[int] = None) -> datetime:
    city_meta = CITIES.get(city) or {}
    offset = utc_offset_seconds
    if offset is None:
        offset = _safe_int(city_meta.get("tz"), 0)
    try:
        offset = int(offset or 0)
    except Exception:
        offset = 0
    return datetime.now(timezone.utc) + timedelta(seconds=offset)


def _city_local_date(city: str, utc_offset_seconds: Optional[int] = None) -> str:
    return _city_local_now(city, utc_offset_seconds).strftime("%Y-%m-%d")


def _city_local_time(city: str, utc_offset_seconds: Optional[int] = None) -> str:
    return _city_local_now(city, utc_offset_seconds).strftime("%H:%M")


def _model_sources_with_weathernext2(
    base_models: Any,
    data: Dict[str, Any],
) -> Dict[str, Any]:
    models = (
        {
            str(k): v
            for k, v in (base_models or {}).items()
            if v is not None
        }
        if isinstance(base_models, dict)
        else {}
    )
    weathernext2 = data.get("weathernext2")
    if isinstance(weathernext2, dict):
        summary = (
            weathernext2.get("summary")
            if isinstance(weathernext2.get("summary"), dict)
            else {}
        )
        representative = _safe_float(summary.get("median"))
        if representative is None:
            representative = _safe_float(summary.get("mean"))
        if representative is not None:
            models["WeatherNext 2"] = round(float(representative), 1)
    return models


def _panel_cache_stale_reason(city: str, cached_entry: Dict[str, Any], payload: Dict[str, Any]) -> Optional[str]:
    updated_at_ts = _safe_float(cached_entry.get("updated_at_ts"))
    if updated_at_ts is None or time.time() - updated_at_ts > SCAN_PANEL_CACHE_MAX_AGE_SEC:
        return "scan_terminal_stale_panel"

    tz_offset = payload.get("utc_offset_seconds")
    if tz_offset is None:
        tz_offset = (CITIES.get(city) or {}).get("tz")
    expected_date = _city_local_date(city, _safe_int(tz_offset, 0))
    payload_date = str(payload.get("local_date") or "").strip()
    if payload_date and payload_date != expected_date:
        return "scan_terminal_stale_panel_date"
    return None


def _cached_panel_multi_model_for_local_date(
    payload: Dict[str, Any],
    local_date: str,
    *,
    use_fahrenheit: bool,
) -> Optional[Dict[str, Any]]:
    daily = payload.get("multi_model_daily")
    if isinstance(daily, dict):
        daily_entry = daily.get(local_date)
        if isinstance(daily_entry, dict):
            raw_models = daily_entry.get("models")
            if isinstance(raw_models, dict):
                forecasts = {
                    str(model): value
                    for model, value in raw_models.items()
                    if _safe_float(value) is not None
                }
                if forecasts:
                    return {
                        "source": "cached_panel_multi_model_daily",
                        "provider": "panel-cache",
                        "forecasts": forecasts,
                        "daily_forecasts": {local_date: forecasts},
                        "hourly_times": [],
                        "hourly_forecasts": {},
                        "model_metadata": {},
                        "model_keys": list(forecasts.keys()),
                        "dates": [local_date],
                        "unit": "fahrenheit" if use_fahrenheit else "celsius",
                        "scan_terminal_panel_cache": True,
                    }

    multi_model = payload.get("multi_model")
    if isinstance(multi_model, dict) and multi_model_forecasts_for_local_date(
        multi_model,
        local_date,
    ):
        return dict(multi_model)
    return None


def _multi_model_cache_key(
    city: str,
    lat: float,
    lon: float,
    *,
    use_fahrenheit: bool,
) -> str:
    version = str(getattr(_weather, "multi_model_cache_version", "v5") or "v5")
    return (
        f"{round(float(lat), 4)}:{round(float(lon), 4)}:{str(city or '').strip().lower()}:"
        f"{'f' if use_fahrenheit else 'c'}:{version}"
    )


def _read_cached_multi_model_for_today(
    city: str,
    *,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
    local_date: str,
) -> Optional[Dict[str, Any]]:
    maybe_reload = getattr(_weather, "_maybe_reload_open_meteo_disk_cache", None)
    if callable(maybe_reload):
        try:
            maybe_reload()
        except Exception:
            pass
    cache = getattr(_weather, "_multi_model_cache", None)
    lock = getattr(_weather, "_multi_model_cache_lock", None)
    if not isinstance(cache, dict) or lock is None:
        return None
    key = _multi_model_cache_key(city, lat, lon, use_fahrenheit=use_fahrenheit)
    try:
        with lock:
            entry = cache.get(key)
            data = entry.get("data") if isinstance(entry, dict) else None
    except Exception:
        return None
    if isinstance(data, dict) and multi_model_forecasts_for_local_date(data, local_date):
        return dict(data)
    return None


def _store_multi_model_cache(
    city: str,
    payload: Dict[str, Any],
    *,
    lat: float,
    lon: float,
    use_fahrenheit: bool,
) -> None:
    cache = getattr(_weather, "_multi_model_cache", None)
    lock = getattr(_weather, "_multi_model_cache_lock", None)
    if not isinstance(cache, dict) or lock is None:
        return
    key = _multi_model_cache_key(city, lat, lon, use_fahrenheit=use_fahrenheit)
    try:
        with lock:
            cache[key] = {"t": time.time(), "data": dict(payload)}
    except Exception:
        return


def _fetch_scan_terminal_multi_model_batch(city_names: List[str]) -> Dict[str, Dict[str, Any]]:
    """Fetch daily max multi-model payloads for scan rows in batch.

    The scan terminal only needs today's max per model.  A batched daily request
    avoids 50 per-city calls while still preserving city-local dates.
    """
    grouped: Dict[bool, List[Dict[str, Any]]] = {False: [], True: []}
    results: Dict[str, Dict[str, Any]] = {}
    for city in city_names:
        city_meta = CITIES.get(city) or {}
        lat = _safe_float(city_meta.get("lat"))
        lon = _safe_float(city_meta.get("lon"))
        if lat is None or lon is None:
            continue
        use_fahrenheit = bool(city_meta.get("f"))
        local_date = _city_local_date(city, _safe_int(city_meta.get("tz"), 0))
        cached = _read_cached_multi_model_for_today(
            city,
            lat=lat,
            lon=lon,
            use_fahrenheit=use_fahrenheit,
            local_date=local_date,
        )
        if cached:
            results[city] = cached
            continue
        grouped[use_fahrenheit].append(
            {
                "city": city,
                "lat": lat,
                "lon": lon,
                "local_date": local_date,
            }
        )

    http_get = getattr(_weather, "_http_get", None)
    if not callable(http_get):
        return results

    stored_any = False
    for use_fahrenheit, unit_items in grouped.items():
        if not unit_items:
            continue
        for start in range(0, len(unit_items), SCAN_TERMINAL_MULTI_MODEL_BATCH_SIZE):
            items = unit_items[start : start + SCAN_TERMINAL_MULTI_MODEL_BATCH_SIZE]
            if not items:
                continue
            try:
                wait_slot = getattr(_weather, "_wait_open_meteo_slot", None)
                if callable(wait_slot):
                    wait_slot("scan-terminal-multi-model-batch")
                params: Dict[str, Any] = {
                    "latitude": ",".join(str(item["lat"]) for item in items),
                    "longitude": ",".join(str(item["lon"]) for item in items),
                    "daily": "temperature_2m_max",
                    "models": ",".join(OPEN_METEO_MULTI_MODEL_ORDER),
                    "timezone": "auto",
                    "forecast_days": 3,
                }
                if use_fahrenheit:
                    params["temperature_unit"] = "fahrenheit"
                response = http_get(
                    "https://api.open-meteo.com/v1/forecast",
                    params=params,
                    timeout=max(10.0, float(getattr(_weather, "open_meteo_timeout_sec", 5.0))),
                )
                response.raise_for_status()
                raw = response.json()
                payloads = raw if isinstance(raw, list) else [raw]
                for item, location_payload in zip(items, payloads):
                    daily = location_payload.get("daily", {}) if isinstance(location_payload, dict) else {}
                    if not isinstance(daily, dict):
                        continue
                    dates, daily_forecasts, model_metadata, model_keys = _parse_open_meteo_multi_model_daily(daily)
                    if not daily_forecasts:
                        continue
                    local_date = item["local_date"]
                    forecasts = daily_forecasts.get(local_date) or {}
                    if not forecasts:
                        continue
                    city = str(item["city"])
                    result = {
                        "source": "multi_model",
                        "provider": "open-meteo",
                        "forecasts": forecasts,
                        "daily_forecasts": daily_forecasts,
                        "hourly_times": [],
                        "hourly_forecasts": {},
                        "model_metadata": model_metadata,
                        "model_keys": model_keys,
                        "dates": dates,
                        "unit": "fahrenheit" if use_fahrenheit else "celsius",
                        "attribution": "Open-Meteo forecast model API; underlying models from ECMWF, DWD, ECCC, NOAA/NCEP, Google and JMA.",
                        "scan_terminal_batch": True,
                    }
                    results[city] = result
                    _store_multi_model_cache(
                        city,
                        result,
                        lat=float(item["lat"]),
                        lon=float(item["lon"]),
                        use_fahrenheit=use_fahrenheit,
                    )
                    stored_any = True
            except Exception:
                continue
    if stored_any:
        flush = getattr(_weather, "_flush_open_meteo_disk_cache", None)
        if callable(flush):
            try:
                flush()
            except Exception:
                pass
    return results


def _fetch_today_forecast_panel_payload(
    city: str,
    payload: Dict[str, Any],
    *,
    multi_model_override: Optional[Dict[str, Any]] = None,
    allow_direct_fetch: bool = True,
) -> Optional[Dict[str, Any]]:
    city_meta = CITIES.get(city) or {}
    lat = _safe_float(city_meta.get("lat"))
    lon = _safe_float(city_meta.get("lon"))
    if lat is None or lon is None:
        return None

    use_fahrenheit = bool(city_meta.get("f"))
    temp_symbol = "°F" if use_fahrenheit else "°C"
    tz_offset = payload.get("utc_offset_seconds")
    if tz_offset is None:
        tz_offset = city_meta.get("tz")
    tz_offset_int = _safe_int(tz_offset, 0)
    local_date = _city_local_date(city, tz_offset_int)
    local_time = _city_local_time(city, tz_offset_int)

    multi_model = multi_model_override
    if not isinstance(multi_model, dict):
        if not allow_direct_fetch:
            return None
        try:
            multi_model = _weather.fetch_multi_model(
                lat,
                lon,
                city=city,
                use_fahrenheit=use_fahrenheit,
            )
        except Exception:
            multi_model = None
    forecasts = multi_model_forecasts_for_local_date(multi_model, local_date)
    if not forecasts:
        return None

    weathernext2_payload = _load_weathernext2_artifact(_weathernext2_artifact_path(), city)
    weathernext2_summary = (
        weathernext2_payload.get("summary")
        if isinstance(weathernext2_payload, dict) and isinstance(weathernext2_payload.get("summary"), dict)
        else None
    )
    if weathernext2_summary:
        wn2_val = _safe_float(weathernext2_summary.get("median")) or _safe_float(weathernext2_summary.get("mean"))
        if wn2_val is not None:
            forecasts["WeatherNext 2"] = round(wn2_val, 1)
    weathernext2_data = weathernext2_payload if isinstance(weathernext2_payload, dict) else None

    try:
        deb_result = calculate_deb_prediction(
            city,
            forecasts,
            raw_calculator=calculate_dynamic_weights,
        )
    except Exception:
        deb_result = {}
    deb_prediction = _safe_float(deb_result.get("prediction"))

    probabilities: Dict[str, Any] = {"mu": None, "distribution": [], "distribution_all": []}

    source_local_date = str(payload.get("local_date") or "").strip()
    return {
        **payload,
        "local_date": local_date,
        "local_time": local_time,
        "utc_offset_seconds": tz_offset_int,
        "temp_symbol": temp_symbol,
        "multi_model": multi_model or {},
        "multi_model_daily": {
            local_date: {
                "models": forecasts,
                "deb": deb_result if deb_result else {"prediction": deb_prediction},
            }
        },
        "deb": deb_result if deb_result else {"prediction": deb_prediction},
        "weathernext2": weathernext2_data,
        "probabilities": probabilities,
        "forecast_refreshed": True,
        "forecast_source_local_date": local_date,
        "forecast_previous_local_date": source_local_date or None,
    }


def _build_forecast_only_panel_payload(
    city: str,
    multi_model: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    city_meta = CITIES.get(city) or {}
    temp_symbol = "°F" if bool(city_meta.get("f")) else "°C"
    return _fetch_today_forecast_panel_payload(
        city,
        {
            "display_name": city_meta.get("name") or city_meta.get("display_name") or city,
            "current": {},
            "risk": {},
            "probabilities": {},
            "temp_symbol": temp_symbol,
            "utc_offset_seconds": _safe_int(city_meta.get("tz"), 0),
        },
        multi_model_override=multi_model,
        allow_direct_fetch=False,
    )


def _load_scan_panel_payload(
    city: str,
    *,
    force_refresh: bool,
    multi_model_override: Optional[Dict[str, Any]] = None,
    allow_direct_fetch: bool = True,
) -> Optional[Dict[str, Any]]:
    refresh_already_queued = False
    cached_entry = _PANEL_CACHE_DB.get_city_cache("panel", city)
    cached_payload = cached_entry.get("payload") if isinstance(cached_entry, dict) else None
    if isinstance(cached_payload, dict):
        stale_reason = _panel_cache_stale_reason(city, cached_entry, cached_payload)
        if not force_refresh and stale_reason is None:
            return cached_payload
        effective_multi_model_override = multi_model_override
        if not isinstance(effective_multi_model_override, dict):
            city_meta = CITIES.get(city) or {}
            tz_offset = cached_payload.get("utc_offset_seconds")
            if tz_offset is None:
                tz_offset = city_meta.get("tz")
            local_date = _city_local_date(city, _safe_int(tz_offset, 0))
            cached_panel_multi_model = _cached_panel_multi_model_for_local_date(
                cached_payload,
                local_date,
                use_fahrenheit=bool(city_meta.get("f")),
            )
            if cached_panel_multi_model:
                effective_multi_model_override = cached_panel_multi_model
        _enqueue_scan_terminal_refresh(city, reason=stale_reason or "scan_terminal_force_forecast_refresh")
        refresh_already_queued = True
        refreshed_payload = _fetch_today_forecast_panel_payload(
            city,
            cached_payload,
            multi_model_override=effective_multi_model_override,
            allow_direct_fetch=allow_direct_fetch,
        )
        if refreshed_payload:
            return refreshed_payload

    canonical_getter = getattr(_PANEL_CACHE_DB, "get_canonical_temperature", None)
    canonical_entry = canonical_getter(city) if callable(canonical_getter) else None
    canonical = (
        canonical_entry.get("payload")
        if isinstance(canonical_entry, dict) and isinstance(canonical_entry.get("payload"), dict)
        else canonical_entry
    )
    payload = build_city_weather_from_canonical(city, canonical) if isinstance(canonical, dict) else None
    if payload:
        city_meta = CITIES.get(city) or {}
        payload.setdefault("display_name", city_meta.get("name") or city_meta.get("display_name") or city)
        payload.setdefault("temp_symbol", canonical.get("temp_symbol") or "°C")
        refreshed_payload = _fetch_today_forecast_panel_payload(
            city,
            payload,
            multi_model_override=multi_model_override,
            allow_direct_fetch=allow_direct_fetch,
        )
        if refreshed_payload:
            payload = refreshed_payload
        _enqueue_scan_terminal_refresh(city, reason="scan_terminal_canonical_fallback")
        return payload

    if not refresh_already_queued:
        _enqueue_scan_terminal_refresh(city, reason="scan_terminal_cold_start")
    return None


def _resolve_time_range_dates(data: Dict[str, Any], time_range: str) -> List[str]:
    local_date = str(data.get("local_date") or "").strip()
    multi_model_daily = data.get("multi_model_daily") or {}
    available_dates = sorted(
        str(date_key).strip()
        for date_key in (multi_model_daily.keys() if isinstance(multi_model_daily, dict) else [])
        if str(date_key).strip()
    )

    if not local_date:
        return available_dates[:1]
    if time_range == "today":
        return [local_date]

    try:
        local_dt = datetime.fromisoformat(local_date)
    except Exception:
        return available_dates[:7] if time_range == "week" else available_dates[:1]

    if time_range == "tomorrow":
        target = (local_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        if target in available_dates:
            return [target]
        future_dates = [date_key for date_key in available_dates if date_key > local_date]
        return future_dates[:1]

    if time_range == "week":
        target_dates = [date_key for date_key in available_dates if date_key >= local_date]
        if local_date not in target_dates:
            target_dates.insert(0, local_date)
        deduped: List[str] = []
        for date_key in target_dates:
            if date_key not in deduped:
                deduped.append(date_key)
            if len(deduped) >= 7:
                break
        return deduped

    return [local_date]


def _build_terminal_row(
    *,
    city: str,
    data: Dict[str, Any],
    scan: Dict[str, Any],
    row: Dict[str, Any],
) -> Dict[str, Any]:
    current = data.get("current") or {}
    multi_model_daily = data.get("multi_model_daily") or {}
    selected_date = str(row.get("selected_date") or scan.get("selected_date") or data.get("local_date") or "").strip()
    daily_entry = multi_model_daily.get(selected_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    display_name = str(data.get("display_name") or city).strip() or city
    market_slug = str(row.get("market_slug") or "").strip()
    side = str(row.get("side") or "").strip().lower()
    edge_percent = _safe_float(row.get("edge_percent"))
    final_score = _safe_float(row.get("final_score"))
    volume = _safe_float(row.get("volume")) or 0.0
    primary_signal = scan.get("primary_signal") or {}
    city_meta = CITIES.get(city) or {}
    tz_offset = _safe_int(city_meta.get("tz"), 0)
    market_region = _market_region_from_tz_offset(tz_offset)
    metar_context = _build_metar_decision_context(data)

    return {
        **row,
        "id": str(row.get("id") or f"{city}|{selected_date}|{market_slug}|{side}"),
        "city": city,
        "city_display_name": display_name,
        "trading_region": market_region["key"],
        "trading_region_label": market_region["label_en"],
        "trading_region_label_zh": market_region["label_zh"],
        "trading_region_sort": market_region.get("sort_order", 0),
        "tz_offset_seconds": tz_offset,
        "selected_date": selected_date or None,
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current_temp": current.get("temp"),
        "current_max_so_far": current.get("max_so_far"),
        
        "metar_context": metar_context,
        "metar_today_obs": metar_context.get("today_obs") or [],
        "metar_recent_obs": metar_context.get("recent_obs") or [],
        "settlement_today_obs": metar_context.get("settlement_today_obs") or [],
        "metar_status": {
            "available_for_today": metar_context.get("available_for_today"),
            "stale_for_today": metar_context.get("stale_for_today"),
            "last_observation_time": metar_context.get("last_observation_time"),
            "last_temp": metar_context.get("last_temp"),
        },
        "deb_prediction": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None)
        or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None),
        "display_name": display_name,
        "airport": ((data.get("risk") or {}).get("airport") if isinstance(data.get("risk"), dict) else None),
        "risk_level": ((data.get("risk") or {}).get("level") if isinstance(data.get("risk"), dict) else None),
        "distribution_bias": scan.get("distribution_bias"),
        "distribution_preview": scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "distribution_full": scan.get("distribution_full") or scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "probability_engine": scan.get("probability_engine") or (data.get("probabilities") or {}).get("engine"),
        "probability_calibration_mode": scan.get("probability_calibration_mode") or (data.get("probabilities") or {}).get("calibration_mode"),
        "model_cluster_sources": _model_sources_with_weathernext2(
            daily_entry.get("models")
            if isinstance(daily_entry.get("models"), dict)
            else data.get("multi_model", {}).get("forecasts"),
            data,
        ),
        "window_phase": row.get("window_phase") or scan.get("window_phase"),
        "window_score": row.get("window_score") if row.get("window_score") is not None else scan.get("window_score"),
        "signal_status": scan.get("signal_status"),
        "candidate_count": scan.get("candidate_count"),
        "resolved_market_type": scan.get("resolved_market_type") or "maxtemp",
        "market_key": f"{city}|{selected_date}|{market_slug}",
        "is_primary_signal": bool(primary_signal and primary_signal.get("id") == row.get("id")),
        "signal_confidence": final_score,
        "edge_percent": edge_percent,
        "final_score": final_score,
        "volume": volume,
        "amos": data.get("amos") or None,
        "top_buckets": scan.get("top_buckets") or [],
        "all_buckets": scan.get("all_buckets") or [],
        "runway_plate_history": _compact_runway_plate_history_for_scan(
            data.get("runway_plate_history")
        ),
    }


def _scan_city_terminal_rows(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
    multi_model_override: Optional[Dict[str, Any]] = None,
    allow_direct_fetch: bool = True,
) -> Dict[str, Any]:
    return _scan_city_terminal_rows_quick(
        city,
        filters,
        force_refresh=force_refresh,
        multi_model_override=multi_model_override,
        allow_direct_fetch=allow_direct_fetch,
    )


def _scan_city_terminal_rows_quick(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
    multi_model_override: Optional[Dict[str, Any]] = None,
    allow_direct_fetch: bool = True,
) -> Dict[str, Any]:
    """Fast path that returns cached analysis rows only — returns a single row per city
    with cached analysis data (Obs, DEB, probabilities) but no market prices."""
    if isinstance(multi_model_override, dict) and multi_model_override:
        data = _build_forecast_only_panel_payload(city, multi_model_override)
        if data:
            row = _build_quick_row(city=city, data=data)
            return {
                "city": city,
                "rows": [row] if row else [],
                "candidate_total": 1,
                "primary_scores": [float(row.get("final_score") or 0)] if row else [],
            }

    data = _load_scan_panel_payload(
        city,
        force_refresh=force_refresh,
        multi_model_override=multi_model_override,
        allow_direct_fetch=allow_direct_fetch,
    )
    if not data:
        return {
            "city": city,
            "rows": [],
            "candidate_total": 0,
            "primary_scores": [],
        }
    row = _build_quick_row(city=city, data=data)
    return {
        "city": city,
        "rows": [row] if row else [],
        "candidate_total": 1,
        "primary_scores": [float(row.get("final_score") or 0)] if row else [],
    }


def _build_quick_row(
    *,
    city: str,
    data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    curr = data.get("current") or {}
    risk = data.get("risk") or {}
    airport_primary = data.get("airport_primary") if isinstance(data.get("airport_primary"), dict) else {}
    official_status = data.get("official_network_status") if isinstance(data.get("official_network_status"), dict) else {}
    deb = data.get("deb") or {}
    probs = data.get("probabilities") or {}
    multi = data.get("multi_model") or {}
    distribution = probs.get("distribution") or []
    local_date = str(data.get("local_date") or "")
    local_time = str(data.get("local_time") or "")
    city_meta = CITIES.get(city) or {}
    tz_offset = data.get("utc_offset_seconds")
    if tz_offset is None:
        tz_offset = _safe_int(city_meta.get("tz"), 0)
    market_region = _market_region_from_tz_offset(tz_offset)

    multi_model_daily = data.get("multi_model_daily") or {}
    daily_entry = multi_model_daily.get(local_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    id_parts = [city, local_date or "today"]
    if data.get("temp_symbol") == "°F":
        id_parts.append("F")
    row_id = hashlib.sha256("|".join(id_parts).encode()).hexdigest()[:16]

    row: Dict[str, Any] = {
        "id": f"{city}:{local_date or 'today'}",
        "city": city,
        "city_display_name": str(data.get("display_name") or city),
        "airport": str(risk.get("airport") or ""),
        "local_date": local_date,
        "local_time": local_time,
        "tz_offset_seconds": tz_offset,
        "temp_symbol": data.get("temp_symbol"),
        "risk_level": risk.get("level"),
        "current_temp": curr.get("temp"),
        "current_max_so_far": curr.get("max_so_far"),
        
        "icao": str(risk.get("icao") or airport_primary.get("station_code") or ""),
        "station_source_code": airport_primary.get("source_code") or data.get("official_network_source"),
        "station_source_label": airport_primary.get("source_label") or official_status.get("provider_label"),
        "station_code": airport_primary.get("station_code") or risk.get("icao"),
        "station_label": airport_primary.get("station_label") or risk.get("airport"),
        "network_provider": data.get("official_network_source") or official_status.get("provider_code"),
        "network_provider_label": official_status.get("provider_label"),
        "deb_prediction": deb.get("prediction"),
        "model_cluster_sources": _model_sources_with_weathernext2(
            daily_entry.get("models")
            if isinstance(daily_entry.get("models"), dict)
            else multi.get("forecasts", {}),
            data,
        ),
        "distribution_preview": distribution[:6] if distribution else [],
        "distribution_full": probs.get("distribution_all") or distribution,
        "probability_engine": probs.get("engine"),
        "probability_calibration_mode": probs.get("calibration_mode"),
        "forecast_refreshed": bool(data.get("forecast_refreshed")),
        "forecast_source_local_date": data.get("forecast_source_local_date"),
        "forecast_previous_local_date": data.get("forecast_previous_local_date"),
        "trading_region": market_region["key"],
        "trading_region_label": market_region["label_en"],
        "trading_region_label_zh": market_region["label_zh"],
        "trading_region_sort": market_region.get("sort_order", 0),
        "active": True,
        "closed": False,
        "tradable": False,
        "is_primary_signal": True,
        "accepting_orders": False,
        "row_id": row_id,
        "weathernext2": data.get("weathernext2"),
        "runway_plate_history": _compact_runway_plate_history_for_scan(
            data.get("runway_plate_history")
        ),
    }
    # Compute a simple edge: model top probability vs neutral
    best_model_prob = max(
        (float(b.get("probability") or 0) for b in distribution[:6]),
        default=None,
    )
    row["model_probability"] = best_model_prob
    row["final_score"] = float(deb.get("prediction") or 0)
    return row


# ── METAR/observation context helpers (moved from deleted scan_terminal_ai_compact) ──


def _observation_sort_key(point: Dict[str, Any]) -> tuple[int, str]:
    raw_time = str(point.get("time") or "").strip()
    try:
        parsed = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
        return parsed.hour * 60 + parsed.minute, raw_time
    except Exception:
        pass
    match = re.search(r"(\d{1,2}):(\d{2})", raw_time)
    if match:
        hour = max(0, min(23, int(match.group(1))))
        minute = max(0, min(59, int(match.group(2))))
        return hour * 60 + minute, raw_time
    return 9999, raw_time


def _compact_observation_points(raw_points: Any, limit: int = 24) -> List[Dict[str, Any]]:
    if not isinstance(raw_points, list):
        return []
    points: List[Dict[str, Any]] = []
    for item in raw_points:
        if isinstance(item, dict):
            temp = _safe_float(item.get("temp"))
            time_value = str(item.get("time") or item.get("obs_time") or item.get("time_label") or "").strip()
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            time_value = str(item[0] or "").strip()
            temp = _safe_float(item[1])
        else:
            continue
        if temp is None or not time_value:
            continue
        points.append({"time": time_value, "temp": temp})
    sorted_points = sorted(points, key=_observation_sort_key)
    return sorted_points[-max(1, int(limit)):]


def _build_metar_decision_context(data: Dict[str, Any]) -> Dict[str, Any]:
    today_obs = _compact_observation_points(data.get("metar_today_obs"), 36)
    recent_obs = _compact_observation_points(data.get("metar_recent_obs"), 12)
    settlement_obs = _compact_observation_points(data.get("settlement_today_obs"), 36)
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    metar_status = data.get("metar_status") if isinstance(data.get("metar_status"), dict) else {}

    source_obs = today_obs or recent_obs or settlement_obs
    trend_source = recent_obs or source_obs[-4:]
    last_point = source_obs[-1] if source_obs else {}
    first_trend = trend_source[0] if trend_source else {}
    last_trend = trend_source[-1] if trend_source else {}
    max_point = None
    for point in source_obs:
        if max_point is None or float(point["temp"]) >= float(max_point["temp"]):
            max_point = point

    last_temp = _safe_float(last_point.get("temp"))
    first_temp = _safe_float(first_trend.get("temp"))
    trend_last_temp = _safe_float(last_trend.get("temp"))
    trend_delta = (
        trend_last_temp - first_temp
        if trend_last_temp is not None and first_temp is not None and len(trend_source) >= 2
        else None
    )
    station = data.get("risk") if isinstance(data.get("risk"), dict) else {}
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    settlement_station = data.get("settlement_station") if isinstance(data.get("settlement_station"), dict) else {}
    settlement_source = str(
        current.get("settlement_source")
        or settlement_station.get("settlement_source")
        or "metar"
    ).strip().lower()
    is_hko = settlement_source == "hko"
    source_label = "HKO" if is_hko else "METAR"
    return {
        "source": source_label,
        "is_airport_metar": not is_hko,
        "station": (
            current.get("station_code")
            or settlement_station.get("settlement_station_code")
            or station.get("icao")
            or airport_current.get("station_code")
        ),
        "station_label": (
            current.get("station_name")
            or settlement_station.get("settlement_station_label")
            or station.get("airport")
            or airport_current.get("station_label")
        ),
        "today_obs": today_obs[-12:],
        "recent_obs": recent_obs[-8:],
        "settlement_today_obs": settlement_obs[-12:],
        "obs_count": len(source_obs),
        "last_time": last_point.get("time"),
        "last_temp": last_temp,
        "max_temp": _safe_float((max_point or {}).get("temp")),
        "max_time": (max_point or {}).get("time"),
        "trend_delta": trend_delta,
        "stale_for_today": bool(metar_status.get("stale_for_today")),
        "available_for_today": bool(metar_status.get("available_for_today")),
        "last_observation_time": metar_status.get("last_observation_time"),
        "airport_current_temp": _safe_float(airport_current.get("temp")),
        "airport_max_so_far": _safe_float(airport_current.get("max_so_far")),
        "airport_obs_time": airport_current.get("obs_time"),
        "airport_report_time": airport_current.get("report_time"),
        "airport_raw_metar": airport_current.get("raw_metar"),
        "airport_wx_desc": airport_current.get("wx_desc"),
        "airport_cloud_desc": airport_current.get("cloud_desc"),
        "airport_visibility_mi": _safe_float(airport_current.get("visibility_mi")),
        "airport_wind_speed_kt": _safe_float(airport_current.get("wind_speed_kt")),
        "airport_wind_dir": _safe_float(airport_current.get("wind_dir")),
        "airport_humidity": _safe_float(airport_current.get("humidity")),
    }
