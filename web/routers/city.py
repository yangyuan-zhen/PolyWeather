"""City and city-analysis API routes."""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Request

from web.services.city_api import (
    get_city_detail_aggregate_payload,
    get_city_detail_payload,
    get_city_history_payload,
    get_city_market_scan_payload,
    get_city_summary_payload,
    list_cities_payload,
)

router = APIRouter(tags=["city"])


@router.get("/api/cities")
async def list_cities(request: Request):
    return await list_cities_payload(request)


@router.get("/api/city/{name}")
async def city_detail(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
    depth: str = "panel",
):
    return await get_city_detail_payload(
        request,
        name,
        force_refresh=force_refresh,
        depth=depth,
    )


@router.get("/api/history/{name}")
async def city_history(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    include_records: bool = False,
):
    return await get_city_history_payload(
        request,
        name,
        include_records=include_records,
    )


@router.get("/api/city/{name}/summary")
async def city_summary(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
):
    return await get_city_summary_payload(
        request,
        name,
        force_refresh=force_refresh,
    )


@router.get("/api/city/{name}/detail")
async def city_detail_aggregate(
    request: Request,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
):
    return await get_city_detail_aggregate_payload(
        request,
        name,
        force_refresh=force_refresh,
        market_slug=market_slug,
        target_date=target_date,
    )


@router.get("/api/city/{name}/market-scan")
async def city_market_scan(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    force_refresh: bool = False,
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
):
    return await get_city_market_scan_payload(
        request,
        background_tasks,
        name,
        force_refresh=force_refresh,
        market_slug=market_slug,
        target_date=target_date,
        lite=lite,
    )
