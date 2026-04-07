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
        description="Run a background dashboard prewarm worker for hot PolyWeather cities.",
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
    parser.add_argument(
        "--interval-sec",
        type=int,
        default=int(os.getenv("POLYWEATHER_PREWARM_INTERVAL_SEC", "300")),
        help="Worker interval in seconds",
    )
    parser.add_argument(
        "--jitter-sec",
        type=int,
        default=int(os.getenv("POLYWEATHER_PREWARM_JITTER_SEC", "20")),
        help="Random jitter added to each loop in seconds",
    )
    parser.add_argument("--force-refresh", action="store_true")
    parser.add_argument("--include-detail", action="store_true")
    parser.add_argument("--include-market", action="store_true")
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from src.utils.prewarm_dashboard import run_worker_loop

    return run_worker_loop(
        base_url=args.base_url,
        cities=args.cities,
        interval_sec=args.interval_sec,
        jitter_sec=args.jitter_sec,
        force_refresh=bool(args.force_refresh),
        include_detail=bool(args.include_detail),
        include_market=bool(args.include_market),
        once=bool(args.once),
    )


if __name__ == "__main__":
    raise SystemExit(main())
