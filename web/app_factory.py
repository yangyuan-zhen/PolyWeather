"""Application assembly for the PolyWeather FastAPI backend.

This module centralizes router registration while preserving the existing
``web.core.app`` singleton and middleware setup during the transition toward a
more modular backend structure.
"""

import os

from fastapi import FastAPI

from web.core import app as core_app
from web.routers.analytics import router as analytics_router
from web.routers.city import router as city_router
from web.routers.auth import router as auth_router
from web.routers.ops import router as ops_router
from web.routers.payments import router as payments_router
from web.routers.scan import router as scan_router
from web.routers.system import router as system_router
from web.routes import router as legacy_router
from web.scan_terminal_service import start_scan_terminal_prewarm

_ROUTES_REGISTERED_FLAG = "_polyweather_routes_registered"


def _scan_terminal_prewarm_enabled() -> bool:
    return str(
        os.getenv("POLYWEATHER_SCAN_TERMINAL_PREWARM_ENABLED") or "false"
    ).strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> FastAPI:
    """Return the configured FastAPI app with routers registered once."""
    if not bool(getattr(core_app.state, _ROUTES_REGISTERED_FLAG, False)):
        core_app.include_router(system_router)
        core_app.include_router(city_router)
        core_app.include_router(auth_router)
        core_app.include_router(analytics_router)
        core_app.include_router(scan_router)
        core_app.include_router(payments_router)
        core_app.include_router(ops_router)
        core_app.include_router(legacy_router)
        setattr(core_app.state, _ROUTES_REGISTERED_FLAG, True)
        if _scan_terminal_prewarm_enabled():
            start_scan_terminal_prewarm()
    return core_app
