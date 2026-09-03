"""Audit invalid canonical_temperature_latest rows; repair only with --apply.

Dry-run (default): list cities whose canonical has missing/NaN temp or missing
observed_at, and what repair would do.
--apply: rebuild from the newest valid raw latest row, or delete the canonical
row when no valid source exists. Production safety first.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.database.db_manager import DBManager  # noqa: E402


def _is_valid_canonical(row: dict | None) -> bool:
    if not isinstance(row, dict):
        return False
    try:
        value = float(row.get("value"))
    except (TypeError, ValueError):
        return False
    if not math.isfinite(value):
        return False
    return bool(str(row.get("observed_at") or "").strip())


def main() -> int:
    parser = argparse.ArgumentParser(description="audit/repair invalid canonical rows")
    parser.add_argument("--db", default=None)
    parser.add_argument("--apply", action="store_true", help="actually modify the database")
    args = parser.parse_args()

    db = DBManager(args.db) if args.db else DBManager()
    cities = sorted(db.list_cities() if hasattr(db, "list_cities") else [])
    if not cities:
        from src.data_collection.city_registry import CITY_REGISTRY

        cities = sorted(CITY_REGISTRY.keys())
    invalid: list[str] = []
    for city in cities:
        try:
            row = db.get_canonical_temperature(city)
        except Exception as exc:
            print(f"{city}: read failed ({exc})")
            continue
        if row is None:
            continue
        if not _is_valid_canonical(row):
            invalid.append(city)
    if not invalid:
        print("no invalid canonical rows")
        return 0
    print(f"invalid canonical rows: {len(invalid)}")
    for city in invalid:
        action = "no valid raw source: would delete canonical row"
        try:
            rows = db.list_latest_raw_observations_for_city(city, limit=100)
            valid = [
                r
                for r in rows
                if str(r.get("status") or "").lower() == "ok"
                and r.get("value") is not None
                and str(r.get("observed_at") or "").strip()
            ]
            if valid:
                best = max(valid, key=lambda r: str(r.get("observed_at") or ""))
                action = (
                    f"would rebuild from {best.get('source')}/{best.get('station_code')} "
                    f"observed_at={best.get('observed_at')} value={best.get('value')}"
                )
        except Exception as exc:
            action = f"audit failed ({exc})"
        print(f"  {city}: {action}")
    if not args.apply:
        print("dry-run only; pass --apply to modify")
        return 0
    fixed = 0
    for city in invalid:
        try:
            rows = db.list_latest_raw_observations_for_city(city, limit=100)
            valid = [
                r
                for r in rows
                if str(r.get("status") or "").lower() == "ok"
                and r.get("value") is not None
                and str(r.get("observed_at") or "").strip()
            ]
            if not valid:
                db.delete_canonical_temperature(city)
                print(f"  {city}: deleted (no valid source)")
            else:
                from web.services.canonical_engine import (
                    build_canonical_temperature_from_observations,
                )

                canonical = build_canonical_temperature_from_observations(city, valid)
                if canonical:
                    db.set_canonical_temperature(city, canonical)
                    print(f"  {city}: rebuilt from {canonical.get('source')}")
                else:
                    print(f"  {city}: rebuild produced nothing, kept")
            fixed += 1
        except Exception as exc:
            print(f"  {city}: repair failed ({exc})")
    print(f"repaired {fixed}/{len(invalid)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
