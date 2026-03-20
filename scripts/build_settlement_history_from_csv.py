import argparse
import csv
import json
import os
import sys
from collections import defaultdict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.settlement_rounding import apply_city_settlement  # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Build daily settlement history from historical weather CSV files.")
    parser.add_argument(
        "--history-dir",
        default=os.path.join(PROJECT_ROOT, "data", "historical"),
        help="Directory containing per-city *_historical.csv files.",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "settlement_history.json",
        ),
        help="Output JSON path.",
    )
    args = parser.parse_args()

    result = {}
    for city in sorted(CITY_REGISTRY.keys()):
        path = os.path.join(
            args.history_dir,
            f"{city.replace(' ', '_').lower()}_historical.csv",
        )
        if not os.path.exists(path):
            continue

        daily_max = defaultdict(lambda: None)
        with open(path, "r", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                ts = str(row.get("time") or "")
                raw_temp = row.get("temperature_2m")
                if not ts or raw_temp in (None, ""):
                    continue
                try:
                    temp = float(raw_temp)
                except Exception:
                    continue
                day = ts[:10]
                prev = daily_max[day]
                if prev is None or temp > prev:
                    daily_max[day] = temp

        result[city] = {
            day: {
                "max_temp": round(max_temp, 3),
                "settlement_value": apply_city_settlement(city, max_temp),
            }
            for day, max_temp in sorted(daily_max.items())
            if max_temp is not None
        }

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(
        "saved settlement history to {path} for {count} cities".format(
            path=args.output,
            count=len(result),
        )
    )


if __name__ == "__main__":
    main()
