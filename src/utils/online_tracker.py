"""Lightweight online-user tracker.  Records last-seen timestamps in memory
and exposes a count of users active within a sliding window.  No external
dependency — just a dict + lock + periodic cleanup thread."""

from __future__ import annotations

import threading
import time
from typing import Dict

_online_users: Dict[str, float] = {}
_lock = threading.Lock()
_cleanup_interval_sec = 120
_window_sec = 300  # 5 minutes


def _cleanup_stale() -> None:
    cutoff = time.time() - _window_sec
    with _lock:
        stale = [uid for uid, ts in _online_users.items() if ts < cutoff]
        for uid in stale:
            del _online_users[uid]


def _start_cleanup() -> None:
    _cleanup_stale()
    threading.Timer(_cleanup_interval_sec, _start_cleanup).start()


_start_cleanup()


def record_activity(user_id: str) -> None:
    if not user_id:
        return
    with _lock:
        _online_users[user_id] = time.time()


def online_count() -> int:
    _cleanup_stale()
    with _lock:
        return len(_online_users)
