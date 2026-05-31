"""Small helpers for exposing request stage timings via Server-Timing."""

from __future__ import annotations

import re
import threading
import time
from typing import Awaitable, Callable, Dict, Optional, TypeVar

from fastapi import Request, Response
from loguru import logger


T = TypeVar("T")


class ServerTimingRecorder:
    def __init__(
        self,
        request: Optional[Request],
        *,
        log_name: str,
        prefix: str,
        state_attr: str,
    ) -> None:
        self.request = request
        self.log_name = log_name
        self.prefix = prefix
        self.state_attr = state_attr
        self.started = time.perf_counter()
        self.timings_ms: Dict[str, float] = {}
        self._lock = threading.Lock()

    def _record(self, stage: str, started: float) -> None:
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)
        with self._lock:
            self.timings_ms[stage] = elapsed_ms

    def measure(self, stage: str, action: Callable[[], T]) -> T:
        started = time.perf_counter()
        try:
            return action()
        finally:
            self._record(stage, started)

    async def measure_async(self, stage: str, action: Callable[[], Awaitable[T]]) -> T:
        started = time.perf_counter()
        try:
            return await action()
        finally:
            self._record(stage, started)

    def server_timing_value(self) -> str:
        with self._lock:
            items = list(self.timings_ms.items())
        return ", ".join(
            f"{self._metric_name(stage)};dur={max(0.0, duration):.1f}"
            for stage, duration in items
        )

    def finish(self, *, outcome: str, status_code: int) -> None:
        self._record("total", self.started)
        value = self.server_timing_value()
        state = getattr(self.request, "state", None)
        if state is not None:
            setattr(state, self.state_attr, value)
        logger.info(
            "{} outcome={} status_code={} timings_ms={}",
            self.log_name,
            outcome,
            status_code,
            dict(self.timings_ms),
        )

    def _metric_name(self, stage: str) -> str:
        raw = f"{self.prefix}_{stage}"
        return re.sub(r"[^A-Za-z0-9_-]", "_", raw)


def attach_server_timing_header(
    response: Response,
    request: Request,
    state_attr: str,
) -> None:
    value = str(getattr(request.state, state_attr, "") or "").strip()
    if value:
        response.headers["Server-Timing"] = value
