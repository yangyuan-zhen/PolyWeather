"""Authentication guards and identity resolution for PolyWeather."""

import os
from typing import Any, Dict

from fastapi import HTTPException, Request
from loguru import logger

from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT, extract_bearer_token


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


_ENTITLEMENT_HEADER = "x-polyweather-entitlement"
_FORWARDED_SUPABASE_USER_ID_HEADER = "x-polyweather-auth-user-id"
_FORWARDED_SUPABASE_EMAIL_HEADER = "x-polyweather-auth-email"
_OPS_ADMIN_EMAILS = {
    item.strip().lower()
    for item in str(os.getenv("POLYWEATHER_OPS_ADMIN_EMAILS") or "").split(",")
    if item.strip()
}


# Config values imported lazily from web.core to avoid circular imports
# and allow monkeypatching to target web.core directly.
def _get_entitlement_token():
    import web.core as _core
    return _core._ENTITLEMENT_TOKEN


def _get_supabase_auth_required():
    import web.core as _core
    return _core._SUPABASE_AUTH_REQUIRED


def _get_entitlement_guard_enabled():
    import web.core as _core
    return _core._ENTITLEMENT_GUARD_ENABLED


def _legacy_service_token_valid(request: Request) -> bool:
    token = request.headers.get(_ENTITLEMENT_HEADER)
    if not token:
        token = extract_bearer_token(request.headers.get("authorization"))
    token_hint = _get_entitlement_token()
    return bool(token_hint and token == token_hint)


def _bind_forwarded_supabase_identity(request: Request) -> bool:
    if not _legacy_service_token_valid(request):
        return False
    forwarded_user_id = str(
        request.headers.get(_FORWARDED_SUPABASE_USER_ID_HEADER) or ""
    ).strip()
    if not forwarded_user_id:
        return False
    request.state.auth_user_id = forwarded_user_id
    request.state.auth_email = str(
        request.headers.get(_FORWARDED_SUPABASE_EMAIL_HEADER) or ""
    ).strip()
    return True


def _bind_optional_supabase_identity(request: Request) -> None:
    if _bind_forwarded_supabase_identity(request):
        return
    if not SUPABASE_ENTITLEMENT.configured:
        return
    access_token = extract_bearer_token(request.headers.get("authorization"))
    if not access_token:
        return
    identity = SUPABASE_ENTITLEMENT.get_identity(access_token)
    if not identity:
        return
    request.state.auth_user_id = identity.user_id
    request.state.auth_email = identity.email
    request.state.auth_points = identity.points
    request.state.auth_created_at = identity.created_at
    from src.utils.online_tracker import record_activity
    record_activity(identity.user_id)


def _resolve_auth_points(request: Request, account_db=None) -> int:

    if account_db is None:
        # imported lazily to avoid circular dependency at module level
        from web.core import _account_db as _db
        account_db = _db

    raw_points = getattr(request.state, "auth_points", 0)
    try:
        points = max(0, int(raw_points or 0))
    except Exception:
        points = 0

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()

    if user_id:
        try:
            db_points = account_db.get_points_by_supabase_user_id(user_id)
            if db_points > points:
                request.state.auth_points = db_points
                points = db_points
        except Exception as exc:
            logger.warning(f"auth points fallback failed user_id={user_id}: {exc}")

    if points <= 0:
        email = str(getattr(request.state, "auth_email", "") or "").strip().lower()
        if email:
            try:
                email_points = account_db.get_points_by_supabase_email(email)
                if email_points > points:
                    request.state.auth_points = email_points
                    points = email_points
            except Exception as exc:
                logger.warning(
                    f"auth points email fallback failed email={email}: {exc}"
                )

    return points


def _resolve_weekly_profile(request: Request, account_db=None) -> Dict[str, Any]:

    if account_db is None:
        from web.core import _account_db as _db
        account_db = _db

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    if not user_id:
        return {"weekly_points": 0, "weekly_rank": None}
    try:
        profile = account_db.get_weekly_profile_by_supabase_user_id(user_id)
        return {
            "weekly_points": int(profile.get("weekly_points") or 0),
            "weekly_rank": profile.get("weekly_rank"),
        }
    except Exception as exc:
        logger.warning(f"auth weekly profile fallback failed user_id={user_id}: {exc}")
        return {"weekly_points": 0, "weekly_rank": None}


def _assert_entitlement(request: Request) -> None:
    if SUPABASE_ENTITLEMENT.enabled:
        if _legacy_service_token_valid(request):
            if _bind_forwarded_supabase_identity(request):
                return
            bearer_token = extract_bearer_token(request.headers.get("authorization"))
            if not bearer_token or bearer_token == _get_entitlement_token():
                return
        if not _get_supabase_auth_required():
            _bind_optional_supabase_identity(request)
            return
        if not SUPABASE_ENTITLEMENT.configured:
            raise HTTPException(
                status_code=503,
                detail="Supabase auth is enabled but SUPABASE_URL / SUPABASE_ANON_KEY is not configured",
            )

        access_token = extract_bearer_token(request.headers.get("authorization"))
        if not access_token:
            raise HTTPException(status_code=401, detail="Unauthorized")

        identity = SUPABASE_ENTITLEMENT.get_identity(access_token)
        if not identity:
            raise HTTPException(status_code=401, detail="Unauthorized")
        skip_subscription_gate = bool(
            getattr(request.state, "skip_subscription_gate", False)
        )
        if (
            not skip_subscription_gate
            and not SUPABASE_ENTITLEMENT.has_active_subscription(identity.user_id)
        ):
            raise HTTPException(status_code=403, detail="Subscription required")

        request.state.auth_user_id = identity.user_id
        request.state.auth_email = identity.email
        request.state.auth_points = identity.points
        request.state.auth_created_at = identity.created_at
        from src.utils.online_tracker import record_activity
        record_activity(identity.user_id)
        return

    if not _get_entitlement_guard_enabled():
        return

    if not _get_entitlement_token():
        raise HTTPException(
            status_code=503,
            detail="Entitlement guard is enabled but backend token is not configured",
        )

    if not _legacy_service_token_valid(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _require_supabase_identity(request: Request) -> Dict[str, str]:
    if not SUPABASE_ENTITLEMENT.enabled:
        raise HTTPException(
            status_code=503, detail="payment requires POLYWEATHER_AUTH_ENABLED=true"
        )
    if not SUPABASE_ENTITLEMENT.configured:
        raise HTTPException(
            status_code=503,
            detail="payment requires SUPABASE_URL and SUPABASE_ANON_KEY",
        )

    state_user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    if state_user_id:
        state_email = str(getattr(request.state, "auth_email", "") or "").strip()
        return {"user_id": state_user_id, "email": state_email}

    token = extract_bearer_token(request.headers.get("authorization"))
    if token:
        identity = SUPABASE_ENTITLEMENT.get_identity(token)
        if identity:
            return {"user_id": identity.user_id, "email": identity.email}

    legacy_ok = _legacy_service_token_valid(request)
    if legacy_ok:
        forwarded_user_id = str(
            request.headers.get(_FORWARDED_SUPABASE_USER_ID_HEADER) or ""
        ).strip()
        if forwarded_user_id:
            forwarded_email = str(
                request.headers.get(_FORWARDED_SUPABASE_EMAIL_HEADER) or ""
            ).strip()
            return {"user_id": forwarded_user_id, "email": forwarded_email}
        return {"user_id": "entitlement", "email": ""}

    logger.warning(
        "payment auth identity missing state_user={} auth_bearer={} legacy_ok={} forwarded_user={}".format(
            bool(state_user_id),
            bool(token),
            bool(legacy_ok),
            bool(
                str(
                    request.headers.get(_FORWARDED_SUPABASE_USER_ID_HEADER) or ""
                ).strip()
            ),
        )
    )
    raise HTTPException(status_code=401, detail="Unauthorized")


def _require_ops_admin(request: Request) -> Dict[str, str]:
    identity = _require_supabase_identity(request)
    email = str(identity.get("email") or "").strip().lower()
    if email and email in _OPS_ADMIN_EMAILS:
        return identity

    user_id = identity.get("user_id")
    if user_id and user_id.lower() == "entitlement":
        raise HTTPException(
            status_code=401,
            detail="entitlement bearer is not suitable for ops admin authorization",
        )

    raise HTTPException(
        status_code=403,
        detail="ops access restricted to configured admin emails",
    )
