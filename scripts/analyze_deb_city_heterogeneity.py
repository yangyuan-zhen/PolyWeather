#!/usr/bin/env python3
"""City-level residual heterogeneity vs pooled sigma.

Checks whether pooled (53-city) sigma overstates single-city uncertainty:
  - per-city mean residual (bias) and residual std
  - between-city std of mean residuals  -> how much pooled sigma is inflated
  - typical within-city sigma vs pooled sigma

Usage:
    python scripts/analyze_deb_city_heterogeneity.py [--db data/polyweather.db]
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from collections import defaultdict
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        "SELECT city, actual_high, deb_prediction FROM daily_records_store "
        "WHERE actual_high IS NOT NULL AND deb_prediction IS NOT NULL"
    )
    city_resid = defaultdict(list)
    for r in cur.fetchall():
        city = str(r["city"]).strip().lower()
        resid = _to_c(float(r["actual_high"]), city) - _to_c(float(r["deb_prediction"]), city)
        city_resid[city].append(resid)

    # Pooled stats
    all_res = [x for rs in city_resid.values() for x in rs]
    n = len(all_res)
    pooled_mean = sum(all_res) / n
    pooled_var = sum((x - pooled_mean) ** 2 for x in all_res) / n
    pooled_std = math.sqrt(pooled_var)
    print(f"pooled: n={n}  mean={pooled_mean:+.3f}  std={pooled_std:.3f}")

    # Per-city stats
    city_stats = {}
    city_means = []
    city_stds = []
    for city, rs in sorted(city_resid.items()):
        if len(rs) < 10:
            continue
        m = sum(rs) / len(rs)
        v = sum((x - m) ** 2 for x in rs) / len(rs)
        city_means.append(m)
        city_stds.append(math.sqrt(v))
        city_stats[city] = {"n": len(rs), "mean": round(m, 3), "std": round(math.sqrt(v), 3)}

    # Between-city mean spread
    b_mean = sum(city_means) / len(city_means)
    b_var = sum((m - b_mean) ** 2 for m in city_means) / len(city_means)
    b_std = math.sqrt(b_var)
    # Average within-city std
    w_std = sum(city_stds) / len(city_stds)

    print(f"cities (n>=10): {len(city_means)}")
    print(f"between-city std of mean residual (bias heterogeneity): {b_std:.3f}")
    print(f"average within-city residual std: {w_std:.3f}")
    print(f"pooled std vs within-city std ratio: {pooled_std / w_std:.3f}")
    print(
        "-> if residual = city_bias + noise, pooled var = between_var + within_var: "
        f"{pooled_var:.3f} vs {b_var + w_std**2:.3f}"
    )
    print("\nmost biased cities (top 10 abs mean):")
    for city, s in sorted(city_stats.items(), key=lambda kv: abs(kv[1]["mean"]), reverse=True)[:10]:
        print(f"  {city:16s} n={s['n']:4d}  mean={s['mean']:+.3f}  std={s['std']:.3f}")

    Path(str(ROOT / "data" / "deb_city_heterogeneity_report.json")).write_text(
        json.dumps(
            {
                "pooled": {"n": n, "mean": round(pooled_mean, 4), "std": round(pooled_std, 4)},
                "between_city_bias_std": round(b_std, 4),
                "avg_within_city_std": round(w_std, 4),
                "ratio_pooled_within": round(pooled_std / w_std, 3),
                "cities": city_stats,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("\nwrote data/deb_city_heterogeneity_report.json")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
