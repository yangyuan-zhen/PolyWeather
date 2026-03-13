from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - Python < 3.9 fallback
    ZoneInfo = None  # type: ignore[assignment]

import requests
from loguru import logger

from src.database.db_manager import DBManager


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


def _safe_week_key(dt: datetime) -> str:
    iso_year, iso_week, _ = dt.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _compute_target_week_key(
    now_local: datetime,
    settle_weekday: int,
    settle_hour: int,
    settle_minute: int,
) -> str:
    week_start = (now_local - timedelta(days=now_local.isoweekday() - 1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    settle_dt = week_start + timedelta(days=settle_weekday - 1)
    settle_dt = settle_dt.replace(
        hour=settle_hour,
        minute=settle_minute,
        second=0,
        microsecond=0,
    )
    if now_local >= settle_dt:
        ref = now_local - timedelta(days=7)
    else:
        ref = now_local - timedelta(days=14)
    return _safe_week_key(ref)


def _reward_rule_for_rank(rank: int) -> Optional[Tuple[int, int]]:
    if rank == 1:
        return 500, 7
    if rank in (2, 3):
        return 300, 3
    if 4 <= rank <= 10:
        return 150, 0
    return None


def _service_headers(service_role_key: str) -> Dict[str, str]:
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _grant_bonus_subscription_days(
    *,
    supabase_url: str,
    service_role_key: str,
    user_id: str,
    days: int,
    timeout_sec: int,
) -> Tuple[bool, str, Optional[str]]:
    if not supabase_url or not service_role_key:
        return False, "supabase_not_configured", None
    uid = str(user_id or "").strip()
    if not uid:
        return False, "supabase_user_id_missing", None
    if days <= 0:
        return True, "", None

    base = supabase_url.rstrip("/")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    headers = _service_headers(service_role_key)
    try:
        resp = requests.get(
            f"{base}/rest/v1/subscriptions",
            headers=headers,
            params={
                "select": "id,expires_at",
                "user_id": f"eq.{uid}",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "1",
            },
            timeout=timeout_sec,
        )
        if resp.status_code != 200:
            return False, f"subscriptions_query_http_{resp.status_code}", None

        latest = None
        payload = resp.json() if resp.content else []
        if isinstance(payload, list) and payload:
            latest = payload[0]

        starts_at = now
        if isinstance(latest, dict):
            expires_raw = str(latest.get("expires_at") or "").strip()
            if expires_raw:
                try:
                    latest_exp = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
                    if latest_exp.tzinfo is None:
                        latest_exp = latest_exp.replace(tzinfo=timezone.utc)
                    latest_exp = latest_exp.astimezone(timezone.utc)
                    if latest_exp > starts_at:
                        starts_at = latest_exp
                except Exception:
                    pass

        expires_at = starts_at + timedelta(days=days)
        create_payload = {
            "user_id": uid,
            "plan_code": "weekly_reward_bonus",
            "status": "active",
            "starts_at": starts_at.isoformat(),
            "expires_at": expires_at.isoformat(),
            "source": "weekly_leaderboard_reward",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        ins = requests.post(
            f"{base}/rest/v1/subscriptions",
            headers={**headers, "Prefer": "return=representation"},
            json=create_payload,
            timeout=timeout_sec,
        )
        if ins.status_code not in (200, 201):
            return False, f"subscriptions_insert_http_{ins.status_code}", None
        return True, "", expires_at.isoformat()
    except Exception as exc:
        return False, f"subscriptions_error:{exc}", None


def _render_settle_report(
    week_key: str,
    winners: List[Dict[str, Any]],
    skipped: int,
) -> str:
    lines = [f"🏆 <b>PolyWeather 周榜奖励已结算 ({week_key})</b>", "────────────────────"]
    if not winners:
        lines.append("本周无有效活跃用户，未发放奖励。")
    else:
        medals = {1: "🥇", 2: "🥈", 3: "🥉"}
        for row in winners:
            rank = int(row.get("rank") or 0)
            name = str(row.get("username") or "unknown")[:16]
            points_bonus = int(row.get("points_bonus") or 0)
            pro_days = int(row.get("pro_days") or 0)
            pro_text = f" + {pro_days}天Pro" if pro_days > 0 else ""
            medal = medals.get(rank, f"{rank}.")
            lines.append(f"{medal} {name}: +{points_bonus} 积分{pro_text}")
    if skipped > 0:
        lines.append(f"（重复发放保护已生效，跳过 {skipped} 条）")
    return "\n".join(lines)


def _runner(bot: Any) -> None:
    enabled = _env_bool("POLYWEATHER_WEEKLY_REWARD_ENABLED", True)
    if not enabled:
        logger.info("weekly reward loop disabled")
        return

    tz_name = str(os.getenv("POLYWEATHER_WEEKLY_REWARD_TIMEZONE") or "Asia/Shanghai").strip()
    if ZoneInfo is None:
        local_tz = timezone(timedelta(hours=8))
        tz_name = "UTC+08:00"
    else:
        try:
            local_tz = ZoneInfo(tz_name)
        except Exception:
            local_tz = ZoneInfo("Asia/Shanghai")
            tz_name = "Asia/Shanghai"

    settle_weekday = _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_WEEKDAY", 1, 1)
    if settle_weekday > 7:
        settle_weekday = 7
    settle_hour = min(23, _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_HOUR", 0, 0))
    settle_minute = min(59, _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_MINUTE", 5, 0))
    interval_sec = _env_int("POLYWEATHER_WEEKLY_REWARD_CHECK_INTERVAL_SEC", 300, 30)
    timeout_sec = _env_int("POLYWEATHER_WEEKLY_REWARD_HTTP_TIMEOUT_SEC", 10, 3)
    announce = _env_bool("POLYWEATHER_WEEKLY_REWARD_ANNOUNCE_ENABLED", True)
    chat_id = str(os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    db = DBManager()
    logger.info(
        "weekly reward loop started tz={} settle={} {:02d}:{:02d} interval={}s announce={}",
        tz_name,
        settle_weekday,
        settle_hour,
        settle_minute,
        interval_sec,
        announce,
    )

    while True:
        try:
            now_local = datetime.now(local_tz)
            week_key = _compute_target_week_key(
                now_local,
                settle_weekday=settle_weekday,
                settle_hour=settle_hour,
                settle_minute=settle_minute,
            )
            if db.is_weekly_reward_settled(week_key):
                time.sleep(interval_sec)
                continue

            candidates = db.get_weekly_reward_candidates(week_key=week_key, limit=10)
            winners: List[Dict[str, Any]] = []
            skipped = 0
            for idx, row in enumerate(candidates, start=1):
                reward = _reward_rule_for_rank(idx)
                if reward is None:
                    continue
                points_bonus, pro_days = reward
                telegram_id = int(row.get("telegram_id") or 0)
                username = str(row.get("username") or f"user_{telegram_id}")
                supabase_user_id = str(row.get("supabase_user_id") or "").strip().lower()

                pro_granted = False
                pro_error = ""
                expires_at = None
                if pro_days > 0 and supabase_user_id:
                    pro_granted, pro_error, expires_at = _grant_bonus_subscription_days(
                        supabase_url=supabase_url,
                        service_role_key=service_role_key,
                        user_id=supabase_user_id,
                        days=pro_days,
                        timeout_sec=timeout_sec,
                    )
                elif pro_days > 0 and not supabase_user_id:
                    pro_error = "supabase_unbound"

                applied = db.apply_weekly_reward_payout(
                    week_key=week_key,
                    telegram_id=telegram_id,
                    rank=idx,
                    username=username,
                    points_bonus=points_bonus,
                    pro_days=pro_days,
                    supabase_user_id=supabase_user_id,
                    pro_granted=pro_granted,
                    pro_error=pro_error,
                )
                if not applied:
                    skipped += 1
                    continue

                winners.append(
                    {
                        "rank": idx,
                        "username": username,
                        "telegram_id": telegram_id,
                        "points_bonus": points_bonus,
                        "pro_days": pro_days,
                        "pro_granted": pro_granted,
                        "pro_error": pro_error,
                        "expires_at": expires_at,
                    }
                )

            summary = {
                "week_key": week_key,
                "winner_count": len(winners),
                "skipped_count": skipped,
                "winners": winners,
                "settled_at": datetime.now(timezone.utc).isoformat(),
            }
            db.mark_weekly_reward_settled(
                week_key=week_key,
                winners_count=len(winners),
                summary=summary,
            )
            logger.info(
                "weekly reward settled week={} winners={} skipped={}",
                week_key,
                len(winners),
                skipped,
            )
            if announce and chat_id:
                try:
                    bot.send_message(
                        chat_id,
                        _render_settle_report(week_key=week_key, winners=winners, skipped=skipped),
                        parse_mode="HTML",
                        disable_web_page_preview=True,
                    )
                except Exception as exc:
                    logger.warning(f"weekly reward announcement failed: {exc}")
        except Exception as exc:
            logger.warning(f"weekly reward cycle failed: {exc}")
        time.sleep(interval_sec)


def start_weekly_reward_loop(bot: Any):
    thread = threading.Thread(
        target=_runner,
        args=(bot,),
        daemon=True,
        name="weekly-reward-loop",
    )
    thread.start()
    return thread
