#!/usr/bin/env python3
"""Test sigma inflation factors on the authoritative calibration path.

Same evaluation as compare_deb_calibration.py (SQL lead source + stored
deb_prediction), but retrains once with the current code and re-evaluates
with sigma * scale for scale in {1.0, 1.05, 1.1, 1.15, 1.2, 1.3}.

Goal: the MAD-trained sigma leaves cov90 at ~0.82 (slightly over-confident
vs the 0.90 ideal). Find the smallest scale that lifts overall cov90 toward
0.90 without hurting PIT uniformity (chi2) or stratum means.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_probability import train_deb_lead_stats  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import DailyRecordRepository  # noqa: E402

F_CITIES = {
    str(c).strip().lower()
    for c, m in (CITY_REGISTRY or {}).items()
    if m.get("use_fahrenheit")
}
MIN_SIGMA = 0.5


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _lead_key(lead: float) -> int:
    return min(max(0, int(round(lead))), 2)


def _to_c(value: float, city: str) -> float:
    return (value - 32.0) * 5.0 / 9.0 if city in F_CITIES else value


def load_lead_by_cd(conn) -> dict:
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


def _stratum(actual_c: float) -> str:
    if actual_c <= 32:
        return "<=32C"
    if actual_c <= 36:
        return "33-36C"
    return ">=37C"


def _eval(rows, out: dict, label: str) -> None:
    n = len(rows)
    if n == 0:
        return
    pits = [r for r in rows]
    mean = sum(pits) / n
    var = sum((p - mean) ** 2 for p in pits) / n
    bins = [0.0] * 10
    for p in pits:
        bins[min(9, int(p * 10))] += 1
    exp = n / 10.0
    chi2 = sum((b - exp) ** 2 / exp for b in bins)
    cov90 = sum(1 for p in pits if 0.05 <= p <= 0.95) / n
    out[label] = {
        "n": n,
        "pit_mean": round(mean, 4),
        "pit_std": round(math.sqrt(var), 4),
        "chi2": round(chi2, 2),
        "cov90": round(cov90, 4),
    }


def _temp_bucket(deb_c: float) -> str | None:
    if deb_c <= 32.0:
        return "<=32"
    if deb_c <= 36.0:
        return "33-36"
    return ">=37"


def main() -> int:
    conn = sqlite3.connect(str(ROOT / "data" / "polyweather.db"))
    conn.row_factory = sqlite3.Row

    daily_records = DailyRecordRepository().load_all()
    stats = train_deb_lead_stats(daily_records)
    if not stats.get("trained"):
        print("retrain failed:", stats)
        return 1
    print("lead_biases:", stats["lead_biases"])
    print("lead_sigmas:", stats["lead_sigmas"])

    lead_by_cd = load_lead_by_cd(conn)
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
        lk = _lead_key(lead_raw) if lead_raw is not None else 1

        biases = stats.get("lead_biases") or {}
        sigmas = stats.get("lead_sigmas") or {}
        bias = biases.get(str(lk)) or biases.get("1") or 0.0
        sigma = sigmas.get(str(lk)) or sigmas.get("1") or 2.5
        city_map = (stats.get("city_biases") or {}).get(str(lk)) or {}
        temp_map = (stats.get("temp_biases") or {}).get(str(lk)) or {}
        bias += city_map.get(city, 0.0)
        tk = _temp_bucket(deb_c)
        if tk:
            bias += temp_map.get(tk, 0.0)
        rows.append((lk, actual_c, deb_c, bias, max(sigma, MIN_SIGMA)))

    out: dict = {}
    for scale in (1.0, 1.05, 1.1, 1.15, 1.2, 1.3):
        pits_by_scale: dict = {}
        for lk, actual_c, deb_c, bias, sigma in rows:
            pits_by_scale.setdefault(lk, []).append(
                (_cdf((actual_c - (deb_c + bias)) / (sigma * scale)), actual_c)
            )
        all_pits = [p for sub in pits_by_scale.values() for p in sub]
        _eval([p for p, _ in all_pits], out, f"s{scale:.2f}_all")
        for s in ("<=32C", "33-36C", ">=37C"):
            _eval([p for p, a in all_pits if _stratum(a) == s], out, f"s{scale:.2f}_{s}")

    def _fmt(v):
        return (
            f"n={v.get('n'):5d}  mean={v.get('pit_mean', float('nan')):.4f}  "
            f"std={v.get('pit_std', float('nan')):.4f}  chi2={v.get('chi2', float('nan')):7.1f}  "
            f"cov90={v.get('cov90', float('nan')):.4f}"
        )

    for k in sorted(out):
        if k.endswith("_all") or k in ("s1.00_<=32C", "s1.10_<=32C", "s1.20_<=32C",
                                       "s1.00_33-36C", "s1.10_33-36C", "s1.20_33-36C",
                                       "s1.00_>=37C", "s1.10_>=37C", "s1.20_>=37C"):
            print(k.ljust(12), _fmt(out[k]))

    out_path = ROOT / "data" / "deb_sigma_scale_test.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nwrote", out_path)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
