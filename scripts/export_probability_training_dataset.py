import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from scripts.fit_probability_calibration import (  # noqa: E402
    _default_history_arg,
    _default_snapshot_arg,
    _extract_samples,
    _load_history_with_fallback,
    _load_json_if_exists,
    _load_snapshot_rows,
)


def main():
    parser = argparse.ArgumentParser(description="Export normalized probability calibration training samples.")
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
        "--output",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "training_samples.json",
        ),
    )
    parser.add_argument(
        "--snapshot-file",
        default=_default_snapshot_arg(),
    )
    args = parser.parse_args()

    history = _load_history_with_fallback(args.history_file)
    settlement_history = _load_json_if_exists(args.settlement_history)
    snapshot_rows = _load_snapshot_rows(args.snapshot_file)
    samples, filled_actual_from_history = _extract_samples(
        history,
        settlement_history=settlement_history,
        snapshot_rows=snapshot_rows,
    )
    snapshot_count = sum(1 for sample in samples if sample.get("sample_source") == "snapshot")
    daily_record_count = sum(1 for sample in samples if sample.get("sample_source") == "daily_record")

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    payload = {
        "sample_count": len(samples),
        "snapshot_sample_count": snapshot_count,
        "daily_record_sample_count": daily_record_count,
        "filled_actual_from_history": filled_actual_from_history,
        "samples": samples,
    }
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(f"exported {len(samples)} samples to {args.output}")


if __name__ == "__main__":
    main()
