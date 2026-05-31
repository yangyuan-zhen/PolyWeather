"""Market scan API service functions."""

from __future__ import annotations

from inspect import Parameter, signature
from typing import Any, Dict

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import web.routes as legacy_routes
from web.services.request_timing import ServerTimingRecorder


def _supports_timing_recorder(func: Any) -> bool:
    try:
        params = signature(func).parameters.values()
    except (TypeError, ValueError):
        return True
    return any(
        param.name == "timing_recorder" or param.kind == Parameter.VAR_KEYWORD
        for param in params
    )


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
    timer = ServerTimingRecorder(
        request,
        log_name="scan_terminal_timing",
        prefix="scan_terminal",
        state_attr="scan_terminal_server_timing",
    )
    outcome = "ok"
    status_code = 200
    try:
        timer.measure("assert_entitlement", lambda: legacy_routes._assert_entitlement(request))
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
        async def build_payload():
            builder = legacy_routes.build_scan_terminal_payload
            kwargs: Dict[str, Any] = {"force_refresh": force_refresh}
            if _supports_timing_recorder(builder):
                kwargs["timing_recorder"] = timer
            return await run_in_threadpool(builder, filters, **kwargs)

        return await timer.measure_async("build_payload", build_payload)
    except HTTPException as exc:
        outcome = f"http_{exc.status_code}"
        status_code = exc.status_code
        raise
    except Exception:
        outcome = "exception"
        status_code = 500
        raise
    finally:
        timer.finish(outcome=outcome, status_code=status_code)


async def get_scan_terminal_overview_payload(request: Request) -> Dict[str, Any]:
    return {"overview": [], "available": False}
