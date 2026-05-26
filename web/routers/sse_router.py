"""SSE endpoints for live terminal patch delivery."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from web.sse_manager import sse_manager


router = APIRouter(tags=["events"])


@router.get("/api/events")
async def sse_events(request: Request):
    user_id = getattr(request.state, "auth_user_id", None) or "anon"
    return StreamingResponse(
        sse_manager.event_stream(user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/internal/collector-patch")
async def ingest_patch(patch: dict[str, Any]):
    city = str(patch.get("city") or "").strip().lower()
    changes = patch.get("changes")
    if not city:
        raise HTTPException(status_code=400, detail="city is required")
    if not isinstance(changes, dict):
        raise HTTPException(status_code=400, detail="changes must be an object")
    event = sse_manager.broadcast(city, changes)
    return {"ok": True, "revision": event["revision"]}
