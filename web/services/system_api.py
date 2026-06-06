"""System and observability API service functions."""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from loguru import logger

from src.database.db_manager import DBManager
from src.utils.metrics import export_prometheus_metrics
from web.core import build_health_payload, build_system_status_payload
import web.routes as legacy_routes

_ANNOUNCEMENT_ENABLED_KEY = "POLYWEATHER_UPDATE_ANNOUNCEMENT_ENABLED"
_ANNOUNCEMENT_TEXT_KEYS = {
    "zh_title": "POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH",
    "zh_body": "POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_ZH",
    "en_title": "POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_EN",
    "en_body": "POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_EN",
}


def get_health_payload() -> Dict[str, Any]:
    return build_health_payload()


def _runtime_or_env_value(db: DBManager, key: str) -> tuple[str, str]:
    metadata = db.get_runtime_config_metadata(key)
    if metadata.get("configured"):
        return str(metadata.get("value") or ""), str(metadata.get("updated_at") or "")
    return str(os.getenv(key) or ""), ""


def _truthy_runtime_flag(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def get_public_update_announcement() -> Dict[str, Any]:
    db = DBManager()
    enabled_value, enabled_updated_at = _runtime_or_env_value(db, _ANNOUNCEMENT_ENABLED_KEY)
    values: dict[str, str] = {}
    updated_at_candidates = [enabled_updated_at]
    for name, key in _ANNOUNCEMENT_TEXT_KEYS.items():
        value, updated_at = _runtime_or_env_value(db, key)
        values[name] = value
        if updated_at:
            updated_at_candidates.append(updated_at)

    has_content = any(
        values.get(name, "").strip()
        for name in ("zh_title", "zh_body", "en_title", "en_body")
    )
    enabled = _truthy_runtime_flag(enabled_value) and has_content
    updated_at = max((item for item in updated_at_candidates if item), default="")
    return {
        "enabled": enabled,
        "zh": {
            "title": values.get("zh_title", ""),
            "body": values.get("zh_body", ""),
        },
        "en": {
            "title": values.get("en_title", ""),
            "body": values.get("en_body", ""),
        },
        "updated_at": updated_at,
    }


async def get_system_status_payload() -> Dict[str, Any]:
    payload = await run_in_threadpool(build_system_status_payload)
    payload["realtime"] = await run_in_threadpool(_realtime_status_payload)
    return payload


def _realtime_status_payload() -> Dict[str, Any]:
    try:
        from web.routers import sse_router

        store = sse_router.event_store
        status_fn = getattr(store, "status", None)
        if callable(status_fn):
            status = dict(status_fn())
        else:
            store_name = "degraded_sqlite" if getattr(store, "degraded_from", None) == "redis" else "sqlite"
            status = {
                "store": store_name,
                "latest_revision": int(store.latest_revision()),
            }
        connection_count = getattr(sse_router.sse_manager, "connection_count", None)
        status["sse_connections"] = int(connection_count()) if callable(connection_count) else 0
        return status
    except Exception as exc:
        return {
            "store": "unknown",
            "latest_revision": 0,
            "sse_connections": 0,
            "error": str(exc),
        }


def get_system_cache_status(request: Request, cities: Optional[str] = None) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    selected = legacy_routes._normalize_city_list(cities)
    if not selected:
        selected = legacy_routes._normalize_city_list(None)
    kinds = {
        "summary": legacy_routes.CITY_SUMMARY_CACHE_TTL_SEC,
        "panel": legacy_routes.CITY_PANEL_CACHE_TTL_SEC,
        "nearby": legacy_routes.CITY_NEARBY_CACHE_TTL_SEC,
        "market": legacy_routes.CITY_MARKET_CACHE_TTL_SEC,
        "full": legacy_routes.CITY_FULL_CACHE_TTL_SEC,
    }
    items = []
    for city in selected:
        row = {"city": city}
        for kind, ttl_sec in kinds.items():
            entry = legacy_routes._CACHE_DB.get_city_cache(kind, city)
            row[kind] = {
                "exists": bool(entry),
                "fresh": legacy_routes._city_cache_is_fresh(entry, ttl_sec),
                "updated_at": entry.get("updated_at") if entry else None,
                "age_sec": round(max(0.0, time.time() - float(entry.get("updated_at_ts") or 0.0)), 1)
                if entry
                else None,
                "ttl_sec": ttl_sec,
            }
        items.append(row)
    return {"cities": items}


def run_system_priority_warm(
    request: Request,
    background_tasks: BackgroundTasks,
    timezone: Optional[str] = None,
) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    batches = legacy_routes._select_priority_city_batches(timezone)
    primary = list(batches.get("primary") or [])
    secondary = list(batches.get("secondary") or [])

    def _runner() -> None:
        for city in primary:
            try:
                legacy_routes._refresh_city_summary_cache(city, force_refresh=False)
                legacy_routes._refresh_city_panel_cache(city, force_refresh=False)
                legacy_routes._refresh_city_nearby_cache(city, force_refresh=False)
                legacy_routes._refresh_city_market_cache(city, force_refresh=False)
                legacy_routes._refresh_city_full_cache(city, force_refresh=False)
            except Exception as exc:
                logger.warning("priority warm primary failed city={} timezone={}: {}", city, timezone, exc)
        for city in secondary:
            try:
                legacy_routes._refresh_city_summary_cache(city, force_refresh=False)
                legacy_routes._refresh_city_panel_cache(city, force_refresh=False)
            except Exception as exc:
                logger.warning("priority warm secondary failed city={} timezone={}: {}", city, timezone, exc)

    background_tasks.add_task(_runner)
    return {
        "ok": True,
        "region": batches.get("region"),
        "timezone": batches.get("timezone"),
        "primary": primary,
        "secondary": secondary,
    }


def get_prometheus_metrics_response() -> PlainTextResponse:
    return PlainTextResponse(
        export_prometheus_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
