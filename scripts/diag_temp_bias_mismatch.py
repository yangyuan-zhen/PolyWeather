#!/usr/bin/env python3
"""Diagnose temp-bias mismatch: train-time stratification (by raw_c forecast)
vs eval-time stratification (by actual_c). Check hit rates per stratum."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402

F_CITIES = {
    str(c).strip().lower()
    for c, m in (CITY_REGISTRY or {}).items()
    if m.get("use_fahrenheit")
}


def _to_c(value: float, city: str) -> float:
    return (value - 32.0) * 5.0 / 9.0 if city in F_CITIES else value


def _bucket(c: float) -> str:
    if c <= 32.0:
        return "<=32"
    if c <= 36.0:
        return "33-36"
    return ">=37"


def main() -> int:
    conn = sqlite3.connect(str(ROOT / "data" / "polyweather.db"))
    conn.row_factory = sqlite3.Row
    rows = []
    for r in conn.execute(
        "SELECT city, target_date, actual_high, deb_prediction FROM daily_records_store "
        "WHERE actual_high IS NOT NULL AND deb_prediction IS NOT NULL"
    ).fetchall():
        city = str(r["city"]).strip().lower()
        rows.append(
            {
                "city": city,
                "actual_c": _to_c(float(r["actual_high"]), city),
                "deb_c": _to_c(float(r["deb_prediction"]), city),
            }
        )

    from collections import Counter

    print("=== actual-stratum x forecast-stratum cross table ===")
    cross = Counter((_bucket(r["actual_c"]), _bucket(r["deb_c"])) for r in rows)
    for a in ("<=32", "33-36", ">=37"):
        line = []
        for f in ("<=32", "33-36", ">=37"):
            line.append(f"{a}->{f}:{cross.get((a, f), 0)}")
        print("  " + "  ".join(line))

    print("\n=== >=37 actuals: forecast distribution & mean deb ===")
    hot = [r for r in rows if r["actual_c"] >= 37]
    print(f"  n={len(hot)}")
    for f in ("<=32", "33-36", ">=37"):
        sub = [r for r in hot if _bucket(r["deb_c"]) == f]
        if sub:
            mean_deb = sum(r["deb_c"] for r in sub) / len(sub)
            mean_act = sum(r["actual_c"] for r in sub) / len(sub)
            print(f"  forecast-bucket {f}: n={len(sub)}  mean_deb={mean_deb:.2f}  mean_actual={mean_act:.2f}")

    print("\n=== 33-36 actuals ===")
    warm = [r for r in rows if 32 < r["actual_c"] <= 36]
    print(f"  n={len(warm)}")
    for f in ("<=32", "33-36", ">=37"):
        sub = [r for r in warm if _bucket(r["deb_c"]) == f]
        if sub:
            mean_deb = sum(r["deb_c"] for r in sub) / len(sub)
            mean_act = sum(r["actual_c"] for r in sub) / len(sub)
            print(f"  forecast-bucket {f}: n={len(sub)}  mean_deb={mean_deb:.2f}  mean_actual={mean_act:.2f}")

    print("\n=== forecast >=37 (train-time stratum): actual outcome ===")
    fhot = [r for r in rows if _bucket(r["deb_c"]) == ">=37"]
    print(f"  n={len(fhot)}")
    for a in ("<=32", "33-36", ">=37"):
        sub = [r for r in fhot if _bucket(r["actual_c"]) == a]
        if sub:
            mean_deb = sum(r["deb_c"] for r in sub) / len(sub)
            mean_act = sum(r["actual_c"] for r in sub) / len(sub)
            print(f"  actual-bucket {a}: n={len(sub)}  mean_deb={mean_deb:.2f}  mean_actual={mean_act:.2f}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
