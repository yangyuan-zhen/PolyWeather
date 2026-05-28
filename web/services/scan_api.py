"""Market scan API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import Request
from fastapi.concurrency import run_in_threadpool

import web.routes as legacy_routes


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


async def get_scan_terminal_overview_payload(request: Request) -> Dict[str, Any]:
    return {"overview": [], "available": False}
