"""SSE endpoints for live terminal patch delivery."""

from __future__ import annotations

import time
from typing import Any, Optional, Set

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from web.realtime_event_store import RealtimeEventStore, MAX_REPLAY_LIMIT
from web.realtime_patch_schema import PatchValidationError, normalize_observation_patch
from web.sse_manager import sse_manager


router = APIRouter(tags=["events"])
event_store = RealtimeEventStore()


def _parse_cities_param(cities: str) -> Set[str]:
    return {
        item.strip().lower()
        for item in str(cities or "").split(",")
        if item.strip()
    }


def _bounded_replay_limit(value: int) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        limit = 500
    return max(1, min(MAX_REPLAY_LIMIT, limit))


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
    limit = _bounded_replay_limit(replay_limit)
    latest_revision = event_store.latest_revision()
    replay_events = []
    resync_event = None

    if since_revision is not None:
        try:
            replay_events = event_store.replay_events(
                cities=city_set,
                since_revision=max(0, int(since_revision)),
                limit=limit,
            )
            if event_store.replay_requires_resync(
                cities=city_set,
                since_revision=max(0, int(since_revision)),
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

    try:
        event = event_store.append_event(normalized)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="event log write failed") from exc

    sse_manager.broadcast_event(event)
    return {"ok": True, "revision": event["revision"]}
