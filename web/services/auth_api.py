"""Authentication API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request

from src.auth.telegram_group_pricing import TelegramGroupPricing
from src.database.db_manager import DBManager
from web.core import TelegramLoginRequest
import web.routes as legacy_routes


def get_auth_me_payload(request: Request) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    legacy_routes._bind_optional_supabase_identity(request)

    user_id = getattr(request.state, "auth_user_id", None)
    subscription_required = bool(
        legacy_routes.SUPABASE_ENTITLEMENT.enabled
        and legacy_routes.SUPABASE_ENTITLEMENT.require_subscription
    )
    subscription_active = None
    subscription_plan_code = None
    subscription_starts_at = None
    subscription_expires_at = None
    subscription_total_expires_at = None
    subscription_queued_days = 0
    subscription_queued_count = 0

    if legacy_routes.SUPABASE_ENTITLEMENT.enabled and user_id:
        try:
            latest_subscription = legacy_routes.SUPABASE_ENTITLEMENT.ensure_signup_trial(
                user_id,
                created_at=getattr(request.state, "auth_created_at", None),
            )
            if not latest_subscription:
                latest_subscription = (
                    legacy_routes.SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                        user_id,
                        respect_requirement=False,
                    )
                )

            latest_known_subscription = latest_subscription
            if not latest_known_subscription:
                latest_known_subscription = (
                    legacy_routes.SUPABASE_ENTITLEMENT.get_latest_subscription_any_status(
                        user_id
                    )
                )
            subscription_window = legacy_routes.SUPABASE_ENTITLEMENT.get_subscription_window(
                user_id,
                respect_requirement=False,
            )
            subscription_active = bool(latest_subscription)
            if isinstance(latest_subscription, dict):
                subscription_plan_code = latest_subscription.get("plan_code")
                subscription_starts_at = latest_subscription.get("starts_at")
                subscription_expires_at = latest_subscription.get("expires_at")
            elif isinstance(latest_known_subscription, dict):
                subscription_plan_code = latest_known_subscription.get("plan_code")
                subscription_starts_at = latest_known_subscription.get("starts_at")
                subscription_expires_at = latest_known_subscription.get("expires_at")
            if isinstance(subscription_window, dict):
                subscription_total_expires_at = subscription_window.get("total_expires_at")
                subscription_queued_days = int(subscription_window.get("queued_days") or 0)
                subscription_queued_count = int(subscription_window.get("queued_count") or 0)
        except Exception:
            subscription_active = None
            subscription_plan_code = None
            subscription_starts_at = None
            subscription_expires_at = None
            subscription_total_expires_at = None
            subscription_queued_days = 0
            subscription_queued_count = 0

    points = legacy_routes._resolve_auth_points(request)
    weekly_profile = legacy_routes._resolve_weekly_profile(request)
    telegram_pricing = None
    if user_id:
        try:
            pricing = TelegramGroupPricing()
            if pricing.configured:
                linked = DBManager().get_user_by_supabase_user_id(user_id)
                telegram_id = (
                    int(linked.get("telegram_id") or 0)
                    if isinstance(linked, dict)
                    else 0
                )
                telegram_pricing = pricing.resolve_price_for_telegram_id(
                    telegram_id or None
                )
        except Exception:
            telegram_pricing = None

    return {
        "authenticated": bool(user_id),
        "user_id": user_id,
        "email": getattr(request.state, "auth_email", None),
        "points": points,
        "weekly_points": weekly_profile["weekly_points"],
        "weekly_rank": weekly_profile["weekly_rank"],
        "entitlement_mode": (
            "supabase_required"
            if legacy_routes.SUPABASE_ENTITLEMENT.enabled
            and legacy_routes._SUPABASE_AUTH_REQUIRED
            else "supabase_optional"
            if legacy_routes.SUPABASE_ENTITLEMENT.enabled
            else "legacy_token"
            if legacy_routes._ENTITLEMENT_GUARD_ENABLED
            else "disabled"
        ),
        "auth_required": bool(
            legacy_routes.SUPABASE_ENTITLEMENT.enabled
            and legacy_routes._SUPABASE_AUTH_REQUIRED
        ),
        "subscription_required": subscription_required,
        "subscription_active": subscription_active,
        "subscription_plan_code": subscription_plan_code,
        "subscription_starts_at": subscription_starts_at,
        "subscription_expires_at": subscription_expires_at,
        "subscription_total_expires_at": subscription_total_expires_at,
        "subscription_queued_days": subscription_queued_days,
        "subscription_queued_count": subscription_queued_count,
        "telegram_pricing": telegram_pricing,
    }


def login_with_telegram(request: Request, body: TelegramLoginRequest) -> Dict[str, Any]:
    legacy_routes._assert_entitlement(request)
    identity = legacy_routes._require_supabase_identity(request)
    pricing = TelegramGroupPricing()
    if not pricing.configured:
        raise HTTPException(status_code=503, detail="telegram login is not configured")
    try:
        payload = body.model_dump() if hasattr(body, "model_dump") else body.dict()
        verified = pricing.verify_login_payload(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    telegram_id = int(verified["telegram_id"])
    username = str(verified.get("username") or "").strip()
    db = DBManager()
    db.upsert_user(telegram_id, username)
    bind_result = db.bind_supabase_identity(
        telegram_id=telegram_id,
        supabase_user_id=identity["user_id"],
        supabase_email=identity.get("email") or "",
    )
    if not bind_result.get("ok"):
        raise HTTPException(status_code=409, detail=str(bind_result.get("reason") or "telegram bind failed"))
    price = pricing.resolve_price_for_telegram_id(telegram_id)
    return {
        "ok": True,
        "telegram": verified,
        "binding": bind_result,
        "telegram_pricing": price,
    }


def bind_telegram_by_token(request: Request, body) -> Dict[str, Any]:
    """Bind Telegram identity using a one-time token from the bot /bind command."""
    legacy_routes._assert_entitlement(request)
    identity = legacy_routes._require_supabase_identity(request)

    token = str(getattr(body, "token", "") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="bind_token is required")

    db = DBManager()
    telegram_id = db.consume_bind_token(token)
    if telegram_id is None:
        raise HTTPException(status_code=400, detail="invalid or expired bind token")

    pricing = TelegramGroupPricing()
    member_status = pricing.get_member_status(telegram_id) if pricing.configured else None
    if not member_status or member_status not in ("creator", "administrator", "member"):
        raise HTTPException(status_code=403, detail="not a group member")

    db.upsert_user(telegram_id, "")
    bind_result = db.bind_supabase_identity(
        telegram_id=telegram_id,
        supabase_user_id=identity["user_id"],
        supabase_email=identity.get("email") or "",
    )
    if not bind_result.get("ok"):
        raise HTTPException(
            status_code=409,
            detail=str(bind_result.get("reason") or "telegram bind failed"),
        )

    price = pricing.resolve_price_for_telegram_id(telegram_id)
    return {
        "ok": True,
        "telegram_id": telegram_id,
        "binding": bind_result,
        "telegram_pricing": price,
    }
