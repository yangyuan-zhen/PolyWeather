"""Lightweight bot-facing API service functions."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from src.analysis.settlement_rounding import apply_city_settlement, is_exact_settlement_city
from src.auth.supabase_entitlement import extract_bearer_token
import web.routes as legacy_routes


_CACHE_KINDS = ("summary", "panel", "full")
_ENTITLEMENT_HEADER = "x-polyweather-entitlement"


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _round_one(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(float(value), 1)


def _display_to_celsius(value: Optional[float], unit: str) -> Optional[float]:
    if value is None:
        return None
    if unit == "F":
        return round((float(value) - 32.0) * 5.0 / 9.0, 1)
    return round(float(value), 1)


def _bot_temp_unit(city: str, payload: Dict[str, Any]) -> str:
    symbol = str(payload.get("temp_symbol") or "").upper()
    if "F" in symbol:
        return "F"
    city_info = legacy_routes.CITIES.get(city) or {}
    city_meta = legacy_routes.CITY_REGISTRY.get(city) or {}
    if bool(city_info.get("f")) or bool(city_meta.get("use_fahrenheit")):
        return "F"
    return "C"


def _normalize_bot_city_list(raw: Optional[str]) -> Tuple[List[str], List[str]]:
    requested = str(raw or "").strip()
    if not requested or requested.lower() in {"all", "*"}:
        return sorted(legacy_routes.CITIES.keys()), []

    cities: List[str] = []
    missing: List[str] = []
    aliases = getattr(legacy_routes, "ALIASES", {}) or {}
    for part in requested.split(","):
        token = str(part or "").strip().lower().replace("-", " ")
        if not token:
            continue
        if token in {"all", "*"}:
            return sorted(legacy_routes.CITIES.keys()), []
        city = aliases.get(token, token)
        if city in legacy_routes.CITIES:
            if city not in cities:
                cities.append(city)
        elif city not in missing:
            missing.append(city)
    return cities, missing


def _require_bot_entitlement(request: Request) -> None:
    expected = str(os.getenv("POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="bot DEB endpoint requires POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN",
        )
    token = str(request.headers.get(_ENTITLEMENT_HEADER) or "").strip()
    if not token:
        token = extract_bearer_token(request.headers.get("authorization"))
    if token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")
    legacy_routes._assert_entitlement(request)


def _cache_updated_at(entry: Dict[str, Any], payload: Dict[str, Any]) -> Optional[str]:
    value = str(entry.get("updated_at") or payload.get("updated_at") or "").strip()
    return value or None


def _entry_local_datetime(city: str, entry: Dict[str, Any]) -> Optional[datetime]:
    updated_at_ts = _safe_float(entry.get("updated_at_ts"))
    if updated_at_ts is None or updated_at_ts <= 0:
        return None
    try:
        offset = int((legacy_routes.CITIES.get(city) or {}).get("tz") or 0)
    except Exception:
        offset = 0
    return datetime.fromtimestamp(updated_at_ts, tz=timezone.utc) + timedelta(seconds=offset)


def _local_date(payload: Dict[str, Any], city: str, entry: Dict[str, Any]) -> Optional[str]:
    value = str(payload.get("local_date") or "").strip()
    if value:
        return value
    local_dt = _entry_local_datetime(city, entry)
    return local_dt.strftime("%Y-%m-%d") if local_dt is not None else None


def _local_time(payload: Dict[str, Any], city: str, entry: Dict[str, Any]) -> Optional[str]:
    value = str(payload.get("local_time") or "").strip()
    if value:
        return value
    local_dt = _entry_local_datetime(city, entry)
    return local_dt.strftime("%H:%M") if local_dt is not None else None


def _cached_bot_deb_row(city: str) -> Optional[Dict[str, Any]]:
    for kind in _CACHE_KINDS:
        entry = legacy_routes._CACHE_DB.get_city_cache(kind, city)
        if not isinstance(entry, dict):
            continue
        payload = entry.get("payload")
        if not isinstance(payload, dict):
            continue

        deb = payload.get("deb") if isinstance(payload.get("deb"), dict) else {}
        deb_prediction = _round_one(_safe_float(deb.get("prediction")))
        if deb_prediction is None:
            continue

        unit = _bot_temp_unit(city, payload)
        current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
        current_temp = _round_one(_safe_float(current.get("temp")))
        city_meta = legacy_routes.CITY_REGISTRY.get(city) or {}
        display_name = str(
            payload.get("display_name")
            or city_meta.get("display_name")
            or city_meta.get("name")
            or city.title()
        ).strip()

        return {
            "local_date": _local_date(payload, city, entry),
            "local_time": _local_time(payload, city, entry),
            "display_name": display_name,
            "temp_unit": unit,
            "deb_prediction": deb_prediction,
            "deb_prediction_c": _display_to_celsius(deb_prediction, unit),
            "deb_version": deb.get("version"),
            "quality_tier": deb.get("quality_tier"),
            "recent_hit_rate": _round_one(_safe_float(deb.get("recent_hit_rate"))),
            "settlement_bucket": apply_city_settlement(city, deb_prediction),
            "settlement_rule": "floor" if is_exact_settlement_city(city) else "wu_round",
            "current_temp": current_temp,
            "current_temp_c": _display_to_celsius(current_temp, unit),
            "source_updated_at": _cache_updated_at(entry, payload),
            "cache_kind": kind,
        }
    return None


def _build_bot_deb_payload(cities: Optional[str]) -> Dict[str, Any]:
    requested_cities, missing = _normalize_bot_city_list(cities)
    rows: Dict[str, Dict[str, Any]] = {}
    for city in requested_cities:
        row = _cached_bot_deb_row(city)
        if row is None:
            missing.append(city)
            continue
        rows[city] = row
    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "city_cache",
        "count": len(rows),
        "cities": rows,
        "missing": missing,
    }


async def get_bot_deb_payload(request: Request, cities: Optional[str] = None) -> Dict[str, Any]:
    _require_bot_entitlement(request)
    return await run_in_threadpool(_build_bot_deb_payload, cities)
