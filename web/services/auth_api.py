"""Authentication API service functions."""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, Optional, TypeVar

from fastapi import HTTPException, Request
from loguru import logger

from src.auth.telegram_group_pricing import TelegramGroupPricing
from src.database.db_manager import DBManager
from web.core import ReferralApplyRequest, TelegramLoginRequest
import web.routes as legacy_routes


T = TypeVar("T")


class _AuthMeTimer:
    def __init__(self, request: Request):
        self.request = request
        self.started = time.perf_counter()
        self.timings_ms: Dict[str, float] = {}

    def measure(self, stage: str, action: Callable[[], T]) -> T:
        started = time.perf_counter()
        try:
            return action()
        finally:
            self.timings_ms[stage] = round(
                (time.perf_counter() - started) * 1000.0,
                1,
            )

    def finish(
        self,
        *,
        authenticated: Optional[bool],
        outcome: str,
        status_code: int,
        subscription_active: Optional[bool],
    ) -> None:
        self.timings_ms["total"] = round(
            (time.perf_counter() - self.started) * 1000.0,
            1,
        )
        server_timing = ", ".join(
            f"backend_{stage};dur={max(0.0, duration):.1f}"
            for stage, duration in self.timings_ms.items()
        )
        self.request.state.auth_me_server_timing = server_timing
        _log_auth_me_timing(
            authenticated=authenticated,
            outcome=outcome,
            status_code=status_code,
            subscription_active=subscription_active,
            timings_ms=self.timings_ms,
        )


def _log_auth_me_timing(
    *,
    authenticated: Optional[bool],
    outcome: str,
    status_code: int,
    subscription_active: Optional[bool],
    timings_ms: Dict[str, float],
) -> None:
    logger.info(
        "auth_me_timing outcome={} status_code={} authenticated={} "
        "subscription_active={} timings_ms={}",
        outcome,
        status_code,
        authenticated,
        subscription_active,
        timings_ms,
    )


def _require_auth_identity_without_subscription_gate(request: Request) -> Dict[str, str]:
    request.state.skip_subscription_gate = True
    legacy_routes._assert_entitlement(request)
    return legacy_routes._require_supabase_identity(request)


def _subscription_row_is_trial(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    plan_code = str(row.get("plan_code") or "").strip().lower()
    source = str(row.get("source") or "").strip().lower()
    return "trial" in plan_code or "trial" in source


def get_auth_me_payload(request: Request) -> Dict[str, Any]:
    timer = _AuthMeTimer(request)
    authenticated_for_log: Optional[bool] = None
    outcome = "ok"
    status_code = 200
    subscription_active_for_log: Optional[bool] = None

    try:
        request.state.skip_subscription_gate = True
        timer.measure("assert_entitlement", lambda: legacy_routes._assert_entitlement(request))
        if not str(getattr(request.state, "auth_user_id", "") or "").strip():
            timer.measure(
                "bind_identity",
                lambda: legacy_routes._bind_optional_supabase_identity(request),
            )

        user_id = getattr(request.state, "auth_user_id", None)
        email = getattr(request.state, "auth_email", None)
        authenticated_for_log = bool(user_id)
        subscription_required = bool(
            legacy_routes.SUPABASE_ENTITLEMENT.enabled
            and legacy_routes.SUPABASE_ENTITLEMENT.require_subscription
        )
        subscription_active = None
        subscription_plan_code = None
        subscription_source = None
        subscription_is_trial = False
        subscription_starts_at = None
        subscription_expires_at = None
        subscription_total_expires_at = None
        subscription_queued_days = 0
        subscription_queued_count = 0
        referral = None

        if legacy_routes.SUPABASE_ENTITLEMENT.enabled and user_id:
            try:
                timer.measure(
                    "ensure_signup_trial",
                    lambda: legacy_routes.SUPABASE_ENTITLEMENT.ensure_signup_trial(
                        user_id,
                        email,
                    ),
                )
                try:
                    subscription_window = timer.measure(
                        "subscription_window",
                        lambda: legacy_routes.SUPABASE_ENTITLEMENT.get_subscription_window(
                            user_id,
                            respect_requirement=False,
                            bypass_cache=True,
                            unknown_on_error=True,
                        ),
                    )
                except TypeError:
                    subscription_window = timer.measure(
                        "subscription_window",
                        lambda: legacy_routes.SUPABASE_ENTITLEMENT.get_subscription_window(
                            user_id,
                            respect_requirement=False,
                        ),
                    )
                latest_subscription = None
                latest_known_subscription = None
                subscription_window_unknown = (
                    isinstance(subscription_window, dict)
                    and subscription_window.get("unknown") is True
                )
                subscription_window_known = (
                    isinstance(subscription_window, dict)
                    and not subscription_window_unknown
                )
                if subscription_window_known:
                    current_subscription = subscription_window.get("current")
                    if isinstance(current_subscription, dict):
                        latest_subscription = current_subscription
                    rows = subscription_window.get("rows")
                    if not latest_subscription and isinstance(rows, list):
                        latest_known_subscription = next(
                            (row for row in rows if isinstance(row, dict)),
                            None,
                        )
                if (
                    not latest_subscription
                    and not latest_known_subscription
                    and not subscription_window_unknown
                    and not subscription_window_known
                    and not subscription_required
                ):
                    latest_subscription = timer.measure(
                        "latest_active_subscription",
                        lambda: legacy_routes.SUPABASE_ENTITLEMENT.get_latest_active_subscription(
                            user_id,
                            respect_requirement=False,
                        ),
                    )

                subscription_active = (
                    None if subscription_window_unknown else bool(latest_subscription)
                )
                subscription_active_for_log = subscription_active
                if subscription_required and subscription_active is False:
                    raise HTTPException(status_code=403, detail="Subscription required")

                if not subscription_window_unknown and not latest_known_subscription:
                    latest_known_subscription = latest_subscription
                if not subscription_window_unknown and not latest_known_subscription:
                    latest_known_subscription = timer.measure(
                        "latest_subscription_history",
                        lambda: legacy_routes.SUPABASE_ENTITLEMENT.get_latest_subscription_any_status(
                            user_id
                        ),
                    )
                if isinstance(latest_subscription, dict):
                    subscription_plan_code = latest_subscription.get("plan_code")
                    subscription_source = latest_subscription.get("source")
                    subscription_is_trial = _subscription_row_is_trial(
                        latest_subscription
                    )
                    subscription_starts_at = latest_subscription.get("starts_at")
                    subscription_expires_at = latest_subscription.get("expires_at")
                elif isinstance(latest_known_subscription, dict):
                    subscription_plan_code = latest_known_subscription.get("plan_code")
                    subscription_source = latest_known_subscription.get("source")
                    subscription_is_trial = _subscription_row_is_trial(
                        latest_known_subscription
                    )
                    subscription_starts_at = latest_known_subscription.get("starts_at")
                    subscription_expires_at = latest_known_subscription.get("expires_at")
                if subscription_window_known:
                    subscription_total_expires_at = subscription_window.get(
                        "total_expires_at"
                    )
                    subscription_queued_days = int(
                        subscription_window.get("queued_days") or 0
                    )
                    subscription_queued_count = int(
                        subscription_window.get("queued_count") or 0
                    )
                referral = timer.measure(
                    "referral_summary",
                    lambda: legacy_routes.SUPABASE_ENTITLEMENT.get_referral_summary(
                        user_id
                    ),
                )
            except HTTPException:
                raise
            except Exception:
                if subscription_required:
                    raise HTTPException(status_code=403, detail="Subscription required")
                subscription_active = None
                subscription_active_for_log = None
                subscription_plan_code = None
                subscription_source = None
                subscription_is_trial = False
                subscription_starts_at = None
                subscription_expires_at = None
                subscription_total_expires_at = None
                subscription_queued_days = 0
                subscription_queued_count = 0
                referral = None

        points = timer.measure(
            "auth_points",
            lambda: legacy_routes._resolve_auth_points(request),
        )
        weekly_profile = timer.measure(
            "weekly_profile",
            lambda: legacy_routes._resolve_weekly_profile(request),
        )

        def resolve_telegram_pricing() -> Any:
            if not user_id:
                return None
            pricing = TelegramGroupPricing()
            if not pricing.configured:
                return None
            linked = DBManager().get_user_by_supabase_user_id(user_id)
            telegram_id = (
                int(linked.get("telegram_id") or 0) if isinstance(linked, dict) else 0
            )
            return pricing.resolve_price_for_telegram_id(telegram_id or None)

        telegram_pricing = None
        if user_id:
            try:
                telegram_pricing = timer.measure(
                    "telegram_pricing",
                    resolve_telegram_pricing,
                )
            except Exception:
                telegram_pricing = None

        payload = {
            "authenticated": bool(user_id),
            "user_id": user_id,
            "email": email,
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
            "subscription_source": subscription_source,
            "subscription_is_trial": subscription_is_trial,
            "subscription_starts_at": subscription_starts_at,
            "subscription_expires_at": subscription_expires_at,
            "subscription_total_expires_at": subscription_total_expires_at,
            "subscription_queued_days": subscription_queued_days,
            "subscription_queued_count": subscription_queued_count,
            "telegram_pricing": telegram_pricing,
            "referral": referral,
        }
        authenticated_for_log = bool(payload["authenticated"])
        subscription_active_for_log = (
            payload["subscription_active"]
            if isinstance(payload["subscription_active"], bool)
            else None
        )
        return payload
    except HTTPException as exc:
        outcome = f"http_{exc.status_code}"
        status_code = exc.status_code
        raise
    except Exception:
        outcome = "exception"
        status_code = 500
        raise
    finally:
        timer.finish(
            authenticated=authenticated_for_log,
            outcome=outcome,
            status_code=status_code,
            subscription_active=subscription_active_for_log,
        )


def apply_referral_code(request: Request, body: ReferralApplyRequest) -> Dict[str, Any]:
    identity = _require_auth_identity_without_subscription_gate(request)
    try:
        return legacy_routes.SUPABASE_ENTITLEMENT.apply_referral_code(
            identity["user_id"],
            body.code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def login_with_telegram(request: Request, body: TelegramLoginRequest) -> Dict[str, Any]:
    identity = _require_auth_identity_without_subscription_gate(request)
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
    identity = _require_auth_identity_without_subscription_gate(request)

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


def create_telegram_bot_bind_link(request: Request) -> Dict[str, Any]:
    """Create a one-time web-to-bot bind deep link for the authenticated account."""
    identity = _require_auth_identity_without_subscription_gate(request)

    db = DBManager()
    token = db.create_web_bind_token(
        supabase_user_id=identity["user_id"],
        supabase_email=identity.get("email") or "",
        ttl_minutes=10,
    )
    start_param = f"bind_{token}"
    bot_username = str(
        legacy_routes.os.getenv("TELEGRAM_BOT_USERNAME")
        or legacy_routes.os.getenv("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME")
        or "polyyuanbot"
    ).strip().lstrip("@")
    bot_url = f"https://t.me/{bot_username}?start={start_param}"
    return {
        "ok": True,
        "token": token,
        "start_param": start_param,
        "bot_url": bot_url,
        "expires_in_seconds": 600,
    }
