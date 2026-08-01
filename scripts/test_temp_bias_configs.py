#!/usr/bin/env python3
"""Parametric test: how temp-bias config (MIN_ADJUST_SAMPLES / cap) affects
actual-stratified PIT calibration. Uses stored-deb residual basis (matches
inference). Configs:
  A) MIN_ADJUST_SAMPLES=30 (drops >=37 lead1 n=17, >=37 lead0 n=27)
  B) MIN_ADJUST_SAMPLES=30 + cap |adj|<=0.5
  C) temp biases disabled (city biases only)
  D) current code (MIN_ADJUST_SAMPLES=10, no cap)
"""

from __future__ import annotations

import json
import math
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_algorithm import calculate_dynamic_weight_components  # noqa: E402
from src.analysis.deb_probability import _lead_key, _temp_bucket_key  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import DailyRecordRepository, ProbabilitySnapshotRepository  # noqa: E402

F_CITIES = {
    str(c).strip().lower()
    for c, m in (CITY_REGISTRY or {}).items()
    if m.get("use_fahrenheit")
}
MIN_SIGMA = 0.5
BIAS_SHRINK_K = 5.0


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _to_c(value, city: str):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return (v - 32.0) * 5.0 / 9.0 if city in F_CITIES else v


def load_lead_by_cd() -> dict:
    lead_by_cd: dict = {}
    try:
        for row in ProbabilitySnapshotRepository().load_all_rows():
            ts, date_str = row.get("timestamp"), row.get("target_date") or row.get("date")
            if not ts or not date_str:
                continue
            try:
                ts_dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                tgt_dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
            except Exception:
                continue
            key = (str(row.get("city") or "").strip().lower(), str(date_str)[:10])
            if key[0] and key[1]:
                lead = (tgt_dt.date() - ts_dt.date()).days
                lead_by_cd[key] = min(lead_by_cd.get(key, 10**9), lead)
    except Exception:
        pass
    return lead_by_cd


def build_rows(lead_by_cd: dict):
    daily_records = DailyRecordRepository().load_all()
    rows = []
    for city, by_date in daily_records.items():
        city_l = str(city).strip().lower()
        history: dict = {}
        for td in sorted(by_date.keys()):
            rec = by_date[td]
            if not isinstance(rec, dict):
                history[td] = rec
                continue
            actual, forecasts = rec.get("actual_high"), rec.get("forecasts")
            if actual is None or not isinstance(forecasts, dict) or not forecasts:
                history[td] = rec
                continue
            pred_c = None
            stored = rec.get("deb_prediction")
            if stored is not None:
                pred_c = _to_c(stored, city_l)
            if pred_c is None:
                comp = calculate_dynamic_weight_components(city, forecasts, history_data={city: history})
                raw = comp.get("prediction")
                if raw is not None and int(comp.get("days_used") or 0) >= 2:
                    pred_c = _to_c(raw, city_l)
            if pred_c is not None:
                actual_c = _to_c(actual, city_l)
                if actual_c is not None:
                    rows.append(
                        {
                            "city": city_l,
                            "lead": _lead_key(lead_by_cd.get((city_l, td[:10]), 1)),
                            "raw_c": pred_c,
                            "residual_c": actual_c - pred_c,
                            "actual_c": actual_c,
                        }
                    )
            history[td] = rec
    return rows


def train(rows, min_adj: int, cap: float | None) -> dict:
    by_lead: dict = {}
    by_lead_city: dict = {}
    by_lead_temp: dict = {}
    for r in rows:
        lk = r["lead"]
        by_lead.setdefault(lk, []).append(r["residual_c"])
        by_lead_city.setdefault((lk, r["city"]), []).append(r["residual_c"])
        tk = _temp_bucket_key(r["raw_c"])
        if tk:
            by_lead_temp.setdefault((lk, tk), []).append(r["residual_c"])
    lead_biases, lead_sigmas = {}, {}
    for lk in (0, 1, 2):
        resid = by_lead.get(lk, [])
        if len(resid) < 20:
            continue
        med = statistics.median(resid)
        mad = statistics.median([abs(v - med) for v in resid])
        lead_biases[str(lk)] = round(med, 3)
        lead_sigmas[str(lk)] = round(max(1.4826 * mad, MIN_SIGMA) if mad > 0 else MIN_SIGMA, 3)

    def _adj(group, lead_bias):
        if len(group) < min_adj:
            return 0.0
        shrink = len(group) / (len(group) + BIAS_SHRINK_K)
        a = shrink * (statistics.median(group) - lead_bias)
        if cap is not None:
            a = max(-cap, min(cap, a))
        return a

    city_biases: dict = {}
    for (lk, city), resid in sorted(by_lead_city.items()):
        lb = lead_biases.get(str(lk))
        if lb is None:
            continue
        a = _adj(resid, lb)
        if abs(a) >= 0.05:
            city_biases.setdefault(str(lk), {})[city] = round(a, 3)

    temp_biases: dict = {}
    for (lk, tk), resid in sorted(by_lead_temp.items()):
        lb = lead_biases.get(str(lk))
        if lb is None:
            continue
        a = _adj(resid, lb)
        if abs(a) >= 0.05:
            temp_biases.setdefault(str(lk), {})[tk] = round(a, 3)

    return {"lead_biases": lead_biases, "lead_sigmas": lead_sigmas,
            "city_biases": city_biases, "temp_biases": temp_biases}


def evaluate(rows, stats, use_temp: bool) -> dict:
    pits = []
    for r in rows:
        lk = r["lead"]
        lb = stats["lead_biases"].get(str(lk)) or stats["lead_biases"].get("1") or 0.0
        sg = stats["lead_sigmas"].get(str(lk)) or stats["lead_sigmas"].get("1") or 2.5
        adj = 0.0
        if use_temp:
            adj += (stats["city_biases"].get(str(lk)) or {}).get(r["city"], 0.0)
            tk = _temp_bucket_key(r["raw_c"])
            if tk:
                adj += (stats["temp_biases"].get(str(lk)) or {}).get(tk, 0.0)
        mu = r["raw_c"] + lb + adj
        sigma = max(sg, MIN_SIGMA)
        pits.append((_cdf((r["actual_c"] - mu) / sigma), r["actual_c"], lk))
    return pits


def report(pits, label: str, out: dict) -> None:
    n = len(pits)
    mean = sum(p for p, _, _ in pits) / n
    var = sum((p - mean) ** 2 for p, _, _ in pits) / n
    bins = [0.0] * 10
    for p, _, _ in pits:
        bins[min(9, int(p * 10))] += 1
    exp = n / 10.0
    chi2 = sum((b - exp) ** 2 / exp for b in bins)
    cov90 = sum(1 for p, _, _ in pits if 0.05 <= p <= 0.95) / n
    out[label] = {"n": n, "pit_mean": round(mean, 4), "pit_std": round(math.sqrt(var), 4),
                  "chi2": round(chi2, 2), "cov90": round(cov90, 4)}


def main() -> int:
    lead_by_cd = load_lead_by_cd()
    rows = build_rows(lead_by_cd)
    print(f"rows: {len(rows)}")

    conn = sqlite3.connect(str(ROOT / "data" / "polyweather.db"))
    conn.row_factory = sqlite3.Row
    old_stats = json.loads((ROOT / "data" / "deb_normal_calibration_report.json").read_text("utf-8"))["stats"]
    old_bias = {k: float(v) for k, v in old_stats["biases"].items()}
    old_sigma = {k: float(v) for k, v in old_stats["sigmas"].items()}

    def _stratum(a: float) -> str:
        if a <= 32:
            return "<=32C"
        if a <= 36:
            return "33-36C"
        return ">=37C"

    results: dict = {}

    # OLD baseline
    old_pits = []
    for r in rows:
        lb = old_bias.get(str(r["lead"])) or old_bias.get("1") or 0.0
        sg = old_sigma.get(str(r["lead"])) or old_sigma.get("1") or 2.5
        mu = r["raw_c"] + lb
        old_pits.append((_cdf((r["actual_c"] - mu) / max(sg, MIN_SIGMA)), r["actual_c"], r["lead"]))
    report(old_pits, "old_all", results)
    for s in ("<=32C", "33-36C", ">=37C"):
        report([p for p in old_pits if _stratum(p[1]) == s], f"old_{s}", results)

    for cfg_name, min_adj, cap, use_temp in (
        ("D_min10_nocap", 10, None, True),
        ("A_min30_nocap", 30, None, True),
        ("B_min30_cap05", 30, 0.5, True),
        ("C_city_only", 10, None, False),
    ):
        stats = train(rows, min_adj, cap)
        print(f"\n[{cfg_name}] min_adj={min_adj} cap={cap} use_temp={use_temp}")
        print("  temp_biases:", json.dumps(stats["temp_biases"], ensure_ascii=False))
        pits = evaluate(rows, stats, use_temp)
        report(pits, f"{cfg_name}_all", results)
        for s in ("<=32C", "33-36C", ">=37C"):
            report([p for p in pits if _stratum(p[1]) == s], f"{cfg_name}_{s}", results)

    def _line(key: str) -> str:
        v = results.get(key) or {}
        return f"  {key.ljust(18)} n={v.get('n', 0):5d}  mean={v.get('pit_mean', float('nan')):.4f}  std={v.get('pit_std', float('nan')):.4f}  chi2={v.get('chi2', float('nan')):7.1f}  cov90={v.get('cov90', float('nan')):.4f}"

    for key in sorted(results):
        print(_line(key))

    out_path = ROOT / "data" / "deb_temp_cfg_test.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nwrote", out_path)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
