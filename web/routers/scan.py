"""Market scan and scan AI API routes."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web.services.cache_headers import NO_STORE_CACHE_CONTROL, public_edge_cache_control
from web.services.scan_api import (
    get_scan_terminal_overview_payload,
    get_scan_terminal_payload,
)
from web.services.request_timing import attach_server_timing_header

router = APIRouter(tags=["scan"])

SCAN_TERMINAL_CACHE_CONTROL = public_edge_cache_control(300, 900)


@router.get("/api/scan/terminal")
async def scan_terminal(
    request: Request,
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
    trading_region: str = "",
    timezone_offset_seconds: int | None = None,
):
    payload = await get_scan_terminal_payload(
        request,
        scan_mode=scan_mode,
        min_price=min_price,
        max_price=max_price,
        min_edge_pct=min_edge_pct,
        min_liquidity=min_liquidity,
        high_liquidity_only=high_liquidity_only,
        market_type=market_type,
        time_range=time_range,
        limit=limit,
        force_refresh=force_refresh,
        region=region or trading_region or None,
        timezone_offset_seconds=timezone_offset_seconds,
    )
    status = str(payload.get("status") or "").strip().lower()
    cache_control = (
        SCAN_TERMINAL_CACHE_CONTROL
        if not force_refresh and status == "ready" and payload.get("stale") is not True
        else NO_STORE_CACHE_CONTROL
    )
    response = JSONResponse(
        content=payload,
        headers={
            "Cache-Control": cache_control,
            "Cloudflare-CDN-Cache-Control": cache_control,
        },
    )
    attach_server_timing_header(response, request, "scan_terminal_server_timing")
    return response


@router.post("/api/scan/terminal/overview")
async def scan_terminal_overview(request: Request):
    return await get_scan_terminal_overview_payload(request)
