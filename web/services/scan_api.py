"""Market scan API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from web.services.market_overview_api import build_market_overview_payload
import web.routes as legacy_routes


def _boolish(value: Any) -> bool:
    return str(value or "false").lower() in {"1", "true", "yes", "on"}


async def _json_body_or_empty(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return body


def _extract_required_city(body: Dict[str, Any]) -> str:
    city = str(body.get("city") or "").strip()
    if not city:
        raise HTTPException(status_code=400, detail="city is required")
    return city


async def get_scan_terminal_payload(
    request: Request,
    *,
    scan_mode: str = "tradable",
    min_price: float = 0.05,
    max_price: float = 0.95,
    min_edge_pct: float = 2.0,
    min_liquidity: float = 500.0,
    high_liquidity_only: bool = False,
    market_type: str = "maxtemp",
    time_range: str = "today",
    limit: int = 25,
    force_refresh: bool = False,
    region: str = "",
    timezone_offset_seconds: int | None = None,
) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    filters: Dict[str, Any] = {
        "scan_mode": scan_mode,
        "min_price": min_price,
        "max_price": max_price,
        "min_edge_pct": min_edge_pct,
        "min_liquidity": min_liquidity,
        "high_liquidity_only": high_liquidity_only,
        "market_type": market_type,
        "time_range": time_range,
        "limit": limit,
    }
    if timezone_offset_seconds is not None:
        filters["timezone_offset_seconds"] = timezone_offset_seconds
    if region:
        filters["trading_region"] = region
    return await run_in_threadpool(
        legacy_routes.build_scan_terminal_payload,
        filters,
        force_refresh=force_refresh,
    )


async def get_scan_terminal_ai_payload(request: Request) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    body = await _json_body_or_empty(request)
    filters = body.get("filters") if isinstance(body.get("filters"), dict) else {}
    snapshot_id = str(body.get("snapshot_id") or "").strip() or None
    return await run_in_threadpool(
        legacy_routes.build_scan_terminal_ai_payload,
        filters,
        snapshot_id=snapshot_id,
    )


async def get_scan_terminal_overview_payload(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    rows = body.get("rows") if isinstance(body.get("rows"), list) else []
    locale = str(body.get("locale") or "zh-CN").strip()
    force_refresh = str(body.get("force_refresh") or "false").strip().lower() in {"1", "true", "yes"}
    return await run_in_threadpool(
        build_market_overview_payload,
        rows,
        locale=locale,
        force_refresh=force_refresh,
    )
