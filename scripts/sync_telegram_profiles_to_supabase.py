from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from typing import Any

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def main() -> None:
    from src.database.db_manager import DBManager

    parser = argparse.ArgumentParser(
        description="Backfill Supabase public.profiles.telegram_* fields from local SQLite bindings.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print rows that would be synced without writing to Supabase.",
    )
    args = parser.parse_args()

    db = DBManager()
    synced = 0
    skipped = 0
    rows_out: list[dict[str, Any]] = []

    with db._get_connection() as conn:  # noqa: SLF001
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
                lower(trim(COALESCE(b.supabase_user_id, ''))) AS supabase_user_id,
                b.telegram_id AS telegram_id,
                COALESCE(u.username, '') AS telegram_username
            FROM supabase_bindings b
            LEFT JOIN users u
                ON u.telegram_id = b.telegram_id
            WHERE trim(COALESCE(b.supabase_user_id, '')) <> ''
            ORDER BY b.updated_at DESC, b.supabase_user_id ASC
            """
        ).fetchall()

    for row in rows:
        supabase_user_id = str(row["supabase_user_id"] or "").strip().lower()
        if not supabase_user_id:
            skipped += 1
            continue
        telegram_id = int(row["telegram_id"] or 0)
        telegram_username = str(row["telegram_username"] or "").strip()
        payload = {
            "supabase_user_id": supabase_user_id,
            "telegram_id": telegram_id,
            "telegram_username": telegram_username or None,
        }
        rows_out.append(payload)
        if args.dry_run:
            continue
        ok = db._sync_supabase_profile_telegram_fields(  # noqa: SLF001
            supabase_user_id=supabase_user_id,
            telegram_id=telegram_id,
            telegram_username=telegram_username,
        )
        if ok:
            synced += 1
        else:
            skipped += 1

    if args.dry_run:
        print(
            {
                "mode": "dry_run",
                "rows": len(rows_out),
                "items": rows_out,
            }
        )
        return

    print(
        {
            "mode": "sync",
            "synced": synced,
            "skipped": skipped,
            "rows": len(rows_out),
        }
    )


if __name__ == "__main__":
    main()
