"""Market scan and scan AI API routes."""

from __future__ import annotations

from fastapi import APIRouter, Request

from web.services.scan_api import (
    get_scan_city_ai_forecast_payload,
    get_scan_city_ai_stream_response,
    get_scan_terminal_ai_payload,
    get_scan_terminal_overview_payload,
    get_scan_terminal_payload,
)

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
    region: str = "",
    trading_region: str = "",
    skip_polymarket: bool = False,
    timezone_offset_seconds: int | None = None,
):
    return await get_scan_terminal_payload(
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
        skip_polymarket=skip_polymarket,
        timezone_offset_seconds=timezone_offset_seconds,
    )


@router.post("/api/scan/terminal/ai")
async def scan_terminal_ai(request: Request):
    return await get_scan_terminal_ai_payload(request)


@router.post("/api/scan/terminal/ai-city")
async def scan_terminal_ai_city(request: Request):
    return await get_scan_city_ai_forecast_payload(request)


@router.post("/api/scan/terminal/ai-city/stream")
async def scan_terminal_ai_city_stream(request: Request):
    return await get_scan_city_ai_stream_response(request)


@router.post("/api/scan/terminal/overview")
async def scan_terminal_overview(request: Request):
    return await get_scan_terminal_overview_payload(request)
