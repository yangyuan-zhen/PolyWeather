"""Operations/admin API service functions."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request
import requests as _requests

from src.database.db_manager import DBManager
from src.utils.runtime_secrets import get_runtime_secret, get_runtime_secret_status
from web.services.observation_freshness import (
    build_observation_freshness,
    canonical_observation_source_code,
)
from web.core import GrantPointsRequest
import web.routes as legacy_routes


def _require_ops(request: Request) -> Dict[str, Any] | None:
    # Ops admins are authenticated via Supabase identity + email whitelist.
    # They do NOT need an active Pro subscription to manage the system.
    return legacy_routes._require_ops_admin(request)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _supabase_rest_rows(
    table: str,
    params: Dict[str, Any],
    *,
    timeout: int = 10,
) -> List[Dict[str, Any]]:
    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }
    resp = _requests.get(
        f"{supabase_url}/rest/v1/{table}",
        headers=headers,
        params=params,
        timeout=timeout,
    )
    if not resp.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Supabase query failed for {table}: {resp.status_code}",
        )
    rows = resp.json() if resp.content else []
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _payment_explorer_url(chain: Any, tx_hash: Any) -> str:
    tx = str(tx_hash or "").strip()
    if not tx:
        return ""
    chain_text = str(chain or "").strip().lower()
    base = "https://etherscan.io" if "eth" in chain_text else "https://polygonscan.com"
    return f"{base}/tx/{tx}"


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


def _risk_issue(
    *,
    category: str,
    severity: str,
    title: str,
    detail: str,
    user_id: Any = "",
    created_at: Any = "",
    reference: Any = "",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "category": category,
        "severity": severity,
        "title": title,
        "detail": detail,
        "user_id": str(user_id or ""),
        "created_at": str(created_at or ""),
        "reference": str(reference or ""),
        "payload": payload or {},
    }


def search_ops_users(request: Request, q: str = "", limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    return {"users": db.search_users(q, limit=limit)}


def get_ops_weekly_leaderboard(request: Request, limit: int = 20) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    return {"leaderboard": db.get_weekly_leaderboard(limit=limit)}


def _list_active_subscriptions_with_windows(
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], bool]:
    active_window_query = getattr(
        legacy_routes.SUPABASE_ENTITLEMENT,
        "list_active_subscription_windows",
        None,
    )
    if not callable(active_window_query):
        return [], {}, False
    try:
        active_window_payload = active_window_query(limit=limit)
    except Exception:
        return [], {}, False
    if not isinstance(active_window_payload, dict):
        return [], {}, False

    active_window_subscriptions = active_window_payload.get("subscriptions")
    active_window_windows = active_window_payload.get("windows")
    if not isinstance(active_window_subscriptions, list):
        return [], {}, False
    if not active_window_subscriptions and not (
        isinstance(active_window_windows, dict) and active_window_windows
    ):
        return [], {}, False

    subscriptions = [
        item for item in active_window_subscriptions if isinstance(item, dict)
    ]
    subscription_windows = (
        active_window_windows if isinstance(active_window_windows, dict) else {}
    )
    return subscriptions, subscription_windows, True


def _build_membership_rows(
    db: DBManager,
    subscriptions: list[dict[str, Any]],
    subscription_windows: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    subscription_user_ids = [str(item.get("user_id") or "") for item in subscriptions]
    user_map = db.get_users_by_supabase_user_ids(subscription_user_ids)
    unresolved_user_ids = [
        user_id
        for user_id in subscription_user_ids
        if str(user_id or "").strip().lower()
        and not str(
            (user_map.get(str(user_id).strip().lower(), {}) or {}).get("supabase_email")
            or ""
        ).strip()
    ]
    auth_user_map = legacy_routes.SUPABASE_ENTITLEMENT.get_auth_users(
        unresolved_user_ids
    )
    if not subscription_windows:
        subscription_windows = legacy_routes.SUPABASE_ENTITLEMENT.list_subscription_windows(
            subscription_user_ids,
            bypass_cache=True,
        )
    deduped: dict[str, dict] = {}
    for item in subscriptions:
        user_id = str(item.get("user_id") or "").strip().lower()
        local_user = user_map.get(user_id, {})
        auth_user = auth_user_map.get(user_id, {})
        subscription_window = subscription_windows.get(user_id, {})
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
        source = str(item.get("source") or "")
        is_trial = source == "signup_trial" or str(
            item.get("plan_code") or ""
        ).startswith("signup_trial")
        row = {
            "user_id": user_id,
            "email": str(
                auth_user.get("email") or local_user.get("supabase_email") or ""
            ),
            "telegram_id": local_user.get("telegram_id"),
            "username": local_user.get("username"),
            "registered_at": local_user.get("created_at")
            or auth_user.get("created_at"),
            "plan_code": item.get("plan_code"),
            "source": source,
            "is_trial": is_trial,
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
    return sorted(
        deduped.values(),
        key=lambda item: str(item.get("expires_at") or ""),
    )


def _build_membership_growth(
    subscriptions: list[dict[str, Any]],
    days: int,
) -> dict[str, Any]:
    from collections import defaultdict
    from datetime import datetime, timedelta

    safe_days = max(7, min(365, int(days or 90)))
    now = datetime.utcnow()
    cutoff = now - timedelta(days=safe_days)

    trial_by_day: dict[str, int] = defaultdict(int)
    paid_by_day: dict[str, int] = defaultdict(int)
    running = 0

    for item in subscriptions:
        starts_raw = str(item.get("starts_at") or "").strip()
        if not starts_raw:
            continue
        try:
            dt = datetime.fromisoformat(starts_raw.replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
        except Exception:
            continue
        if dt < cutoff:
            continue
        day_key = dt.strftime("%Y-%m-%d")
        source = str(item.get("source") or "").strip().lower()
        plan = str(item.get("plan_code") or "").strip().lower()
        is_trial = source == "signup_trial" or plan.startswith("signup_trial")
        if is_trial:
            trial_by_day[day_key] += 1
        else:
            paid_by_day[day_key] += 1

    daily = []
    cursor = cutoff.date()
    while cursor <= now.date():
        key = cursor.isoformat()
        tc = trial_by_day.get(key, 0)
        pc = paid_by_day.get(key, 0)
        total = tc + pc
        running += total
        daily.append(
            {
                "date": key,
                "trial": tc,
                "paid": pc,
                "total": total,
                "cumulative": running,
            }
        )
        cursor += timedelta(days=1)

    return {"days": safe_days, "daily": daily}


def list_ops_memberships(request: Request, limit: int = 200) -> Dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    reconcile_enabled = (
        str(os.getenv("POLYWEATHER_OPS_MEMBERSHIPS_RECONCILE_ENABLED") or "")
        .strip()
        .lower()
        in {"1", "true", "yes", "on"}
    )
    if reconcile_enabled and getattr(legacy_routes.PAYMENT_CHECKOUT, "enabled", False):
        try:
            legacy_routes.PAYMENT_CHECKOUT.reconcile_recent_intents(
                limit=min(max(int(limit or 200), 20), 200)
            )
        except Exception:
            pass
    subscriptions, subscription_windows, used_active_window_query = (
        _list_active_subscriptions_with_windows(limit)
    )
    if not used_active_window_query:
        subscriptions = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(
            limit=limit
        )
    return {
        "memberships": _build_membership_rows(
            db,
            subscriptions,
            subscription_windows,
        )
    }


def get_ops_memberships_growth(request: Request, days: int = 90) -> dict[str, Any]:
    _require_ops(request)

    subscriptions, _, used_active_window_query = _list_active_subscriptions_with_windows(
        limit=5000
    )
    if not used_active_window_query:
        subscriptions = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(
            limit=5000
        )
    return _build_membership_growth(subscriptions, days)


def get_ops_memberships_overview(
    request: Request,
    limit: int = 200,
    days: int = 90,
) -> dict[str, Any]:
    _require_ops(request)
    db = DBManager()
    safe_limit = max(1, min(int(limit or 200), 1000))
    query_limit = max(safe_limit, 5000)
    subscriptions, subscription_windows, used_active_window_query = (
        _list_active_subscriptions_with_windows(limit=query_limit)
    )
    if not used_active_window_query:
        subscriptions = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(
            limit=query_limit
        )
    membership_subscriptions = subscriptions[:safe_limit]
    return {
        "memberships": _build_membership_rows(
            db,
            membership_subscriptions,
            subscription_windows,
        ),
        **_build_membership_growth(subscriptions, days),
    }


def _normalize_payment_incident(item: Dict[str, Any]) -> Dict[str, Any]:
    payload = item.get("payload") if isinstance(item, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    confirm_failure = (
        payload.get("confirm_failure")
        if isinstance(payload.get("confirm_failure"), dict)
        else {}
    )
    reason = str(
        payload.get("reason")
        or confirm_failure.get("reason")
        or payload.get("error")
        or "unknown"
    ).strip().lower()
    detail = str(
        payload.get("detail")
        or confirm_failure.get("detail")
        or payload.get("message")
        or payload.get("error")
        or ""
    ).strip()
    resolved_at = str(payload.get("resolved_at") or "").strip()
    return {
        **item,
        "payload": payload,
        "reason": reason or "unknown",
        "detail": detail,
        "intent_id": str(
            payload.get("intent_id")
            or payload.get("payment_intent_id")
            or confirm_failure.get("intent_id")
            or ""
        ).strip(),
        "user_id": str(payload.get("user_id") or "").strip(),
        "tx_hash": str(
            payload.get("tx_hash")
            or confirm_failure.get("tx_hash")
            or ""
        ).strip(),
        "resolved": bool(resolved_at),
        "resolved_at": resolved_at,
        "resolved_by": str(payload.get("resolved_by") or "").strip(),
    }


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
        normalized_item = _normalize_payment_incident(item)
        item_reason = str(normalized_item.get("reason") or "").strip().lower()
        resolved = bool(normalized_item.get("resolved"))
        if normalized_reason and item_reason != normalized_reason:
            continue
        if not include_resolved and resolved:
            continue
        filtered.append(normalized_item)
    return {"incidents": filtered, "total": len(filtered)}


def resolve_ops_payment_incident(request: Request, event_id: int) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = DBManager()
    resolved = db.mark_payment_audit_event_resolved(
        event_id, str(admin.get("email") or "")
    )
    if not resolved:
        raise HTTPException(status_code=404, detail="payment_incident_not_found")
    return {"ok": True, "incident": resolved}


def list_ops_payments(
    request: Request,
    limit: int = 50,
) -> Dict[str, Any]:
    """List successful payment records from Supabase."""
    _require_ops(request)
    safe_limit = max(1, min(int(limit or 50), 200))
    rows = _supabase_rest_rows(
        "payments",
        {
            "select": "id,user_id,amount,currency,chain,tx_hash,status,created_at",
            "order": "created_at.desc",
            "limit": str(safe_limit),
        },
    )
    return {"payments": rows, "total": len(rows)}


def get_ops_billing_risk(
    request: Request,
    days: int = 30,
    limit: int = 80,
) -> Dict[str, Any]:
    """Summarize trial, payment, referral, and points risk signals for ops."""
    _require_ops(request)
    db = DBManager()
    now = datetime.now(timezone.utc)
    safe_days = max(1, min(int(days or 30), 120))
    safe_limit = max(10, min(int(limit or 80), 200))
    since_dt = now - timedelta(days=safe_days)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    query_errors: List[Dict[str, str]] = []

    def collect(table: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        try:
            return _supabase_rest_rows(table, params)
        except Exception as exc:
            query_errors.append({"table": table, "error": str(exc)[:180]})
            return []

    intents = collect(
        "payment_intents",
        {
            "select": (
                "id,user_id,plan_code,chain_id,status,expires_at,tx_hash,"
                "metadata,created_at,updated_at"
            ),
            "order": "updated_at.desc",
            "limit": str(max(safe_limit * 3, 100)),
        },
    )
    referral_attributions = collect(
        "referral_attributions",
        {
            "select": (
                "id,referrer_user_id,referred_user_id,code,status,"
                "converted_payment_intent_id,converted_tx_hash,converted_at,"
                "created_at,updated_at"
            ),
            "order": "updated_at.desc",
            "limit": str(safe_limit),
        },
    )
    referral_rewards = collect(
        "referral_rewards",
        {
            "select": (
                "id,referral_attribution_id,referrer_user_id,referred_user_id,"
                "payment_intent_id,tx_hash,reward_days,reward_points,created_at"
            ),
            "order": "created_at.desc",
            "limit": str(safe_limit),
        },
    )
    trial_claims = collect(
        "trial_claims",
        {
            "select": "id,user_id,email,telegram_user_id,claimed_at,created_at",
            "order": "created_at.desc",
            "limit": str(max(safe_limit * 10, 500)),
        },
    )
    subscription_rows = collect(
        "subscriptions",
        {
            "select": (
                "id,user_id,plan_code,source,status,starts_at,expires_at,"
                "created_at,updated_at"
            ),
            "or": "(source.eq.signup_trial,plan_code.eq.signup_trial_3d,status.eq.active)",
            "order": "created_at.desc",
            "limit": str(max(safe_limit * 20, 1000)),
        },
    )
    entitlement_trial_events = collect(
        "entitlement_events",
        {
            "select": "id,user_id,action,payload,created_at",
            "action": "in.(signup_trial_claimed,signup_trial_granted)",
            "order": "created_at.desc",
            "limit": str(max(safe_limit * 10, 500)),
        },
    )

    issues: List[Dict[str, Any]] = []
    stuck_intents: List[Dict[str, Any]] = []
    points_issues: List[Dict[str, Any]] = []

    for intent in intents:
        status = str(intent.get("status") or "").strip().lower()
        updated_at = _parse_iso_datetime(intent.get("updated_at"))
        created_at = _parse_iso_datetime(intent.get("created_at"))
        expires_at = _parse_iso_datetime(intent.get("expires_at"))
        age_min = (
            int((now - (updated_at or created_at or now)).total_seconds() // 60)
            if (updated_at or created_at)
            else 0
        )
        intent_id = str(intent.get("id") or "")
        user_id = str(intent.get("user_id") or "")
        metadata = intent.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        redemption = metadata.get("points_redemption")
        redemption = redemption if isinstance(redemption, dict) else {}

        if status == "submitted" and age_min >= 10:
            row = {
                "id": intent_id,
                "user_id": user_id,
                "plan_code": intent.get("plan_code"),
                "status": status,
                "age_min": age_min,
                "tx_hash": intent.get("tx_hash"),
                "updated_at": intent.get("updated_at"),
            }
            stuck_intents.append(row)
            issues.append(
                _risk_issue(
                    category="payment_intent",
                    severity="high",
                    title="Submitted intent 超过 10 分钟未确认",
                    detail=f"{intent_id} 已提交 {age_min} 分钟，可能需要补单或检查确认循环。",
                    user_id=user_id,
                    created_at=intent.get("updated_at") or intent.get("created_at"),
                    reference=intent_id,
                    payload=row,
                )
            )
        elif status == "created" and expires_at and expires_at < now:
            row = {
                "id": intent_id,
                "user_id": user_id,
                "plan_code": intent.get("plan_code"),
                "status": status,
                "expires_at": intent.get("expires_at"),
                "age_min": age_min,
            }
            stuck_intents.append(row)
            issues.append(
                _risk_issue(
                    category="payment_intent",
                    severity="medium",
                    title="Created intent 已过期但未关闭",
                    detail=f"{intent_id} 已过期，用户可能离开支付流程。",
                    user_id=user_id,
                    created_at=intent.get("created_at"),
                    reference=intent_id,
                    payload=row,
                )
            )

        if bool(redemption.get("applied")):
            planned = int(redemption.get("points_to_consume") or 0)
            consumed = bool(redemption.get("consumed"))
            consumed_points = int(redemption.get("consumed_points") or 0)
            if status == "confirmed" and not consumed:
                row = {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "status": status,
                    "planned_points": planned,
                    "consumed_points": consumed_points,
                    "updated_at": intent.get("updated_at"),
                }
                points_issues.append(row)
                issues.append(
                    _risk_issue(
                        category="points_redemption",
                        severity="high",
                        title="订单已确认但积分未扣减",
                        detail=f"{intent_id} 标记使用积分，但 confirmed metadata 未显示 consumed。",
                        user_id=user_id,
                        created_at=intent.get("updated_at") or intent.get("created_at"),
                        reference=intent_id,
                        payload=row,
                    )
                )
            elif status == "confirmed" and planned > 0 and 0 < consumed_points < planned:
                row = {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "status": status,
                    "planned_points": planned,
                    "consumed_points": consumed_points,
                    "updated_at": intent.get("updated_at"),
                }
                points_issues.append(row)
                issues.append(
                    _risk_issue(
                        category="points_redemption",
                        severity="medium",
                        title="积分抵扣只扣了部分积分",
                        detail=f"{intent_id} 计划扣 {planned}，实际扣 {consumed_points}。",
                        user_id=user_id,
                        created_at=intent.get("updated_at") or intent.get("created_at"),
                        reference=intent_id,
                        payload=row,
                    )
                )

    reward_by_attribution = {
        str(row.get("referral_attribution_id") or ""): row
        for row in referral_rewards
        if row.get("referral_attribution_id") is not None
    }
    monthly_cap_hits: List[Dict[str, Any]] = []
    referral_settlement_issues: List[Dict[str, Any]] = []

    for attribution in referral_attributions:
        status = str(attribution.get("status") or "").strip().lower()
        attribution_id = str(attribution.get("id") or "")
        updated_at = _parse_iso_datetime(
            attribution.get("updated_at") or attribution.get("converted_at") or attribution.get("created_at")
        )
        if status == "capped" and (not updated_at or updated_at >= month_start):
            row = {
                "id": attribution_id,
                "code": attribution.get("code"),
                "referrer_user_id": attribution.get("referrer_user_id"),
                "referred_user_id": attribution.get("referred_user_id"),
                "updated_at": attribution.get("updated_at"),
            }
            monthly_cap_hits.append(row)
            issues.append(
                _risk_issue(
                    category="referral",
                    severity="medium",
                    title="邀请奖励月度上限命中",
                    detail=f"邀请码 {attribution.get('code') or ''} 的推荐奖励已被月度上限拦截。",
                    user_id=attribution.get("referrer_user_id"),
                    created_at=attribution.get("updated_at") or attribution.get("created_at"),
                    reference=attribution_id,
                    payload=row,
                )
            )
        if status == "converted" and attribution_id not in reward_by_attribution:
            row = {
                "id": attribution_id,
                "code": attribution.get("code"),
                "referrer_user_id": attribution.get("referrer_user_id"),
                "referred_user_id": attribution.get("referred_user_id"),
                "converted_payment_intent_id": attribution.get("converted_payment_intent_id"),
                "converted_at": attribution.get("converted_at"),
            }
            referral_settlement_issues.append(row)
            issues.append(
                _risk_issue(
                    category="referral",
                    severity="high",
                    title="推荐已转化但没有奖励记录",
                    detail=f"归因 {attribution_id} 已 converted，但 referral_rewards 未找到对应记录。",
                    user_id=attribution.get("referrer_user_id"),
                    created_at=attribution.get("converted_at") or attribution.get("updated_at"),
                    reference=attribution_id,
                    payload=row,
                )
            )

    events = db.list_app_analytics_events(limit=20000, since_iso=since_dt.isoformat())
    signup_rows = [
        row
        for row in events
        if str(row.get("event_type") or "").strip().lower()
        in {"signup_success", "signup_completed"}
    ]
    def normalize_user_key(value: Any) -> str:
        return str(value or "").strip().lower()

    trial_actor_keys = {
        _app_analytics_actor_key(row)
        for row in events
        if str(row.get("event_type") or "").strip().lower() == "trial_created"
    }
    subscription_user_keys = {
        normalize_user_key(row.get("user_id"))
        for row in subscription_rows
        if normalize_user_key(row.get("user_id"))
    }
    trial_subscription_user_keys = {
        normalize_user_key(row.get("user_id"))
        for row in subscription_rows
        if normalize_user_key(row.get("user_id"))
        and (
            str(row.get("plan_code") or "").strip().lower() == "signup_trial_3d"
            or str(row.get("source") or "").strip().lower() == "signup_trial"
        )
    }
    trial_claim_user_keys = {
        normalize_user_key(row.get("user_id"))
        for row in trial_claims
        if normalize_user_key(row.get("user_id"))
    }
    trial_event_user_keys: set[str] = set()
    for row in entitlement_trial_events:
        event_user_id = normalize_user_key(row.get("user_id"))
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        payload_user_id = normalize_user_key(payload.get("user_id"))
        if event_user_id:
            trial_event_user_keys.add(event_user_id)
        if payload_user_id:
            trial_event_user_keys.add(payload_user_id)

    backend_trial_user_keys = (
        trial_subscription_user_keys | trial_claim_user_keys | trial_event_user_keys
    )
    trial_gaps: List[Dict[str, Any]] = []

    for claim in trial_claims:
        claim_user_id = normalize_user_key(claim.get("user_id"))
        if not claim_user_id or claim_user_id in trial_subscription_user_keys:
            continue
        gap = {
            "claim_id": claim.get("id"),
            "user_id": claim.get("user_id"),
            "email": claim.get("email"),
            "created_at": claim.get("created_at") or claim.get("claimed_at"),
            "reason": "trial_claim_without_subscription",
        }
        trial_gaps.append(gap)
        if len(trial_gaps) <= 20:
            issues.append(
                _risk_issue(
                    category="signup_trial",
                    severity="high",
                    title="试用 claim 已写入但订阅缺失",
                    detail="trial_claims 已记录该用户领取试用，但 subscriptions 中没有 signup_trial_3d 记录。",
                    user_id=gap.get("user_id"),
                    created_at=gap.get("created_at"),
                    reference=str(gap.get("claim_id") or ""),
                    payload=gap,
                )
            )

    for row in signup_rows[:300]:
        actor_key = _app_analytics_actor_key(row)
        if actor_key in trial_actor_keys:
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        signup_user_id = normalize_user_key(row.get("user_id") or payload.get("user_id"))
        if not signup_user_id:
            continue
        if (
            signup_user_id in backend_trial_user_keys
            or signup_user_id in subscription_user_keys
        ):
            continue
        gap = {
            "event_id": row.get("id"),
            "actor_key": actor_key,
            "user_id": signup_user_id,
            "created_at": row.get("created_at"),
            "reason": "signup_without_backend_trial_evidence",
        }
        trial_gaps.append(gap)
        if len(trial_gaps) <= 20:
            issues.append(
                _risk_issue(
                    category="signup_trial",
                    severity="high",
                    title="注册成功后未发现后端试用记录",
                    detail=(
                        "该用户进入 signup_success，但没有 trial_created、trial_claims、"
                        "signup_trial subscription 或其他有效订阅证据。"
                    ),
                    user_id=gap.get("user_id"),
                    created_at=gap.get("created_at"),
                    reference=str(gap.get("event_id") or ""),
                    payload=gap,
                )
            )

    payment_incidents = db.list_payment_audit_events(
        limit=safe_limit,
        event_type="payment_intent_failed",
    )
    unresolved_incidents = [
        item
        for item in payment_incidents
        if not str((item.get("payload") or {}).get("resolved_at") or "").strip()
    ]

    issues.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    recent_rewards = [
        {
            "id": row.get("id"),
            "referral_attribution_id": row.get("referral_attribution_id"),
            "referrer_user_id": row.get("referrer_user_id"),
            "referred_user_id": row.get("referred_user_id"),
            "payment_intent_id": row.get("payment_intent_id"),
            "reward_points": int(row.get("reward_points") or 0),
            "reward_days": int(row.get("reward_days") or 0),
            "tx_hash": row.get("tx_hash"),
            "explorer_url": _payment_explorer_url("polygon", row.get("tx_hash")),
            "created_at": row.get("created_at"),
        }
        for row in referral_rewards[:safe_limit]
    ]

    return {
        "checked_at": _to_utc_iso(now),
        "window_days": safe_days,
        "summary": {
            "issues": len(issues),
            "stuck_intents": len(stuck_intents),
            "trial_gaps": len(trial_gaps),
            "payment_incidents": len(unresolved_incidents),
            "points_discount_issues": len(points_issues),
            "referral_settlement_issues": len(referral_settlement_issues),
            "monthly_cap_hits": len(monthly_cap_hits),
            "recent_referral_rewards": len(recent_rewards),
            "recent_trial_claims": len(trial_claims),
        },
        "issues": issues[:safe_limit],
        "stuck_intents": stuck_intents[:safe_limit],
        "trial_gaps": trial_gaps[:safe_limit],
        "payment_incidents": unresolved_incidents[:safe_limit],
        "points_discount_issues": points_issues[:safe_limit],
        "referral_settlement_issues": referral_settlement_issues[:safe_limit],
        "monthly_cap_hits": monthly_cap_hits[:safe_limit],
        "recent_referral_rewards": recent_rewards,
        "recent_trial_claims": trial_claims,
        "query_errors": query_errors,
    }


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
    db = DBManager()
    result = db.transfer_points_by_email(from_email, to_email, amount)
    result["operator_email"] = admin.get("email")
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
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
                        (legacy_routes.CITY_REGISTRY.get(row_city) or {}).get("name")
                        or row_city
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

    rows.sort(
        key=lambda item: (str(item["target_date"]), str(item["city"])), reverse=True
    )
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


# ── Config ──────────────────────────────────────────────────────────

_EDITABLE_CONFIG_KEYS: dict[str, str] = {
    "POLYWEATHER_AUTH_REQUIRED": "是否强制要求 Supabase 登录访问 API",
    "POLYWEATHER_PAYMENT_ENABLED": "是否启用支付功能",
    "POLYWEATHER_PAYMENT_POINTS_ENABLED": "是否启用积分抵扣",
    "POLYWEATHER_TELEGRAM_ALERT_PUSH_ENABLED": "是否启用 Telegram 告警推送",
    "POLYWEATHER_GROUP_MEMBER_PRICE_USDC": "群成员月费 (USDC)",
    "POLYWEATHER_PUBLIC_PRICE_USDC": "公开月费 (USDC)",
    "POLYWEATHER_PAYMENT_POINTS_PER_USDC": "积分兑换汇率 (积分/USDC)",
    "POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC": "积分最高抵扣金额 (USDC)",
    "POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS": "手动转账收款钱包地址",
}

_SENSITIVE_CONFIG_KEYS: dict[str, dict[str, str]] = {
    "POLYWEATHER_AMSC_SESSION_ID": {
        "label": "AMSC AWOS sessionId",
        "description": "中国跑道观测接口 sessionId，用于上海/北京/广州等 AMSC AWOS 数据源。",
    },
}


def get_ops_config(request: Request) -> dict[str, Any]:
    _require_ops(request)
    import os

    configs: list[dict[str, str]] = []
    for key, desc in _EDITABLE_CONFIG_KEYS.items():
        configs.append(
            {
                "key": key,
                "value": os.getenv(key) or "",
                "description": desc,
            }
        )
    return {"configs": configs}


def update_ops_config(request: Request, key: str, value: str) -> dict[str, Any]:
    _require_ops(request)
    import os

    if key not in _EDITABLE_CONFIG_KEYS:
        raise HTTPException(
            status_code=400, detail=f"config key '{key}' is not editable"
        )
    os.environ[key] = str(value)
    return {"key": key, "value": value, "ok": True}


def _sensitive_config_payload(key: str) -> dict[str, Any]:
    definition = _SENSITIVE_CONFIG_KEYS.get(key) or {}
    metadata = get_runtime_secret_status(key)
    return {
        "key": key,
        "label": definition.get("label") or key,
        "description": definition.get("description") or "",
        "configured": bool(metadata.get("configured")),
        "masked": str(metadata.get("masked") or ""),
        "length": int(metadata.get("length") or 0),
        "updated_at": str(metadata.get("updated_at") or ""),
        "updated_by": str(metadata.get("updated_by") or ""),
        "source": str(metadata.get("source") or "runtime_store"),
    }


def get_ops_sensitive_config(request: Request) -> dict[str, Any]:
    _require_ops(request)
    return {
        "configs": [
            _sensitive_config_payload(key)
            for key in _SENSITIVE_CONFIG_KEYS
        ]
    }


def update_ops_sensitive_config(
    request: Request,
    key: str,
    value: str,
) -> dict[str, Any]:
    admin = _require_ops(request) or {}
    normalized_key = str(key or "").strip()
    if normalized_key not in _SENSITIVE_CONFIG_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"sensitive config key '{normalized_key}' is not editable",
        )
    secret_value = str(value or "").strip()
    if not 12 <= len(secret_value) <= 256 or any(ch.isspace() for ch in secret_value):
        raise HTTPException(
            status_code=400,
            detail="sessionId must be 12-256 non-whitespace characters",
        )

    db = DBManager()
    try:
        config = db.set_runtime_secret(
            normalized_key,
            secret_value,
            updated_by=str(admin.get("email") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    os.environ[normalized_key] = secret_value
    response_config = _sensitive_config_payload(normalized_key)
    response_config.update(
        {
            "configured": bool(config.get("configured")),
            "masked": str(config.get("masked") or ""),
            "length": int(config.get("length") or 0),
            "updated_at": str(config.get("updated_at") or ""),
            "updated_by": str(config.get("updated_by") or ""),
            "source": str(config.get("source") or "runtime_store"),
        }
    )
    health = (
        _check_amsc_awos_health(timeout=8)
        if normalized_key == "POLYWEATHER_AMSC_SESSION_ID"
        else None
    )
    return {"ok": True, "config": response_config, "health": health}


def _build_amsc_awos_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": os.getenv("AMSC_AWOS_REFERER", "https://www.amsc.net.cn/"),
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
        ),
    }
    cookie = get_runtime_secret("POLYWEATHER_AMSC_COOKIE")
    session_id = get_runtime_secret("POLYWEATHER_AMSC_SESSION_ID")
    if cookie:
        headers["Cookie"] = cookie
    elif session_id:
        headers["sessionId"] = session_id
        headers["app"] = "AMS"
    return headers


def _check_amsc_awos_health(timeout: int = 8) -> dict[str, Any]:
    import time as _time

    from src.data_collection.amsc_awos_sources import _amsc_parse_wind_plate_payload

    amsc_base = str(os.getenv("AMSC_AWOS_BASE_URL") or "").strip()
    if not amsc_base:
        return {"ok": False, "error": "not configured"}

    credential_configured = bool(
        get_runtime_secret("POLYWEATHER_AMSC_COOKIE")
        or get_runtime_secret("POLYWEATHER_AMSC_SESSION_ID")
    )
    try:
        t0 = _time.perf_counter()
        response = _requests.get(
            f"{amsc_base}?cccc=ZSPD",
            timeout=timeout,
            verify=False,
            headers=_build_amsc_awos_headers(),
        )
        latency_ms = round((_time.perf_counter() - t0) * 1000)
        try:
            payload = response.json() if response.content else {}
        except ValueError:
            payload = {}
        parsed = _amsc_parse_wind_plate_payload(
            payload if isinstance(payload, dict) else {},
            city_key="shanghai",
            icao="ZSPD",
        )
        points = (
            ((parsed or {}).get("runway_obs") or {}).get("point_temperatures")
            if isinstance(parsed, dict)
            else []
        )
        point_count = len(points or [])
        ok = bool(response.ok and parsed and point_count > 0)
        result: dict[str, Any] = {
            "ok": ok,
            "status": response.status_code,
            "latency_ms": latency_ms,
            "credential_configured": credential_configured,
            "points": point_count,
        }
        if isinstance(parsed, dict):
            result["sample_city"] = "shanghai"
            result["observation_time_local"] = parsed.get("observation_time_local")
        if not ok:
            result["error"] = "empty_or_unauthorized_response"
        return result
    except Exception as exc:
        return {
            "ok": False,
            "credential_configured": credential_configured,
            "error": str(exc)[:100],
        }


# ── Subscriptions ───────────────────────────────────────────────────


def _supabase_service_headers(
    service_role_key: str,
    *,
    prefer: str | None = None,
) -> dict[str, str]:
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _lookup_supabase_user_id_by_email(
    supabase_url: str,
    service_role_key: str,
    email: str,
) -> str:
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return ""
    base = str(supabase_url or "").strip().rstrip("/")
    headers = _supabase_service_headers(service_role_key)

    profile_resp = _requests.get(
        f"{base}/rest/v1/profiles",
        headers=headers,
        params={
            "select": "id",
            "email": f"eq.{normalized_email}",
            "limit": "1",
        },
        timeout=10,
    )
    if profile_resp.ok:
        profiles = profile_resp.json() if profile_resp.content else []
        if isinstance(profiles, list) and profiles:
            user_id = str((profiles[0] or {}).get("id") or "").strip()
            if user_id:
                return user_id

    user_resp = _requests.get(
        f"{base}/auth/v1/admin/users",
        headers=headers,
        params={"filter": f"email.eq.{normalized_email}"},
        timeout=10,
    )
    users = user_resp.json().get("users", []) if user_resp.ok else []
    return str(users[0].get("id") or "").strip() if users else ""


def grant_ops_subscription(
    request: Request,
    email: str,
    plan_code: str = "pro_monthly",
    days: int = 30,
    deduct_points: int = 0,
) -> dict[str, Any]:
    _require_ops(request)
    from datetime import datetime, timedelta

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    allowed_plans = {"pro_monthly"}
    if plan_code not in allowed_plans:
        raise HTTPException(
            status_code=400, detail=f"invalid plan_code, allowed: {allowed_plans}"
        )

    safe_days = max(1, min(365, int(days or 30)))
    safe_deduct = max(0, int(deduct_points or 0))
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    user_id = _lookup_supabase_user_id_by_email(
        supabase_url,
        service_role_key,
        normalized_email,
    )
    if not user_id:
        raise HTTPException(
            status_code=404, detail=f"user not found: {normalized_email}"
        )

    now = datetime.utcnow()
    starts_at = now.isoformat() + "Z"
    expires_at = (now + timedelta(days=safe_days)).isoformat() + "Z"

    payload = {
        "user_id": user_id,
        "email": normalized_email,
        "plan_code": plan_code,
        "starts_at": starts_at,
        "expires_at": expires_at,
        "source": "ops_manual_grant",
        "created_at": now.isoformat() + "Z",
    }

    resp = _requests.post(
        f"{supabase_url}/rest/v1/subscriptions",
        headers=_supabase_service_headers(service_role_key, prefer="return=minimal"),
        json=payload,
        timeout=10,
    )
    if not resp.ok:
        raise HTTPException(
            status_code=500, detail=f"Supabase insert failed: {resp.text[:200]}"
        )
    legacy_routes.SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)

    result: dict[str, Any] = {
        "ok": True,
        "user_id": user_id,
        "plan_code": plan_code,
        "days": safe_days,
        "expires_at": expires_at,
    }

    # Optionally deduct points from the user (manual Pro grant with points payment)
    if safe_deduct > 0:
        db = DBManager()
        deduct_result = db.deduct_points_by_supabase_email(
            normalized_email, safe_deduct
        )
        result["points_deducted"] = safe_deduct
        result["points_result"] = deduct_result

    return result


def extend_ops_subscription(
    request: Request,
    email: str,
    additional_days: int = 30,
) -> dict[str, Any]:
    _require_ops(request)
    from datetime import datetime, timedelta

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    safe_days = max(1, min(365, int(additional_days or 30)))
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    headers = _supabase_service_headers(service_role_key)

    user_id = _lookup_supabase_user_id_by_email(
        supabase_url,
        service_role_key,
        normalized_email,
    )
    if not user_id:
        raise HTTPException(
            status_code=404, detail=f"user not found: {normalized_email}"
        )

    # Find latest active subscription
    subs_resp = _requests.get(
        f"{supabase_url}/rest/v1/subscriptions",
        headers=headers,
        params={
            "select": "id,expires_at",
            "user_id": f"eq.{user_id}",
            "status": "eq.active",
            "order": "expires_at.desc",
            "limit": "1",
        },
        timeout=10,
    )
    subs = subs_resp.json() if subs_resp.ok else []
    if not subs:
        raise HTTPException(
            status_code=404, detail=f"no subscription found for {normalized_email}"
        )

    sub = subs[0]
    current_expiry = sub.get("expires_at", "")
    try:
        dt = datetime.fromisoformat(current_expiry.replace("Z", "+00:00"))
        new_expiry = (dt + timedelta(days=safe_days)).isoformat()
    except Exception:
        new_expiry = (datetime.utcnow() + timedelta(days=safe_days)).isoformat() + "Z"

    patch_resp = _requests.patch(
        f"{supabase_url}/rest/v1/subscriptions?id=eq.{sub['id']}",
        headers=_supabase_service_headers(service_role_key, prefer="return=minimal"),
        json={"expires_at": new_expiry},
        timeout=10,
    )
    if patch_resp.ok:
        legacy_routes.SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)
        return {
            "ok": True,
            "email": normalized_email,
            "additional_days": safe_days,
            "new_expires_at": new_expiry,
        }
    raise HTTPException(
        status_code=500, detail=f"Supabase update failed: {patch_resp.text[:200]}"
    )


def get_ops_user_subscriptions(
    request: Request,
    email: str,
) -> dict[str, Any]:
    """Return ALL subscription rows for a user (by email), regardless of status."""
    _require_ops(request)

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    headers = _supabase_service_headers(service_role_key)

    user_id = _lookup_supabase_user_id_by_email(
        supabase_url,
        service_role_key,
        normalized_email,
    )
    if not user_id:
        raise HTTPException(
            status_code=404, detail=f"user not found: {normalized_email}"
        )

    # Fetch all subscription rows for this user (no status filter)
    subs_resp = _requests.get(
        f"{supabase_url}/rest/v1/subscriptions",
        headers=headers,
        params={
            "select": "id,user_id,status,plan_code,source,starts_at,expires_at,created_at,updated_at",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": "50",
        },
        timeout=10,
    )
    rows = subs_resp.json() if subs_resp.ok and subs_resp.content else []
    if not isinstance(rows, list):
        rows = []

    return {
        "email": normalized_email,
        "user_id": user_id,
        "subscriptions": rows,
        "count": len(rows),
    }


# ── Logs ────────────────────────────────────────────────────────────


def get_ops_logs(
    request: Request,
    level: str = "",
    lines: int = 100,
) -> dict[str, Any]:
    _require_ops(request)
    import os
    import subprocess

    safe_lines = max(10, min(1000, int(lines or 100)))
    log_text = ""
    try:
        # Read from Docker logs
        result = subprocess.run(
            ["docker", "logs", "--tail", str(safe_lines), "polyweather_bot"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        log_text = result.stdout or result.stderr or ""
    except Exception:
        pass

    # Fallback to local log file if docker logs returns empty
    if not log_text.strip():
        log_file = "data/logs/polyweather.log"
        if os.path.exists(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    all_lines = f.readlines()
                    log_text = "".join(all_lines[-safe_lines:])
            except Exception:
                pass

    log_lines = log_text.strip().split("\n") if log_text.strip() else []

    if level:
        level_upper = level.upper()
        log_lines = [line for line in log_lines if level_upper in line.upper()]

    return {
        "lines": log_lines[-safe_lines:],
        "total": len(log_lines),
    }


def _safe_source_text(value: Any) -> str:
    return str(value or "").strip()


def _source_observed_at(source: dict[str, Any]) -> Any:
    for key in (
        "observed_at",
        "obs_time",
        "report_time",
        "observation_time",
        "observation_time_local",
        "time",
        "timestamp",
    ):
        value = source.get(key)
        if _safe_source_text(value):
            return value
    return None


def _source_code(source: dict[str, Any], fallback: str = "") -> str:
    for key in ("source_code", "source", "provider_code", "network_provider"):
        value = _safe_source_text(source.get(key))
        if value:
            return canonical_observation_source_code(value)
    return canonical_observation_source_code(fallback)


def _source_label(source: dict[str, Any], code: str, fallback: str = "") -> str:
    for key in ("source_label", "station_label", "station_name", "label", "provider_label"):
        value = _safe_source_text(source.get(key))
        if value:
            return value
    return fallback or code.upper()


def _source_health_entry(
    *,
    city: str,
    role: str,
    source: dict[str, Any],
    fallback_code: str = "",
    fallback_label: str = "",
) -> dict[str, Any] | None:
    if not isinstance(source, dict) or not source:
        return None

    code = _source_code(source, fallback_code)
    label = _source_label(source, code, fallback_label)
    observed_at = _source_observed_at(source)
    freshness = source.get("freshness") if isinstance(source.get("freshness"), dict) else None
    if freshness:
        status = _safe_source_text(freshness.get("freshness_status")) or "unknown"
        age_sec = freshness.get("age_sec")
        observed_at = freshness.get("observed_at") or freshness.get("observed_at_local") or observed_at
        expected_next = freshness.get("expected_next_update_at")
        reason = freshness.get("freshness_reason")
    else:
        age_min = source.get("obs_age_min")
        try:
            age_min_int = int(age_min) if age_min is not None else None
        except Exception:
            age_min_int = None
        freshness = build_observation_freshness(
            source_code=code,
            source_label=label,
            observed_at=observed_at,
            age_min=age_min_int,
        )
        status = str(freshness.get("freshness_status") or "unknown")
        age_sec = freshness.get("age_sec")
        expected_next = freshness.get("expected_next_update_at")
        reason = freshness.get("freshness_reason")

    return {
        "city": city,
        "role": role,
        "source_code": code,
        "source_label": label,
        "station_code": source.get("station_code") or source.get("icao"),
        "station_label": source.get("station_label") or source.get("station_name"),
        "status": status,
        "reason": reason,
        "age_sec": age_sec,
        "age_min": round(float(age_sec) / 60, 1) if isinstance(age_sec, (int, float)) else None,
        "observed_at": observed_at,
        "expected_next_update_at": expected_next,
        "temp": source.get("temp"),
    }


def _expected_city_source_codes(city: str, payload: dict[str, Any]) -> list[str]:
    city_key = str(city or "").strip().lower().replace(" ", "")
    expected: list[str] = []
    if city_key in {"ankara", "istanbul"}:
        expected.append("mgm")
    if city_key == "amsterdam":
        expected.append("knmi")
    if city_key in {"telaviv", "telavivyafo"}:
        expected.append("ims")
    provider = canonical_observation_source_code(payload.get("official_network_source"))
    if provider and provider not in {"metar", "none"}:
        expected.append(provider)
    return list(dict.fromkeys(expected))


def _collect_city_source_health(city: str, entry: dict[str, Any] | None) -> dict[str, Any]:
    payload = (entry or {}).get("payload") if isinstance(entry, dict) else {}
    if not isinstance(payload, dict):
        payload = {}

    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(role: str, source: Any, fallback_code: str = "", fallback_label: str = "") -> None:
        item = _source_health_entry(
            city=city,
            role=role,
            source=source if isinstance(source, dict) else {},
            fallback_code=fallback_code,
            fallback_label=fallback_label,
        )
        if not item:
            return
        key = (str(item.get("role")), str(item.get("source_code")))
        if key in seen:
            return
        seen.add(key)
        sources.append(item)

    add("settlement", payload.get("current"), fallback_label="Settlement")
    add("airport_metar", payload.get("airport_current"), fallback_code="metar", fallback_label="METAR")
    add("airport_primary", payload.get("airport_primary"), fallback_label="Airport station")

    official = payload.get("official") if isinstance(payload.get("official"), dict) else {}
    add("official_airport_primary", official.get("airport_primary"), fallback_label="Official airport station")
    add("official_airport_primary", official.get("airport_primary_current"), fallback_label="Official airport station")

    mgm = payload.get("mgm") if isinstance(payload.get("mgm"), dict) else {}
    if mgm:
        mgm_current = mgm.get("current") if isinstance(mgm.get("current"), dict) else {}
        add(
            "official_network",
            {
                **mgm_current,
                "source_code": "mgm",
                "source_label": "MGM",
                "obs_time": mgm.get("obs_time") or mgm_current.get("time"),
            },
            fallback_code="mgm",
            fallback_label="MGM",
        )

    for nearby in payload.get("official_nearby") or payload.get("mgm_nearby") or []:
        if isinstance(nearby, dict):
            add("nearby_official", nearby, fallback_label="Nearby official")

    expected_codes = _expected_city_source_codes(city, payload)
    present_codes = {str(item.get("source_code") or "") for item in sources}
    for code in expected_codes:
        if code and code not in present_codes:
            sources.append(
                {
                    "city": city,
                    "role": "expected_source",
                    "source_code": code,
                    "source_label": code.upper(),
                    "status": "missing",
                    "reason": "expected_source_not_present_in_cached_detail",
                    "age_sec": None,
                    "age_min": None,
                    "observed_at": None,
                    "expected_next_update_at": None,
                    "temp": None,
                }
            )

    priority = {"stale": 4, "missing": 4, "delayed": 3, "unknown": 2, "expected_wait": 1, "fresh": 0}
    worst = max(sources, key=lambda item: priority.get(str(item.get("status") or ""), 2), default=None)
    full_age_sec = (
        round(max(0.0, __import__("time").time() - float(entry.get("updated_at_ts") or 0.0)), 1)
        if entry
        else None
    )
    return {
        "city": city,
        "cache_exists": bool(entry),
        "cache_updated_at": entry.get("updated_at") if entry else None,
        "cache_age_sec": full_age_sec,
        "source_count": len(sources),
        "worst_status": str(worst.get("status") if worst else "missing"),
        "sources": sources,
    }


def get_ops_source_health(
    request: Request,
    cities: str = "",
    limit: int = 80,
) -> dict[str, Any]:
    _require_ops(request)
    requested = legacy_routes._normalize_city_list(cities) if cities else []
    if requested:
        selected = requested
    else:
        all_cities = getattr(legacy_routes, "CITIES", {})
        selected = list(all_cities.keys()) if isinstance(all_cities, dict) else []
    safe_limit = max(1, min(int(limit or 80), 200))
    rows = []
    for city in selected[:safe_limit]:
        entry = legacy_routes._CACHE_DB.get_city_cache("full", city)
        if not entry:
            entry = legacy_routes._CACHE_DB.get_city_cache("panel", city)
        rows.append(_collect_city_source_health(city, entry))

    status_counts: dict[str, int] = {}
    for row in rows:
        for source in row.get("sources") or []:
            status = str(source.get("status") or "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "checked_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "cities": rows,
        "status_counts": status_counts,
        "total_cities": len(rows),
    }


def get_ops_health_check(request: Request) -> dict[str, Any]:
    _require_ops(request)
    import os
    import requests as _r
    import time as _time
    import urllib3 as _urllib3

    _urllib3.disable_warnings(_urllib3.exceptions.InsecureRequestWarning)

    results: dict[str, dict] = {}
    timeout = 8

    # Supabase
    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    supabase_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if supabase_url and supabase_key:
        try:
            r = _r.get(
                f"{supabase_url}/rest/v1/",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                },
                timeout=timeout,
            )
            results["supabase"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round(r.elapsed.total_seconds() * 1000),
            }
        except Exception as e:
            results["supabase"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["supabase"] = {"ok": False, "error": "not configured"}

    # Open-Meteo
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&daily=temperature_2m_max&timezone=auto&forecast_days=1",
            timeout=timeout,
        )
        results["open_meteo"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["open_meteo"] = {"ok": False, "error": str(e)[:100]}

    # METAR (aviationweather)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json",
            timeout=timeout,
        )
        results["metar"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["metar"] = {"ok": False, "error": str(e)[:100]}

    # KNMI
    knmi_key = str(os.getenv("KNMI_API_KEY") or "").strip()
    if knmi_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                "https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files?maxKeys=1",
                headers={"Authorization": knmi_key},
                timeout=timeout,
            )
            results["knmi"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["knmi"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["knmi"] = {"ok": False, "error": "not configured"}

    # MADIS (NOAA)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/",
            timeout=timeout,
        )
        results["madis"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["madis"] = {"ok": False, "error": str(e)[:100]}

    # Telegram Bot
    bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if bot_token:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                f"https://api.telegram.org/bot{bot_token}/getMe", timeout=timeout
            )
            results["telegram"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["telegram"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["telegram"] = {"ok": False, "error": "not configured"}

    # JMA (Japan Meteorological Agency)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.jma.go.jp/bosai/forecast/", timeout=timeout)
        results["jma"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["jma"] = {"ok": False, "error": str(e)[:100]}

    # MGM (Turkish State Meteorological Service)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://servis.mgm.gov.tr/web/sondurumlar?istno=17130&_=1",
            timeout=timeout,
            headers={"Origin": "https://www.mgm.gov.tr"},
        )
        results["mgm"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["mgm"] = {"ok": False, "error": str(e)[:100]}

    # FMI (Finnish Meteorological Institute)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=GetCapabilities",
            timeout=timeout,
        )
        results["fmi"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["fmi"] = {"ok": False, "error": str(e)[:100]}

    # KMA (Korea Meteorological Administration)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://www.weather.go.kr/wgis-nuri/js/info/sfc.geojson", timeout=timeout
        )
        results["kma"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["kma"] = {"ok": False, "error": str(e)[:100]}

    # HKO (Hong Kong Observatory)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv",
            timeout=timeout,
        )
        results["hko"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["hko"] = {"ok": False, "error": str(e)[:100]}

    # Singapore MSS (data.gov.sg)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://api.data.gov.sg/v1/environment/air-temperature", timeout=timeout
        )
        results["singapore_mss"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["singapore_mss"] = {"ok": False, "error": str(e)[:100]}

    # CWA (Taiwan Central Weather Administration)
    cwa_key = str(
        os.getenv("CWA_API_KEY")
        or os.getenv("CWA_OPEN_DATA_AUTH")
        or os.getenv("CWA_OPEN_DATA_API_KEY")
        or ""
    ).strip()
    if cwa_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization={cwa_key}&limit=1",
                timeout=timeout,
            )
            results["cwa"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["cwa"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["cwa"] = {"ok": False, "error": "not configured"}



    # AMOS (Korea runway sensors)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do", timeout=timeout
        )
        results["amos"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["amos"] = {"ok": False, "error": str(e)[:100]}

    # AMSC AWOS (China mainland airports)
    results["amsc_awos"] = _check_amsc_awos_health(timeout=timeout)

    # NOAA WRH (US settlement verification)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.weather.gov/wrh/timeseries?site=KJFK", timeout=timeout)
        results["noaa_wrh"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["noaa_wrh"] = {"ok": False, "error": str(e)[:100]}

    all_ok = all(v.get("ok") for v in results.values())
    return {
        "ok": all_ok,
        "checked_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "services": results,
    }


def get_ops_training_accuracy(request: Request) -> Dict[str, Any]:
    from src.analysis.deb_algorithm import get_deb_accuracy, get_mu_accuracy
    from src.data_collection.city_registry import CITY_REGISTRY

    accuracy_data = []
    for city_id, info in CITY_REGISTRY.items():
        name = info.get("name") or city_id

        # Calculate DEB accuracy
        deb_acc = get_deb_accuracy(city_id)
        deb_payload = None
        if deb_acc:
            deb_payload = {
                "hit_rate": deb_acc[0],
                "mae": deb_acc[1],
                "total_days": deb_acc[2],
                "details_str": deb_acc[3],
            }

        # Calculate Mu accuracy
        mu_acc = get_mu_accuracy(city_id)
        mu_payload = None
        if mu_acc:
            mu_payload = {
                "mae": mu_acc[0],
                "hit_rate": mu_acc[1],
                "brier_score": mu_acc[2],
                "total_days": mu_acc[3],
                "details_str": mu_acc[4],
            }

        if deb_payload or mu_payload:
            accuracy_data.append(
                {"city_id": city_id, "name": name, "deb": deb_payload, "mu": mu_payload}
            )

    # Sort by total days of DEB or Mu
    accuracy_data.sort(
        key=lambda x: max(
            x["deb"]["total_days"] if x["deb"] else 0,
            x["mu"]["total_days"] if x["mu"] else 0,
        ),
        reverse=True,
    )

    return {"accuracy": accuracy_data}


def get_ops_telegram_audit(request: Request) -> Dict[str, Any]:
    _require_ops(request)
    import concurrent.futures
    import os
    import sqlite3
    import requests
    from src.database.db_manager import DBManager
    from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env

    db = DBManager()

    # 1. Fetch all distinct telegram users from database
    with db._get_connection() as conn:
        conn.row_factory = sqlite3.Row
        users_rows = conn.execute("SELECT telegram_id, username FROM users").fetchall()
        bindings_rows = conn.execute(
            "SELECT telegram_id, supabase_user_id, supabase_email FROM supabase_bindings"
        ).fetchall()

    user_info = {}
    for r in users_rows:
        tid = int(r["telegram_id"])
        user_info[tid] = {
            "telegram_id": tid,
            "username": r["username"] or f"ID: {tid}",
            "supabase_user_id": None,
            "supabase_email": None,
            "is_bound": False,
        }

    for r in bindings_rows:
        tid = int(r["telegram_id"])
        if tid not in user_info:
            user_info[tid] = {
                "telegram_id": tid,
                "username": f"ID: {tid}",
                "supabase_user_id": r["supabase_user_id"],
                "supabase_email": r["supabase_email"],
                "is_bound": True,
            }
        else:
            user_info[tid]["supabase_user_id"] = r["supabase_user_id"]
            user_info[tid]["supabase_email"] = r["supabase_email"]
            user_info[tid]["is_bound"] = True

    # 2. Get Telegram Bot settings
    bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_ids = get_telegram_chat_ids_from_env()

    # Add other group IDs if configured
    for env_name in [
        "POLYWEATHER_TELEGRAM_GROUP_ID",
        "POLYWEATHER_TELEGRAM_TOPICS_GROUP_ID",
    ]:
        val = str(os.getenv(env_name) or "").strip()
        if val and val not in chat_ids:
            chat_ids.append(val)

    if not bot_token or not chat_ids:
        return {
            "error": "Telegram Bot Token or Chat IDs not configured",
            "anomalies": [],
        }

    # 3. Check membership status for all users in parallel
    results = []

    def check_user_chat(tg_id, chat_id):
        try:
            resp = requests.get(
                f"https://api.telegram.org/bot{bot_token}/getChatMember",
                params={"chat_id": chat_id, "user_id": tg_id},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("ok"):
                    res_status = data["result"].get("status")
                    return chat_id, res_status
            return chat_id, None
        except Exception:
            return chat_id, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {}
        for tg_id in user_info.keys():
            for c_id in chat_ids:
                f = executor.submit(check_user_chat, tg_id, c_id)
                futures[f] = (tg_id, c_id)

        for f in concurrent.futures.as_completed(futures):
            tg_id, c_id = futures[f]
            try:
                _, status = f.result()
                if status in {"creator", "administrator", "member"}:
                    results.append((tg_id, c_id, status))
            except Exception:
                pass

    # 4. Filter and categorize members
    anomalies = []
    valid_members = []

    active_subs, _, used_active_window_query = _list_active_subscriptions_with_windows(
        limit=5000
    )
    if not used_active_window_query:
        active_subs = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(
            limit=5000
        )
    active_subs_map = {}
    for sub in active_subs:
        uid = str(sub.get("user_id") or "").strip().lower()
        if uid:
            active_subs_map[uid] = sub

    for tg_id, chat_id, status in results:
        info = user_info[tg_id]

        if not info["is_bound"]:
            anomalies.append(
                {
                    "telegram_id": tg_id,
                    "username": info["username"],
                    "chat_id": chat_id,
                    "status": status,
                    "anomaly_type": "unbound",
                    "reason": "未绑定网页账号",
                    "email": None,
                    "expires_at": None,
                }
            )
        else:
            uid = str(info["supabase_user_id"]).strip().lower()
            sub = active_subs_map.get(uid)
            is_paid = False
            plan_code = ""
            expires_at = None

            if sub:
                plan_code = str(sub.get("plan_code") or "").strip().lower()
                source = str(sub.get("source") or "").strip().lower()
                is_paid = "trial" not in plan_code and "trial" not in source
                expires_at = sub.get("expires_at")

            if not sub:
                anomalies.append(
                    {
                        "telegram_id": tg_id,
                        "username": info["username"],
                        "chat_id": chat_id,
                        "status": status,
                        "anomaly_type": "expired",
                        "reason": "没有有效的会员订阅",
                        "email": info["supabase_email"],
                        "expires_at": None,
                    }
                )
            elif not is_paid:
                anomalies.append(
                    {
                        "telegram_id": tg_id,
                        "username": info["username"],
                        "chat_id": chat_id,
                        "status": status,
                        "anomaly_type": "trial_only",
                        "reason": f"仅拥有试用会员 ({plan_code})",
                        "email": info["supabase_email"],
                        "expires_at": expires_at,
                    }
                )
            else:
                valid_members.append(
                    {
                        "telegram_id": tg_id,
                        "username": info["username"],
                        "chat_id": chat_id,
                        "status": status,
                        "email": info["supabase_email"],
                        "plan_code": plan_code,
                        "expires_at": expires_at,
                    }
                )

    return {
        "anomalies": anomalies,
        "valid_count": len(valid_members),
        "anomaly_count": len(anomalies),
    }
