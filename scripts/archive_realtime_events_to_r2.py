"""Archive realtime observation patch events to Cloudflare R2 as JSONL.

This script is intentionally read-only for Redis/SQLite. It uploads a cold
archive object and does not delete live replay data.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]


def _ensure_repo_path() -> None:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def _default_sqlite_db_path() -> str:
    _ensure_repo_path()
    from src.database.db_manager import DBManager

    return DBManager().db_path


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _date_window(day: date) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def _decode(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value or "")


def _load_sqlite_events(db_path: str, archive_day: date) -> list[dict[str, Any]]:
    start, end = _date_window(archive_day)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT revision, schema_type, schema_version, city, source, obs_time,
                   payload_json, created_at
            FROM observation_patch_events
            WHERE created_at >= ? AND created_at < ?
            ORDER BY revision ASC
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()
    return [
        {
            "revision": int(row["revision"]),
            "schema_type": row["schema_type"],
            "schema_version": int(row["schema_version"]),
            "type": f"{row['schema_type']}.v{int(row['schema_version'])}",
            "city": row["city"],
            "source": row["source"],
            "obs_time": row["obs_time"],
            "created_at": row["created_at"],
            "payload": json.loads(row["payload_json"]),
        }
        for row in rows
    ]


def _load_redis_events(redis_url: str, stream_key: str, archive_day: date) -> list[dict[str, Any]]:
    import redis  # type: ignore

    start, end = _date_window(archive_day)
    min_id = f"{int(start.timestamp() * 1000)}-0"
    max_id = f"{int(end.timestamp() * 1000) - 1}-999999"
    client = redis.Redis.from_url(redis_url)
    rows = client.xrange(stream_key, min=min_id, max=max_id)
    events = []
    for stream_id, fields in rows:
        decoded = {_decode(key): _decode(value) for key, value in dict(fields).items()}
        payload_json = decoded.get("payload_json") or "{}"
        events.append(
            {
                "stream_id": _decode(stream_id),
                "revision": int(decoded.get("revision") or 0),
                "type": decoded.get("type") or "",
                "schema_type": decoded.get("schema_type") or "",
                "schema_version": int(decoded.get("schema_version") or 0),
                "city": decoded.get("city") or "",
                "source": decoded.get("source") or "",
                "obs_time": decoded.get("obs_time") or "",
                "created_at_ms": int(decoded.get("created_at_ms") or 0),
                "ts": int(decoded.get("ts") or 0),
                "producer_id": decoded.get("producer_id") or "",
                "payload": json.loads(payload_json),
            }
        )
    return events


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["redis", "sqlite"], default=os.getenv("POLYWEATHER_R2_ARCHIVE_SOURCE", "redis"))
    parser.add_argument("--date", default=(datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat())
    parser.add_argument("--sqlite-db", default=os.getenv("POLYWEATHER_SQLITE_DB_PATH", ""))
    parser.add_argument("--redis-url", default=os.getenv("POLYWEATHER_REDIS_URL", "redis://127.0.0.1:6379/0"))
    parser.add_argument("--redis-stream-key", default=os.getenv("POLYWEATHER_REDIS_STREAM_KEY", "stream:city_observation"))
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    _ensure_repo_path()
    from web.r2_archive import (
        R2ArchiveConfig,
        R2ObjectStore,
        build_realtime_archive_key,
        events_to_jsonl,
    )

    archive_day = _parse_date(args.date)
    if args.source == "sqlite":
        db_path = args.sqlite_db or _default_sqlite_db_path()
        events = _load_sqlite_events(db_path, archive_day)
    else:
        events = _load_redis_events(args.redis_url, args.redis_stream_key, archive_day)

    body = events_to_jsonl(events)
    key = build_realtime_archive_key(args.source, archive_day.isoformat())
    print(json.dumps({"source": args.source, "date": archive_day.isoformat(), "events": len(events), "key": key}, indent=2))
    if args.dry_run:
        return 0
    config = R2ArchiveConfig.from_env()
    if config is None:
        print("R2 env is not configured; set POLYWEATHER_R2_* variables", file=sys.stderr)
        return 2
    result = R2ObjectStore(config).put_object(key, body, content_type="application/x-ndjson")
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
