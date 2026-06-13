"""Standalone cache warmer process for production aggregate payloads."""

from __future__ import annotations

import signal
import threading
from types import FrameType
from typing import Optional

from loguru import logger

from web.cache_warmer_service import (
    build_default_cache_warmer,
    warmer_enabled,
    warmer_tick_sec,
)

_STOP_EVENT = threading.Event()


def _handle_stop_signal(signum: int, _frame: Optional[FrameType]) -> None:
    logger.info("cache warmer worker stopping signal={}", signum)
    _STOP_EVENT.set()


def main() -> None:
    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)

    if not warmer_enabled():
        logger.warning("cache warmer worker disabled; idling")
        while not _STOP_EVENT.wait(3600):
            pass
        return

    warmer = build_default_cache_warmer()
    tick_sec = warmer_tick_sec()
    logger.info(
        "cache warmer worker started tick={}s city_batch={}",
        tick_sec,
        warmer.city_batch_size,
    )
    while not _STOP_EVENT.is_set():
        try:
            completed = warmer.run_due_once()
            logger.debug("cache warmer run completed work_items={}", completed)
        except Exception as exc:
            logger.exception("cache warmer loop failed: {}", exc)
        _STOP_EVENT.wait(tick_sec)


if __name__ == "__main__":
    main()
