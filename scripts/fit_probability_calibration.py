import argparse
import json
import os
import sys
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.probability_calibration import (  # noqa: E402
    DEFAULT_CALIBRATION_FILE,
    default_calibration_payload,
    fit_calibration,
)
from src.analysis.deb_algorithm import load_history  # noqa: E402


def _sf(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _load_json_if_exists(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def _extract_samples(history, settlement_history=None):
    samples = []
    filled_actual_from_history = 0
    today = datetime.utcnow().strftime("%Y-%m-%d")
    settlement_history = settlement_history or {}
    for city, city_rows in (history or {}).items():
        if not isinstance(city_rows, dict):
            continue
        city_settlement = settlement_history.get(city) or {}
        for date_str, record in city_rows.items():
            if date_str == today or not isinstance(record, dict):
                continue
            actual_high = _sf(record.get("actual_high"))
            if actual_high is None:
                actual_high = _sf((city_settlement.get(date_str) or {}).get("max_temp"))
                if actual_high is not None:
                    filled_actual_from_history += 1
            deb_prediction = _sf(record.get("deb_prediction"))
            raw_mu = _sf(record.get("mu")) or deb_prediction
            forecasts = record.get("forecasts") or {}
            if not isinstance(forecasts, dict):
                forecasts = {}
            forecast_values = [val for val in (_sf(v) for v in forecasts.values()) if val is not None]
            forecast_values.sort()
            forecast_median = (
                forecast_values[len(forecast_values) // 2] if forecast_values else None
            )
            feature_snapshot = record.get("probability_features") or {}
            if not isinstance(feature_snapshot, dict):
                feature_snapshot = {}

            ens_median = _sf(feature_snapshot.get("ens_median")) or forecast_median or raw_mu
            ensemble_spread = _sf(feature_snapshot.get("ensemble_spread"))
            if ensemble_spread is None:
                if len(forecast_values) >= 2:
                    ensemble_spread = max(0.6, (forecast_values[-1] - forecast_values[0]) / 2.0)
                else:
                    ensemble_spread = 1.0
            raw_sigma = _sf(feature_snapshot.get("raw_sigma")) or ensemble_spread or 1.0
            peak_status = str(feature_snapshot.get("peak_status") or "before").strip().lower()
            peak_flag = 0.0
            if peak_status == "in_window":
                peak_flag = 0.5
            elif peak_status == "past":
                peak_flag = 1.0

            if actual_high is None or raw_mu is None:
                continue

            max_so_far = _sf(feature_snapshot.get("max_so_far"))
            max_so_far_gap = _sf(feature_snapshot.get("max_so_far_gap"))
            if max_so_far_gap is None and max_so_far is not None and deb_prediction is not None:
                max_so_far_gap = deb_prediction - max_so_far

            samples.append(
                {
                    "city": city,
                    "date": date_str,
                    "actual_high": actual_high,
                    "raw_mu": raw_mu,
                    "raw_sigma": raw_sigma,
                    "deb_prediction": deb_prediction,
                    "ens_median": ens_median,
                    "ensemble_spread": ensemble_spread,
                    "max_so_far_gap": max_so_far_gap,
                    "peak_flag": peak_flag,
                }
            )
    return samples, filled_actual_from_history


def main():
    parser = argparse.ArgumentParser(description="Fit PolyWeather probability calibration parameters.")
    parser.add_argument(
        "--history-file",
        default=os.path.join(PROJECT_ROOT, "data", "daily_records.json"),
        help="Path to the historical daily_records.json file.",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_CALIBRATION_FILE,
        help="Output JSON file for fitted calibration parameters.",
    )
    parser.add_argument(
        "--settlement-history",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "settlement_history.json",
        ),
        help="Optional daily settlement history JSON built from historical CSV files.",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="Optional explicit calibration version.",
    )
    args = parser.parse_args()

    history = load_history(args.history_file)
    settlement_history = _load_json_if_exists(args.settlement_history)
    samples, filled_actual_from_history = _extract_samples(
        history,
        settlement_history=settlement_history,
    )
    calibration = fit_calibration(samples, version=args.version)
    if not samples:
        calibration = default_calibration_payload(
            version=args.version,
            reason="no_samples",
        )
    calibration.setdefault("metrics", {})
    calibration["metrics"]["filled_actual_from_history"] = filled_actual_from_history
    calibration["metrics"]["settlement_history_city_count"] = len(settlement_history)
    try:
        calibration["source"] = os.path.relpath(args.output, PROJECT_ROOT)
    except ValueError:
        calibration["source"] = os.path.abspath(args.output)

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(calibration, fh, ensure_ascii=False, indent=2)

    print(
        "saved calibration to {path} with {count} samples".format(
            path=args.output,
            count=calibration.get("metrics", {}).get("sample_count", 0),
        )
    )


if __name__ == "__main__":
    main()
