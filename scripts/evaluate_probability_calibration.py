import argparse
import json
import os
import sys
from collections import defaultdict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.probability_calibration import (  # noqa: E402
    ENGINE_MODE_EMOS_PRIMARY,
    _gaussian_crps,
    apply_probability_calibration,
    build_probability_features,
)
from src.analysis.settlement_rounding import apply_city_settlement  # noqa: E402
from scripts.fit_probability_calibration import (  # noqa: E402
    _extract_samples,
    _load_json_if_exists,
)
from src.analysis.deb_algorithm import load_history  # noqa: E402


def _mean(values):
    return (sum(values) / len(values)) if values else None


def _sample_to_features(sample):
    return build_probability_features(
        city_name=sample.get("city") or "",
        raw_mu=sample.get("raw_mu"),
        raw_sigma=sample.get("raw_sigma"),
        deb_prediction=sample.get("deb_prediction"),
        ens_data={
            "median": sample.get("ens_median"),
            "p10": None,
            "p90": None,
        },
        current_forecasts={},
        max_so_far=None,
        peak_status="in_window" if sample.get("peak_flag") == 0.5 else "past" if sample.get("peak_flag") == 1.0 else "before",
        local_hour_frac=None,
    )


def _top_bucket_value(distribution):
    if not distribution:
        return None
    top = max(
        (row for row in distribution if isinstance(row, dict)),
        key=lambda row: float(row.get("probability") or 0.0),
        default=None,
    )
    if not top:
        return None
    return top.get("value")


def main():
    parser = argparse.ArgumentParser(description="Evaluate legacy vs EMOS probability calibration.")
    parser.add_argument(
        "--history-file",
        default=os.path.join(PROJECT_ROOT, "data", "daily_records.json"),
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
        "--calibration-file",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "default.json",
        ),
    )
    parser.add_argument(
        "--output",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "evaluation_report.json",
        ),
    )
    args = parser.parse_args()

    history = load_history(args.history_file)
    settlement_history = _load_json_if_exists(args.settlement_history)
    samples, filled_actual_from_history = _extract_samples(
        history,
        settlement_history=settlement_history,
    )

    legacy_crps = []
    emos_crps = []
    legacy_mae = []
    emos_mae = []
    legacy_bucket_hits = []
    emos_bucket_hits = []
    by_city = defaultdict(lambda: {
        "samples": 0,
        "legacy_crps": [],
        "emos_crps": [],
        "legacy_mae": [],
        "emos_mae": [],
        "legacy_bucket_hits": [],
        "emos_bucket_hits": [],
    })

    for sample in samples:
        city = str(sample.get("city") or "").strip().lower()
        actual_high = float(sample["actual_high"])
        raw_mu = float(sample["raw_mu"])
        raw_sigma = max(0.1, float(sample["raw_sigma"]))
        legacy_crps.append(_gaussian_crps(actual_high, raw_mu, raw_sigma))
        legacy_mae.append(abs(raw_mu - actual_high))

        legacy_bucket = apply_city_settlement(city, raw_mu)
        actual_bucket = apply_city_settlement(city, actual_high)
        legacy_bucket_hits.append(1.0 if legacy_bucket == actual_bucket else 0.0)

        calibration = apply_probability_calibration(
            city_name=city,
            temp_symbol="°F" if city in {"atlanta", "chicago", "dallas", "miami", "new york", "seattle"} else "°C",
            raw_mu=raw_mu,
            raw_sigma=raw_sigma,
            max_so_far=None,
            legacy_distribution=[],
            features=_sample_to_features(sample),
            calibration_path=args.calibration_file,
            mode=ENGINE_MODE_EMOS_PRIMARY,
        )
        emos_mu = float(calibration.get("calibrated_mu") or raw_mu)
        emos_sigma = max(0.1, float(calibration.get("calibrated_sigma") or raw_sigma))
        emos_distribution = calibration.get("distribution") or []
        emos_crps.append(_gaussian_crps(actual_high, emos_mu, emos_sigma))
        emos_mae.append(abs(emos_mu - actual_high))
        emos_bucket = _top_bucket_value(emos_distribution)
        emos_bucket_hits.append(1.0 if emos_bucket == actual_bucket else 0.0)

        row = by_city[city]
        row["samples"] += 1
        row["legacy_crps"].append(legacy_crps[-1])
        row["emos_crps"].append(emos_crps[-1])
        row["legacy_mae"].append(legacy_mae[-1])
        row["emos_mae"].append(emos_mae[-1])
        row["legacy_bucket_hits"].append(legacy_bucket_hits[-1])
        row["emos_bucket_hits"].append(emos_bucket_hits[-1])

    summary = {
        "sample_count": len(samples),
        "filled_actual_from_history": filled_actual_from_history,
        "legacy": {
            "mean_crps": round(_mean(legacy_crps), 6) if legacy_crps else None,
            "mean_mae": round(_mean(legacy_mae), 6) if legacy_mae else None,
            "bucket_hit_rate": round(_mean(legacy_bucket_hits), 6) if legacy_bucket_hits else None,
        },
        "emos": {
            "mean_crps": round(_mean(emos_crps), 6) if emos_crps else None,
            "mean_mae": round(_mean(emos_mae), 6) if emos_mae else None,
            "bucket_hit_rate": round(_mean(emos_bucket_hits), 6) if emos_bucket_hits else None,
        },
        "delta": {
            "crps": round((_mean(emos_crps) or 0.0) - (_mean(legacy_crps) or 0.0), 6),
            "mae": round((_mean(emos_mae) or 0.0) - (_mean(legacy_mae) or 0.0), 6),
            "bucket_hit_rate": round((_mean(emos_bucket_hits) or 0.0) - (_mean(legacy_bucket_hits) or 0.0), 6),
        },
    }

    city_report = {}
    for city, metrics in sorted(by_city.items()):
        city_report[city] = {
            "samples": metrics["samples"],
            "legacy_mean_crps": round(_mean(metrics["legacy_crps"]), 6),
            "emos_mean_crps": round(_mean(metrics["emos_crps"]), 6),
            "legacy_mean_mae": round(_mean(metrics["legacy_mae"]), 6),
            "emos_mean_mae": round(_mean(metrics["emos_mae"]), 6),
            "legacy_bucket_hit_rate": round(_mean(metrics["legacy_bucket_hits"]), 6),
            "emos_bucket_hit_rate": round(_mean(metrics["emos_bucket_hits"]), 6),
        }

    payload = {
        "summary": summary,
        "by_city": city_report,
    }

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved evaluation report to {args.output}")


if __name__ == "__main__":
    main()
