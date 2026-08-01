#!/usr/bin/env python3
"""Quantify walk-forward raw vs stored deb_prediction discrepancy, and
report train-time temp/city group sample sizes."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_algorithm import calculate_dynamic_weight_components  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import DailyRecordRepository  # noqa: E402

F_CITIES = {
    str(c).strip().lower()
    for c, m in (CITY_REGISTRY or {}).items()
    if m.get("use_fahrenheit")
}


def _to_c(value, city: str):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return (v - 32.0) * 5.0 / 9.0 if city in F_CITIES else v


def main() -> int:
    daily_records = DailyRecordRepository().load_all()
    print(f"cities: {len(daily_records)}")

    diffs = []  # stored_deb_c - walkforward_raw_c
    strata = {}  # temp bucket -> [(raw, stored, actual)]
    for city, by_date in daily_records.items():
        city_l = str(city).strip().lower()
        history: dict = {}
        for target_date in sorted(by_date.keys()):
            record = by_date[target_date]
            if not isinstance(record, dict):
                history[target_date] = record
                continue
            actual = record.get("actual_high")
            forecasts = record.get("forecasts")
            stored = record.get("deb_prediction")
            if actual is None or not isinstance(forecasts, dict) or not forecasts:
                history[target_date] = record
                continue
            components = calculate_dynamic_weight_components(
                city, forecasts, history_data={city: history}
            )
            raw = components.get("prediction")
            if raw is not None and stored is not None:
                raw_c = _to_c(raw, city_l)
                stored_c = _to_c(stored, city_l)
                actual_c = _to_c(actual, city_l)
                if raw_c is not None and stored_c is not None and actual_c is not None:
                    diffs.append(stored_c - raw_c)
                    key = ">=37" if raw_c > 36 else ("33-36" if raw_c > 32 else "<=32")
                    strata.setdefault(key, []).append((raw_c, stored_c, actual_c))
            history[target_date] = record

    print(f"\nstored_deb - walkforward_raw: n={len(diffs)}")
    if diffs:
        diffs_sorted = sorted(diffs)
        n = len(diffs_sorted)
        print(f"  median={diffs_sorted[n // 2]:+.3f}  mean={sum(diffs) / n:+.3f}")
        print(f"  p10={diffs_sorted[int(n * 0.10)]:+.3f}  p90={diffs_sorted[int(n * 0.90)]:+.3f}")
        import statistics

        print(f"  pstdev={statistics.pstdev(diffs):.3f}")
        big = sum(1 for d in diffs if abs(d) > 0.5)
        print(f"  |diff|>0.5C: {big} ({big / n:.1%})")

    print("\ntemp stratum (by walkforward raw): raw / stored / actual means")
    for key in ("<=32", "33-36", ">=37"):
        sub = strata.get(key, [])
        if not sub:
            continue
        raw_m = sum(x[0] for x in sub) / len(sub)
        st_m = sum(x[1] for x in sub) / len(sub)
        ac_m = sum(x[2] for x in sub) / len(sub)
        print(
            f"  {key}: n={len(sub):4d}  mean_raw={raw_m:6.2f}  mean_stored={st_m:6.2f}  "
            f"mean_actual={ac_m:6.2f}  stored-raw={st_m - raw_m:+.3f}  actual-stored={ac_m - st_m:+.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
