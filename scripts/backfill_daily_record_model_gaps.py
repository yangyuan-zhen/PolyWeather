from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analysis.deb_algorithm import load_history, save_history  # noqa: E402
from src.analysis.probability_snapshot_archive import (  # noqa: E402
    load_snapshot_rows_for_day,
)
from src.database.runtime_state import STATE_STORAGE_FILE, get_state_storage_mode  # noqa: E402


def _load_daily_records(path: Path) -> Dict[str, Dict[str, Dict[str, Any]]]:
    data = load_history(str(path))
    return data if isinstance(data, dict) else {}


def _pick_model_value_from_snapshots(
    city: str,
    target_date: str,
    model_name: str,
) -> float | None:
    rows = load_snapshot_rows_for_day(city, target_date)
    values = []
    for row in rows:
        mm = row.get("multi_model") or {}
        if not isinstance(mm, dict):
            continue
        value = mm.get(model_name)
        if value is None:
            continue
        try:
            values.append(float(value))
        except Exception:
            continue
    if not values:
        return None
    counts = Counter(values)
    return counts.most_common(1)[0][0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill missing model forecasts in daily_records from archived probability snapshots."
    )
    parser.add_argument(
        "--history-file",
        default=str(Path("data") / "daily_records.json"),
        help="Path to daily_records.json",
    )
    parser.add_argument("--city", help="Optional city filter, e.g. ankara")
    parser.add_argument("--date", help="Optional YYYY-MM-DD filter")
    parser.add_argument(
        "--model",
        default="MGM",
        help="Model name to backfill from snapshot multi_model payloads",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write recovered values back to history file / runtime state",
    )
    args = parser.parse_args()

    history_path = Path(args.history_file)
    data = _load_daily_records(history_path)
    model_name = str(args.model or "").strip()
    city_filter = str(args.city or "").strip().lower() or None
    date_filter = str(args.date or "").strip() or None

    recovered = []
    missing = []
    changed = False

    for city, city_rows in sorted(data.items()):
        if city_filter and city != city_filter:
            continue
        if not isinstance(city_rows, dict):
            continue
        for target_date, record in sorted(city_rows.items()):
            if date_filter and target_date != date_filter:
                continue
            if not isinstance(record, dict):
                continue
            forecasts = record.get("forecasts") or {}
            if not isinstance(forecasts, dict):
                forecasts = {}
            if forecasts.get(model_name) is not None:
                continue

            recovered_value = _pick_model_value_from_snapshots(city, target_date, model_name)
            if recovered_value is None:
                missing.append((city, target_date))
                continue

            recovered.append((city, target_date, recovered_value))
            if args.write:
                next_forecasts = dict(forecasts)
                next_forecasts[model_name] = recovered_value
                record["forecasts"] = next_forecasts
                changed = True

    print(
        json.dumps(
            {
                "model": model_name,
                "recovered_count": len(recovered),
                "missing_count": len(missing),
                "recovered": [
                    {"city": city, "date": date_str, "value": value}
                    for city, date_str, value in recovered
                ],
                "missing": [
                    {"city": city, "date": date_str}
                    for city, date_str in missing
                ],
                "write_requested": bool(args.write),
                "storage_mode": get_state_storage_mode(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if changed:
        previous_mode = get_state_storage_mode()
        # Reuse existing save path semantics. In sqlite-only mode, save_history would skip file write.
        save_history(str(history_path), data)
        if previous_mode == STATE_STORAGE_FILE and not history_path.exists():
            raise FileNotFoundError(history_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
