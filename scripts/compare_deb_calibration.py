#!/usr/bin/env python3
"""Compare DEB normal calibration before/after the v1.9 calibration changes.

Old logic (baseline, from data/deb_normal_calibration_report.json):
    mu    = deb_c + bias(lead)              [lead-only, pstdev-trained]
    sigma = max(sigma(lead), 0.5)           [pstdev-trained]

New logic (this branch):
    mu    = deb_c + bias(lead) + city_adj(lead, city) + temp_adj(lead, bucket(deb_c))
    sigma = max(sigma(lead), 0.5)           [MAD-robust trained]

Same settled records, same lead-by-(city,date) computation, side by side.
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
LEAD_2PLUS = 2


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _lead_key(lead: float) -> int:
    return min(max(0, int(round(lead))), LEAD_2PLUS)


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


def _eval(rows, label: str, out: dict) -> None:
    n = len(rows)
    if n == 0:
        return
    pits = [r["pit"] for r in rows]
    mean_pit = sum(pits) / n
    var_pit = sum((p - mean_pit) ** 2 for p in pits) / n
    bins = [0.0] * 10
    for p in pits:
        bins[min(9, int(p * 10))] += 1
    expected = n / 10.0
    chi2 = sum((b - expected) ** 2 / expected for b in bins)
    cov90 = sum(1 for p in pits if 0.05 <= p <= 0.95) / n
    out[label] = {
        "n": n,
        "pit_mean": round(mean_pit, 4),
        "pit_std": round(math.sqrt(var_pit), 4),
        "pit_bins": [round(b, 2) for b in bins],
        "chi2": round(chi2, 2),
        "cov90": round(cov90, 4),
    }


def main() -> int:
    conn = sqlite3.connect(str(ROOT / "data" / "polyweather.db"))
    conn.row_factory = sqlite3.Row

    # --- baseline stats frozen in the pre-change report ---
    baseline = json.loads(
        (ROOT / "data" / "deb_normal_calibration_report.json").read_text("utf-8")
    )["stats"]
    old_bias = {k: float(v) for k, v in baseline["biases"].items()}
    old_sigma = {k: float(v) for k, v in baseline["sigmas"].items()}

    # --- new stats: retrain with the current branch ---
    daily_records = DailyRecordRepository().load_all()
    print(f"daily_records: {len(daily_records)} cities loaded")
    new_stats = train_deb_lead_stats(daily_records)
    if not new_stats.get("trained"):
        print("retrain failed:", new_stats)
        return 1
    print("new lead_biases:", new_stats["lead_biases"])
    print("new lead_sigmas:", new_stats["lead_sigmas"])
    print("new city_biases:", json.dumps(new_stats.get("city_biases", {}), ensure_ascii=False))
    print("new temp_biases:", json.dumps(new_stats.get("temp_biases", {}), ensure_ascii=False))

    lead_by_cd = load_lead_by_cd(conn)

    def _old_mu_sigma(lead_key: int) -> tuple[float, float]:
        bias = old_bias.get(str(lead_key)) or old_bias.get("1") or 0.0
        sigma = old_sigma.get(str(lead_key)) or old_sigma.get("1") or 2.5
        return bias, max(sigma, MIN_SIGMA)

    def _new_mu_sigma(stats, lead_key: int, city: str, temp_key) -> tuple[float, float]:
        biases = stats.get("lead_biases") or {}
        sigmas = stats.get("lead_sigmas") or {}
        bias = biases.get(str(lead_key)) or biases.get("1") or 0.0
        sigma = sigmas.get(str(lead_key)) or sigmas.get("1") or 2.5
        city_map = (stats.get("city_biases") or {}).get(str(lead_key)) or {}
        temp_map = (stats.get("temp_biases") or {}).get(str(lead_key)) or {}
        bias += city_map.get(city, 0.0)
        if temp_key:
            bias += temp_map.get(temp_key, 0.0)
        return bias, max(sigma, MIN_SIGMA)

    def _temp_bucket(deb_c: float) -> str | None:
        if deb_c <= 32.0:
            return "<=32"
        if deb_c <= 36.0:
            return "33-36"
        return ">=37"

    old_rows, new_rows = [], []
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

        o_bias, o_sigma = _old_mu_sigma(lead_key)
        o_mu = deb_c + o_bias
        old_rows.append({"pit": _cdf((actual_c - o_mu) / o_sigma), "actual_c": actual_c, "lead": lead_key})

        n_bias, n_sigma = _new_mu_sigma(new_stats, lead_key, city, _temp_bucket(deb_c))
        n_mu = deb_c + n_bias
        new_rows.append({"pit": _cdf((actual_c - n_mu) / n_sigma), "actual_c": actual_c, "lead": lead_key})

    out = {"n": len(old_rows)}
    for label in ("all", "<=32C", "33-36C", ">=37C"):
        if label == "all":
            _eval(old_rows, f"old_{label}", out)
            _eval(new_rows, f"new_{label}", out)
        else:
            _eval([r for r in old_rows if _stratum(r["actual_c"]) == label], f"old_{label}", out)
            _eval([r for r in new_rows if _stratum(r["actual_c"]) == label], f"new_{label}", out)
    for lead in (0, 1, 2):
        _eval([r for r in old_rows if r["lead"] == lead], f"old_lead{lead}", out)
        _eval([r for r in new_rows if r["lead"] == lead], f"new_lead{lead}", out)

    def _fmt(key: str) -> str:
        v = out.get(key) or {}
        return (
            f"  n={v.get('n'):5d}  mean={v.get('pit_mean', float('nan')):.4f}  "
            f"std={v.get('pit_std', float('nan')):.4f}  chi2={v.get('chi2', float('nan')):7.1f}  "
            f"cov90={v.get('cov90', float('nan')):.4f}"
        )

    print("\n=== OLD (baseline) ===")
    for k in sorted(out):
        if k.startswith("old_"):
            print(k.ljust(14), _fmt(k))
    print("\n=== NEW (this branch) ===")
    for k in sorted(out):
        if k.startswith("new_"):
            print(k.ljust(14), _fmt(k))

    out_path = ROOT / "data" / "deb_normal_calibration_compare.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nwrote", out_path)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
