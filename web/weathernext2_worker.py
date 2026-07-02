"""Standalone WeatherNext 2 offline worker."""

from __future__ import annotations

import argparse
import json
import os
import signal
import threading
import time
from types import FrameType
from typing import Optional

from loguru import logger

from web.weathernext2_worker_service import run_weathernext2_cycle


_STOP_EVENT = threading.Event()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _handle_stop_signal(signum: int, _frame: Optional[FrameType]) -> None:
    logger.info("WeatherNext2 worker stopping signal={}", signum)
    _STOP_EVENT.set()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch WeatherNext 2 city highs and train LightGBM calibration."
    )
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit.")
    parser.add_argument(
        "--interval-sec",
        type=int,
        default=_env_int("WEATHERNEXT2_WORKER_INTERVAL_SEC", 21600),
    )
    parser.add_argument(
        "--initial-delay-sec",
        type=int,
        default=_env_int("WEATHERNEXT2_WORKER_INITIAL_DELAY_SEC", 90),
    )
    parser.add_argument("--cities", nargs="*", default=None)
    return parser.parse_args()


def _run_once(*, cities: Optional[list[str]]) -> dict:
    result = run_weathernext2_cycle(cities=cities)
    logger.info("WeatherNext2 worker result={}", json.dumps(result, ensure_ascii=False))
    return result


def main() -> None:
    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)
    args = _parse_args()

    if args.once:
        result = _run_once(cities=args.cities)
        print(json.dumps(result, ensure_ascii=False))
        return

    interval_sec = max(1800, int(args.interval_sec or 21600))
    initial_delay_sec = max(0, int(args.initial_delay_sec or 0))
    logger.info("WeatherNext2 worker started interval={}s", interval_sec)
    if initial_delay_sec and _STOP_EVENT.wait(initial_delay_sec):
        return

    while not _STOP_EVENT.is_set():
        started = time.time()
        try:
            _run_once(cities=args.cities)
        except Exception as exc:
            logger.exception("WeatherNext2 cycle failed: {}", exc)
        elapsed = time.time() - started
        wait_for = max(5.0, interval_sec - elapsed)
        if _STOP_EVENT.wait(wait_for):
            break


if __name__ == "__main__":
    main()
