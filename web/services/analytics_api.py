"""Analytics API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager
from web.core import AnalyticsEventRequest
import web.routes as legacy_routes


def track_analytics_event(request: Request, body: AnalyticsEventRequest) -> Dict[str, Any]:
    legacy_routes._bind_optional_supabase_identity(request)
    event_type = str(body.event_type or "").strip().lower()
    if event_type not in legacy_routes.TRACKABLE_ANALYTICS_EVENTS:
        raise HTTPException(status_code=400, detail="unsupported_event_type")

    payload = body.payload if isinstance(body.payload, dict) else {}
    normalized_payload = {
        key: value
        for key, value in payload.items()
        if isinstance(key, str) and len(key) <= 64
    }

    db = DBManager()
    db.append_app_analytics_event(
        event_type,
        normalized_payload,
        user_id=getattr(request.state, "auth_user_id", None),
        client_id=body.client_id,
        session_id=body.session_id,
    )
    return {"ok": True}
