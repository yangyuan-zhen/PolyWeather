"""Authentication API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import Request

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
    }
