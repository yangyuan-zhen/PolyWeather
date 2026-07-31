"""Arbitrage overview HTTP router.

Exposes ``GET /api/arbitrage/overview?city=<display_name>``,
``GET /api/arbitrage/overview-batch?cities=...`` and
``GET /api/arbitrage/cities`` for the terminal ``套利对比`` tab.
Authentication and cache headers mirror ``/api/scan/terminal``.
"""

from __future__ import annotations

import web.routes as legacy_routes
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web.services.arbitrage_service import (
    get_arbitrage_overview,
    get_arbitrage_overview_batch,
    list_arbitrage_cities,
)
from web.services.cache_headers import NO_STORE_CACHE_CONTROL

router = APIRouter(tags=["arbitrage"])


@router.get("/api/arbitrage/overview")
async def arbitrage_overview(
    request: Request,
    city: str,
    force_refresh: bool = False,
) -> JSONResponse:
    legacy_routes._assert_entitlement(request)
    payload = get_arbitrage_overview(
        request,
        city=city,
        force_refresh=force_refresh,
    )
    response = JSONResponse(
        content=payload,
        headers={
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
        },
    )
    return response


@router.get("/api/arbitrage/overview-batch")
async def arbitrage_overview_batch(
    request: Request,
    cities: str,
    force_refresh: bool = False,
    limit: int = 50,
) -> JSONResponse:
    legacy_routes._assert_entitlement(request)
    payload = await get_arbitrage_overview_batch(
        request,
        cities=cities,
        force_refresh=force_refresh,
        limit=limit,
    )
    response = JSONResponse(
        content=payload,
        headers={
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
        },
    )
    return response


@router.get("/api/arbitrage/cities")
async def arbitrage_cities(request: Request) -> JSONResponse:
    legacy_routes._assert_entitlement(request)
    payload = list_arbitrage_cities(request)
    response = JSONResponse(
        content=payload,
        headers={
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
        },
    )
    return response


__all__ = ["router"]
