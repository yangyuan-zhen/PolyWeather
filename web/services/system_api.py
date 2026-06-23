"""System and observability API service functions."""

from __future__ import annotations

import time
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from loguru import logger

from src.database.db_manager import DBManager
from src.database.sqlite_connection import connect_sqlite
from src.utils.metrics import export_prometheus_metrics, gauge_set
from web.core import build_health_payload, build_system_status_payload
import web.routes as legacy_routes


def get_health_payload() -> Dict[str, Any]:
    return build_health_payload()


async def get_system_status_payload(request: Request) -> Dict[str, Any]:
    legacy_routes._require_ops_admin(request)
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
    legacy_routes._require_ops_admin(request)
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

    def _queue_city_refresh(city: str, *, priority: str) -> None:
        enqueue = getattr(legacy_routes._CACHE_DB, "enqueue_observation_refresh_request", None)
        if not callable(enqueue):
            logger.warning("priority warm queue unavailable city={} timezone={}", city, timezone)
            return
        enqueue(
            city=city,
            kind="panel",
            priority=priority,
            reason="system_priority_warm",
        )

    def _runner() -> None:
        for city in primary:
            try:
                _queue_city_refresh(city, priority="high")
            except Exception as exc:
                logger.warning("priority warm primary failed city={} timezone={}: {}", city, timezone, exc)
        for city in secondary:
            try:
                _queue_city_refresh(city, priority="normal")
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


def get_prometheus_metrics_response(request: Request) -> PlainTextResponse:
    legacy_routes._require_ops_admin(request)
    _refresh_operational_metrics()
    return PlainTextResponse(
        export_prometheus_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


def _payment_event_reason(row: Dict[str, Any]) -> str:
    payload = row.get("payload") if isinstance(row, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    confirm_failure = (
        payload.get("confirm_failure")
        if isinstance(payload.get("confirm_failure"), dict)
        else {}
    )
    return str(
        payload.get("reason")
        or confirm_failure.get("reason")
        or payload.get("error")
        or "unknown"
    ).strip().lower() or "unknown"


def _payment_event_is_resolved(row: Dict[str, Any]) -> bool:
    payload = row.get("payload") if isinstance(row, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    return bool(str(payload.get("resolved_at") or "").strip())


def _refresh_operational_metrics() -> None:
    try:
        db = DBManager()
    except Exception:
        return

    payment_events = []
    for event_type in ("payment_intent_failed", "payment_refund_required"):
        try:
            payment_events.extend(
                db.list_payment_audit_events(limit=500, event_type=event_type)
            )
        except Exception:
            continue

    open_events = [row for row in payment_events if not _payment_event_is_resolved(row)]
    gauge_set("polyweather_payment_incidents_open", len(open_events))
    for reason, count in Counter(_payment_event_reason(row) for row in open_events).items():
        gauge_set("polyweather_payment_incidents_by_reason", count, reason=reason)

    try:
        refund_cases = db.list_refund_cases(limit=500)
    except Exception:
        refund_cases = []
    terminal_statuses = {"refunded", "rejected", "closed"}
    open_refunds = [
        case
        for case in refund_cases
        if str(case.get("status") or "").strip().lower() not in terminal_statuses
    ]
    gauge_set("polyweather_refund_cases_open", len(open_refunds))

    realtime = _realtime_status_payload()
    gauge_set("polyweather_sse_connections", int(realtime.get("sse_connections") or 0))
    gauge_set(
        "polyweather_realtime_latest_revision",
        int(realtime.get("latest_revision") or 0),
    )
    degraded_from = str(realtime.get("degraded_from") or "").strip().lower()
    store = str(realtime.get("store") or "").strip().lower()
    gauge_set(
        "polyweather_realtime_redis_fallback",
        1 if degraded_from == "redis" or store == "degraded_sqlite" else 0,
    )

    db_path = str(getattr(db, "db_path", "") or "").strip()
    if db_path:
        try:
            gauge_set("polyweather_sqlite_db_size_bytes", os.path.getsize(db_path))
        except OSError:
            pass
        _refresh_training_data_metrics(db_path)


def _target_date_stale_days(target_date: Optional[str]) -> Optional[int]:
    raw = str(target_date or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        return None
    return max(0, (datetime.now(timezone.utc).date() - parsed).days)


def _max_target_date(db_path: str, table_name: str) -> Optional[str]:
    with connect_sqlite(db_path) as conn:
        row = conn.execute(f"SELECT MAX(target_date) AS max_date FROM {table_name}").fetchone()
    if not row:
        return None
    return row[0]


def _refresh_training_data_metrics(db_path: str) -> None:
    stale_threshold_days = max(
        0,
        int(os.getenv("POLYWEATHER_TRAINING_DATA_STALE_WARN_DAYS", "2") or "2"),
    )
    table_metrics = {
        "daily_records_store": "polyweather_daily_records_stale_days",
        "truth_records_store": "polyweather_truth_records_stale_days",
        "training_feature_records_store": "polyweather_training_features_stale_days",
    }
    max_stale_days: Optional[int] = None
    for table_name, metric_name in table_metrics.items():
        try:
            stale_days = _target_date_stale_days(_max_target_date(db_path, table_name))
        except Exception:
            stale_days = None
        if stale_days is None:
            gauge_set(metric_name, -1)
            max_stale_days = max(max_stale_days or 0, stale_threshold_days + 1)
            continue
        gauge_set(metric_name, stale_days)
        max_stale_days = max(max_stale_days or 0, stale_days)
    gauge_set(
        "polyweather_training_data_stale",
        1 if max_stale_days is None or max_stale_days > stale_threshold_days else 0,
    )
