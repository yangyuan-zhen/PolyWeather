"""Operations/admin API service functions."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException, Request

from src.database.db_manager import DBManager
from web.core import GrantPointsRequest
import web.routes as legacy_routes


def _require_ops(request: Request) -> Dict[str, Any] | None:
    # Ops admins are authenticated via Supabase identity + email whitelist.
    # They do NOT need an active Pro subscription to manage the system.
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
        source = str(item.get("source") or "")
        is_trial = source == "signup_trial" or str(item.get("plan_code") or "").startswith("signup_trial")
        row = {
            "user_id": user_id,
            "email": str(auth_user.get("email") or local_user.get("supabase_email") or ""),
            "telegram_id": local_user.get("telegram_id"),
            "username": local_user.get("username"),
            "registered_at": local_user.get("created_at") or auth_user.get("created_at"),
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
    rows = sorted(
        deduped.values(),
        key=lambda item: str(item.get("expires_at") or ""),
    )
    return {"memberships": rows}


def get_ops_memberships_growth(request: Request, days: int = 90) -> dict[str, Any]:
    _require_ops(request)
    from collections import defaultdict
    from datetime import datetime, timedelta

    safe_days = max(7, min(365, int(days or 90)))
    subscriptions = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(limit=5000)
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
        daily.append({"date": key, "trial": tc, "paid": pc, "total": total, "cumulative": running})
        cursor += timedelta(days=1)

    return {"days": safe_days, "daily": daily}


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


def list_ops_payments(
    request: Request,
    limit: int = 50,
) -> Dict[str, Any]:
    """List successful payment records from Supabase."""
    _require_ops(request)
    import os
    import requests as _requests

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }
    safe_limit = max(1, min(int(limit or 50), 200))
    resp = _requests.get(
        f"{supabase_url}/rest/v1/payments",
        headers=headers,
        params={
            "select": "id,user_id,amount,currency,chain,tx_hash,status,created_at",
            "order": "created_at.desc",
            "limit": str(safe_limit),
        },
        timeout=10,
    )
    rows = resp.json() if resp.ok and resp.content else []
    if not isinstance(rows, list):
        rows = []
    return {"payments": rows, "total": len(rows)}


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
        raise HTTPException(status_code=400, detail="from_email and to_email are required")
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


def get_ops_config(request: Request) -> dict[str, Any]:
    _require_ops(request)
    import os
    configs: list[dict[str, str]] = []
    for key, desc in _EDITABLE_CONFIG_KEYS.items():
        configs.append({
            "key": key,
            "value": os.getenv(key) or "",
            "description": desc,
        })
    return {"configs": configs}


def update_ops_config(request: Request, key: str, value: str) -> dict[str, Any]:
    _require_ops(request)
    import os
    if key not in _EDITABLE_CONFIG_KEYS:
        raise HTTPException(status_code=400, detail=f"config key '{key}' is not editable")
    os.environ[key] = str(value)
    return {"key": key, "value": value, "ok": True}


# ── Subscriptions ───────────────────────────────────────────────────

def grant_ops_subscription(
    request: Request,
    email: str,
    plan_code: str = "pro_monthly",
    days: int = 30,
    deduct_points: int = 0,
) -> dict[str, Any]:
    _require_ops(request)
    import os
    from datetime import datetime, timedelta
    import requests as _requests

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    allowed_plans = {"pro_monthly"}
    if plan_code not in allowed_plans:
        raise HTTPException(status_code=400, detail=f"invalid plan_code, allowed: {allowed_plans}")

    safe_days = max(1, min(365, int(days or 30)))
    safe_deduct = max(0, int(deduct_points or 0))
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    # Look up user by email
    user_resp = _requests.get(
        f"{supabase_url}/auth/v1/admin/users",
        headers=headers,
        params={"filter": f"email.eq.{normalized_email}"},
        timeout=10,
    )
    users = user_resp.json().get("users", []) if user_resp.ok else []
    user_id = users[0].get("id") if users else None
    if not user_id:
        raise HTTPException(status_code=404, detail=f"user not found: {normalized_email}")

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
        headers=headers,
        json=payload,
        timeout=10,
    )
    if not resp.ok:
        raise HTTPException(status_code=500, detail=f"Supabase insert failed: {resp.text[:200]}")

    result: dict[str, Any] = {
        "ok": True, "user_id": user_id, "plan_code": plan_code,
        "days": safe_days, "expires_at": expires_at,
    }

    # Optionally deduct points from the user (manual Pro grant with points payment)
    if safe_deduct > 0:
        db = DBManager()
        deduct_result = db.deduct_points_by_supabase_email(normalized_email, safe_deduct)
        result["points_deducted"] = safe_deduct
        result["points_result"] = deduct_result

    return result


def extend_ops_subscription(
    request: Request,
    email: str,
    additional_days: int = 30,
) -> dict[str, Any]:
    _require_ops(request)
    import os
    from datetime import datetime, timedelta
    import requests as _requests

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    safe_days = max(1, min(365, int(additional_days or 30)))
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    # Find latest active subscription
    subs_resp = _requests.get(
        f"{supabase_url}/rest/v1/subscriptions",
        headers=headers,
        params={
            "select": "*",
            "email": f"eq.{normalized_email}",
            "order": "expires_at.desc",
            "limit": "1",
        },
        timeout=10,
    )
    subs = subs_resp.json() if subs_resp.ok else []
    if not subs:
        raise HTTPException(status_code=404, detail=f"no subscription found for {normalized_email}")

    sub = subs[0]
    current_expiry = sub.get("expires_at", "")
    try:
        dt = datetime.fromisoformat(current_expiry.replace("Z", "+00:00"))
        new_expiry = (dt + timedelta(days=safe_days)).isoformat()
    except Exception:
        new_expiry = (datetime.utcnow() + timedelta(days=safe_days)).isoformat() + "Z"

    patch_resp = _requests.patch(
        f"{supabase_url}/rest/v1/subscriptions?id=eq.{sub['id']}",
        headers=headers,
        json={"expires_at": new_expiry},
        timeout=10,
    )
    if patch_resp.ok:
        return {"ok": True, "email": normalized_email, "additional_days": safe_days, "new_expires_at": new_expiry}
    raise HTTPException(status_code=500, detail=f"Supabase update failed: {patch_resp.text[:200]}")


def get_ops_user_subscriptions(
    request: Request,
    email: str,
) -> dict[str, Any]:
    """Return ALL subscription rows for a user (by email), regardless of status."""
    _require_ops(request)
    import os
    import requests as _requests

    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    # Resolve user_id from email via auth admin API
    user_resp = _requests.get(
        f"{supabase_url}/auth/v1/admin/users",
        headers=headers,
        params={"filter": f"email.eq.{normalized_email}"},
        timeout=10,
    )
    users = user_resp.json().get("users", []) if user_resp.ok else []
    user_id = users[0].get("id") if users else None
    if not user_id:
        raise HTTPException(status_code=404, detail=f"user not found: {normalized_email}")

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
        log_file = "data/logs/trading_system.log"
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
            r = _r.get(f"{supabase_url}/rest/v1/", headers={"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}, timeout=timeout)
            results["supabase"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round(r.elapsed.total_seconds() * 1000)}
        except Exception as e:
            results["supabase"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["supabase"] = {"ok": False, "error": "not configured"}

    # Open-Meteo
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&daily=temperature_2m_max&timezone=auto&forecast_days=1", timeout=timeout)
        results["open_meteo"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["open_meteo"] = {"ok": False, "error": str(e)[:100]}

    # METAR (aviationweather)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://aviationweather.gov/api/data/metar?ids=KJFK&format=json", timeout=timeout)
        results["metar"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["metar"] = {"ok": False, "error": str(e)[:100]}

    # KNMI
    knmi_key = str(os.getenv("KNMI_API_KEY") or "").strip()
    if knmi_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get("https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files?maxKeys=1", headers={"Authorization": knmi_key}, timeout=timeout)
            results["knmi"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
        except Exception as e:
            results["knmi"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["knmi"] = {"ok": False, "error": "not configured"}

    # MADIS (NOAA)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/", timeout=timeout)
        results["madis"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["madis"] = {"ok": False, "error": str(e)[:100]}

    # Telegram Bot
    bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if bot_token:
        try:
            t0 = _time.perf_counter()
            r = _r.get(f"https://api.telegram.org/bot{bot_token}/getMe", timeout=timeout)
            results["telegram"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
        except Exception as e:
            results["telegram"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["telegram"] = {"ok": False, "error": "not configured"}

    # JMA (Japan Meteorological Agency)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.jma.go.jp/bosai/forecast/", timeout=timeout)
        results["jma"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["jma"] = {"ok": False, "error": str(e)[:100]}

    # MGM (Turkish State Meteorological Service)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://servis.mgm.gov.tr/web/sondurumlar?istno=17130&_=1", timeout=timeout, headers={"Origin": "https://www.mgm.gov.tr"})
        results["mgm"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["mgm"] = {"ok": False, "error": str(e)[:100]}

    # FMI (Finnish Meteorological Institute)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=GetCapabilities", timeout=timeout)
        results["fmi"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["fmi"] = {"ok": False, "error": str(e)[:100]}

    # KMA (Korea Meteorological Administration)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.weather.go.kr/wgis-nuri/js/info/sfc.geojson", timeout=timeout)
        results["kma"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["kma"] = {"ok": False, "error": str(e)[:100]}

    # HKO (Hong Kong Observatory)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv", timeout=timeout)
        results["hko"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["hko"] = {"ok": False, "error": str(e)[:100]}

    # Singapore MSS (data.gov.sg)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://api.data.gov.sg/v1/environment/air-temperature", timeout=timeout)
        results["singapore_mss"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["singapore_mss"] = {"ok": False, "error": str(e)[:100]}

    # CWA (Taiwan Central Weather Administration)
    cwa_key = str(os.getenv("CWA_API_KEY") or os.getenv("CWA_OPEN_DATA_AUTH") or os.getenv("CWA_OPEN_DATA_API_KEY") or "").strip()
    if cwa_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get(f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization={cwa_key}&limit=1", timeout=timeout)
            results["cwa"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
        except Exception as e:
            results["cwa"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["cwa"] = {"ok": False, "error": "not configured"}

    # Polymarket Gamma API
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://gamma-api.polymarket.com/events?limit=1", timeout=timeout)
        results["polymarket_gamma"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["polymarket_gamma"] = {"ok": False, "error": str(e)[:100]}

    # Polymarket CLOB API — GET / returns 200 on healthy CLOB
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://clob.polymarket.com/", timeout=timeout)
        results["polymarket_clob"] = {"ok": r.status_code < 500, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["polymarket_clob"] = {"ok": False, "error": str(e)[:100]}




    # AMOS (Korea runway sensors)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do", timeout=timeout)
        results["amos"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["amos"] = {"ok": False, "error": str(e)[:100]}

    # AMSC AWOS (China mainland airports) — matches actual source SSL + URL pattern
    amsc_base = str(os.getenv("AMSC_AWOS_BASE_URL") or "").strip()
    if amsc_base:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                f"{amsc_base}?cccc=ZSPD",
                timeout=timeout,
                verify=False,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Referer": os.getenv("AMSC_AWOS_REFERER", "https://www.amsc.net.cn/"),
                    "User-Agent": "PolyWeather/1.0",
                },
            )
            results["amsc_awos"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
        except Exception as e:
            results["amsc_awos"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["amsc_awos"] = {"ok": False, "error": "not configured"}

    # NOAA WRH (US settlement verification)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.weather.gov/wrh/timeseries?site=KJFK", timeout=timeout)
        results["noaa_wrh"] = {"ok": r.ok, "status": r.status_code, "latency_ms": round((_time.perf_counter() - t0) * 1000)}
    except Exception as e:
        results["noaa_wrh"] = {"ok": False, "error": str(e)[:100]}

    all_ok = all(v.get("ok") for v in results.values())
    return {"ok": all_ok, "checked_at": __import__("datetime").datetime.utcnow().isoformat() + "Z", "services": results}


def get_ops_training_accuracy(request: Request) -> Dict[str, Any]:
    _require_ops(request)
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
                "details_str": deb_acc[3]
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
                "details_str": mu_acc[4]
            }

        if deb_payload or mu_payload:
            accuracy_data.append({
                "city_id": city_id,
                "name": name,
                "deb": deb_payload,
                "mu": mu_payload
            })

    # Sort by total days of DEB or Mu
    accuracy_data.sort(
        key=lambda x: max(
            x["deb"]["total_days"] if x["deb"] else 0,
            x["mu"]["total_days"] if x["mu"] else 0
        ),
        reverse=True
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
        bindings_rows = conn.execute("SELECT telegram_id, supabase_user_id, supabase_email FROM supabase_bindings").fetchall()

    user_info = {}
    for r in users_rows:
        tid = int(r["telegram_id"])
        user_info[tid] = {
            "telegram_id": tid,
            "username": r["username"] or f"ID: {tid}",
            "supabase_user_id": None,
            "supabase_email": None,
            "is_bound": False
        }

    for r in bindings_rows:
        tid = int(r["telegram_id"])
        if tid not in user_info:
            user_info[tid] = {
                "telegram_id": tid,
                "username": f"ID: {tid}",
                "supabase_user_id": r["supabase_user_id"],
                "supabase_email": r["supabase_email"],
                "is_bound": True
            }
        else:
            user_info[tid]["supabase_user_id"] = r["supabase_user_id"]
            user_info[tid]["supabase_email"] = r["supabase_email"]
            user_info[tid]["is_bound"] = True

    # 2. Get Telegram Bot settings
    bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_ids = get_telegram_chat_ids_from_env()

    # Add other group IDs if configured
    for env_name in ["POLYWEATHER_TELEGRAM_GROUP_ID", "POLYWEATHER_TELEGRAM_TOPICS_GROUP_ID"]:
        val = str(os.getenv(env_name) or "").strip()
        if val and val not in chat_ids:
            chat_ids.append(val)

    if not bot_token or not chat_ids:
        return {"error": "Telegram Bot Token or Chat IDs not configured", "anomalies": []}

    # 3. Check membership status for all users in parallel
    results = []

    def check_user_chat(tg_id, chat_id):
        try:
            resp = requests.get(
                f"https://api.telegram.org/bot{bot_token}/getChatMember",
                params={"chat_id": chat_id, "user_id": tg_id},
                timeout=5
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

    from web.services.ops_api import legacy_routes
    active_subs = legacy_routes.SUPABASE_ENTITLEMENT.list_active_subscriptions(limit=5000)
    active_subs_map = {}
    for sub in active_subs:
        uid = str(sub.get("user_id") or "").strip().lower()
        if uid:
            active_subs_map[uid] = sub

    for tg_id, chat_id, status in results:
        info = user_info[tg_id]

        if not info["is_bound"]:
            anomalies.append({
                "telegram_id": tg_id,
                "username": info["username"],
                "chat_id": chat_id,
                "status": status,
                "anomaly_type": "unbound",
                "reason": "未绑定网页账号",
                "email": None,
                "expires_at": None,
            })
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
                anomalies.append({
                    "telegram_id": tg_id,
                    "username": info["username"],
                    "chat_id": chat_id,
                    "status": status,
                    "anomaly_type": "expired",
                    "reason": "没有有效的会员订阅",
                    "email": info["supabase_email"],
                    "expires_at": None,
                })
            elif not is_paid:
                anomalies.append({
                    "telegram_id": tg_id,
                    "username": info["username"],
                    "chat_id": chat_id,
                    "status": status,
                    "anomaly_type": "trial_only",
                    "reason": f"仅拥有试用会员 ({plan_code})",
                    "email": info["supabase_email"],
                    "expires_at": expires_at,
                })
            else:
                valid_members.append({
                    "telegram_id": tg_id,
                    "username": info["username"],
                    "chat_id": chat_id,
                    "status": status,
                    "email": info["supabase_email"],
                    "plan_code": plan_code,
                    "expires_at": expires_at,
                })

    return {
        "anomalies": anomalies,
        "valid_count": len(valid_members),
        "anomaly_count": len(anomalies),
    }


