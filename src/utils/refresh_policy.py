"""Shared refresh cadence policy for the web terminal and data collectors."""

from __future__ import annotations

OBSERVATION_REFRESH_SEC = 60
METAR_POLL_TTL_SEC = 5 * 60
SCAN_ROWS_REFRESH_SEC = 5 * 60
MODEL_CACHE_TTL_SEC = 30 * 60

