"""Redis Stream-backed realtime observation event store."""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from loguru import logger

from web.realtime_event_store import MAX_REPLAY_LIMIT, TIME_CONTRACT_KEYS
from web.realtime_patch_schema import EVENT_TYPE


DEFAULT_STREAM_KEY = "stream:city_observation"
DEFAULT_COUNTER_KEY = "counter:city_observation_revision"
DEFAULT_MAXLEN = 50000
DEFAULT_SOCKET_TIMEOUT_SECONDS = 15.0
DEFAULT_SOCKET_CONNECT_TIMEOUT_SECONDS = 5.0
DEFAULT_REPLAY_CHUNK_SIZE = 512
DEFAULT_REPLAY_SCAN_MAX = 5000

APPEND_EVENT_SCRIPT = """
local revision = redis.call('INCR', KEYS[2])
local stream_id = redis.call(
  'XADD', KEYS[1], 'MAXLEN', '~', ARGV[1], '*',
  'revision', revision,
  'type', ARGV[2],
  'schema_type', ARGV[3],
  'schema_version', ARGV[4],
  'city', ARGV[5],
  'source', ARGV[6],
  'obs_time', ARGV[7],
  'payload_json', ARGV[8],
  'created_at_ms', ARGV[9],
  'ts', ARGV[10],
  'producer_id', ARGV[11]
)
return {revision, stream_id}
"""


def _decode(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value or "")


def _normalize_city_set(cities: Optional[Iterable[str]]) -> Set[str]:
    return {str(city or "").strip().lower() for city in (cities or set()) if str(city or "").strip()}


def _time_contract_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {key: payload[key] for key in TIME_CONTRACT_KEYS if key in payload}


def _int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or default)
    except (TypeError, ValueError):
        return default


def _int_env(name: str, default: int, *, min_value: int, max_value: int) -> int:
    try:
        value = int(os.getenv(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(max_value, int(value)))


class RedisRealtimeEventStore:
    """Persist replayable observation patch events in a Redis Stream."""

    uses_external_live_fanout = True

    def __init__(
        self,
        *,
        redis_url: Optional[str] = None,
        redis_client: Any = None,
        stream_key: Optional[str] = None,
        counter_key: Optional[str] = None,
        maxlen: Optional[int] = None,
        producer_id: Optional[str] = None,
    ) -> None:
        self.stream_key = stream_key or os.getenv("POLYWEATHER_REDIS_STREAM_KEY") or DEFAULT_STREAM_KEY
        self.counter_key = counter_key or os.getenv("POLYWEATHER_REDIS_COUNTER_KEY") or DEFAULT_COUNTER_KEY
        self.maxlen = max(1, int(maxlen or os.getenv("POLYWEATHER_REDIS_STREAM_MAXLEN") or DEFAULT_MAXLEN))
        self.replay_chunk_size = _int_env(
            "POLYWEATHER_REDIS_REPLAY_CHUNK_SIZE",
            DEFAULT_REPLAY_CHUNK_SIZE,
            min_value=50,
            max_value=2000,
        )
        self.replay_scan_max = _int_env(
            "POLYWEATHER_REDIS_REPLAY_SCAN_MAX",
            DEFAULT_REPLAY_SCAN_MAX,
            min_value=500,
            max_value=50000,
        )
        self.producer_id = producer_id or os.getenv("POLYWEATHER_INSTANCE_ID") or socket.gethostname()
        self._client = redis_client or self._build_client(redis_url)
        self._subscriber_lock = threading.Lock()
        self._subscriber_thread: Optional[threading.Thread] = None
        self._subscriber_stop: Optional[threading.Event] = None

    @staticmethod
    def _build_client(redis_url: Optional[str]) -> Any:
        try:
            import redis  # type: ignore
        except ImportError as exc:
            raise RuntimeError("redis package is required for Redis realtime event store") from exc

        url = redis_url or os.getenv("POLYWEATHER_REDIS_URL") or "redis://127.0.0.1:6379/0"
        client = redis.Redis.from_url(
            url,
            socket_timeout=_float_env("POLYWEATHER_REDIS_SOCKET_TIMEOUT_SECONDS", DEFAULT_SOCKET_TIMEOUT_SECONDS),
            socket_connect_timeout=_float_env(
                "POLYWEATHER_REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS",
                DEFAULT_SOCKET_CONNECT_TIMEOUT_SECONDS,
            ),
            health_check_interval=30,
        )
        client.ping()
        return client

    def append_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        if event.get("type") != EVENT_TYPE:
            raise ValueError("unsupported realtime event type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("event payload must be an object")

        created_at_ms = int(time.time() * 1000)
        ts = int(event.get("ts") or created_at_ms)
        payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        result = self._client.eval(
            APPEND_EVENT_SCRIPT,
            2,
            self.stream_key,
            self.counter_key,
            self.maxlen,
            str(event["type"]),
            str(event["schema_type"]),
            int(event["schema_version"]),
            str(event["city"]),
            str(event["source"]),
            str(event.get("obs_time") or ""),
            payload_json,
            created_at_ms,
            ts,
            self.producer_id,
        )
        revision = int(_decode(result[0] if isinstance(result, (list, tuple)) else result))
        return {
            "type": event["type"],
            "revision": revision,
            "city": str(event["city"]),
            "source": str(event["source"]),
            "obs_time": event.get("obs_time"),
            **_time_contract_from_payload(payload),
            "ts": ts,
            "payload": payload,
        }

    def latest_revision(self) -> int:
        value = self._client.get(self.counter_key)
        revision = _int_or_zero(_decode(value))
        if revision:
            return revision
        rows = self._client.xrevrange(self.stream_key, max="+", min="-", count=1)
        events = self._rows_to_events(rows)
        return max((event["revision"] for event in events), default=0)

    def status(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "store": "redis",
            "redis_connected": False,
            "stream_key": self.stream_key,
            "latest_revision": 0,
            "stream_len": None,
            "oldest_revision": None,
            "subscriber_connected": bool(
                self._subscriber_thread and self._subscriber_thread.is_alive()
            ),
        }
        try:
            ping = getattr(self._client, "ping", None)
            if callable(ping):
                ping()
            out["redis_connected"] = True
            out["latest_revision"] = self.latest_revision()
            xlen = getattr(self._client, "xlen", None)
            if callable(xlen):
                out["stream_len"] = int(xlen(self.stream_key))
            out["oldest_revision"] = self._oldest_revision()
        except Exception as exc:
            out["error"] = str(exc)
        return out

    def replay_events(
        self,
        *,
        cities: Optional[Set[str]],
        since_revision: int,
        limit: int,
    ) -> List[Dict[str, Any]]:
        city_set = _normalize_city_set(cities)
        since = max(0, int(since_revision or 0))
        bounded_limit = max(1, min(MAX_REPLAY_LIMIT, int(limit or 1)))
        if since <= 0:
            return self._replay_events_forward(
                city_set=city_set,
                since=since,
                limit=bounded_limit,
            )[0]
        return self._replay_events_reverse(
            city_set=city_set,
            since=since,
            limit=bounded_limit,
        )[0]

    def replay_requires_resync(
        self,
        *,
        cities: Optional[Set[str]],
        since_revision: int,
        replay_count: int,
        limit: int,
    ) -> bool:
        city_set = _normalize_city_set(cities)
        since = max(0, int(since_revision or 0))
        oldest_revision = self._oldest_revision()
        if since > 0 and oldest_revision and since < oldest_revision - 1:
            return True
        bounded_limit = max(1, int(limit or 1))
        if int(replay_count or 0) < bounded_limit:
            return False
        probe_limit = min(MAX_REPLAY_LIMIT + 1, bounded_limit + 1)
        if since <= 0:
            probe_events, _, _ = self._replay_events_forward(
                city_set=city_set,
                since=since,
                limit=probe_limit,
            )
            return len(probe_events) > bounded_limit

        probe_events, hit_boundary, scanned = self._replay_events_reverse(
            city_set=city_set,
            since=since,
            limit=probe_limit,
        )
        if len(probe_events) > bounded_limit:
            return True
        return not hit_boundary and scanned >= self.replay_scan_max

    def start_live_subscription(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        with self._subscriber_lock:
            if self._subscriber_thread and self._subscriber_thread.is_alive():
                return
            self._subscriber_stop = threading.Event()
            self._subscriber_thread = threading.Thread(
                target=self._live_subscription_loop,
                args=(callback, self._subscriber_stop),
                name="polyweather-redis-realtime-subscriber",
                daemon=True,
            )
            self._subscriber_thread.start()

    def stop_live_subscription(self) -> None:
        with self._subscriber_lock:
            if self._subscriber_stop:
                self._subscriber_stop.set()
            self._subscriber_thread = None
            self._subscriber_stop = None

    def _live_subscription_loop(
        self,
        callback: Callable[[Dict[str, Any]], None],
        stop_event: threading.Event,
    ) -> None:
        last_seen_id = "$"
        while not stop_event.is_set():
            try:
                rows = self._client.xread({self.stream_key: last_seen_id}, count=100, block=5000)
                for _stream_name, entries in rows or []:
                    for entry_id, fields in entries:
                        last_seen_id = _decode(entry_id)
                        callback(self._entry_to_event(entry_id, fields))
            except Exception as exc:
                logger.warning(f"Redis realtime subscriber disconnected: {exc}")
                stop_event.wait(2.0)

    def _all_events(self) -> List[Dict[str, Any]]:
        rows = self._client.xrange(self.stream_key, min="-", max="+")
        return self._rows_to_events(rows)

    def _oldest_revision(self) -> Optional[int]:
        rows = self._client.xrange(self.stream_key, min="-", max="+", count=1)
        events = self._rows_to_events(rows)
        if not events:
            return None
        return int(events[0].get("revision") or 0) or None

    def _rows_to_events(self, rows: Any) -> List[Dict[str, Any]]:
        return [self._entry_to_event(entry_id, fields) for entry_id, fields in rows or []]

    @staticmethod
    def _matches_city(event: Dict[str, Any], city_set: Set[str]) -> bool:
        return not city_set or str(event.get("city") or "").strip().lower() in city_set

    def _replay_events_forward(
        self,
        *,
        city_set: Set[str],
        since: int,
        limit: int,
    ) -> tuple[List[Dict[str, Any]], bool, int]:
        replay: List[Dict[str, Any]] = []
        scanned = 0
        min_id = "-"
        hit_boundary = False
        while len(replay) < limit and scanned < self.replay_scan_max:
            count = min(self.replay_chunk_size, self.replay_scan_max - scanned)
            rows = self._client.xrange(self.stream_key, min=min_id, max="+", count=count)
            if not rows:
                hit_boundary = True
                break
            scanned += len(rows)
            for entry_id, fields in rows:
                event = self._entry_to_event(entry_id, fields)
                if int(event.get("revision") or 0) <= since:
                    continue
                if self._matches_city(event, city_set):
                    replay.append(event)
                    if len(replay) >= limit:
                        break
            min_id = f"({_decode(rows[-1][0])}"
        return replay, hit_boundary, scanned

    def _replay_events_reverse(
        self,
        *,
        city_set: Set[str],
        since: int,
        limit: int,
    ) -> tuple[List[Dict[str, Any]], bool, int]:
        replay_desc: List[Dict[str, Any]] = []
        scanned = 0
        max_id = "+"
        hit_boundary = False
        while len(replay_desc) < limit and scanned < self.replay_scan_max:
            count = min(self.replay_chunk_size, self.replay_scan_max - scanned)
            rows = self._client.xrevrange(self.stream_key, max=max_id, min="-", count=count)
            if not rows:
                hit_boundary = True
                break
            scanned += len(rows)
            for entry_id, fields in rows:
                event = self._entry_to_event(entry_id, fields)
                if int(event.get("revision") or 0) <= since:
                    hit_boundary = True
                    return list(reversed(replay_desc)), hit_boundary, scanned
                if self._matches_city(event, city_set):
                    replay_desc.append(event)
                    if len(replay_desc) >= limit:
                        break
            max_id = f"({_decode(rows[-1][0])}"
        return list(reversed(replay_desc)), hit_boundary, scanned

    @staticmethod
    def _entry_to_event(entry_id: Any, fields: Dict[Any, Any]) -> Dict[str, Any]:
        normalized = {_decode(key): _decode(value) for key, value in dict(fields or {}).items()}
        payload = json.loads(normalized.get("payload_json") or "{}")
        schema_type = normalized.get("schema_type") or "city_observation_patch"
        schema_version = int(normalized.get("schema_version") or 1)
        created_at_ms = _int_or_zero(normalized.get("created_at_ms")) or int(time.time() * 1000)
        ts = _int_or_zero(normalized.get("ts")) or created_at_ms
        obs_time = normalized.get("obs_time") or None
        return {
            "type": normalized.get("type") or f"{schema_type}.v{schema_version}",
            "revision": int(normalized["revision"]),
            "city": normalized.get("city") or "",
            "source": normalized.get("source") or "",
            "obs_time": obs_time,
            **_time_contract_from_payload(payload if isinstance(payload, dict) else {}),
            "ts": ts,
            "payload": payload if isinstance(payload, dict) else {},
        }
