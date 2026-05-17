"""Dashboard init — bundled payload to reduce API waterfall on first paint."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from loguru import logger

import web.routes as legacy_routes
from web.services.city_api import _build_cities_payload


def _resolve_default_city(request: Request) -> Optional[str]:
    tz = (
        getattr(request.state, "auth_timezone", None)
        or str(request.headers.get("X-User-Timezone") or "").strip()
        or None
    )
    if tz and hasattr(legacy_routes, "TIMEZONE_DEFAULT_CITIES"):
        cities_map = getattr(legacy_routes, "TIMEZONE_DEFAULT_CITIES", {})
        if tz in cities_map:
            return cities_map[tz]
    return next(iter(getattr(legacy_routes, "DEFAULT_STATUS_CITIES", [])), None)


async def build_dashboard_init_payload(request: Request) -> Dict[str, Any]:
    started = time.perf_counter()
    legacy_routes._bind_optional_supabase_identity(request)
    is_pro = bool(getattr(request.state, "auth_user_id", None))

    cities_payload = await run_in_threadpool(_build_cities_payload)

    default_city = _resolve_default_city(request)
    detail_payload: Optional[Dict[str, Any]] = None
    if default_city:
        try:
            cached_entry = await run_in_threadpool(
                legacy_routes._CACHE_DB.get_city_cache, "panel", default_city,
            )
            if cached_entry:
                detail_payload = cached_entry.get("payload") or {}
            else:
                detail_payload = await run_in_threadpool(
                    legacy_routes._refresh_city_panel_cache, default_city, False,
                )
        except Exception as exc:
            logger.warning(
                "dashboard_init default_city={} panel failed: {}", default_city, exc
            )

    scan_payload: Optional[Dict[str, Any]] = None
    if is_pro:
        try:
            scan_payload = await run_in_threadpool(
                legacy_routes.build_scan_terminal_payload,
                {
                    "scan_mode": "tradable",
                    "min_price": 0.05,
                    "max_price": 0.95,
                    "min_edge_pct": 2.0,
                    "min_liquidity": 500.0,
                    "market_type": "maxtemp",
                    "time_range": "today",
                    "limit": 25,
                },
                False,
            )
        except Exception as exc:
            logger.warning("dashboard_init scan terminal failed: {}", exc)

    duration_ms = round((time.perf_counter() - started) * 1000.0, 1)
    logger.info(
        "dashboard_init is_pro={} default_city={} duration_ms={}",
        is_pro,
        default_city,
        duration_ms,
    )

    payload: Dict[str, Any] = {
        "cities": cities_payload.get("cities", []),
        "default_city": default_city or "",
        "default_city_detail": detail_payload,
        "is_pro": is_pro,
    }
    if scan_payload is not None:
        payload["scan_terminal"] = scan_payload
    return payload
