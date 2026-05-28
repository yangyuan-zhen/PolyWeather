"""Scan terminal configuration constants."""

from __future__ import annotations

import os
from typing import Optional

from src.utils.refresh_policy import SCAN_ROWS_REFRESH_SEC


def _env_int(
    name: str,
    default: int,
    *,
    min_value: int,
    max_value: Optional[int] = None,
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = int(default)
    value = max(int(min_value), value)
    if max_value is not None:
        value = min(int(max_value), value)
    return value


SCAN_TERMINAL_PAYLOAD_TTL_SEC = min(
    SCAN_ROWS_REFRESH_SEC,
    max(10, int(os.getenv("POLYWEATHER_SCAN_TERMINAL_PAYLOAD_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))),
)
SCAN_TERMINAL_BUILD_TIMEOUT_SEC = max(
    8,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC", "120")),
)
SCAN_TERMINAL_MAX_WORKERS = _env_int(
    "POLYWEATHER_SCAN_TERMINAL_MAX_WORKERS",
    8,
    min_value=1,
    max_value=12,
)
