from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from src.data_collection.rp5_scraper import scrape_rp5_forecast


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scrape public RP5 forecast page and output JSON.",
    )
    parser.add_argument(
        "--url",
        required=True,
        help="RP5 city weather URL, e.g. https://rp5.am/Weather_in_Ankara%2C_Esenboga_%28airport%29",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=20,
        help="HTTP timeout seconds (default: 20)",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Optional output file path. If empty, print to stdout.",
    )
    args = parser.parse_args()

    data = scrape_rp5_forecast(args.url, timeout_sec=args.timeout)
    payload = json.dumps(data, ensure_ascii=False, indent=2)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload + "\n")
        print(f"saved: {args.out}")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

