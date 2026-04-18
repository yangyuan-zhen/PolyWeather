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
    _default_history_arg,
    _extract_samples,
    _load_history_with_fallback,
    _load_json_if_exists,
    _load_legacy_training_samples,
    _load_snapshot_rows,
    _load_training_feature_history,
    _load_truth_history,
    merge_samples_with_legacy_archive,
)


def _env_int(name, default=None):
    try:
        value = os.getenv(name)
        if value is None or str(value).strip() == "":
            return default
        return int(value)
    except Exception:
        return default


def _log(enabled, message):
    if enabled:
        print(f"[evaluate_probability_calibration] {message}", flush=True)


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
    parser.add_argument(
        "--snapshot-file",
        default=None,
        help="Optional legacy JSONL snapshot archive path. In sqlite mode this defaults to the runtime database.",
    )
    parser.add_argument(
        "--snapshot-limit",
        type=int,
        default=_env_int("POLYWEATHER_EMOS_TRAINING_SNAPSHOT_LIMIT"),
        help="Optional max number of recent probability snapshots to load from SQLite.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print data loading and evaluation progress.",
    )
    args = parser.parse_args()

    _log(args.verbose, "loading daily records")
    history = _load_history_with_fallback(args.history_file)
    _log(args.verbose, f"loaded daily record cities={len(history or {})}")
    _log(args.verbose, "loading training feature history")
    training_feature_history = _load_training_feature_history()
    _log(args.verbose, f"loaded training feature cities={len(training_feature_history or {})}")
    _log(args.verbose, "loading truth history")
    truth_history = _load_truth_history()
    _log(args.verbose, f"loaded truth cities={len(truth_history or {})}")
    _log(args.verbose, "loading settlement history")
    settlement_history = _load_json_if_exists(args.settlement_history)
    _log(args.verbose, f"loaded settlement history cities={len(settlement_history or {})}")
    _log(
        args.verbose,
        "loading probability snapshots"
        + (f" limit={args.snapshot_limit}" if args.snapshot_limit else ""),
    )
    snapshot_rows = _load_snapshot_rows(args.snapshot_file, limit=args.snapshot_limit)
    _log(args.verbose, f"loaded probability snapshots={len(snapshot_rows or [])}")
    _log(args.verbose, "loading legacy training archive")
    legacy_training_samples = _load_legacy_training_samples()
    _log(args.verbose, f"loaded legacy training samples={len(legacy_training_samples or [])}")
    _log(args.verbose, "extracting evaluation samples")
    samples, filled_actual_from_history = _extract_samples(
        history,
        training_feature_history=training_feature_history,
        truth_history=truth_history,
        settlement_history=settlement_history,
        snapshot_rows=snapshot_rows,
    )
    samples = merge_samples_with_legacy_archive(samples, legacy_training_samples)
    _log(args.verbose, f"evaluating samples={len(samples or [])}")

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
    _log(args.verbose, "done")


if __name__ == "__main__":
    main()
