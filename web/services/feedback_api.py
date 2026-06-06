"""User feedback API service functions."""

from __future__ import annotations

import json
from typing import Any, Dict

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager
from web.core import UserFeedbackRequest
import web.routes as legacy_routes


_ALLOWED_FEEDBACK_CATEGORIES = {
    "bug",
    "data",
    "idea",
    "payment",
    "account",
    "other",
}


def _normalize_category(value: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in _ALLOWED_FEEDBACK_CATEGORIES else "other"


def _bounded_context(context: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(context, dict):
        return {}
    try:
        encoded = json.dumps(context, ensure_ascii=False, default=str)
    except Exception:
        return {"_error": "context_not_serializable"}
    if len(encoded) <= 20_000:
        return json.loads(encoded)
    return {
        "_truncated": True,
        "raw_preview": encoded[:20_000],
    }


def submit_user_feedback(request: Request, body: UserFeedbackRequest) -> Dict[str, Any]:
    legacy_routes._bind_optional_supabase_identity(request)

    message = str(body.message or "").strip()
    if len(message) < 3:
        raise HTTPException(status_code=400, detail="message is required")

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    user_email = str(getattr(request.state, "auth_email", "") or "").strip()
    contact = str(body.contact or "").strip() or user_email

    feedback = DBManager().append_user_feedback(
        category=_normalize_category(body.category),
        message=message,
        source=str(body.source or "terminal").strip().lower() or "terminal",
        contact=contact,
        user_id=user_id,
        user_email=user_email,
        context=_bounded_context(body.context),
    )
    return {"ok": True, "feedback": feedback}


def list_current_user_feedback(request: Request, *, limit: int = 20) -> Dict[str, Any]:
    legacy_routes._bind_optional_supabase_identity(request)

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    user_email = str(getattr(request.state, "auth_email", "") or "").strip()
    if not user_id and not user_email:
        raise HTTPException(status_code=401, detail="Supabase user required")

    rows = DBManager().list_user_feedback(
        limit=limit,
        user_id=user_id,
        user_email=user_email,
    )
    status_counts: Dict[str, int] = {}
    for row in rows:
        key = str(row.get("status") or "unknown")
        status_counts[key] = status_counts.get(key, 0) + 1
    return {
        "feedback": rows,
        "total": len(rows),
        "status_counts": status_counts,
    }
