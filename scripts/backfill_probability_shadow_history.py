import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.deb_algorithm import load_history, save_history  # noqa: E402
from src.analysis.probability_calibration import (  # noqa: E402
    ENGINE_MODE_EMOS_SHADOW,
    apply_probability_calibration,
    build_probability_features,
)
from scripts.fit_probability_calibration import _default_history_arg  # noqa: E402


def _sample_to_features(sample):
    peak_flag = sample.get("peak_flag")
    if peak_flag == 1.0:
        peak_status = "past"
    elif peak_flag == 0.5:
        peak_status = "in_window"
    else:
        peak_status = "before"
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
        peak_status=peak_status,
        local_hour_frac=None,
    )


def main():
    parser = argparse.ArgumentParser(description="Backfill shadow probability snapshots into daily records.")
    parser.add_argument(
        "--history-file",
        default=_default_history_arg(),
    )
    parser.add_argument(
        "--training-samples",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "training_samples.json",
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
    args = parser.parse_args()

    history = load_history(args.history_file)
    with open(args.training_samples, "r", encoding="utf-8") as fh:
        training_payload = json.load(fh)

    updated = 0
    touched = 0

    for sample in training_payload.get("samples") or []:
        city = str(sample.get("city") or "").strip().lower()
        date_str = str(sample.get("date") or "").strip()
        if not city or not date_str:
            continue
        record = ((history.get(city) or {}).get(date_str) or {})
        if not isinstance(record, dict) or not record:
            continue

        legacy_distribution = [
            {"value": row.get("v"), "probability": row.get("p")}
            for row in (record.get("prob_snapshot") or [])
            if isinstance(row, dict) and row.get("v") is not None
        ]
        if not legacy_distribution:
            continue

        calibration = apply_probability_calibration(
            city_name=city,
            temp_symbol="°F" if city in {"atlanta", "chicago", "dallas", "miami", "new york", "seattle"} else "°C",
            raw_mu=sample.get("raw_mu"),
            raw_sigma=sample.get("raw_sigma"),
            max_so_far=None,
            legacy_distribution=legacy_distribution,
            features=_sample_to_features(sample),
            calibration_path=args.calibration_file,
            mode=ENGINE_MODE_EMOS_SHADOW,
        )

        shadow_distribution = calibration.get("shadow_distribution") or []
        compact_shadow = [
            {
                "v": int(row.get("value")),
                "p": round(float(row.get("probability") or 0.0), 3),
            }
            for row in shadow_distribution[:4]
            if row.get("value") is not None
        ]
        compact_calibration = {
            "mode": calibration.get("mode"),
            "engine": calibration.get("engine"),
            "version": calibration.get("calibration_version"),
            "source": calibration.get("calibration_source"),
            "raw_mu": calibration.get("raw_mu"),
            "raw_sigma": calibration.get("raw_sigma"),
            "calibrated_mu": calibration.get("calibrated_mu"),
            "calibrated_sigma": calibration.get("calibrated_sigma"),
        }

        touched += 1
        if (
            record.get("shadow_prob_snapshot") == compact_shadow
            and record.get("probability_calibration") == compact_calibration
        ):
            continue

        record["shadow_prob_snapshot"] = compact_shadow
        record["probability_calibration"] = compact_calibration
        history[city][date_str] = record
        updated += 1

    save_history(args.history_file, history)
    print(
        json.dumps(
            {
                "samples_seen": len(training_payload.get("samples") or []),
                "records_considered": touched,
                "records_updated": updated,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
