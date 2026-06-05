"""Shared singleflight and cooldown guard for high-frequency observation sources."""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Hashable, Optional, Tuple, TypeVar

from loguru import logger

from src.database.db_manager import DBManager

T = TypeVar("T")


ObservationSourceKey = Tuple[str, str]


@dataclass
class _SourceState:
    result: Any = None
    has_result: bool = False
    cooldown_until_ts: float = 0.0
    inflight: Optional[threading.Event] = None
    error: Optional[BaseException] = None


_GATE_LOCK = threading.Lock()
_SOURCE_STATES: Dict[ObservationSourceKey, _SourceState] = {}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_part(value: Any) -> str:
    return str(value or "").strip().lower()


def _state_for(key: ObservationSourceKey) -> _SourceState:
    state = _SOURCE_STATES.get(key)
    if state is None:
        state = _SourceState()
        _SOURCE_STATES[key] = state
    return state


def _acquire_cross_process_cooldown(key: ObservationSourceKey, ttl_sec: int) -> bool:
    if not _env_bool("POLYWEATHER_OBSERVATION_SOURCE_DB_LOCK_ENABLED", True):
        return True
    cache_key = f"observation-source:{key[0]}:{key[1]}"
    try:
        owner = DBManager().acquire_cache_refresh_lock(
            cache_key,
            ttl_sec=max(15, int(ttl_sec or 60)),
        )
    except Exception as exc:
        logger.debug("observation source DB cooldown skipped key={}: {}", cache_key, exc)
        return True
    return bool(owner)


def run_observation_source(
    source: Hashable,
    city_or_scope: Hashable,
    interval_sec: int,
    fetcher: Callable[[], T],
    *,
    failure_cooldown_sec: int = 30,
) -> Optional[T]:
    """Run a source fetch once per source/city interval and share in-flight work.

    The in-process gate returns the previous result during cooldown.  The SQLite
    lock is intentionally left to expire instead of being released so multiple
    service processes also observe a coarse source cooldown.
    """
    if not _env_bool("POLYWEATHER_OBSERVATION_SOURCE_GATE_ENABLED", True):
        return fetcher()

    source_key = _normalize_part(source)
    scope_key = _normalize_part(city_or_scope)
    if not source_key or not scope_key:
        return fetcher()
    interval = max(1, int(interval_sec or 60))
    key: ObservationSourceKey = (source_key, scope_key)

    while True:
        wait_event: Optional[threading.Event] = None
        now_ts = time.time()
        with _GATE_LOCK:
            state = _state_for(key)
            if now_ts < state.cooldown_until_ts:
                return state.result if state.has_result else None
            if state.inflight is None:
                event = threading.Event()
                state.inflight = event
                state.error = None
                break
            wait_event = state.inflight
        if wait_event is not None:
            wait_event.wait(timeout=max(5.0, float(interval)))
            with _GATE_LOCK:
                state = _state_for(key)
                if state.error is not None:
                    raise state.error
                if state.has_result:
                    return state.result
                if state.inflight is None:
                    continue
            return None

    owner_event = event
    try:
        if not _acquire_cross_process_cooldown(key, interval):
            with _GATE_LOCK:
                state = _state_for(key)
                return state.result if state.has_result else None
        result = fetcher()
        with _GATE_LOCK:
            state = _state_for(key)
            state.result = result
            state.has_result = True
            state.cooldown_until_ts = time.time() + interval
            state.error = None
        return result
    except BaseException as exc:
        with _GATE_LOCK:
            state = _state_for(key)
            state.error = exc
            state.cooldown_until_ts = time.time() + max(1, int(failure_cooldown_sec or 30))
        raise
    finally:
        with _GATE_LOCK:
            state = _state_for(key)
            if state.inflight is owner_event:
                state.inflight = None
        owner_event.set()


def reset_observation_source_gate_for_tests() -> None:
    with _GATE_LOCK:
        _SOURCE_STATES.clear()
