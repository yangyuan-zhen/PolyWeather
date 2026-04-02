import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.database.runtime_state import (  # noqa: E402
    ProbabilitySnapshotRepository,
    TrainingFeatureRecordRepository,
    get_state_storage_mode,
)


def _load_legacy_snapshot_rows(path: str):
    rows = []
    if not path or not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def _spread_from_ensemble(ensemble: dict):
    if not isinstance(ensemble, dict):
        return None
    try:
        p10 = float(ensemble.get("p10"))
        p90 = float(ensemble.get("p90"))
    except Exception:
        return None
    if p90 < p10:
        return None
    return max(0.1, round((p90 - p10) / 2.56, 3))


def main():
    parser = argparse.ArgumentParser(
        description="Restore permanent training feature history from snapshot archives."
    )
    parser.add_argument(
        "--snapshot-file",
        default=os.path.join(PROJECT_ROOT, "data", "probability_training_snapshots.jsonl"),
    )
    args = parser.parse_args()

    rows = []
    if get_state_storage_mode() == "sqlite":
        rows.extend(ProbabilitySnapshotRepository().load_all_rows())
    rows.extend(_load_legacy_snapshot_rows(args.snapshot_file))

    latest = {}
    for row in rows:
        city = str(row.get("city") or "").strip().lower()
        date_str = str(row.get("date") or "").strip()
        ts = str(row.get("timestamp") or "")
        if not city or not date_str:
            continue
        key = (city, date_str)
        current = latest.get(key)
        if current is None or ts >= str(current.get("timestamp") or ""):
            latest[key] = row

    repo = TrainingFeatureRecordRepository()
    restored = 0
    for (city, date_str), row in latest.items():
        repo.upsert_record(
            city,
            date_str,
            {
                "forecasts": row.get("multi_model") or {},
                "deb_prediction": row.get("deb_prediction"),
                "mu": row.get("raw_mu"),
                "probability_features": {
                    "raw_mu": row.get("raw_mu"),
                    "raw_sigma": row.get("raw_sigma"),
                    "deb_prediction": row.get("deb_prediction"),
                    "ens_median": ((row.get("ensemble") or {}).get("median")),
                    "ensemble_spread": _spread_from_ensemble(row.get("ensemble") or {}),
                    "max_so_far": row.get("max_so_far"),
                    "peak_status": row.get("peak_status"),
                },
                "prob_snapshot": row.get("prob_snapshot") or [],
                "shadow_prob_snapshot": row.get("shadow_prob_snapshot") or [],
                "probability_calibration": {
                    "engine": row.get("probability_engine"),
                    "mode": row.get("probability_mode"),
                    "calibration_version": row.get("calibration_version"),
                    "calibration_source": row.get("calibration_source"),
                    "calibrated_mu": row.get("calibrated_mu"),
                    "calibrated_sigma": row.get("calibrated_sigma"),
                },
                "observation": row.get("observation") or {},
                "snapshot_timestamp": row.get("timestamp"),
            },
        )
        restored += 1

    print(json.dumps({"restored_feature_records": restored}, ensure_ascii=False))


if __name__ == "__main__":
    main()
