import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.deb_algorithm import load_history  # noqa: E402
from src.analysis.settlement_rounding import apply_city_settlement  # noqa: E402


def _sf(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _mean(values):
    return round(sum(values) / len(values), 6) if values else None


def _top_bucket(snapshot):
    if not isinstance(snapshot, list):
        return None
    best = None
    best_prob = -1.0
    for row in snapshot:
        if not isinstance(row, dict):
            continue
        try:
            prob = float(row.get("p") if "p" in row else row.get("probability"))
        except Exception:
            continue
        value = row.get("v") if "v" in row else row.get("value")
        if value is None:
            continue
        if prob > best_prob:
            best = value
            best_prob = prob
    return best


def _bucket_probability(snapshot, target_bucket):
    if not isinstance(snapshot, list):
        return 0.0
    for row in snapshot:
        if not isinstance(row, dict):
            continue
        value = row.get("v") if "v" in row else row.get("value")
        if value != target_bucket:
            continue
        try:
            return float(row.get("p") if "p" in row else row.get("probability") or 0.0)
        except Exception:
            return 0.0
    return 0.0


def _brier_from_snapshot(snapshot, target_bucket):
    hit_prob = _bucket_probability(snapshot, target_bucket)
    total = (1.0 - hit_prob) ** 2
    if isinstance(snapshot, list):
        for row in snapshot:
            if not isinstance(row, dict):
                continue
            value = row.get("v") if "v" in row else row.get("value")
            if value == target_bucket:
                continue
            try:
                prob = float(row.get("p") if "p" in row else row.get("probability") or 0.0)
            except Exception:
                prob = 0.0
            total += prob * prob
    return round(total, 6)


def _blank_metrics():
    return {
        "samples": 0,
        "legacy_mae": [],
        "shadow_mae": [],
        "legacy_bucket_hit": [],
        "shadow_bucket_hit": [],
        "legacy_bucket_brier": [],
        "shadow_bucket_brier": [],
    }


def _rollup(metrics):
    return {
        "samples": metrics["samples"],
        "legacy_mean_mae": _mean(metrics["legacy_mae"]),
        "shadow_mean_mae": _mean(metrics["shadow_mae"]),
        "legacy_bucket_hit_rate": _mean(metrics["legacy_bucket_hit"]),
        "shadow_bucket_hit_rate": _mean(metrics["shadow_bucket_hit"]),
        "legacy_bucket_brier": _mean(metrics["legacy_bucket_brier"]),
        "shadow_bucket_brier": _mean(metrics["shadow_bucket_brier"]),
        "delta_mae": round((_mean(metrics["shadow_mae"]) or 0.0) - (_mean(metrics["legacy_mae"]) or 0.0), 6),
        "delta_bucket_hit_rate": round((_mean(metrics["shadow_bucket_hit"]) or 0.0) - (_mean(metrics["legacy_bucket_hit"]) or 0.0), 6),
        "delta_bucket_brier": round((_mean(metrics["shadow_bucket_brier"]) or 0.0) - (_mean(metrics["legacy_bucket_brier"]) or 0.0), 6),
    }


def main():
    parser = argparse.ArgumentParser(description="Build live shadow probability report from daily records.")
    parser.add_argument(
        "--history-file",
        default=os.path.join(PROJECT_ROOT, "data", "daily_records.json"),
    )
    parser.add_argument(
        "--output",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "shadow_report.json",
        ),
    )
    args = parser.parse_args()

    history = load_history(args.history_file)
    overall = _blank_metrics()
    by_city = defaultdict(_blank_metrics)
    by_date = defaultdict(_blank_metrics)
    latest_observations = []

    for city, city_records in sorted(history.items()):
        if not isinstance(city_records, dict):
            continue
        for date_str, record in sorted(city_records.items()):
            if not isinstance(record, dict):
                continue
            actual_high = _sf(record.get("actual_high"))
            shadow_snapshot = record.get("shadow_prob_snapshot")
            calibration = record.get("probability_calibration") or {}
            if actual_high is None or not shadow_snapshot:
                continue

            legacy_mu = _sf(calibration.get("raw_mu"))
            if legacy_mu is None:
                legacy_mu = _sf(record.get("mu"))
            shadow_mu = _sf(calibration.get("calibrated_mu"))
            if shadow_mu is None:
                continue

            actual_bucket = apply_city_settlement(city, actual_high)
            legacy_snapshot = record.get("prob_snapshot") or []
            legacy_bucket = _top_bucket(legacy_snapshot)
            shadow_bucket = _top_bucket(shadow_snapshot)

            for metrics in (overall, by_city[city], by_date[date_str]):
                metrics["samples"] += 1
                metrics["legacy_mae"].append(abs(legacy_mu - actual_high))
                metrics["shadow_mae"].append(abs(shadow_mu - actual_high))
                metrics["legacy_bucket_hit"].append(1.0 if legacy_bucket == actual_bucket else 0.0)
                metrics["shadow_bucket_hit"].append(1.0 if shadow_bucket == actual_bucket else 0.0)
                metrics["legacy_bucket_brier"].append(_brier_from_snapshot(legacy_snapshot, actual_bucket))
                metrics["shadow_bucket_brier"].append(_brier_from_snapshot(shadow_snapshot, actual_bucket))

            latest_observations.append(
                {
                    "city": city,
                    "date": date_str,
                    "actual_high": actual_high,
                    "actual_bucket": actual_bucket,
                    "legacy_mu": round(legacy_mu, 3),
                    "shadow_mu": round(shadow_mu, 3),
                    "legacy_top_bucket": legacy_bucket,
                    "shadow_top_bucket": shadow_bucket,
                    "calibration_version": calibration.get("version"),
                    "calibration_mode": calibration.get("mode"),
                }
            )

    by_city_report = {
        city: _rollup(metrics)
        for city, metrics in sorted(by_city.items())
    }
    by_date_report = {
        date_str: _rollup(metrics)
        for date_str, metrics in sorted(
            by_date.items(),
            key=lambda item: datetime.strptime(item[0], "%Y-%m-%d"),
        )
    }

    latest_observations = sorted(
        latest_observations,
        key=lambda row: (row["date"], row["city"]),
        reverse=True,
    )[:100]

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": _rollup(overall),
        "by_city": by_city_report,
        "by_date": by_date_report,
        "recent_observations": latest_observations,
    }

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    print(f"saved shadow report to {args.output}")


if __name__ == "__main__":
    main()
