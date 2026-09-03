"""Read-only 51-city observation health overview (exit code for CI/patrol)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.database.db_manager import DBManager  # noqa: E402
from web.services.data_quality_api import build_data_quality_snapshot  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="51-city observation health overview (read-only)")
    parser.add_argument("--db", default=None, help="SQLite path (default: runtime DB)")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of table")
    args = parser.parse_args()

    db = DBManager(args.db) if args.db else DBManager()
    snapshot = build_data_quality_snapshot(db)
    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    else:
        print(f"{'City':<16}{'Source':<14}{'Station':<8}{'Age':>8}  {'Status':<12}  Fallback  Last error")
        for row in snapshot["cities"]:
            age = row["age_seconds"]
            age_text = f"{age // 60}m" if isinstance(age, int) else "--"
            print(
                f"{row['city']:<16}{str(row['source'] or '--'):<14}"
                f"{str(row['station'] or '--'):<8}{age_text:>8}  "
                f"{row['status']:<12}  {'yes' if row['fallback_in_use'] else 'no ':<8}  "
                f"{str(row['last_error'] or '')[:60]}"
            )
        print(
            f"overall={snapshot['overall']} total={snapshot['total_cities']} "
            f"counts={snapshot['status_counts']} fallback={snapshot['fallback_count']}"
        )
    overall = snapshot["overall"]
    return 0 if overall == "ok" else (1 if overall == "degraded" else 2)


if __name__ == "__main__":
    raise SystemExit(main())
