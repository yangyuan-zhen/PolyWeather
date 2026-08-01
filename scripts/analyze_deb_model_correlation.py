#!/usr/bin/env python3
"""Quantify inter-model residual correlation and effective sample size for DEB.

For each settled record with per-model forecasts stored in daily_records_store
payload, compute per-model residuals (actual - forecast), then:
  - pairwise residual correlation matrix
  - mean pairwise rho (after family dedup? raw set)
  - effective degrees of freedom / variance inflation for the equal-weight blend
  - how much sigma(lead) would need to shrink if residuals were independent

Usage:
    python scripts/analyze_deb_model_correlation.py [--db data/polyweather.db]
"""

from __future__ import annotations

import argparse
import json
import math
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

# Models expected in daily_records payload forecasts (DEB pool).
MODEL_ORDER = ["ECMWF", "GFS", "ICON", "GEM", "JMA", "Open-Meteo"]


def _to_c(value: float, city: str) -> float:
    return (value - 32.0) * 5.0 / 9.0 if city in F_CITIES else value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument("--output-json", default="")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    # Collect per-model residuals per (city, date)
    residuals = {m: [] for m in MODEL_ORDER}
    pairs = []
    n_with_models = 0
    cur = conn.execute(
        "SELECT city, target_date, actual_high, payload_json FROM daily_records_store "
        "WHERE actual_high IS NOT NULL AND payload_json IS NOT NULL"
    )
    for r in cur.fetchall():
        city = str(r["city"]).strip().lower()
        try:
            p = json.loads(r["payload_json"] or "{}")
        except Exception:
            continue
        fc = p.get("forecasts")
        if not isinstance(fc, dict) or not fc:
            continue
        actual_c = _to_c(float(r["actual_high"]), city)
        row_vals = {}
        for m, v in fc.items():
            if v is None:
                continue
            try:
                v_c = _to_c(float(v), city)
            except (TypeError, ValueError):
                continue
            # match canonical model name
            key = next((k for k in MODEL_ORDER if k.lower() in str(m).lower()), None)
            if key:
                row_vals[key] = v_c
        if len(row_vals) >= 2:
            n_with_models += 1
            pairs.append(row_vals)
            for m, v in row_vals.items():
                residuals[m].append(actual_c - v)

    print(f"settled records with >=2 model forecasts: {n_with_models}")
    print("\nper-model residual stats (C):")
    per_model = {}
    for m in MODEL_ORDER:
        rs = residuals[m]
        if not rs:
            continue
        n = len(rs)
        mean = sum(rs) / n
        var = sum((x - mean) ** 2 for x in rs) / n
        per_model[m] = {
            "n": n,
            "mean": round(mean, 3),
            "std": round(math.sqrt(var), 3),
        }
        print(f"  {m:12s} n={n:5d}  mean={mean:+.3f}  std={math.sqrt(var):.3f}")

    # Pairwise correlation on rows that have BOTH models
    print("\npairwise residual correlation matrix:")
    active = [m for m in MODEL_ORDER if residuals[m]]
    corr = {}
    for i, m1 in enumerate(active):
        row_str = []
        for j, m2 in enumerate(active):
            if j < i:
                row_str.append("       ")
                continue
            if m1 == m2:
                row_str.append("  1.000")
                continue
            xs = []
            ys = []
            for row in pairs:
                if m1 in row and m2 in row:
                    xs.append(row[m1])
                    ys.append(row[m2])
            if len(xs) < 10:
                row_str.append("  n/a  ")
                continue
            mx = sum(xs) / len(xs)
            my = sum(ys) / len(ys)
            cov = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / len(xs)
            sx = math.sqrt(sum((a - mx) ** 2 for a in xs) / len(xs))
            sy = math.sqrt(sum((b - my) ** 2 for b in ys) / len(ys))
            rho = cov / (sx * sy) if sx > 0 and sy > 0 else 0.0
            corr[(m1, m2)] = {"n": len(xs), "rho": round(rho, 3)}
            row_str.append(f"{rho:7.3f}")
        print(f"  {m1:12s} " + " ".join(row_str))

    # Mean pairwise rho (unweighted, across model pairs)
    rho_vals = [v["rho"] for v in corr.values() if v["n"] >= 10]
    if rho_vals:
        rho_bar = sum(rho_vals) / len(rho_vals)
        k = len(active)
        # variance inflation for equal-weight blend: var(mean) = sigma^2/k * (1 + (k-1)*rho)
        vif = 1.0 + (k - 1) * rho_bar
        # effective number of independent models
        k_eff = k / vif
        print(f"\nmean pairwise rho = {rho_bar:.3f}  (pairs used: {len(rho_vals)})")
        print(f"n_models = {k}, variance inflation factor = {vif:.3f}")
        print(f"effective independent models k_eff = {k_eff:.2f}")
        # if residuals were independent, sigma of blend would shrink by sqrt(1/k) vs sqrt(vif/k)
        print(
            f"blend std ratio: correlated={math.sqrt(vif / k):.3f} vs independent={math.sqrt(1 / k):.3f}"
            f" -> correlation inflates blend uncertainty by x{math.sqrt(vif):.3f}"
        )

    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps(
                {
                    "db": args.db,
                    "n_records": n_with_models,
                    "per_model": per_model,
                    "corr": {f"{a}|{b}": v for (a, b), v in corr.items()},
                    "rho_bar": round(rho_bar, 4) if rho_vals else None,
                    "vif": round(vif, 4) if rho_vals else None,
                    "k_eff": round(k_eff, 3) if rho_vals else None,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("\nwrote", args.output_json)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
