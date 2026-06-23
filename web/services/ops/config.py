"""Ops config / subscriptions / logs / telegram service functions."""
from __future__ import annotations

import concurrent.futures
import os
import sqlite3
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests as _requests
from fastapi import HTTPException, Request

from src.utils.runtime_secrets import get_runtime_secret_status


def _get_db():
    from src.database.db_manager import DBManager as _DBManager
    return _DBManager()


# ── Config key definitions ──────────────────────────────────────────

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


# ── Helpers ─────────────────────────────────────────────────────────


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


# ── Config ──────────────────────────────────────────────────────────


def get_ops_config(request: Request) -> dict[str, Any]:
    _require_ops(request)

    configs: list[dict[str, Any]] = []
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

    normalized_key = str(key or "").strip()
    if normalized_key not in _EDITABLE_CONFIG_KEYS:
        raise HTTPException(
            status_code=400, detail=f"config key '{normalized_key}' is not editable"
        )
    os.environ[normalized_key] = str(value)
    return {
        "key": normalized_key,
        "value": value,
        "ok": True,
    }


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

    db = _get_db()
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
    # Lazy import to avoid circular dependency with ops_api
    from web.services.ops_api import _check_amsc_awos_health
    health = (
        _check_amsc_awos_health(timeout=8)
        if normalized_key == "POLYWEATHER_AMSC_SESSION_ID"
        else None
    )
    return {"ok": True, "config": response_config, "health": health}


# ── Subscriptions ───────────────────────────────────────────────────


def grant_ops_subscription(
    request: Request,
    email: str,
    plan_code: str = "pro_monthly",
    days: int = 30,
    deduct_points: int = 0,
) -> dict[str, Any]:
    admin = _require_ops(request) or {}
    actor_email = str(admin.get("email") or "").strip().lower()
    from datetime import datetime

    import web.routes as legacy_routes  # lazy – avoid circular import

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
        db = _get_db()
        deduct_result = db.deduct_points_by_supabase_email(
            normalized_email,
            safe_deduct,
            source="ops_subscription_deduction",
            actor_email=actor_email,
            reference_type="subscription",
            reference_id=user_id,
            metadata={"plan_code": plan_code, "days": safe_days},
        )
        result["points_deducted"] = safe_deduct
        result["points_result"] = deduct_result

    try:
        _get_db().append_ops_audit_event(
            action="subscription_manual_grant",
            actor_email=actor_email,
            target_user_id=user_id,
            target_email=normalized_email,
            target_type="subscription",
            payload={
                "plan_code": plan_code,
                "days": safe_days,
                "expires_at": expires_at,
                "deduct_points": safe_deduct,
            },
        )
    except Exception:
        pass

    return result


def extend_ops_subscription(
    request: Request,
    email: str,
    additional_days: int = 30,
) -> dict[str, Any]:
    admin = _require_ops(request) or {}
    actor_email = str(admin.get("email") or "").strip().lower()
    from datetime import datetime

    import web.routes as legacy_routes  # lazy – avoid circular import

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
        try:
            _get_db().append_ops_audit_event(
                action="subscription_manual_extend",
                actor_email=actor_email,
                target_user_id=user_id,
                target_email=normalized_email,
                target_type="subscription",
                target_id=str(sub.get("id") or ""),
                payload={
                    "additional_days": safe_days,
                    "previous_expires_at": current_expiry,
                    "new_expires_at": new_expiry,
                },
            )
        except Exception:
            pass
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


# ── Telegram audit ──────────────────────────────────────────────────


def get_ops_telegram_audit(request: Request) -> Dict[str, Any]:
    _require_ops(request)

    
    from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env
    # Lazy imports to avoid circular dependency with ops_api
    import web.routes as legacy_routes
    from web.services.ops.payments import _list_active_subscriptions_with_windows

    db = _get_db()

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
            resp = _requests.get(
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
