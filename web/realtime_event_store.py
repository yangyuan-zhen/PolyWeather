"""SQLite-backed replay log for realtime observation SSE patches."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Set

from src.database.db_manager import DBManager
from web.realtime_patch_schema import EVENT_TYPE


DEFAULT_RETENTION_HOURS = 6
MAX_REPLAY_LIMIT = 2000


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _created_at_to_ms(value: str) -> int:
    raw = str(value or "").strip()
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return int(_utc_now().timestamp() * 1000)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.astimezone(timezone.utc).timestamp() * 1000)


def _normalize_city_set(cities: Optional[Set[str]]) -> Set[str]:
    return {str(city or "").strip().lower() for city in (cities or set()) if str(city or "").strip()}


def _retention_hours_from_env() -> int:
    raw = os.getenv("POLYWEATHER_PATCH_EVENT_RETENTION_HOURS", "").strip()
    if not raw:
        return DEFAULT_RETENTION_HOURS
    try:
        return max(1, int(float(raw)))
    except ValueError:
        return DEFAULT_RETENTION_HOURS


class RealtimeEventStore:
    def __init__(self, db_path: Optional[str] = None) -> None:
        self._db = DBManager(db_path)
        self.db_path = self._db.db_path
        self._ensure_table()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _ensure_table(self) -> None:
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS observation_patch_events (
                    revision INTEGER PRIMARY KEY AUTOINCREMENT,
                    schema_type TEXT NOT NULL,
                    schema_version INTEGER NOT NULL,
                    city TEXT NOT NULL,
                    source TEXT NOT NULL,
                    obs_time TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_patch_events_city_revision
                ON observation_patch_events(city, revision)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_observation_patch_events_created_at
                ON observation_patch_events(created_at)
                """
            )
            conn.commit()

    def append_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        if event.get("type") != EVENT_TYPE:
            raise ValueError("unsupported realtime event type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("event payload must be an object")

        created_at = _iso(_utc_now())
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO observation_patch_events (
                    schema_type, schema_version, city, source, obs_time, payload_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(event["schema_type"]),
                    int(event["schema_version"]),
                    str(event["city"]),
                    str(event["source"]),
                    event.get("obs_time"),
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    created_at,
                ),
            )
            revision = int(cursor.lastrowid)
            conn.commit()

        stored = {
            "type": event["type"],
            "revision": revision,
            "city": str(event["city"]),
            "source": str(event["source"]),
            "obs_time": event.get("obs_time"),
            "ts": int(event.get("ts") or _created_at_to_ms(created_at)),
            "payload": payload,
        }
        self.cleanup_old_events(retention_hours=_retention_hours_from_env())
        return stored

    def latest_revision(self) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(revision), 0) FROM observation_patch_events"
            ).fetchone()
        return int(row[0] or 0) if row else 0

    def replay_events(
        self,
        *,
        cities: Optional[Set[str]],
        since_revision: int,
        limit: int,
    ) -> list[Dict[str, Any]]:
        city_set = _normalize_city_set(cities)
        bounded_limit = max(1, min(MAX_REPLAY_LIMIT, int(limit or 1)))
        params: list[Any] = [max(0, int(since_revision or 0))]
        where = "revision > ?"
        if city_set:
            placeholders = ",".join("?" for _ in city_set)
            where += f" AND city IN ({placeholders})"
            params.extend(sorted(city_set))
        params.append(bounded_limit)

        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT revision, schema_type, schema_version, city, source, obs_time,
                       payload_json, created_at
                FROM observation_patch_events
                WHERE {where}
                ORDER BY revision ASC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [self._row_to_event(row) for row in rows]

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
        where_parts = []
        params: list[Any] = []
        if city_set:
            placeholders = ",".join("?" for _ in city_set)
            where_parts.append(f"city IN ({placeholders})")
            params.extend(sorted(city_set))
        where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        with self._connect() as conn:
            min_row = conn.execute(
                f"SELECT MIN(revision) FROM observation_patch_events {where}",
                params,
            ).fetchone()
            min_revision = int(min_row[0] or 0) if min_row else 0
            if min_revision and since > 0 and since < min_revision - 1:
                return True

            if replay_count < max(1, int(limit or 1)):
                return False

            count_params = [since, *params]
            count_where = "revision > ?"
            if where_parts:
                count_where += " AND " + " AND ".join(where_parts)
            count_row = conn.execute(
                f"SELECT COUNT(1) FROM observation_patch_events WHERE {count_where}",
                count_params,
            ).fetchone()
        return int(count_row[0] or 0) > int(limit or 1)

    def cleanup_old_events(
        self,
        *,
        retention_hours: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> int:
        hours = max(1, int(retention_hours or _retention_hours_from_env()))
        cutoff = _iso((now or _utc_now()) - timedelta(hours=hours))
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM observation_patch_events WHERE created_at < ?",
                (cutoff,),
            )
            deleted = int(cursor.rowcount or 0)
            conn.commit()
        return deleted

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Dict[str, Any]:
        payload = json.loads(row["payload_json"])
        schema_type = str(row["schema_type"])
        schema_version = int(row["schema_version"])
        return {
            "type": f"{schema_type}.v{schema_version}",
            "revision": int(row["revision"]),
            "city": str(row["city"]),
            "source": str(row["source"]),
            "obs_time": row["obs_time"],
            "ts": _created_at_to_ms(row["created_at"]),
            "payload": payload,
        }
