"""HTTP middlewares for the PolyWeather FastAPI application."""

import hashlib
import time

from fastapi import Request
from fastapi.responses import Response

from src.utils.metrics import counter_inc, histogram_observe


async def metrics_middleware(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000.0
        counter_inc(
            "polyweather_http_requests_total",
            method=request.method,
            path=request.url.path,
            status="500",
        )
        histogram_observe(
            "polyweather_http_request_duration_ms",
            duration_ms,
            method=request.method,
            path=request.url.path,
            status="500",
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000.0
    status_code = str(response.status_code)
    counter_inc(
        "polyweather_http_requests_total",
        method=request.method,
        path=request.url.path,
        status=status_code,
    )
    histogram_observe(
        "polyweather_http_request_duration_ms",
        duration_ms,
        method=request.method,
        path=request.url.path,
        status=status_code,
    )
    return response


async def etag_middleware(request: Request, call_next):
    """Add ETag to GET /api/* responses; return 304 on If-None-Match hit."""
    response = await call_next(request)

    if request.method != "GET" or response.status_code != 200:
        return response

    path = request.url.path
    if not path.startswith("/api/") or path.endswith("/stream"):
        return response

    body = getattr(response, "body", None) or b""
    if not body:
        return response

    try:
        etag = hashlib.md5(body).hexdigest()
    except Exception:
        return response

    etag_value = f'"{etag}"'
    if_none_match = request.headers.get("If-None-Match", "")
    if if_none_match == etag_value:
        return Response(status_code=304, headers={"ETag": etag_value})

    response.headers["ETag"] = etag_value
    response.headers["Cache-Control"] = "private, max-age=30"
    return response
