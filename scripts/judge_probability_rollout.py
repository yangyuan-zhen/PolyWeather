import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.probability_rollout import build_rollout_report  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Judge whether EMOS is ready for primary rollout.")
    parser.add_argument(
        "--evaluation-report",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "evaluation_report.json",
        ),
    )
    parser.add_argument(
        "--shadow-report",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "shadow_report.json",
        ),
    )
    parser.add_argument(
        "--output",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "rollout_report.json",
        ),
    )
    args = parser.parse_args()

    payload = build_rollout_report(args.evaluation_report, args.shadow_report)
    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(json.dumps(payload["decision"], ensure_ascii=False, indent=2))
    print(f"saved rollout report to {args.output}")


if __name__ == "__main__":
    main()
