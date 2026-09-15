"""Prune the truth_revisions_store audit log to a bounded retention window.

truth_revisions_store is append-only: every truth backfill reconciliation
appends a revision row, so it grew ~3.2k rows/day across 51 cities (389k rows
in 122 days on production). It had no retention guard until the training
worker learned to prune it (POLYWEATHER_TRUTH_REVISIONS_RETENTION_DAYS, see
web/training_settlement_worker.py). This script performs the same prune
on demand - useful to reclaim the 389k-row backlog already accumulated
before the guard shipped.

Read-only dry run by default; pass --apply to delete.

Usage:
    python scripts/prune_truth_revisions.py [db_path] [--days 120] [--apply]
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DAYS = 120
MIN_DAYS = 30


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "db_path", nargs="?", default=str(ROOT / "data" / "polyweather.db")
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_DAYS,
        help=f"retention window in days (min {MIN_DAYS}, default {DEFAULT_DAYS})",
    )
    parser.add_argument(
        "--apply", action="store_true", help="actually delete rows (default: dry run)"
    )
    args = parser.parse_args()

    if args.days < MIN_DAYS:
        print(f"refuse: --days {args.days} below minimum {MIN_DAYS}")
        return 2

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"refuse: db not found: {db_path}")
        return 2

    cutoff = time.time() - args.days * 86400
    mode = "APPLY" if args.apply else "DRY RUN"

    conn = sqlite3.connect(db_path)
    try:
        total = conn.execute("SELECT COUNT(*) FROM truth_revisions_store").fetchone()[0]
        stale = conn.execute(
            "SELECT COUNT(*) FROM truth_revisions_store WHERE updated_at < ?",
            (cutoff,),
        ).fetchone()[0]
        db_mb_before = db_path.stat().st_size / (1024 * 1024)

        print(f"mode           : {mode}")
        print(f"db             : {db_path}")
        print(f"retention days : {args.days}")
        print(f"total rows     : {total}")
        print(
            f"rows to prune  : {stale} ({(stale / total * 100) if total else 0:.1f}%)"
        )
        print(f"db size (MB)   : {db_mb_before:.1f}")
        if stale == 0:
            print("nothing to prune")
            return 0

        if not args.apply:
            print("\ndry run only - pass --apply to delete")
            return 0

        # Cursor deletion in batches keeps the write transaction bounded on a
        # multi-hundred-k row table (a single huge DELETE would hold the write
        # lock and the WAL for a long time under SQLite).
        while True:
            conn.execute(
                "DELETE FROM truth_revisions_store WHERE id IN ("
                "SELECT id FROM truth_revisions_store "
                "WHERE updated_at < ? LIMIT 5000"
                ")",
                (cutoff,),
            )
            conn.commit()
            remaining_stale = conn.execute(
                "SELECT COUNT(*) FROM truth_revisions_store WHERE updated_at < ?",
                (cutoff,),
            ).fetchone()[0]
            if remaining_stale == 0:
                break
        remaining = conn.execute(
            "SELECT COUNT(*) FROM truth_revisions_store"
        ).fetchone()[0]
        db_mb_after = db_path.stat().st_size / (1024 * 1024)
        print(f"\npruned         : {total - remaining}")
        print(f"rows remaining : {remaining}")
        print(
            f"db size (MB)   : {db_mb_after:.1f} (was {db_mb_before:.1f}; "
            "REINDEX or VACUUM reclaims freed pages)"
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
