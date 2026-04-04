import argparse
import os
import sys
from datetime import datetime, timedelta

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.deb_algorithm import load_history, reconcile_recent_actual_highs, save_history  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from scripts.fit_probability_calibration import _default_history_arg  # noqa: E402


def _target_dates(city_info: dict, lookback_days: int) -> list[str]:
    tz_offset = int(city_info.get("tz_offset") or 0)
    local_now = datetime.utcnow() + timedelta(seconds=tz_offset)
    local_today = local_now.date()
    dates = []
    for offset in range(max(lookback_days, 1), 0, -1):
        day = local_today - timedelta(days=offset)
        dates.append(day.strftime("%Y-%m-%d"))
    return dates


def _is_metar_city(city_info: dict) -> bool:
    source = str(city_info.get("settlement_source") or "metar").strip().lower()
    return source in {"metar", "hko", "noaa"}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed recent runtime daily_records rows and backfill actual_high from the city's settlement source."
    )
    parser.add_argument(
        "--cities",
        nargs="*",
        default=[],
        help="Optional subset of city registry keys.",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=14,
        help="How many recent local days to seed/backfill (excluding today).",
    )
    parser.add_argument(
        "--only-missing-cities",
        action="store_true",
        help="Only process cities that do not exist in daily_records yet.",
    )
    args = parser.parse_args()

    history_file = _default_history_arg() or ""
    data = load_history(history_file)

    selected = {str(item).strip().lower() for item in args.cities if str(item).strip()}
    candidates: list[str] = []
    for city_name, city_info in sorted(CITY_REGISTRY.items()):
        if selected and city_name not in selected:
            continue
        if not isinstance(city_info, dict) or not _is_metar_city(city_info):
            continue
        if not str(city_info.get("icao") or "").strip():
            continue
        if args.only_missing_cities and city_name in data:
            continue
        candidates.append(city_name)

    seeded_rows = 0
    seeded_cities = 0
    for city_name in candidates:
        city_info = CITY_REGISTRY[city_name]
        city_rows = data.get(city_name)
        if not isinstance(city_rows, dict):
            city_rows = {}
            data[city_name] = city_rows

        before = len(city_rows)
        for date_str in _target_dates(city_info, args.lookback_days):
            city_rows.setdefault(date_str, {})
        if len(city_rows) > before:
            seeded_cities += 1
            seeded_rows += len(city_rows) - before

    if seeded_rows > 0:
        save_history(history_file, data)

    results = []
    for city_name in candidates:
        result = reconcile_recent_actual_highs(city_name, lookback_days=args.lookback_days)
        results.append((city_name, result))

    print(
        {
            "lookback_days": args.lookback_days,
            "candidate_count": len(candidates),
            "seeded_cities": seeded_cities,
            "seeded_rows": seeded_rows,
            "results": results,
        }
    )


if __name__ == "__main__":
    main()
