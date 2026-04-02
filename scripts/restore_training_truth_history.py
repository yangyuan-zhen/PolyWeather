import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.database.runtime_state import TruthRecordRepository  # noqa: E402
from scripts.fit_probability_calibration import (  # noqa: E402
    _default_history_arg,
    _load_history_with_fallback,
    _load_json_if_exists,
)


def _sf(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _truth_meta(city: str) -> dict:
    city_meta = CITY_REGISTRY.get(city) or {}
    return {
        "settlement_source": str(city_meta.get("settlement_source") or "metar").strip().lower(),
        "settlement_station_code": str(
            city_meta.get("settlement_station_code") or city_meta.get("icao") or ""
        ).strip().upper()
        or None,
        "settlement_station_label": str(
            city_meta.get("settlement_station_label")
            or city_meta.get("airport_name")
            or city_meta.get("name")
            or ""
        ).strip()
        or None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Restore permanent training truth history from settlement history and recent runtime cache."
    )
    parser.add_argument(
        "--history-file",
        default=_default_history_arg(),
    )
    parser.add_argument(
        "--settlement-history",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "settlement_history.json",
        ),
    )
    parser.add_argument(
        "--truth-version",
        default="v1",
    )
    args = parser.parse_args()

    repo = TruthRecordRepository()
    settlement_history = _load_json_if_exists(args.settlement_history)
    runtime_history = _load_history_with_fallback(args.history_file)
    restored = 0

    for city, city_rows in (settlement_history or {}).items():
        if not isinstance(city_rows, dict):
            continue
        meta = _truth_meta(city)
        for date_str, payload in city_rows.items():
            if not isinstance(payload, dict):
                continue
            actual_high = _sf(payload.get("max_temp"))
            if actual_high is None:
                continue
            repo.upsert_truth(
                city=city,
                target_date=str(date_str),
                actual_high=actual_high,
                settlement_source=meta["settlement_source"],
                settlement_station_code=meta["settlement_station_code"],
                settlement_station_label=meta["settlement_station_label"],
                truth_version=args.truth_version,
                updated_by="restore:settlement_history",
                source_payload=payload,
                is_final=True,
                reason="restore_training_truth_history",
            )
            restored += 1

    merged_recent = 0
    for city, city_rows in (runtime_history or {}).items():
        if not isinstance(city_rows, dict):
            continue
        meta = _truth_meta(city)
        for date_str, payload in city_rows.items():
            if not isinstance(payload, dict):
                continue
            actual_high = _sf(payload.get("actual_high"))
            if actual_high is None:
                continue
            repo.upsert_truth(
                city=city,
                target_date=str(date_str),
                actual_high=actual_high,
                settlement_source=meta["settlement_source"],
                settlement_station_code=meta["settlement_station_code"],
                settlement_station_label=meta["settlement_station_label"],
                truth_version=args.truth_version,
                updated_by="restore:runtime_daily_records",
                source_payload={
                    "actual_high": actual_high,
                    "payload_json": payload,
                },
                is_final=True,
                reason="restore_training_truth_history",
            )
            merged_recent += 1

    print(
        json.dumps(
            {
                "restored_from_settlement_history": restored,
                "merged_recent_runtime_records": merged_recent,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
