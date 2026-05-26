"""In-process SSE patch broadcaster for live terminal updates."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import defaultdict
from typing import Any, AsyncIterator, DefaultDict, Iterable, Optional, Set


HEARTBEAT_INTERVAL_SECONDS = 30
QUEUE_MAXSIZE = 256


class SseManager:
    def __init__(self) -> None:
        self._queues: DefaultDict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._queue_cities: dict[int, frozenset[str]] = {}
        self._lock = threading.RLock()
        self._revision = 0

    def _next_revision(self) -> int:
        with self._lock:
            self._revision += 1
            return self._revision

    @staticmethod
    def _normalize_city(value: Any) -> str:
        return str(value or "").strip().lower()

    @classmethod
    def _normalize_city_set(cls, cities: Optional[Iterable[str]]) -> Set[str]:
        return {
            cls._normalize_city(city)
            for city in (cities or [])
            if cls._normalize_city(city)
        }

    def _track_revision(self, event: dict[str, Any]) -> None:
        try:
            revision = int(event.get("revision") or 0)
        except (TypeError, ValueError):
            return
        if revision <= 0:
            return
        with self._lock:
            if revision > self._revision:
                self._revision = revision

    def broadcast(self, city: str, changes: dict[str, Any]) -> dict[str, Any]:
        event = {
            "type": "city_patch",
            "city": self._normalize_city(city),
            "changes": changes or {},
            "revision": self._next_revision(),
            "ts": int(time.time() * 1000),
        }
        return self.broadcast_event(event)

    def broadcast_event(self, event: dict[str, Any]) -> dict[str, Any]:
        city = self._normalize_city(event.get("city"))
        if city:
            event = {**event, "city": city}
        self._track_revision(event)
        if not city:
            return event

        with self._lock:
            queue_items = [
                (queue, self._queue_cities.get(id(queue), frozenset()))
                for queue_set in self._queues.values()
                for queue in queue_set
            ]

        for queue, subscribed_cities in queue_items:
            if subscribed_cities and city not in subscribed_cities:
                continue
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass
        return event

    async def event_stream(
        self,
        user_id: str,
        *,
        cities: Optional[Iterable[str]] = None,
        replay_events: Optional[Iterable[dict[str, Any]]] = None,
        connected_revision: Optional[int] = None,
        resync_event: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[str]:
        user_key = str(user_id or "anon")
        city_set = frozenset(self._normalize_city_set(cities))
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._queues[user_key].add(queue)
            self._queue_cities[id(queue)] = city_set
            if connected_revision is not None:
                self._revision = max(self._revision, int(connected_revision or 0))

        try:
            yield self._format_event({
                "type": "connected",
                "revision": self._revision,
                "cities": sorted(city_set),
                "ts": int(time.time() * 1000),
            })
            for event in replay_events or []:
                self._track_revision(event)
                yield self._format_event(event)
            if resync_event:
                self._track_revision({"revision": resync_event.get("latest_revision")})
                yield self._format_event(resync_event)
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(),
                        timeout=HEARTBEAT_INTERVAL_SECONDS,
                    )
                except asyncio.TimeoutError:
                    event = {
                        "type": "heartbeat",
                        "revision": self._revision,
                        "ts": int(time.time() * 1000),
                    }
                yield self._format_event(event)
        finally:
            with self._lock:
                self._queues[user_key].discard(queue)
                self._queue_cities.pop(id(queue), None)
                if not self._queues[user_key]:
                    self._queues.pop(user_key, None)

    @staticmethod
    def _format_event(event: dict[str, Any]) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


sse_manager = SseManager()
