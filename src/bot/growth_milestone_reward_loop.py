from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from loguru import logger

from src.database.db_manager import DBManager
from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, min_value: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return max(min_value, value)


def _service_headers(service_role_key: str, prefer: str = "") -> Dict[str, str]:
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _parse_datetime(value: object) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def reached_growth_milestones(verified_users: int) -> List[Tuple[int, int]]:
    count = max(0, int(verified_users or 0))
    reached: List[Tuple[int, int]] = []
    if count >= 600:
        reached.append((600, 1))
    if count >= 750:
        reached.append((750, 2))
    if count >= 1000:
        reached.extend((milestone, 3) for milestone in range(1000, count + 1, 100))
    return reached


def select_eligible_paid_user_ids(
    subscriptions: Iterable[Dict[str, Any]],
    confirmed_payments: Iterable[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> List[str]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    paid_user_ids = {
        str(row.get("user_id") or "").strip().lower()
        for row in confirmed_payments
        if str(row.get("status") or "").strip().lower() == "confirmed"
        and str(row.get("user_id") or "").strip()
    }
    active_user_ids = set()
    for row in subscriptions:
        user_id = str(row.get("user_id") or "").strip().lower()
        if not user_id or str(row.get("status") or "").strip().lower() != "active":
            continue
        starts_at = _parse_datetime(row.get("starts_at"))
        expires_at = _parse_datetime(row.get("expires_at"))
        if starts_at and starts_at > current:
            continue
        if not expires_at or expires_at <= current:
            continue
        active_user_ids.add(user_id)
    return sorted(active_user_ids & paid_user_ids)


def fetch_auth_user_counts(
    *,
    supabase_url: str,
    service_role_key: str,
    timeout_sec: int,
) -> Dict[str, int]:
    users: List[Dict[str, Any]] = []
    page = 1
    base = supabase_url.rstrip("/")
    headers = _service_headers(service_role_key)
    while True:
        response = requests.get(
            f"{base}/auth/v1/admin/users",
            headers=headers,
            params={"page": page, "per_page": 1000},
            timeout=timeout_sec,
        )
        if response.status_code != 200:
            raise RuntimeError(f"auth_users_http_{response.status_code}")
        payload = response.json() if response.content else {}
        batch = payload.get("users", []) if isinstance(payload, dict) else []
        rows = [row for row in batch if isinstance(row, dict)]
        users.extend(rows)
        if len(rows) < 1000:
            break
        page += 1
    return {
        "total_registered": len(users),
        "verified_users": sum(
            1
            for user in users
            if user.get("email_confirmed_at")
            or user.get("phone_confirmed_at")
            or user.get("confirmed_at")
        ),
        "ever_signed_in": sum(1 for user in users if user.get("last_sign_in_at")),
    }


def _fetch_rows(
    *,
    supabase_url: str,
    service_role_key: str,
    table: str,
    params: Dict[str, str],
    timeout_sec: int,
) -> List[Dict[str, Any]]:
    response = requests.get(
        f"{supabase_url.rstrip('/')}/rest/v1/{table}",
        headers=_service_headers(service_role_key),
        params=params,
        timeout=timeout_sec,
    )
    if response.status_code != 200:
        raise RuntimeError(f"{table}_http_{response.status_code}")
    payload = response.json() if response.content else []
    return [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []


def fetch_current_subscriptions_and_confirmed_payments(
    *,
    supabase_url: str,
    service_role_key: str,
    timeout_sec: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    now_iso = datetime.now(timezone.utc).isoformat()
    subscriptions = _fetch_rows(
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        table="subscriptions",
        params={
            "select": "user_id,status,starts_at,expires_at",
            "status": "eq.active",
            "starts_at": f"lte.{now_iso}",
            "expires_at": f"gt.{now_iso}",
            "limit": "5000",
        },
        timeout_sec=timeout_sec,
    )
    confirmed = _fetch_rows(
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        table="payments",
        params={
            "select": "user_id,status",
            "status": "eq.confirmed",
            "limit": "5000",
        },
        timeout_sec=timeout_sec,
    )
    return subscriptions, confirmed


def grant_growth_milestone_days(
    *,
    supabase_url: str,
    service_role_key: str,
    user_id: str,
    milestone: int,
    days: int,
    timeout_sec: int,
) -> Tuple[bool, str, Optional[str]]:
    uid = str(user_id or "").strip().lower()
    if not supabase_url or not service_role_key:
        return False, "supabase_not_configured", None
    if not uid:
        return False, "supabase_user_id_missing", None
    safe_days = max(1, int(days or 0))
    source = f"growth_milestone_reward_{int(milestone)}"
    base = supabase_url.rstrip("/")
    headers = _service_headers(service_role_key)
    now = datetime.now(timezone.utc)
    try:
        existing = requests.get(
            f"{base}/rest/v1/subscriptions",
            headers=headers,
            params={
                "select": "expires_at",
                "user_id": f"eq.{uid}",
                "source": f"eq.{source}",
                "limit": "1",
            },
            timeout=timeout_sec,
        )
        if existing.status_code != 200:
            return False, f"idempotency_query_http_{existing.status_code}", None
        existing_rows = existing.json() if existing.content else []
        if isinstance(existing_rows, list) and existing_rows:
            return True, "already_granted", str(existing_rows[0].get("expires_at") or "") or None

        current = requests.get(
            f"{base}/rest/v1/subscriptions",
            headers=headers,
            params={
                "select": "expires_at",
                "user_id": f"eq.{uid}",
                "status": "eq.active",
                "expires_at": f"gt.{now.isoformat()}",
                "order": "expires_at.desc",
                "limit": "1",
            },
            timeout=timeout_sec,
        )
        if current.status_code != 200:
            return False, f"subscriptions_query_http_{current.status_code}", None
        rows = current.json() if current.content else []
        starts_at = now
        if isinstance(rows, list) and rows:
            latest_expiry = _parse_datetime(rows[0].get("expires_at"))
            if latest_expiry and latest_expiry > starts_at:
                starts_at = latest_expiry
        expires_at = starts_at + timedelta(days=safe_days)
        payload = {
            "user_id": uid,
            "plan_code": "growth_milestone_bonus",
            "status": "active",
            "starts_at": starts_at.isoformat(),
            "expires_at": expires_at.isoformat(),
            "source": source,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        created = requests.post(
            f"{base}/rest/v1/subscriptions",
            headers=_service_headers(service_role_key, "return=minimal"),
            json=payload,
            timeout=timeout_sec,
        )
        if created.status_code not in (200, 201):
            return False, f"subscriptions_insert_http_{created.status_code}", None
        return True, "", expires_at.isoformat()
    except Exception as exc:
        return False, f"subscriptions_error:{exc}", None


def _render_announcement(milestone: int, days: int, rewarded_count: int) -> str:
    return "\n".join(
        [
            f"🎉 <b>PolyWeather Growth Reward: {milestone} verified users</b>",
            f"Active paid members received <b>+{days} Pro day{'s' if days != 1 else ''}</b>. Rewarded members: {rewarded_count}.",
            "",
            f"🎉 <b>PolyWeather 增长奖励：已验证用户达到 {milestone}</b>",
            f"当前有效付费会员已获得 <b>+{days} 天 Pro</b>。本次奖励人数：{rewarded_count}。",
        ]
    )


def run_growth_milestone_cycle(
    *,
    bot: Any,
    db: DBManager,
    supabase_url: str,
    service_role_key: str,
    timeout_sec: int,
    announce: bool,
    chat_ids: Iterable[int],
) -> Dict[str, Any]:
    counts = fetch_auth_user_counts(
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        timeout_sec=timeout_sec,
    )
    today = datetime.now(timezone.utc).date().isoformat()
    db.record_user_growth_snapshot(snapshot_date=today, **counts)
    settlements: List[Dict[str, Any]] = []
    for milestone, days in reached_growth_milestones(counts["verified_users"]):
        if db.is_growth_milestone_settled(milestone):
            continue
        frozen_payouts = db.list_growth_milestone_payouts(milestone)
        if frozen_payouts:
            eligible = sorted(
                {
                    str(row.get("supabase_user_id") or "").strip().lower()
                    for row in frozen_payouts
                    if str(row.get("supabase_user_id") or "").strip()
                }
            )
        else:
            subscriptions, confirmed = fetch_current_subscriptions_and_confirmed_payments(
                supabase_url=supabase_url,
                service_role_key=service_role_key,
                timeout_sec=timeout_sec,
            )
            eligible = select_eligible_paid_user_ids(subscriptions, confirmed)
            for user_id in eligible:
                db.record_growth_milestone_payout(
                    milestone,
                    user_id,
                    days,
                    "pending",
                    "",
                )
        rewarded = 0
        failed = 0
        for user_id in eligible:
            if db.has_growth_milestone_payout(milestone, user_id):
                rewarded += 1
                continue
            ok, reason, expires_at = grant_growth_milestone_days(
                supabase_url=supabase_url,
                service_role_key=service_role_key,
                user_id=user_id,
                milestone=milestone,
                days=days,
                timeout_sec=timeout_sec,
            )
            db.record_growth_milestone_payout(
                milestone,
                user_id,
                days,
                "granted" if ok else "failed",
                reason,
                expires_at=expires_at or "",
            )
            if ok:
                rewarded += 1
            else:
                failed += 1
        summary = {
            "milestone": milestone,
            "verified_users": counts["verified_users"],
            "reward_days": days,
            "eligible_count": len(eligible),
            "rewarded_count": rewarded,
            "failed_count": failed,
        }
        if failed == 0:
            db.mark_growth_milestone_settled(
                milestone,
                counts["verified_users"],
                days,
                rewarded,
                failed,
                summary,
            )
            if announce:
                message = _render_announcement(milestone, days, rewarded)
                for chat_id in chat_ids:
                    try:
                        bot.send_message(
                            chat_id,
                            message,
                            parse_mode="HTML",
                            disable_web_page_preview=True,
                        )
                    except Exception as exc:
                        logger.warning(
                            "growth milestone announcement failed milestone={} chat_id={} error={}",
                            milestone,
                            chat_id,
                            exc,
                        )
        settlements.append(summary)
    return {"counts": counts, "settlements": settlements}


def _runner(bot: Any) -> None:
    if not _env_bool("POLYWEATHER_GROWTH_REWARD_ENABLED", False):
        logger.info("growth milestone reward loop disabled")
        return
    interval_sec = _env_int("POLYWEATHER_GROWTH_REWARD_CHECK_INTERVAL_SEC", 21600, 300)
    timeout_sec = _env_int("POLYWEATHER_GROWTH_REWARD_HTTP_TIMEOUT_SEC", 15, 3)
    announce = _env_bool("POLYWEATHER_GROWTH_REWARD_ANNOUNCE_ENABLED", True)
    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    chat_ids = get_telegram_chat_ids_from_env()
    db = DBManager()
    logger.info(
        "growth milestone reward loop started interval={}s announce={} chat_targets={}",
        interval_sec,
        announce,
        len(chat_ids),
    )
    while True:
        try:
            run_growth_milestone_cycle(
                bot=bot,
                db=db,
                supabase_url=supabase_url,
                service_role_key=service_role_key,
                timeout_sec=timeout_sec,
                announce=announce,
                chat_ids=chat_ids,
            )
        except Exception as exc:
            logger.warning(f"growth milestone reward cycle failed: {exc}")
        time.sleep(interval_sec)


def start_growth_milestone_reward_loop(bot: Any):
    thread = threading.Thread(
        target=_runner,
        args=(bot,),
        daemon=True,
        name="growth-milestone-reward-loop",
    )
    thread.start()
    return thread
