import sqlite3
import hashlib
import json
from datetime import datetime
from typing import Optional, Dict, Any


class CacheRepo:
    def __init__(self, get_connection):
        self._get_connection = get_connection

    def _cache_table_name(self, kind: str) -> Optional[str]:
        normalized = str(kind or "").strip().lower()
        if normalized == "summary":
            return "city_summary_cache"
        if normalized == "panel":
            return "city_panel_cache"
        if normalized == "nearby":
            return "city_nearby_cache"
        if normalized == "market":
            return "city_market_cache"
        if normalized == "full":
            return "city_full_cache"
        return None

    def get_city_cache(self, kind: str, city: str) -> Optional[Dict[str, Any]]:
        table = self._cache_table_name(kind)
        normalized_city = str(city or "").strip().lower()
        if not table or not normalized_city:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                f"""
                SELECT city, payload_json, updated_at, updated_at_ts, version, source_fingerprint
                FROM {table}
                WHERE city = ?
                LIMIT 1
                """,
                (normalized_city,),
            ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(str(row["payload_json"] or "{}"))
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        return {
            "city": str(row["city"] or normalized_city),
            "payload": payload,
            "updated_at": str(row["updated_at"] or ""),
            "updated_at_ts": float(row["updated_at_ts"] or 0.0),
            "version": str(row["version"] or ""),
            "source_fingerprint": str(row["source_fingerprint"] or ""),
        }

    def set_city_cache(
        self,
        kind: str,
        city: str,
        payload: Dict[str, Any],
        *,
        version: str = "v1",
        source_fingerprint: Optional[str] = None,
    ) -> None:
        table = self._cache_table_name(kind)
        normalized_city = str(city or "").strip().lower()
        if not table or not normalized_city or not isinstance(payload, dict):
            return
        now = datetime.now().isoformat()
        now_ts = datetime.now().timestamp()
        with self._get_connection() as conn:
            conn.execute(
                f"""
                INSERT INTO {table} (
                    city,
                    payload_json,
                    updated_at,
                    updated_at_ts,
                    version,
                    source_fingerprint
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(city) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at,
                    updated_at_ts = excluded.updated_at_ts,
                    version = excluded.version,
                    source_fingerprint = excluded.source_fingerprint
                """,
                (
                    normalized_city,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now_ts,
                    str(version or "v1"),
                    str(source_fingerprint or ""),
                ),
            )
            conn.commit()

    def acquire_cache_refresh_lock(
        self,
        cache_key: str,
        *,
        ttl_sec: int = 120,
        owner: Optional[str] = None,
    ) -> Optional[str]:
        normalized_key = str(cache_key or "").strip().lower()
        if not normalized_key:
            return None
        lock_owner = str(owner or "").strip() or hashlib.sha1(
            f"{normalized_key}:{datetime.now().timestamp()}".encode("utf-8")
        ).hexdigest()[:12]
        now_ts = datetime.now().timestamp()
        locked_until_ts = now_ts + max(15, int(ttl_sec or 120))
        updated_at = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO cache_refresh_locks (cache_key, locked_until_ts, owner, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    locked_until_ts = excluded.locked_until_ts,
                    owner = excluded.owner,
                    updated_at = excluded.updated_at
                WHERE cache_refresh_locks.locked_until_ts < ?
                """,
                (
                    normalized_key,
                    locked_until_ts,
                    lock_owner,
                    updated_at,
                    now_ts,
                ),
            )
            conn.commit()
        return lock_owner if int(cursor.rowcount or 0) > 0 else None

    def release_cache_refresh_lock(self, cache_key: str, owner: str) -> None:
        normalized_key = str(cache_key or "").strip().lower()
        normalized_owner = str(owner or "").strip()
        if not normalized_key or not normalized_owner:
            return
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM cache_refresh_locks
                WHERE cache_key = ? AND owner = ?
                """,
                (normalized_key, normalized_owner),
            )
            conn.commit()
