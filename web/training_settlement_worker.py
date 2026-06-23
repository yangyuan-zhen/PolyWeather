"""Standalone low-frequency DEB training settlement worker."""

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

from web.training_settlement_service import run_training_settlement_cycle


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
    logger.info("training settlement worker stopping signal={}", signum)
    _STOP_EVENT.set()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run low-frequency DEB training settlement maintenance."
    )
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit.")
    parser.add_argument(
        "--interval-sec",
        type=int,
        default=_env_int("POLYWEATHER_TRAINING_SETTLEMENT_INTERVAL_SEC", 21600),
    )
    parser.add_argument(
        "--initial-delay-sec",
        type=int,
        default=_env_int("POLYWEATHER_TRAINING_SETTLEMENT_INITIAL_DELAY_SEC", 60),
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=_env_int("POLYWEATHER_TRAINING_SETTLEMENT_LOOKBACK_DAYS", 10),
    )
    parser.add_argument("--cities", nargs="*", default=None)
    return parser.parse_args()


def _run_once(*, lookback_days: int, cities: Optional[list[str]]) -> dict:
    result = run_training_settlement_cycle(
        cities=cities,
        lookback_days=lookback_days,
    )
    logger.info("training settlement result={}", json.dumps(result, ensure_ascii=False))
    return result


def main() -> None:
    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)
    args = _parse_args()

    if args.once:
        result = _run_once(lookback_days=args.lookback_days, cities=args.cities)
        print(json.dumps(result, ensure_ascii=False))
        return

    interval_sec = max(300, int(args.interval_sec or 21600))
    initial_delay_sec = max(0, int(args.initial_delay_sec or 0))
    logger.info(
        "training settlement worker started interval={}s lookback_days={}",
        interval_sec,
        args.lookback_days,
    )
    if initial_delay_sec and _STOP_EVENT.wait(initial_delay_sec):
        return

    while not _STOP_EVENT.is_set():
        started = time.time()
        try:
            _run_once(lookback_days=args.lookback_days, cities=args.cities)
        except Exception as exc:
            logger.exception("training settlement cycle failed: {}", exc)
        elapsed = time.time() - started
        wait_for = max(5.0, interval_sec - elapsed)
        if _STOP_EVENT.wait(wait_for):
            break


if __name__ == "__main__":
    main()
