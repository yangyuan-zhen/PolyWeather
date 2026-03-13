#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore[assignment]


def compute_target_week_key(
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
    ref = now_local - timedelta(days=7 if now_local >= settle_dt else 14)
    iso_year, iso_week, _ = ref.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def resolve_tz(tz_name: str):
    if ZoneInfo is None:
        return timezone(timedelta(hours=8)), "UTC+08:00"
    try:
        return ZoneInfo(tz_name), tz_name
    except Exception:
        return ZoneInfo("Asia/Shanghai"), "Asia/Shanghai"


def get_candidates(conn: sqlite3.Connection, week_key: str, limit: int):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT *
        FROM (
            SELECT
                u.telegram_id,
                u.username,
                lower(trim(COALESCE(u.supabase_user_id, ''))) AS supabase_user_id,
                COALESCE(u.points, 0) AS points,
                COALESCE(u.message_count, 0) AS message_count,
                COALESCE(a.points,
                    CASE
                        WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                        ELSE 0
                    END
                ) AS weekly_points
            FROM users u
            LEFT JOIN weekly_points_archive a
                ON a.telegram_id = u.telegram_id
                AND a.week_key = ?
        ) ranked
        WHERE weekly_points > 0
        ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
        LIMIT ?
        """,
        (week_key, week_key, max(1, int(limit))),
    ).fetchall()
    return [dict(r) for r in rows]


def get_settle_run(conn: sqlite3.Connection, week_key: str) -> Optional[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT week_key, settled_at, winners_count
        FROM weekly_reward_runs
        WHERE week_key = ?
        LIMIT 1
        """,
        (week_key,),
    ).fetchone()


def get_recent_runs(conn: sqlite3.Connection, limit: int = 5):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT week_key, settled_at, winners_count
        FROM weekly_reward_runs
        ORDER BY settled_at DESC
        LIMIT ?
        """,
        (max(1, int(limit)),),
    ).fetchall()
    return [dict(r) for r in rows]


def get_recent_payouts(conn: sqlite3.Connection, limit: int = 20):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT week_key, telegram_id, username, rank, points_bonus, pro_days, pro_granted, pro_error, created_at
        FROM weekly_reward_payouts
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (max(1, int(limit)),),
    ).fetchall()
    return [dict(r) for r in rows]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check PolyWeather weekly reward settlement status.")
    parser.add_argument("--db", default=os.getenv("POLYWEATHER_DB_PATH", "data/polyweather.db"))
    parser.add_argument("--timezone", default=os.getenv("POLYWEATHER_WEEKLY_REWARD_TIMEZONE", "Asia/Shanghai"))
    parser.add_argument("--settle-weekday", type=int, default=int(os.getenv("POLYWEATHER_WEEKLY_REWARD_SETTLE_WEEKDAY", "1")))
    parser.add_argument("--settle-hour", type=int, default=int(os.getenv("POLYWEATHER_WEEKLY_REWARD_SETTLE_HOUR", "0")))
    parser.add_argument("--settle-minute", type=int, default=int(os.getenv("POLYWEATHER_WEEKLY_REWARD_SETTLE_MINUTE", "5")))
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args()

    settle_weekday = min(7, max(1, int(args.settle_weekday)))
    settle_hour = min(23, max(0, int(args.settle_hour)))
    settle_minute = min(59, max(0, int(args.settle_minute)))
    tz, tz_label = resolve_tz(str(args.timezone).strip() or "Asia/Shanghai")
    now_local = datetime.now(tz)
    week_key = compute_target_week_key(
        now_local,
        settle_weekday=settle_weekday,
        settle_hour=settle_hour,
        settle_minute=settle_minute,
    )

    print("=== Weekly Reward Status ===")
    print(f"db={args.db}")
    print(f"now_local={now_local.isoformat()}")
    print(f"timezone={tz_label}")
    print(f"settle_rule=weekday:{settle_weekday} time:{settle_hour:02d}:{settle_minute:02d}")
    print(f"target_week={week_key}")

    with sqlite3.connect(args.db) as conn:
        run = get_settle_run(conn, week_key)
        print(f"settled={bool(run)}")
        if run:
            print(f"settled_at={run['settled_at']} winners_count={run['winners_count']}")

        candidates = get_candidates(conn, week_key, args.top)
        print(f"candidates={len(candidates)}")
        for idx, row in enumerate(candidates, start=1):
            print(
                f"  {idx}. {row.get('username')} "
                f"(tg={row.get('telegram_id')}, weekly={row.get('weekly_points')}, total={row.get('points')})"
            )

        print("\nrecent_runs:")
        runs = get_recent_runs(conn, limit=5)
        if not runs:
            print("  (none)")
        else:
            for row in runs:
                print(
                    f"  - {row.get('week_key')} settled_at={row.get('settled_at')} "
                    f"winners={row.get('winners_count')}"
                )

        print("\nrecent_payouts:")
        payouts = get_recent_payouts(conn, limit=20)
        if not payouts:
            print("  (none)")
        else:
            for row in payouts:
                print(
                    f"  - week={row.get('week_key')} rank={row.get('rank')} "
                    f"user={row.get('username')} tg={row.get('telegram_id')} "
                    f"+{row.get('points_bonus')}pts +{row.get('pro_days')}dPro "
                    f"pro_granted={row.get('pro_granted')}"
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

