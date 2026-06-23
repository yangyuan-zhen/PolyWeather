"""Ops payments / billing / membership service functions."""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager  # type hints
import web.routes as legacy_routes


def _get_db():
    from src.database.db_manager import DBManager as _DBManager
    return _DBManager()


# ═══════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════

def _require_ops(request: Request) -> Dict[str, Any] | None:
    from web.services.ops_api import _require_ops as _real
    return _real(request)


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
    from web.services.ops_api import _supabase_rest_rows as _real

    return _real(table, params, timeout=timeout)


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
# Payment helpers
# ═══════════════════════════════════════════════════════════════════════

def _payment_explorer_url(chain: Any, tx_hash: Any) -> str:
    tx = str(tx_hash or "").strip()
    if not tx:
        return ""
    chain_text = str(chain or "").strip().lower()
    base = "https://etherscan.io" if "eth" in chain_text else "https://polygonscan.com"
    return f"{base}/tx/{tx}"


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
        "refund_case_id": payload.get("refund_case_id"),
        "refund_status": str(payload.get("refund_status") or "").strip(),
        "resolved": bool(resolved_at),
        "resolved_at": resolved_at,
        "resolved_by": str(payload.get("resolved_by") or "").strip(),
    }


def _payment_incident_group_key(item: Dict[str, Any]) -> Tuple[str, str, str, str]:
    reason = str(item.get("reason") or "unknown").strip().lower()
    intent_id = str(item.get("intent_id") or "").strip().lower()
    tx_hash = str(item.get("tx_hash") or "").strip().lower()
    user_id = str(item.get("user_id") or "").strip().lower()
    if intent_id or tx_hash:
        return reason, user_id, intent_id, tx_hash
    return reason, user_id, f"event:{item.get('id')}", ""


def _group_payment_incidents(
    incidents: List[Dict[str, Any]],
    *,
    reason: str = "",
    include_resolved: bool = False,
) -> Dict[str, Any]:
    normalized_reason = str(reason or "").strip().lower()
    groups: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}
    raw_total = 0

    for item in incidents:
        normalized_item = _normalize_payment_incident(item)
        item_reason = str(normalized_item.get("reason") or "").strip().lower()
        resolved = bool(normalized_item.get("resolved"))
        if normalized_reason and item_reason != normalized_reason:
            continue
        if not include_resolved and resolved:
            continue
        raw_total += 1

        key = _payment_incident_group_key(normalized_item)
        created_at = str(normalized_item.get("created_at") or "").strip()
        event_id = int(normalized_item.get("id") or 0)
        existing = groups.get(key)
        if existing is None:
            grouped = {
                **normalized_item,
                "occurrence_count": 1,
                "event_ids": [event_id] if event_id > 0 else [],
                "first_seen_at": created_at,
                "last_seen_at": created_at,
            }
            groups[key] = grouped
            continue

        existing["occurrence_count"] = int(existing.get("occurrence_count") or 1) + 1
        if event_id > 0:
            existing.setdefault("event_ids", []).append(event_id)
        first_seen = str(existing.get("first_seen_at") or "").strip()
        last_seen = str(existing.get("last_seen_at") or "").strip()
        if created_at and (not first_seen or created_at < first_seen):
            existing["first_seen_at"] = created_at
        if created_at and (not last_seen or created_at > last_seen):
            existing["last_seen_at"] = created_at

    grouped_items = list(groups.values())
    grouped_items.sort(
        key=lambda item: (
            str(item.get("last_seen_at") or item.get("created_at") or ""),
            int(item.get("id") or 0),
        ),
        reverse=True,
    )
    return {
        "incidents": grouped_items,
        "raw_total": raw_total,
        "total": len(grouped_items),
    }


# ═══════════════════════════════════════════════════════════════════════
# Payment incident API
# ═══════════════════════════════════════════════════════════════════════

def list_ops_payment_incidents(
    request: Request,
    limit: int = 50,
    reason: str = "",
    include_resolved: bool = False,
) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    safe_limit = max(1, min(int(limit or 50), 200))
    incidents: List[Dict[str, Any]] = []
    for event_type in ("payment_intent_failed", "payment_refund_required"):
        try:
            rows = db.list_payment_audit_events(
                limit=max(safe_limit, 500),
                event_type=event_type,
            )
            incidents.extend(
                row for row in rows
                if str(row.get("event_type") or "").strip().lower() == event_type
            )
        except Exception:
            continue
    terminal_refund_statuses = {"refunded", "rejected", "closed"}
    list_refund_cases = getattr(db, "list_refund_cases", None)
    if callable(list_refund_cases):
        try:
            refund_cases = list_refund_cases(limit=max(safe_limit, 500))
        except Exception:
            refund_cases = []
        for case in refund_cases:
            if not isinstance(case, dict):
                continue
            status = str(case.get("status") or "").strip().lower()
            if not include_resolved and status in terminal_refund_statuses:
                continue
            incidents.append(
                {
                    "id": int(case.get("id") or 0),
                    "event_type": "payment_refund_case",
                    "payload": {
                        "reason": str(case.get("reason") or "refund_required"),
                        "intent_id": case.get("intent_id"),
                        "user_id": case.get("user_id"),
                        "tx_hash": case.get("tx_hash"),
                        "refund_case_id": case.get("id"),
                        "refund_status": status,
                    },
                    "created_at": case.get("created_at"),
                }
            )
    grouped = _group_payment_incidents(
        incidents,
        reason=reason,
        include_resolved=include_resolved,
    )
    return {
        **grouped,
        "incidents": grouped["incidents"][:safe_limit],
    }


def list_ops_refund_cases(
    request: Request,
    limit: int = 50,
    status: str = "",
) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
    safe_limit = max(1, min(int(limit or 50), 200))
    return {
        "refunds": db.list_refund_cases(
            limit=safe_limit,
            status=str(status or "").strip().lower() or None,
        )
    }


def create_ops_refund_case(
    request: Request,
    *,
    reason: str,
    intent_id: str = "",
    tx_hash: str = "",
    user_id: str = "",
    amount_usdc: str = "",
    note: str = "",
) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    actor_email = str(admin.get("email") or "").strip().lower()
    db = _get_db()
    created = db.create_refund_case(
        reason=reason,
        intent_id=intent_id,
        tx_hash=tx_hash,
        user_id=user_id,
        amount_usdc=amount_usdc,
        created_by=actor_email,
        note=note,
    )
    if not created or created.get("ok") is False:
        raise HTTPException(status_code=400, detail=created or "refund_case_failed")
    db.append_ops_audit_event(
        action="refund_case_create",
        actor_email=actor_email,
        target_user_id=str(user_id or ""),
        target_type="refund_case",
        target_id=str(created.get("id") or ""),
        payload={
            "reason": reason,
            "intent_id": intent_id,
            "tx_hash": tx_hash,
            "amount_usdc": amount_usdc,
        },
    )
    db.append_payment_audit_event(
        "payment_refund_required",
        {
            "reason": str(reason or "refund_required").strip().lower(),
            "intent_id": intent_id,
            "user_id": user_id,
            "tx_hash": tx_hash,
            "refund_case_id": created.get("id"),
        },
    )
    return {"ok": True, "refund": created}


def update_ops_refund_case(
    request: Request,
    *,
    case_id: int,
    status: str,
    note: str = "",
) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    actor_email = str(admin.get("email") or "").strip().lower()
    db = _get_db()
    updated = db.update_refund_case(
        case_id,
        status=status,
        handled_by=actor_email,
        note=note,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="refund_case_not_found")
    db.append_ops_audit_event(
        action="refund_case_update",
        actor_email=actor_email,
        target_user_id=str(updated.get("user_id") or ""),
        target_type="refund_case",
        target_id=str(case_id),
        payload={
            "status": status,
            "note": note,
            "intent_id": updated.get("intent_id"),
            "tx_hash": updated.get("tx_hash"),
        },
    )
    return {"ok": True, "refund": updated}


def resolve_ops_payment_incident(request: Request, event_id: int) -> Dict[str, Any]:
    admin = _require_ops(request) or {}
    db = _get_db()
    resolved_group = db.mark_related_payment_audit_events_resolved(
        event_id, str(admin.get("email") or "")
    )
    if not resolved_group:
        raise HTTPException(status_code=404, detail="payment_incident_not_found")
    return {
        "ok": True,
        "incident": resolved_group[0],
        "resolved_count": len(resolved_group),
        "resolved_event_ids": [int(item.get("id") or 0) for item in resolved_group],
    }


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


# ═══════════════════════════════════════════════════════════════════════
# Billing risk
# ═══════════════════════════════════════════════════════════════════════

def get_ops_billing_risk(
    request: Request,
    days: int = 30,
    limit: int = 80,
) -> Dict[str, Any]:
    """Summarize trial, payment, referral, and points risk signals for ops."""
    _require_ops(request)
    db = _get_db()
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
    trial_subscription_rows = collect(
        "subscriptions",
        {
            "select": (
                "id,user_id,plan_code,source,status,starts_at,expires_at,"
                "created_at,updated_at"
            ),
            "or": "(source.eq.signup_trial,plan_code.eq.signup_trial_3d)",
            "order": "created_at.desc",
            "limit": str(max(safe_limit * 20, 1000)),
        },
    )
    active_subscription_rows = collect(
        "subscriptions",
        {
            "select": (
                "id,user_id,plan_code,source,status,starts_at,expires_at,"
                "created_at,updated_at"
            ),
            "status": "eq.active",
            "order": "created_at.desc",
            "limit": str(max(safe_limit * 20, 1000)),
        },
    )
    subscription_rows: List[Dict[str, Any]] = []
    seen_subscription_keys: set[str] = set()
    for row in [*trial_subscription_rows, *active_subscription_rows]:
        key = str(row.get("id") or "").strip() or (
            f"{row.get('user_id')}:{row.get('plan_code')}:{row.get('source')}:"
            f"{row.get('starts_at')}:{row.get('expires_at')}"
        )
        if key in seen_subscription_keys:
            continue
        seen_subscription_keys.add(key)
        subscription_rows.append(row)
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

    def analytics_payload(row: Dict[str, Any]) -> Dict[str, Any]:
        payload = row.get("payload")
        return payload if isinstance(payload, dict) else {}

    def analytics_correlation_keys(row: Dict[str, Any]) -> set[str]:
        payload = analytics_payload(row)
        keys: set[str] = set()
        user_id = normalize_user_key(row.get("user_id") or payload.get("user_id"))
        client_id = str(row.get("client_id") or "").strip()
        session_id = str(row.get("session_id") or "").strip()
        if user_id:
            keys.add(f"user:{user_id}")
        if client_id:
            keys.add(f"client:{client_id}")
        if session_id:
            keys.add(f"session:{session_id}")
        return keys

    signup_intent_keys: set[str] = set()
    for row in events:
        if str(row.get("event_type") or "").strip().lower() != "login_start":
            continue
        payload = analytics_payload(row)
        mode = str(payload.get("mode") or payload.get("auth_mode") or "").strip().lower()
        if mode == "signup":
            signup_intent_keys.update(analytics_correlation_keys(row))

    def has_signup_intent(row: Dict[str, Any]) -> bool:
        payload = analytics_payload(row)
        mode = str(payload.get("mode") or payload.get("auth_mode") or "").strip().lower()
        if mode == "signup" or payload.get("signup_intent") is True:
            return True
        return bool(analytics_correlation_keys(row).intersection(signup_intent_keys))

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
        if not has_signup_intent(row):
            continue
        actor_key = _app_analytics_actor_key(row)
        if actor_key in trial_actor_keys:
            continue
        payload = analytics_payload(row)
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

    payment_incidents_raw = db.list_payment_audit_events(
        limit=max(safe_limit, 500),
        event_type="payment_intent_failed",
    )
    grouped_payment_incidents = _group_payment_incidents(payment_incidents_raw)
    unresolved_incidents = grouped_payment_incidents["incidents"]

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
            "payment_incidents": grouped_payment_incidents["total"],
            "payment_incident_events": grouped_payment_incidents["raw_total"],
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


# ═══════════════════════════════════════════════════════════════════════
# Membership helpers
# ═══════════════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════════════
# Membership API
# ═══════════════════════════════════════════════════════════════════════

def list_ops_memberships(request: Request, limit: int = 200) -> Dict[str, Any]:
    _require_ops(request)
    db = _get_db()
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
    db = _get_db()
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
