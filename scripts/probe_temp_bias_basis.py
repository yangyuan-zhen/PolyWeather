#!/usr/bin/env python3
"""Probe: train-time temp-bias groups on raw basis vs stored-deb basis.

Shows per (lead, temp-bucket): n, median residual, lead median, shrunk adj
for both stratification bases, so we can see which basis produces adjustments
that match inference-time behavior."""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analysis.deb_algorithm import calculate_dynamic_weight_components  # noqa: E402
from src.analysis.deb_probability import _lead_key, _temp_bucket_key  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import DailyRecordRepository  # noqa: E402

F_CITIES = {
    str(c).strip().lower()
    for c, m in (CITY_REGISTRY or {}).items()
    if m.get("use_fahrenheit")
}
BIAS_SHRINK_K = 5.0
MIN_ADJUST_SAMPLES = 10


def _to_c(value, city: str):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return (v - 32.0) * 5.0 / 9.0 if city in F_CITIES else v


def main() -> int:
    daily_records = DailyRecordRepository().load_all()
    rows = []  # (lead, raw_c, stored_c, resid_raw, resid_stored)
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
                    rows.append(
                        (
                            _lead_key(1),  # probe lead-agnostic; leads ~ all 0/1
                            raw_c,
                            stored_c,
                            actual_c - raw_c,
                            actual_c - stored_c,
                        )
                    )
            history[target_date] = record

    print(f"rows: {len(rows)}")

    def _report(basis: str, idx: int) -> None:
        print(f"\n=== temp buckets by {basis} ===")
        groups: dict = {}
        for lead, raw_c, stored_c, r_raw, r_stored in rows:
            key = _temp_bucket_key(raw_c if idx == 0 else stored_c)
            if key:
                groups.setdefault(key, []).append(r_raw if idx == 0 else r_stored)
        for key in ("<=32", "33-36", ">=37"):
            resid = groups.get(key, [])
            n = len(resid)
            if n == 0:
                print(f"  {key}: n=0")
                continue
            med = statistics.median(resid)
            shrink = n / (n + BIAS_SHRINK_K)
            print(
                f"  {key}: n={n:4d}  median_resid={med:+.3f}  "
                f"lead_median={statistics.median([r for r in resid]):+.3f}  "
                f"shrunk_adj={shrink * (med - 0.5):+.3f}  (vs lead 0.5)"
            )

    _report("walkforward raw", 0)
    _report("stored deb", 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
