import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


def main() -> int:
    from src.payments.contract_audit import analyze_checkout_contract

    parser = argparse.ArgumentParser(
        description="Static security review for PolyWeather checkout contract."
    )
    parser.add_argument(
        "--contract",
        default=os.path.join(PROJECT_ROOT, "contracts", "PolyWeatherCheckout.sol"),
        help="Path to Solidity contract source.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional JSON output path.",
    )
    args = parser.parse_args()

    report = analyze_checkout_contract(args.contract)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        output_path = os.path.abspath(args.output)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
