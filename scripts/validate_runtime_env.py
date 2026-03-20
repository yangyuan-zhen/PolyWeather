import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.utils.config_validation import validate_runtime_env  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Validate PolyWeather runtime environment variables.")
    parser.add_argument(
        "--component",
        choices=["bot", "web"],
        default="web",
    )
    args = parser.parse_args()

    report = validate_runtime_env(args.component)
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    raise SystemExit(0 if report.ok else 1)


if __name__ == "__main__":
    main()
