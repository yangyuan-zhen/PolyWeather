#!/usr/bin/env python3
"""Per-model and DEB-blend MAE by temperature stratum.

Checks the review claim that inverse-MAE weights are insensitive to extremes:
does the model that wins on >=37C days also win on <=32C days? Does the blend
outperform every member on hot days?

Usage:
    python scripts/analyze_deb_mae_by_stratum.py [--db data/polyweather.db]
"""

from __future__ import annotations

import argparse
import json
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

MODEL_ORDER = ["ECMWF", "GFS", "ICON", "GEM", "JMA", "Open-Meteo"]


def _to_c(value: float, city: str) -> float:
    return (value - 32.0) * 5.0 / 9.0 if city in F_CITIES else value


def _stratum(actual_c: float) -> str:
    if actual_c <= 32:
        return "<=32C"
    if actual_c <= 36:
        return "33-36C"
    return ">=37C"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument("--output-json", default="")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    errs = defaultdict(lambda: defaultdict(list))  # stratum -> model -> [|err|]
    blend_errs = defaultdict(list)
    cur = conn.execute(
        "SELECT city, target_date, actual_high, deb_prediction, payload_json "
        "FROM daily_records_store WHERE actual_high IS NOT NULL AND payload_json IS NOT NULL"
    )
    n_total = 0
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
        stratum = _stratum(actual_c)
        n_total += 1
        for m, v in fc.items():
            if v is None:
                continue
            try:
                v_c = _to_c(float(v), city)
            except (TypeError, ValueError):
                continue
            key = next((k for k in MODEL_ORDER if k.lower() in str(m).lower()), None)
            if key:
                errs[stratum][key].append(abs(actual_c - v_c))
        deb_c = _to_c(float(r["deb_prediction"]), city)
        if deb_c is not None:
            blend_errs[stratum].append(abs(actual_c - deb_c))

    print(f"records: {n_total}\n")
    for stratum in ("<=32C", "33-36C", ">=37C"):
        print(f"== {stratum} ==")
        rows = []
        for m in MODEL_ORDER:
            es = errs[stratum][m]
            if es:
                mae = sum(es) / len(es)
                rows.append((m, len(es), mae))
                print(f"  {m:12s} n={len(es):5d}  MAE={mae:.3f}")
        if rows:
            best = min(rows, key=lambda x: x[2])
            print(f"  -> best model: {best[0]} (MAE {best[2]:.3f})")
        be = blend_errs[stratum]
        if be:
            bmae = sum(be) / len(be)
            print(f"  DEB blend    n={len(be):5d}  MAE={bmae:.3f}")
            if rows:
                rows_sorted = sorted(rows, key=lambda x: x[2])
                rank = 1 + next(
                    (i for i, (m, _, mae) in enumerate(rows_sorted) if bmae <= mae),
                    len(rows_sorted),
                )
                print(f"  -> blend rank among {len(rows_sorted)} models: {rank}")
        print()

    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps(
                {
                    "stratum_mae": {
                        s: {
                            "models": {
                                m: round(sum(es) / len(es), 4)
                                for m in MODEL_ORDER
                                if (es := errs[s][m])
                            },
                            "blend": (
                                round(sum(be) / len(be), 4) if (be := blend_errs[s]) else None
                            ),
                        }
                        for s in ("<=32C", "33-36C", ">=37C")
                    }
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("wrote", args.output_json)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
