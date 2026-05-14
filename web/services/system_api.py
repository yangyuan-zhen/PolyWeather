"""System and observability API service functions."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from loguru import logger

from src.utils.metrics import export_prometheus_metrics
from web.core import build_health_payload, build_system_status_payload
import web.routes as legacy_routes


def get_health_payload() -> Dict[str, Any]:
    payload = build_health_payload()
    if payload.get("status") != "ok":
        raise HTTPException(status_code=503, detail=payload)
    return payload


async def get_system_status_payload() -> Dict[str, Any]:
    return await run_in_threadpool(build_system_status_payload)


def run_system_prewarm(
    request: Request,
    *,
    cities: Optional[str] = None,
    force_refresh: bool = False,
    include_detail: bool = False,
    include_market: bool = False,
) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    selected = legacy_routes._normalize_city_list(cities)
    if not selected:
        raise HTTPException(status_code=400, detail="No valid cities to prewarm")

    started = time.perf_counter()
    warmed: list[dict[str, object]] = []
    failed: list[dict[str, object]] = []
    summary_ok = 0
    detail_ok = 0
    market_ok = 0

    for city in selected:
        city_started = time.perf_counter()
        try:
            legacy_routes._refresh_city_summary_cache(city, force_refresh=force_refresh)
            entry: dict[str, object] = {
                "city": city,
                "summary": True,
                "duration_ms": round((time.perf_counter() - city_started) * 1000.0, 1),
            }
            summary_ok += 1
            if include_detail:
                legacy_routes._refresh_city_panel_cache(city, force_refresh=force_refresh)
                entry["detail"] = True
                detail_ok += 1
            if include_market:
                entry["market"] = False
            warmed.append(entry)
        except Exception as exc:
            failed.append(
                {
                    "city": city,
                    "error": str(exc),
                    "duration_ms": round((time.perf_counter() - city_started) * 1000.0, 1),
                }
            )

    total_ms = round((time.perf_counter() - started) * 1000.0, 1)
    logger.info(
        "system prewarm finished count={} failed={} force_refresh={} include_detail={} include_market={} duration_ms={}",
        len(warmed),
        len(failed),
        force_refresh,
        include_detail,
        include_market,
        total_ms,
    )
    return {
        "ok": len(failed) == 0,
        "cities": selected,
        "warmed": warmed,
        "failed": failed,
        "summary_ok": summary_ok,
        "panel_ok": detail_ok,
        "detail_ok": detail_ok,
        "market_ok": market_ok,
        "failed_count": len(failed),
        "duration_ms": total_ms,
    }


def get_system_cache_status(request: Request, cities: Optional[str] = None) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    selected = legacy_routes._normalize_city_list(cities)
    if not selected:
        selected = list(legacy_routes.DEFAULT_PREWARM_CITIES)
    kinds = {
        "summary": legacy_routes.CITY_SUMMARY_CACHE_TTL_SEC,
        "panel": legacy_routes.CITY_PANEL_CACHE_TTL_SEC,
        "nearby": legacy_routes.CITY_NEARBY_CACHE_TTL_SEC,
        "market": legacy_routes.CITY_MARKET_CACHE_TTL_SEC,
        "history_preview": legacy_routes.CITY_HISTORY_PREVIEW_CACHE_TTL_SEC,
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
