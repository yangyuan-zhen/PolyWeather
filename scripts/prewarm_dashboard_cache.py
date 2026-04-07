from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def parse_args() -> argparse.Namespace:
    from src.utils.prewarm_dashboard import DEFAULT_CITIES

    parser = argparse.ArgumentParser(
        description="Prewarm PolyWeather summary/detail/market caches for selected cities.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("POLYWEATHER_BACKEND_URL", "http://127.0.0.1:8000"),
        help="Backend base URL, defaults to POLYWEATHER_BACKEND_URL or http://127.0.0.1:8000",
    )
    parser.add_argument(
        "--cities",
        default=",".join(DEFAULT_CITIES),
        help="Comma-separated city names to prewarm",
    )
    parser.add_argument("--force-refresh", action="store_true")
    parser.add_argument("--include-detail", action="store_true")
    parser.add_argument("--include-market", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from src.utils.prewarm_dashboard import run_prewarm

    return run_prewarm(
        base_url=args.base_url,
        cities=args.cities,
        force_refresh=bool(args.force_refresh),
        include_detail=bool(args.include_detail),
        include_market=bool(args.include_market),
    )


if __name__ == "__main__":
    raise SystemExit(main())
