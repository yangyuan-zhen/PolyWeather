"""System and observability API routes for PolyWeather."""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import PlainTextResponse

from web.services.dashboard_init_api import build_dashboard_init_payload
from web.services.system_api import (
    get_health_payload,
    get_prometheus_metrics_response,
    get_system_cache_status,
    get_system_status_payload,
    run_system_priority_warm,
)

router = APIRouter(tags=["system"])


@router.get("/healthz")
async def healthz():
    return get_health_payload()


@router.get("/api/system/status")
async def system_status(request: Request):
    return await get_system_status_payload(request)


@router.get("/api/system/cache-status")
async def system_cache_status(request: Request, cities: Optional[str] = None):
    return get_system_cache_status(request, cities=cities)


@router.post("/api/system/priority-warm")
async def system_priority_warm(
    request: Request,
    background_tasks: BackgroundTasks,
    timezone: Optional[str] = None,
):
    return run_system_priority_warm(request, background_tasks, timezone=timezone)


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics(request: Request):
    return get_prometheus_metrics_response(request)


@router.get("/api/dashboard/init")
async def dashboard_init(request: Request):
    return await build_dashboard_init_payload(request)
