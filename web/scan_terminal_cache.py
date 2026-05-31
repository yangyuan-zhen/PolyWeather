from __future__ import annotations

import json
import hashlib
import os
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

_SCAN_TERMINAL_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_CACHE: Dict[str, Dict[str, Any]] = {}
_SCAN_TERMINAL_REFRESHING: set[str] = set()
_SCAN_TERMINAL_REDIS_CLIENT_LOCK = threading.Lock()
_SCAN_TERMINAL_REDIS_CLIENT: Any = None
_SCAN_TERMINAL_REDIS_UNAVAILABLE = False


def scan_terminal_cache_key(filters: Dict[str, Any]) -> str:
    return json.dumps(filters, ensure_ascii=True, sort_keys=True)


def _truthy_env(name: str, *, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() not in ("", "0", "false", "no", "off")


def _redis_cache_enabled() -> bool:
    return _truthy_env(
        "POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_ENABLED",
        default=bool(os.getenv("POLYWEATHER_REDIS_URL")),
    )


def _redis_cache_ttl_sec() -> int:
    try:
        value = int(os.getenv("POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_TTL_SEC", "21600"))
    except Exception:
        value = 21600
    return max(600, min(value, 86400))


def _redis_cache_prefix() -> str:
    return os.getenv(
        "POLYWEATHER_SCAN_TERMINAL_REDIS_CACHE_PREFIX",
        "polyweather:scan_terminal:v1:",
    )


def _redis_entry_key(cache_key: str) -> str:
    digest = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()
    return f"{_redis_cache_prefix()}{digest}"


def _get_redis_client() -> Any:
    global _SCAN_TERMINAL_REDIS_CLIENT, _SCAN_TERMINAL_REDIS_UNAVAILABLE

    if not _redis_cache_enabled() or _SCAN_TERMINAL_REDIS_UNAVAILABLE:
        return None

    with _SCAN_TERMINAL_REDIS_CLIENT_LOCK:
        if _SCAN_TERMINAL_REDIS_CLIENT is not None:
            return _SCAN_TERMINAL_REDIS_CLIENT
        try:
            import redis  # type: ignore

            url = os.getenv("POLYWEATHER_REDIS_URL") or "redis://127.0.0.1:6379/0"
            client = redis.Redis.from_url(
                url,
                socket_timeout=float(os.getenv("POLYWEATHER_REDIS_SOCKET_TIMEOUT_SECONDS", "2")),
                socket_connect_timeout=float(
                    os.getenv("POLYWEATHER_REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS", "1")
                ),
                health_check_interval=30,
            )
            client.ping()
            _SCAN_TERMINAL_REDIS_CLIENT = client
            return client
        except Exception:
            _SCAN_TERMINAL_REDIS_UNAVAILABLE = True
            return None


def _read_redis_cache_entry(cache_key: str) -> Optional[Dict[str, Any]]:
    client = _get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_redis_entry_key(cache_key))
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        entry = json.loads(str(raw))
        return dict(entry) if isinstance(entry, dict) else None
    except Exception:
        return None


def _write_redis_cache_entry(cache_key: str, entry: Dict[str, Any]) -> None:
    client = _get_redis_client()
    if client is None:
        return
    try:
        client.setex(
            _redis_entry_key(cache_key),
            _redis_cache_ttl_sec(),
            json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        )
    except Exception:
        return


def get_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    *,
    ttl_sec: int,
) -> Optional[Dict[str, Any]]:
    now = time.time()
    cached = get_scan_terminal_cache_entry(filters)
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
        if isinstance(cached, dict):
            return dict(cached)

    redis_entry = _read_redis_cache_entry(cache_key)
    if not redis_entry:
        return None

    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = dict(redis_entry)
    return dict(redis_entry)


def set_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    payload: Dict[str, Any],
) -> None:
    cache_key = scan_terminal_cache_key(filters)
    existing = get_scan_terminal_cache_entry(filters) or {}
    now = time.time()
    entry = {
        "t": now,
        "payload": dict(payload),
        "success_t": now,
        "success_payload": dict(payload),
        "last_error": existing.get("last_error"),
        "last_failed_at": existing.get("last_failed_at"),
    }
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = dict(entry)
    _write_redis_cache_entry(cache_key, entry)


def set_scan_terminal_failure_state(
    filters: Dict[str, Any],
    *,
    error_message: str,
) -> None:
    cache_key = scan_terminal_cache_key(filters)
    existing = get_scan_terminal_cache_entry(filters) or {}
    existing["last_error"] = error_message
    existing["last_failed_at"] = datetime.utcnow().isoformat() + "Z"
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = dict(existing)
    _write_redis_cache_entry(cache_key, existing)


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
