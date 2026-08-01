#!/usr/bin/env python3
"""Analyze deb_normal probability calibration on historical settlements.

For each settled (city, target_date) record with a stored deb_prediction,
rebuild the deb_normal distribution exactly as the engine does:
    mu    = deb_prediction_c + bias(lead)
    sigma = max(sigma(lead), 0.5)
    PIT   = Phi((actual_c - mu) / sigma)

Then evaluate calibration:
  - PIT histogram uniformity (overall + by temperature stratum + by lead)
  - Bucket reliability: predicted P(T==round(actual)) vs observed hit rate
  - Tail focus: strata <=32C / 33-36C / >=37C (Celsius settlement buckets)

Usage:
    python scripts/analyze_deb_normal_calibration.py [--db data/polyweather.db]
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from datetime import datetime
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

MIN_SIGMA = 0.5
LEAD_2PLUS = 2


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _lead_key(lead: int) -> int:
    return min(max(0, int(round(lead))), LEAD_2PLUS)


def _to_c(value: float, city: str) -> float:
    return (value - 32.0) * 5.0 / 9.0 if city in F_CITIES else value


def load_stats(conn) -> dict:
    row = conn.execute(
        "SELECT lead_biases_json, lead_sigmas_json FROM deb_normal_residual_stats_store "
        "WHERE stats_key = 'global'"
    ).fetchone()
    if not row:
        return {}
    return {
        "biases": json.loads(row["lead_biases_json"] or "{}"),
        "sigmas": json.loads(row["lead_sigmas_json"] or "{}"),
    }


def load_lead_by_cd(conn) -> dict:
    """Earliest snapshot timestamp per (city, target_date) -> lead in days."""
    lead_by_cd: dict = {}
    cur = conn.execute(
        "SELECT city, target_date, MIN(timestamp) AS ts "
        "FROM probability_training_snapshots_store GROUP BY city, target_date"
    )
    for city, date_str, ts in cur.fetchall():
        try:
            ts_dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            tgt_dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
            lead = (tgt_dt.date() - ts_dt.date()).days
        except Exception:
            continue
        key = (str(city).strip().lower(), str(date_str)[:10])
        if key[0] and key[1]:
            lead_by_cd[key] = min(lead_by_cd.get(key, 10**9), lead)
    return lead_by_cd


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "data" / "polyweather.db"))
    parser.add_argument("--output-json", default="")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    stats = load_stats(conn)
    if not stats or not stats["biases"]:
        print("no deb_normal stats in", args.db)
        conn.close()
        return 1
    print("deb_normal stats:", json.dumps(stats, ensure_ascii=False))

    lead_by_cd = load_lead_by_cd(conn)

    def _bias_sigma(lead_key: int):
        bias = float(stats["biases"].get(str(lead_key)) or stats["biases"].get("1") or 0.0)
        sigma = float(stats["sigmas"].get(str(lead_key)) or stats["sigmas"].get("1") or 2.5)
        return bias, max(sigma, MIN_SIGMA)

    rows = []
    cur = conn.execute(
        "SELECT city, target_date, actual_high, deb_prediction FROM daily_records_store "
        "WHERE actual_high IS NOT NULL AND deb_prediction IS NOT NULL"
    )
    for r in cur.fetchall():
        city = str(r["city"]).strip().lower()
        actual_c = _to_c(float(r["actual_high"]), city)
        deb_c = _to_c(float(r["deb_prediction"]), city)
        lead_raw = lead_by_cd.get((city, str(r["target_date"])[:10]))
        lead_key = _lead_key(lead_raw) if lead_raw is not None else 1
        bias, sigma = _bias_sigma(lead_key)
        mu = deb_c + bias
        pit = _cdf((actual_c - mu) / sigma)
        tau = round(actual_c)  # settlement rounds to whole degrees C
        p_bucket = _cdf((tau + 0.5 - mu) / sigma) - _cdf((tau - 0.5 - mu) / sigma)
        rows.append(
            {
                "city": city,
                "date": str(r["target_date"])[:10],
                "actual_c": actual_c,
                "deb_c": deb_c,
                "lead": lead_key,
                "mu": mu,
                "sigma": sigma,
                "pit": pit,
                "p_bucket": p_bucket,
                "tau": tau,
            }
        )

    print(f"\nanalyzed {len(rows)} settled records")

    def _stratum(actual_c: float) -> str:
        if actual_c <= 32:
            return "<=32C"
        if actual_c <= 36:
            return "33-36C"
        return ">=37C"

    def _report(rows_sub, label: str, out: dict):
        n = len(rows_sub)
        if n == 0:
            print(f"\n[{label}] n=0")
            return
        pits = [r["pit"] for r in rows_sub]
        mean_pit = sum(pits) / n
        var_pit = sum((p - mean_pit) ** 2 for p in pits) / n
        # chi-square against uniform over 10 bins
        bins = [0.0] * 10
        for p in pits:
            bins[min(9, int(p * 10))] += 1
        expected = n / 10.0
        chi2 = sum((b - expected) ** 2 / expected for b in bins)
        # coverage of 90% central interval
        cov90 = sum(1 for p in pits if 0.05 <= p <= 0.95) / n
        # bucket reliability: mean probability assigned to the true bucket (p>=0.05)
        bucket_rows = [r for r in rows_sub if r["p_bucket"] >= 0.05]
        mean_pred = (
            sum(r["p_bucket"] for r in bucket_rows) / len(bucket_rows) if bucket_rows else None
        )
        # tail check: p_bucket for >=37C actuals (mean prob mass on the true bucket)
        tail_rows = [r for r in rows_sub if r["actual_c"] >= 37]
        tail_mean = (
            sum(r["p_bucket"] for r in tail_rows) / len(tail_rows) if tail_rows else None
        )
        print(f"\n[{label}] n={n}")
        print(f"  PIT mean={mean_pit:.3f} (ideal 0.5)  std={math.sqrt(var_pit):.3f} (ideal 0.289)")
        print(f"  PIT bins={[round(b, 1) for b in bins]}")
        print(f"  chi2={chi2:.1f} (uniform df=9, 95% crit=16.9)")
        print(f"  90% central coverage={cov90:.3f} (ideal 0.900)")
        if mean_pred is not None:
            print(f"  bucket p>5%: mean predicted prob of true bucket={mean_pred:.3f}")
        if tail_rows:
            print(f"  >=37C tail: n={len(tail_rows)}, mean p_bucket={tail_mean:.3f}")
        out[label] = {
            "n": n,
            "pit_mean": round(mean_pit, 4),
            "pit_std": round(math.sqrt(var_pit), 4),
            "pit_bins": [round(b, 2) for b in bins],
            "chi2": round(chi2, 2),
            "cov90": round(cov90, 4),
            "bucket_mean_pred": round(mean_pred, 4) if mean_pred is not None else None,
            "tail37_n": len(tail_rows),
            "tail37_mean_p": round(tail_mean, 4) if tail_mean is not None else None,
        }

    out = {}
    _report(rows, "all", out)
    for stratum in ("<=32C", "33-36C", ">=37C"):
        sub = [r for r in rows if _stratum(r["actual_c"]) == stratum]
        _report(sub, f"stratum_{stratum}", out)
    for lead in (0, 1, 2):
        sub = [r for r in rows if r["lead"] == lead]
        _report(sub, f"lead_{lead}", out)

    if args.output_json:
        out_path = Path(args.output_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps({"db": args.db, "stats": stats, "results": out}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("\nwrote", out_path)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
