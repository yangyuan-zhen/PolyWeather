"""Ops users / feedback / points / analytics service functions."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException, Request


from web.core import GrantPointsRequest
import web.routes as legacy_routes


def _get_db():
    from web.services.ops_api import DBManager
    return DBManager()

# _require_ops is a lightweight auth guard duplicated in each ops submodule
# to avoid circular imports with the ops_api re-export hub.
def _require_ops(request: Request):
    from web.services.ops_api import _require_ops as _real
    return _real(request)


# ═══════════════════════════════════════════════════════════════════════
#  Internal helpers
# ═══════════════════════════════════════════════════════════════════════

def _sf(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_metric(value: Optional[float], digits: int = 1) -> Optional[float]:
    return None if value is None else round(float(value), digits)


def _app_analytics_actor_key(row: Dict[str, Any]) -> str:
    payload = row.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    user_id = str(row.get("user_id") or payload.get("user_id") or "").strip().lower()
    client_id = str(row.get("client_id") or "").strip()
    session_id = str(row.get("session_id") or "").strip()
    if user_id:
        return f"user:{user_id}"
    if client_id:
        return f"client:{client_id}"
    if session_id:
        return f"session:{session_id}"
    return f"event:{row.get('id')}"


# ═══════════════════════════════════════════════════════════════════════
#  Users
# ═══════════════════════════════════════════════════════════════════════

def search_ops_users(request: Request, q: str = "", limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    return {"users": db.search_users(q, limit=limit)}


def get_ops_weekly_leaderboard(request: Request, limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    return {"leaderboard": db.get_weekly_leaderboard(limit=limit)}


# ═══════════════════════════════════════════════════════════════════════
#  Points
# ═══════════════════════════════════════════════════════════════════════

def grant_ops_points(request: Request, body: GrantPointsRequest) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = _get_db()
    result = db.grant_points_by_supabase_email(body.email, body.points)
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        reason = str(result.get("reason") or "grant_points_failed")
        status_code = 404 if reason == "user_not_found" else 400
        raise HTTPException(status_code=status_code, detail=result)
    return result


def transfer_ops_points(
    request: Request,
    from_email: str = "",
    to_email: str = "",
    amount: int = 0,
) -> Dict[str, Any]:
    """Transfer points from one user to another."""
    admin = _require_ops(request) or {}
    from_email = str(from_email or "").strip()
    to_email = str(to_email or "").strip()
    amount = int(amount or 0)
    if not from_email or not to_email:
        raise HTTPException(
            status_code=400, detail="from_email and to_email are required"
        )
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")
    db = _get_db()
    result = db.transfer_points_by_email(from_email, to_email, amount)
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


# ═══════════════════════════════════════════════════════════════════════
#  Analytics
# ═══════════════════════════════════════════════════════════════════════

def get_ops_analytics_funnel(request: Request, days: int = 30) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    return db.get_app_analytics_funnel_summary(days=days)


# ═══════════════════════════════════════════════════════════════════════
#  Feedback
# ═══════════════════════════════════════════════════════════════════════

def list_ops_feedback(
    request: Request,
    *,
    limit: int = 100,
    status: str = "",
) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    rows = db.list_user_feedback(limit=limit, status=status or None)
    status_counts: Dict[str, int] = {}
    recent_rows = db.list_user_feedback(limit=500)
    for row in recent_rows:
        key = str(row.get("status") or "unknown")
        status_counts[key] = status_counts.get(key, 0) + 1
    return {
        "feedback": rows,
        "total": len(rows),
        "status_counts": status_counts,
    }


def update_ops_feedback_status(
    request: Request,
    *,
    feedback_id: int,
    status: str,
) -> Dict[str, Any]:
    _require_ops(request)
    normalized = str(status or "").strip().lower()
    allowed = {"open", "triaged", "investigating", "resolved", "closed"}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="unsupported feedback status")
    updated = _get_db().update_user_feedback_status(feedback_id, status=normalized)
    if not updated:
        raise HTTPException(status_code=404, detail="feedback not found")
    return {"ok": True, "feedback": updated}


def grant_ops_feedback_reward(
    request: Request,
    *,
    feedback_id: int,
    points: int,
    reason: str = "",
) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = _get_db()
    result = db.grant_feedback_reward(
        feedback_id,
        points=points,
        reason=reason,
    )
    if not result.get("ok") and str(result.get("reason") or "") == "user_not_found":
        feedback = result.get("feedback") if isinstance(result.get("feedback"), dict) else {}
        reward_status = str(feedback.get("reward_status") or "").strip().lower()
        reward_points = int(feedback.get("reward_points") or 0)
        supabase_user_id = str(feedback.get("user_id") or "").strip().lower()
        if supabase_user_id and not (reward_status == "granted" and reward_points > 0):
            try:
                fallback = legacy_routes.SUPABASE_ENTITLEMENT.grant_points_to_user(
                    supabase_user_id,
                    points,
                )
            except Exception as exc:
                fallback = {"ok": False, "reason": f"supabase_points_grant_failed:{exc}"}
            if fallback.get("ok"):
                updated_feedback = db.update_user_feedback_reward(
                    feedback_id,
                    points=points,
                    reason=reason,
                    status="granted",
                )
                result = {
                    **fallback,
                    "ok": True,
                    "feedback_id": int(feedback_id),
                    "supabase_user_id": supabase_user_id,
                    "feedback": updated_feedback,
                }
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        reason_code = str(result.get("reason") or "feedback_reward_failed")
        status_code = 404 if reason_code in {"feedback_not_found", "user_not_found"} else 400
        if reason_code == "already_rewarded":
            status_code = 409
        raise HTTPException(status_code=status_code, detail=result)
    return result
