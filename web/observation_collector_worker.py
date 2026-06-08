"""Standalone observation collector process.

The FastAPI web worker must stay responsive for health checks and user-facing
API routes. High-frequency source polling runs here instead of inside the web
request process.
"""

from __future__ import annotations

import signal
import threading
from types import FrameType
from typing import Optional

from loguru import logger

from web.core import _weather
from web.observation_collector_service import start_observation_collector_loop
from web.services.city_runtime import _refresh_city_panel_cache

_STOP_EVENT = threading.Event()


def _handle_stop_signal(signum: int, _frame: Optional[FrameType]) -> None:
    logger.info("observation collector worker stopping signal={}", signum)
    _STOP_EVENT.set()


def main() -> None:
    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)

    thread = start_observation_collector_loop(
        weather=_weather,
        cache_refresher=lambda city: _refresh_city_panel_cache(city, force_refresh=False),
    )
    if thread is None:
        logger.warning("observation collector worker started with collector disabled")
    else:
        logger.info("observation collector worker started thread={}", thread.name)

    while not _STOP_EVENT.wait(3600):
        pass


if __name__ == "__main__":
    main()
