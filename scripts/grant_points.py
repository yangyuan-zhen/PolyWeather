#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


def main() -> int:
    from src.database.db_manager import DBManager

    parser = argparse.ArgumentParser(description="Manually grant PolyWeather points.")
    parser.add_argument("--email", required=True, help="Bound Supabase email")
    parser.add_argument("--points", type=int, required=True, help="Points to add")
    args = parser.parse_args()

    db = DBManager()
    result = db.grant_points_by_supabase_email(args.email, args.points)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

