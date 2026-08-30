"""Market scan and scan AI API routes."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web.services.cache_headers import NO_STORE_CACHE_CONTROL
from web.services.scan_api import (
    get_scan_terminal_overview_payload,
    get_scan_terminal_payload,
)
from web.services.request_timing import attach_server_timing_header

router = APIRouter(tags=["scan"])

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
    diff: bool = False,
    since_snapshot_id: str | None = None,
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
        diff=diff,
        since_snapshot_id=since_snapshot_id,
        region=region or trading_region or None,
        timezone_offset_seconds=timezone_offset_seconds,
    )
    response = JSONResponse(
        content=payload,
        headers={
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
        },
    )
    attach_server_timing_header(response, request, "scan_terminal_server_timing")
    return response


@router.post("/api/scan/terminal/overview")
async def scan_terminal_overview(request: Request):
    return await get_scan_terminal_overview_payload(request)
