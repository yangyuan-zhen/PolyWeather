"""Thread-safe TTL cache manager for weather data collector sources.

Replaces the per-source cache dictionaries and locks scattered across
WeatherDataCollector Mixins with a single unified store.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional


class WeatherCacheManager:
    """Key-value store with per-entry TTL and automatic trimming."""

    def __init__(self, trim_interval_writes: int = 200) -> None:
        self._lock = threading.Lock()
        self._stores: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._write_count = 0
        self._trim_interval = max(1, int(trim_interval_writes))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, store: str, key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entries = self._stores.get(store)
            if entries is None:
                return None
            return entries.get(key)

    def set(self, store: str, key: str, value: Dict[str, Any]) -> None:
        with self._lock:
            if store not in self._stores:
                self._stores[store] = {}
            self._stores[store][key] = value
            self._write_count += 1
        self._maybe_trim()

    def get_ttl(
        self,
        store: str,
        key: str,
        ttl_sec: float,
    ) -> Optional[Dict[str, Any]]:
        """Return the cached value if it exists and is younger than *ttl_sec*."""
        now = time.time()
        with self._lock:
            entries = self._stores.get(store)
            if entries is None:
                return None
            entry = entries.get(key)
            if entry is None:
                return None
            cached_ts = float(entry.get("_ts") or 0)
            if now - cached_ts > ttl_sec:
                return None
            return entry.get("d")

    def set_ttl(self, store: str, key: str, value: Dict[str, Any]) -> None:
        """Store a value with an automatic timestamp for TTL lookups."""
        self.set(store, key, {"_ts": time.time(), "d": value})

    def store_size(self, store: str) -> int:
        with self._lock:
            entries = self._stores.get(store)
            return len(entries) if entries else 0

    # ------------------------------------------------------------------
    # Trimming
    # ------------------------------------------------------------------

    def _maybe_trim(self) -> None:
        if self._write_count % self._trim_interval != 0:
            return
        self.trim_stale()

    def trim_stale(
        self,
        ttl_map: Optional[Dict[str, float]] = None,
    ) -> None:
        """Remove entries older than their store's TTL.

        *ttl_map* maps store name → ttl_sec.  Stores not in the map are skipped.
        """
        if not ttl_map:
            return
        now = time.time()
        with self._lock:
            for store_name, ttl_sec in ttl_map.items():
                entries = self._stores.get(store_name)
                if not entries:
                    continue
                stale = [
                    key
                    for key, entry in entries.items()
                    if now - float(entry.get("_ts") or 0) > ttl_sec
                ]
                for key in stale:
                    del entries[key]

    def clear_store(self, store: str) -> None:
        with self._lock:
            self._stores.pop(store, None)


# Module-level singleton for the default cache used by WeatherDataCollector.
_weather_cache: Optional[WeatherCacheManager] = None
_weather_cache_lock = threading.Lock()


def get_weather_cache() -> WeatherCacheManager:
    global _weather_cache
    if _weather_cache is None:
        with _weather_cache_lock:
            if _weather_cache is None:
                _weather_cache = WeatherCacheManager()
    return _weather_cache
