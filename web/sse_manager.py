"""In-process SSE patch broadcaster for live terminal updates."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import defaultdict
from typing import Any, AsyncIterator, DefaultDict


HEARTBEAT_INTERVAL_SECONDS = 30
QUEUE_MAXSIZE = 256


class SseManager:
    def __init__(self) -> None:
        self._queues: DefaultDict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = threading.RLock()
        self._revision = 0

    def _next_revision(self) -> int:
        with self._lock:
            self._revision += 1
            return self._revision

    def broadcast(self, city: str, changes: dict[str, Any]) -> dict[str, Any]:
        event = {
            "type": "city_patch",
            "city": str(city or "").strip().lower(),
            "changes": changes or {},
            "revision": self._next_revision(),
            "ts": int(time.time() * 1000),
        }
        if not event["city"]:
            return event

        with self._lock:
            queues = [queue for queue_set in self._queues.values() for queue in queue_set]

        for queue in queues:
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

    async def event_stream(self, user_id: str) -> AsyncIterator[str]:
        user_key = str(user_id or "anon")
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._queues[user_key].add(queue)

        try:
            yield self._format_event({
                "type": "connected",
                "revision": self._revision,
                "ts": int(time.time() * 1000),
            })
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
                if not self._queues[user_key]:
                    self._queues.pop(user_key, None)

    @staticmethod
    def _format_event(event: dict[str, Any]) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


sse_manager = SseManager()
