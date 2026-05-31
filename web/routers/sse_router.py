"""SSE endpoints for live terminal patch delivery."""

from __future__ import annotations

import time
import threading
from typing import Any, Optional, Set

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from web.realtime_event_store import MAX_REPLAY_LIMIT
from web.realtime_event_store_factory import create_realtime_event_store
from web.realtime_patch_schema import PatchValidationError, normalize_observation_patch
from web.sse_manager import sse_manager


router = APIRouter(tags=["events"])
event_store = create_realtime_event_store()
_live_subscription_lock = threading.Lock()
_live_subscription_started = False
SSE_REPLAY_BASE_LIMIT = 60
SSE_REPLAY_EVENTS_PER_CITY = 24
SSE_REPLAY_MAX_LIMIT = 240
SSE_REPLAY_DIRECT_RESYNC_FACTOR = 3


def _parse_cities_param(cities: str) -> Set[str]:
    return {
        item.strip().lower()
        for item in str(cities or "").split(",")
        if item.strip()
    }


def _recommended_replay_limit(city_count: int) -> int:
    requested = max(1, int(city_count or 0)) * SSE_REPLAY_EVENTS_PER_CITY
    return max(SSE_REPLAY_BASE_LIMIT, min(SSE_REPLAY_MAX_LIMIT, requested))


def _bounded_replay_limit(value: int, *, city_count: int = 0) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        limit = _recommended_replay_limit(city_count)
    route_limit = _recommended_replay_limit(city_count)
    return max(1, min(MAX_REPLAY_LIMIT, route_limit, limit))


def _should_direct_resync(
    *,
    since_revision: int,
    latest_revision: int,
    limit: int,
) -> bool:
    since = max(0, int(since_revision or 0))
    latest = max(0, int(latest_revision or 0))
    if since <= 0 or latest <= since:
        return False
    gap = latest - since
    threshold = max(SSE_REPLAY_MAX_LIMIT, max(1, int(limit or 1)) * SSE_REPLAY_DIRECT_RESYNC_FACTOR)
    return gap > threshold


def _ensure_live_subscription() -> None:
    starter = getattr(event_store, "start_live_subscription", None)
    if not callable(starter):
        return
    global _live_subscription_started
    with _live_subscription_lock:
        if _live_subscription_started:
            return
        starter(sse_manager.broadcast_event)
        _live_subscription_started = True


@router.options("/api/events")
async def sse_events_preflight(request: Request):
    return {"ok": True}


@router.get("/api/events")
async def sse_events(
    request: Request,
    cities: str = "",
    since_revision: Optional[int] = Query(default=None),
    replay_limit: int = Query(default=500),
):
    user_id = getattr(request.state, "auth_user_id", None) or "anon"
    origin = request.headers.get("origin", "")
    allowed = origin in {"https://polyweather.top", "https://www.polyweather.top", "http://localhost:3000"}
    city_set = _parse_cities_param(cities)
    limit = _bounded_replay_limit(replay_limit, city_count=len(city_set))
    _ensure_live_subscription()
    latest_revision = event_store.latest_revision()
    replay_events = []
    resync_event = None

    if since_revision is not None:
        try:
            since = max(0, int(since_revision))
            if _should_direct_resync(
                since_revision=since,
                latest_revision=latest_revision,
                limit=limit,
            ):
                resync_event = {
                    "type": "resync_required",
                    "reason": "replay_gap_too_large",
                    "latest_revision": latest_revision,
                    "ts": int(time.time() * 1000),
                }
            else:
                replay_events = event_store.replay_events(
                    cities=city_set,
                    since_revision=since,
                    limit=limit,
                )
                if event_store.replay_requires_resync(
                    cities=city_set,
                    since_revision=since,
                    replay_count=len(replay_events),
                    limit=limit,
                ):
                    resync_event = {
                        "type": "resync_required",
                        "reason": "replay_window_exceeded",
                        "latest_revision": latest_revision,
                        "ts": int(time.time() * 1000),
                    }
        except Exception:
            resync_event = {
                "type": "resync_required",
                "reason": "replay_failed",
                "latest_revision": latest_revision,
                "ts": int(time.time() * 1000),
            }

    return StreamingResponse(
        sse_manager.event_stream(
            user_id,
            cities=city_set,
            replay_events=replay_events,
            connected_revision=latest_revision,
            resync_event=resync_event,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin if allowed else "https://polyweather.top",
            "Access-Control-Allow-Credentials": "true",
        },
    )


@router.post("/api/internal/collector-patch")
async def ingest_patch(patch: dict[str, Any]):
    try:
        normalized = normalize_observation_patch(patch)
    except PatchValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _ensure_live_subscription()

    try:
        event = event_store.append_event(normalized)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="event log write failed") from exc

    if not bool(getattr(event_store, "uses_external_live_fanout", False)):
        sse_manager.broadcast_event(event)
    return {"ok": True, "revision": event["revision"]}
