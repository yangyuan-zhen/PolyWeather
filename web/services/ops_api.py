"""Operations/admin API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager
from web.core import GrantPointsRequest
import web.routes as legacy_routes


def _require_ops(request: Request) -> Dict[str, Any] | None:
    legacy_routes._assert_entitlement(request)
    return legacy_routes._require_ops_admin(request)


def search_ops_users(request: Request, q: str = "", limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    return {"users": db.search_users(q, limit=limit)}


def get_ops_weekly_leaderboard(request: Request, limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    return {"leaderboard": db.get_weekly_leaderboard(limit=limit)}


def list_ops_memberships(request: Request, limit: int = 200) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    if getattr(legacy_routes.PAYMENT_CHECKOUT, "enabled", False):
        try:
            legacy_routes.PAYMENT_CHECKOUT.reconcile_recent_intents(
                limit=min(max(int(limit or 200), 20), 200)
            )
        except Exception:
            pass
    subscriptions = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(limit=limit)
    subscription_user_ids = [str(item.get("user_id") or "") for item in subscriptions]
    user_map = db.get_users_by_supabase_user_ids(subscription_user_ids)
    unresolved_user_ids = [
        user_id
        for user_id in subscription_user_ids
        if str(user_id or "").strip().lower()
        and not str(
            (user_map.get(str(user_id).strip().lower(), {}) or {}).get("supabase_email") or ""
        ).strip()
    ]
    auth_user_map = legacy_routes.SUPABASE_ENTITLEMENT.get_auth_users(unresolved_user_ids)
    deduped: dict[str, dict] = {}
    for item in subscriptions:
        user_id = str(item.get("user_id") or "").strip().lower()
        local_user = user_map.get(user_id, {})
        auth_user = auth_user_map.get(user_id, {})
        subscription_window = legacy_routes.SUPABASE_ENTITLEMENT.get_subscription_window(
            user_id,
            respect_requirement=False,
            bypass_cache=True,
        )
        current_expires_at = item.get("expires_at")
        total_expires_at = (
            subscription_window.get("total_expires_at")
            if isinstance(subscription_window, dict)
            else None
        )
        queued_days = (
            int(subscription_window.get("queued_days") or 0)
            if isinstance(subscription_window, dict)
            else 0
        )
        queued_count = (
            int(subscription_window.get("queued_count") or 0)
            if isinstance(subscription_window, dict)
            else 0
        )
        row = {
            "user_id": user_id,
            "email": str(auth_user.get("email") or local_user.get("supabase_email") or ""),
            "telegram_id": local_user.get("telegram_id"),
            "username": local_user.get("username"),
            "registered_at": local_user.get("created_at") or auth_user.get("created_at"),
            "plan_code": item.get("plan_code"),
            "starts_at": item.get("starts_at"),
            "current_expires_at": current_expires_at,
            "total_expires_at": total_expires_at or current_expires_at,
            "expires_at": total_expires_at or current_expires_at,
            "queued_days": queued_days,
            "queued_count": queued_count,
        }
        existing = deduped.get(user_id)
        existing_expires = str(existing.get("expires_at") or "") if existing else ""
        current_expires = str(row.get("expires_at") or "")
        if existing is None or current_expires > existing_expires:
            deduped[user_id] = row
    rows = sorted(
        deduped.values(),
        key=lambda item: str(item.get("expires_at") or ""),
    )
    return {"memberships": rows}


def list_ops_payment_incidents(
    request: Request,
    limit: int = 50,
    reason: str = "",
    include_resolved: bool = False,
) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    incidents = db.list_payment_audit_events(
        limit=max(1, min(int(limit or 50), 200)),
        event_type="payment_intent_failed",
    )
    normalized_reason = str(reason or "").strip().lower()
    filtered = []
    for item in incidents:
        payload = item.get("payload") if isinstance(item, dict) else {}
        payload = payload if isinstance(payload, dict) else {}
        item_reason = str(payload.get("reason") or "").strip().lower()
        resolved_at = str(payload.get("resolved_at") or "").strip()
        if normalized_reason and item_reason != normalized_reason:
            continue
        if not include_resolved and resolved_at:
            continue
        filtered.append(item)
    return {"incidents": filtered}


def resolve_ops_payment_incident(request: Request, event_id: int) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = DBManager()
    resolved = db.mark_payment_audit_event_resolved(event_id, str(admin.get("email") or ""))
    if not resolved:
        raise HTTPException(status_code=404, detail="payment_incident_not_found")
    return {"ok": True, "incident": resolved}


def grant_ops_points(request: Request, body: GrantPointsRequest) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = DBManager()
    result = db.grant_points_by_supabase_email(body.email, body.points)
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        reason = str(result.get("reason") or "grant_points_failed")
        status_code = 404 if reason == "user_not_found" else 400
        raise HTTPException(status_code=status_code, detail=result)
    return result


def get_ops_analytics_funnel(request: Request, days: int = 30) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    return db.get_app_analytics_funnel_summary(days=days)


def get_ops_truth_history(
    request: Request,
    city: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    _require_ops(request)

    truth_history = legacy_routes.TruthRecordRepository().load_all()
    normalized_city = str(city or "").strip().lower()
    normalized_from = str(date_from or "").strip()
    normalized_to = str(date_to or "").strip()
    max_limit = max(1, min(int(limit or 200), 1000))

    rows = []
    for row_city, by_date in truth_history.items():
        if normalized_city and row_city != normalized_city:
            continue
        if not isinstance(by_date, dict):
            continue
        for target_date, payload in by_date.items():
            if normalized_from and str(target_date) < normalized_from:
                continue
            if normalized_to and str(target_date) > normalized_to:
                continue
            if not isinstance(payload, dict):
                continue
            rows.append(
                {
                    "city": row_city,
                    "display_name": str(
                        (legacy_routes.CITY_REGISTRY.get(row_city) or {}).get("name") or row_city
                    ),
                    "target_date": str(target_date),
                    "actual_high": payload.get("actual_high"),
                    "settlement_source": payload.get("settlement_source"),
                    "settlement_station_code": payload.get("settlement_station_code"),
                    "settlement_station_label": payload.get("settlement_station_label"),
                    "truth_version": payload.get("truth_version"),
                    "updated_by": payload.get("updated_by"),
                    "truth_updated_at": payload.get("truth_updated_at"),
                    "is_final": payload.get("is_final"),
                }
            )

    rows.sort(key=lambda item: (str(item["target_date"]), str(item["city"])), reverse=True)
    filtered_count = len(rows)
    rows = rows[:max_limit]
    available_cities = [
        {
            "city": city_id,
            "name": str(info.get("name") or city_id),
        }
        for city_id, info in sorted(
            legacy_routes.CITY_REGISTRY.items(),
            key=lambda item: str(item[1].get("name") or item[0]),
        )
    ]
    return {
        "items": rows,
        "available_cities": available_cities,
        "filters": {
            "city": normalized_city or None,
            "date_from": normalized_from or None,
            "date_to": normalized_to or None,
            "limit": max_limit,
        },
        "filtered_count": filtered_count,
    }
