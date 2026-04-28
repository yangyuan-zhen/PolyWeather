from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

_SCAN_TERMINAL_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_CACHE: Dict[str, Dict[str, Any]] = {}
_SCAN_TERMINAL_REFRESHING: set[str] = set()
_SCAN_TERMINAL_AI_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_AI_CACHE: Dict[str, Dict[str, Any]] = {}


def scan_terminal_cache_key(filters: Dict[str, Any]) -> str:
    return json.dumps(filters, ensure_ascii=True, sort_keys=True)


def get_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    *,
    ttl_sec: int,
) -> Optional[Dict[str, Any]]:
    cache_key = scan_terminal_cache_key(filters)
    now = time.time()
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at = float(cached.get("t") or 0.0)
        if now - cached_at >= float(ttl_sec):
            return None
        payload = cached.get("payload")
        if not isinstance(payload, dict):
            return None
        return dict(payload)


def get_scan_terminal_cache_entry(filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cache_key = scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not isinstance(cached, dict):
            return None
        return dict(cached)


def set_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    payload: Dict[str, Any],
) -> None:
    cache_key = scan_terminal_cache_key(filters)
    existing = get_scan_terminal_cache_entry(filters) or {}
    now = time.time()
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = {
            "t": now,
            "payload": dict(payload),
            "success_t": now,
            "success_payload": dict(payload),
            "last_error": existing.get("last_error"),
            "last_failed_at": existing.get("last_failed_at"),
        }


def set_scan_terminal_failure_state(
    filters: Dict[str, Any],
    *,
    error_message: str,
) -> None:
    cache_key = scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        existing = _SCAN_TERMINAL_CACHE.get(cache_key) or {}
        existing["last_error"] = error_message
        existing["last_failed_at"] = datetime.utcnow().isoformat() + "Z"
        _SCAN_TERMINAL_CACHE[cache_key] = existing


def mark_scan_terminal_refreshing(filters: Dict[str, Any]) -> bool:
    cache_key = scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        if cache_key in _SCAN_TERMINAL_REFRESHING:
            return False
        _SCAN_TERMINAL_REFRESHING.add(cache_key)
    return True


def clear_scan_terminal_refreshing(filters: Dict[str, Any]) -> None:
    cache_key = scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_REFRESHING.discard(cache_key)


def scan_ai_cache_key(
    snapshot_id: str,
    filters: Dict[str, Any],
    *,
    max_rows: int,
    model: str,
) -> str:
    raw = json.dumps(
        {
            "schema_version": "city_forecast_v1",
            "snapshot_id": snapshot_id,
            "filters": filters,
            "model": model,
            "max_rows": max_rows,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_scan_ai_result(
    snapshot_id: str,
    filters: Dict[str, Any],
    *,
    max_rows: int,
    model: str,
    ttl_sec: int,
) -> Optional[Dict[str, Any]]:
    cache_key = scan_ai_cache_key(
        snapshot_id,
        filters,
        max_rows=max_rows,
        model=model,
    )
    now = time.time()
    with _SCAN_TERMINAL_AI_CACHE_LOCK:
        cached = _SCAN_TERMINAL_AI_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at = float(cached.get("cached_at") or 0.0)
        if now - cached_at >= float(ttl_sec):
            return None
        result = cached.get("result")
        if isinstance(result, dict):
            return dict(result)
    return None


def set_cached_scan_ai_result(
    snapshot_id: str,
    filters: Dict[str, Any],
    result: Dict[str, Any],
    *,
    max_rows: int,
    model: str,
) -> None:
    cache_key = scan_ai_cache_key(
        snapshot_id,
        filters,
        max_rows=max_rows,
        model=model,
    )
    with _SCAN_TERMINAL_AI_CACHE_LOCK:
        _SCAN_TERMINAL_AI_CACHE[cache_key] = {
            "cached_at": time.time(),
            "result": result,
        }
