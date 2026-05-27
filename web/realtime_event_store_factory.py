"""Factory for selecting the realtime observation event store."""

from __future__ import annotations

import os
from typing import Any, Callable, Optional

from loguru import logger

from web.realtime_event_store import RealtimeEventStore
from web.redis_realtime_event_store import RedisRealtimeEventStore


def _truthy(value: Optional[str], *, default: bool = False) -> bool:
    raw = str(value or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def create_realtime_event_store(
    *,
    db_path: Optional[str] = None,
    redis_client: Any = None,
    redis_store_builder: Optional[Callable[..., Any]] = None,
) -> Any:
    mode = str(os.getenv("POLYWEATHER_EVENT_STORE") or "sqlite").strip().lower()
    if mode in {"", "sqlite"}:
        return RealtimeEventStore(db_path=db_path)

    if mode != "redis":
        logger.warning(f"Unknown POLYWEATHER_EVENT_STORE={mode!r}; using sqlite event store")
        return RealtimeEventStore(db_path=db_path)

    builder = redis_store_builder or RedisRealtimeEventStore
    try:
        kwargs = {"redis_client": redis_client} if redis_client is not None else {}
        return builder(**kwargs)
    except Exception:
        if _truthy(os.getenv("POLYWEATHER_REDIS_REQUIRED"), default=True):
            raise
        logger.exception("Redis realtime event store unavailable; falling back to sqlite")
        fallback = RealtimeEventStore(db_path=db_path)
        setattr(fallback, "degraded_from", "redis")
        return fallback
