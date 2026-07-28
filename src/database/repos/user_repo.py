"""User repository — users, points, weekly, ledger, growth milestones."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import sqlite3

from loguru import logger

from src.auth.supabase_admin_client import get_supabase_admin_client


class UserRepo:
    """Repository for user accounts, points, leaderboards, and growth milestones."""

    _sync_lock = threading.Lock()
    _sync_cache: Dict[str, Dict[str, Any]] = {}
    _profile_sync_lock = threading.Lock()
    _profile_sync_cache: Dict[str, Dict[str, Any]] = {}

    def __init__(self, get_connection):
        self._get_connection = get_connection
        self._profile_sync_cache = {}
        self._profile_sync_lock = threading.Lock()
        self._sync_cache = {}
        self._sync_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Supabase sync helpers (copied verbatim from DBManager)
    # ------------------------------------------------------------------

    def _supabase_profiles_endpoint(self) -> str:
        return get_supabase_admin_client().profiles_endpoint()

    def _supabase_service_headers(self) -> Dict[str, str]:
        client = get_supabase_admin_client()
        if not client.configured:
            return {}
        return client._service_headers()

    def _supabase_admin_users_endpoint(self) -> str:
        return get_supabase_admin_client().admin_users_endpoint()

    def _profile_sync_min_interval_sec(self) -> float:
        raw = str(
            os.getenv("POLYWEATHER_SUPABASE_PROFILE_SYNC_MIN_INTERVAL_SEC", "3600")
            or ""
        ).strip()
        try:
            return max(0.0, float(raw))
        except ValueError:
            return 3600.0

    def _profile_sync_cache_key(self, supabase_user_id: str) -> str:
        endpoint = self._supabase_profiles_endpoint()
        return f"{endpoint}:{str(supabase_user_id or '').strip().lower()}"

    def _should_skip_profile_sync(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
        force: bool = False,
    ) -> bool:
        if force:
            return False
        min_interval = self._profile_sync_min_interval_sec()
        if min_interval <= 0:
            return False
        payload_key = {
            "telegram_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
        }
        cache_key = self._profile_sync_cache_key(supabase_user_id)
        now_ts = time.monotonic()
        with self._profile_sync_lock:
            cached = self._profile_sync_cache.get(cache_key)
            if not isinstance(cached, dict):
                return False
            cached_payload = cached.get("payload")
            cached_ts = float(cached.get("ts") or 0.0)
            return cached_payload == payload_key and now_ts - cached_ts < min_interval

    def _remember_profile_sync(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
    ) -> None:
        cache_key = self._profile_sync_cache_key(supabase_user_id)
        payload_key = {
            "telegram_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
        }
        with self._profile_sync_lock:
            self._profile_sync_cache[cache_key] = {
                "payload": payload_key,
                "ts": time.monotonic(),
            }
            if len(self._profile_sync_cache) > 4096:
                oldest_key = min(
                    self._profile_sync_cache,
                    key=lambda key: float(
                        self._profile_sync_cache[key].get("ts") or 0.0
                    ),
                )
                self._profile_sync_cache.pop(oldest_key, None)

    def _points_sync_cache_key(self, telegram_id: int) -> str:
        return f"{id(self)}:{int(telegram_id)}"

    def _points_sync_min_interval_sec(self) -> float:
        raw = str(
            os.getenv("POLYWEATHER_SUPABASE_POINTS_SYNC_MIN_INTERVAL_SEC", "60")
            or ""
        ).strip()
        try:
            return max(0.0, float(raw))
        except Exception:
            return 60.0

    def _should_skip_points_metadata_sync(
        self,
        *,
        telegram_id: int,
        points: int,
        force: bool,
    ) -> bool:
        if force:
            return False
        cache_key = self._points_sync_cache_key(telegram_id)
        now_ts = time.monotonic()
        min_interval = self._points_sync_min_interval_sec()
        with self._sync_lock:
            cached = self._sync_cache.get(cache_key)
            if not cached:
                return False
            cached_points = int(cached.get("points") or 0)
            cached_ts = float(cached.get("ts") or 0.0)
            if cached_points == int(points):
                return True
            return min_interval > 0 and (now_ts - cached_ts) < min_interval

    def _remember_points_metadata_sync(
        self,
        *,
        telegram_id: int,
        points: int,
    ) -> None:
        cache_key = self._points_sync_cache_key(telegram_id)
        with self._sync_lock:
            self._sync_cache[cache_key] = {
                "points": int(points),
                "ts": time.monotonic(),
            }
            if len(self._sync_cache) > 4096:
                oldest_key = min(
                    self._sync_cache,
                    key=lambda key: float(
                        self._sync_cache[key].get("ts") or 0.0
                    ),
                )
                self._sync_cache.pop(oldest_key, None)

    def _sync_points_to_supabase_user_metadata(
        self,
        telegram_id: int,
        *,
        force: bool = False,
    ) -> bool:
        supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        if not supabase_url:
            return False
        headers = self._supabase_service_headers()
        if not headers:
            return False
        endpoint = self._supabase_admin_users_endpoint()
        if not endpoint:
            return False

        supabase_user_id = None
        points = 0
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT supabase_user_id FROM supabase_bindings WHERE telegram_id = ? LIMIT 1",
                (int(telegram_id),),
            ).fetchone()
            if row and row["supabase_user_id"]:
                supabase_user_id = str(row["supabase_user_id"]).strip()
            if not supabase_user_id:
                row = conn.execute(
                    "SELECT supabase_user_id FROM users WHERE telegram_id = ? LIMIT 1",
                    (int(telegram_id),),
                ).fetchone()
                if row and row["supabase_user_id"]:
                    supabase_user_id = str(row["supabase_user_id"]).strip()
            if not supabase_user_id:
                return False
            pts_row = conn.execute(
                "SELECT points FROM users WHERE telegram_id = ? LIMIT 1",
                (int(telegram_id),),
            ).fetchone()
            if pts_row:
                points = max(0, int(pts_row["points"] or 0))

        if self._should_skip_points_metadata_sync(
            telegram_id=int(telegram_id),
            points=points,
            force=force,
        ):
            return False

        admin = get_supabase_admin_client()
        if not admin.configured:
            return False
        ok = admin.patch_user_metadata(supabase_user_id, {"points": points})
        if ok:
            self._remember_points_metadata_sync(
                telegram_id=int(telegram_id),
                points=points,
            )
        return ok

    def _sync_supabase_profile_telegram_fields(
        self,
        *,
        supabase_user_id: str,
        telegram_id: Optional[int],
        telegram_username: Optional[str],
        force: bool = False,
    ) -> bool:
        normalized_uid = str(supabase_user_id or "").strip().lower()
        endpoint = self._supabase_profiles_endpoint()
        headers = self._supabase_service_headers()
        if not normalized_uid or not endpoint or not headers:
            return False
        if self._should_skip_profile_sync(
            supabase_user_id=normalized_uid,
            telegram_id=telegram_id,
            telegram_username=telegram_username,
            force=force,
        ):
            return False

        payload = {
            "telegram_user_id": int(telegram_id) if telegram_id is not None else None,
            "telegram_username": str(telegram_username or "").strip() or None,
            "updated_at": datetime.now().isoformat(),
        }
        admin = get_supabase_admin_client()
        ok = admin.patch_profile(normalized_uid, payload)
        if ok:
            self._remember_profile_sync(
                supabase_user_id=normalized_uid,
                telegram_id=telegram_id,
                telegram_username=telegram_username,
            )
        return ok

    def _sync_bound_supabase_profiles_for_telegram(
        self,
        *,
        telegram_id: int,
        telegram_username: Optional[str],
    ) -> None:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            ).fetchall()
        for row in rows:
            user_id = str((row["supabase_user_id"] if row else "") or "").strip().lower()
            if not user_id:
                continue
            self._sync_supabase_profile_telegram_fields(
                supabase_user_id=user_id,
                telegram_id=telegram_id,
                telegram_username=telegram_username,
            )

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _float_or_none(value: Any) -> Optional[float]:
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _int_or_none(value: Any) -> Optional[int]:
        try:
            if value is None or value == "":
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_datetime_or_none(value: Any) -> Optional[datetime]:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @classmethod
    def _source_latency_or_none(cls, observed_at: Any, fetched_at: Any) -> Optional[float]:
        observed = cls._parse_datetime_or_none(observed_at)
        fetched = cls._parse_datetime_or_none(fetched_at)
        if observed is None or fetched is None:
            return None
        return max(0.0, round((fetched - observed).total_seconds(), 3))

    @staticmethod
    def _safe_week_key(value: str) -> str:
        text = str(value or "").strip()
        if len(text) >= 8 and "-W" in text:
            return text[:8]
        return ""

    @staticmethod
    def _read_bonus_config(env_key: str, fallback: int) -> int:
        raw = os.getenv(env_key)
        if raw is None or raw.strip() == "":
            return fallback
        try:
            return max(0, int(raw))
        except Exception:
            return fallback

    # ------------------------------------------------------------------
    # Internal helpers (instance — take conn param)
    # ------------------------------------------------------------------

    def _append_points_ledger_entry_conn(
        self,
        conn: sqlite3.Connection,
        *,
        telegram_id: Optional[int],
        supabase_user_id: str = "",
        supabase_email: str = "",
        source: str,
        delta_points: int,
        balance_after: int,
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        normalized_source = str(source or "").strip().lower()
        if not normalized_source or int(delta_points or 0) == 0:
            return
        conn.execute(
            """
            INSERT INTO points_ledger (
                telegram_id,
                supabase_user_id,
                supabase_email,
                source,
                delta_points,
                balance_after,
                actor_email,
                reference_type,
                reference_id,
                metadata_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(telegram_id) if telegram_id is not None else None,
                str(supabase_user_id or "").strip().lower(),
                str(supabase_email or "").strip().lower(),
                normalized_source,
                int(delta_points),
                int(balance_after),
                str(actor_email or "").strip().lower(),
                str(reference_type or "").strip().lower(),
                str(reference_id or "").strip(),
                json.dumps(metadata if isinstance(metadata, dict) else {}, ensure_ascii=False, default=str),
                datetime.now().isoformat(),
            ),
        )

    def _find_telegram_id_by_supabase_user_id(
        self,
        conn: sqlite3.Connection,
        supabase_user_id: str,
    ) -> Optional[int]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return None
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT telegram_id
            FROM supabase_bindings
            WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        if row:
            try:
                return int(row["telegram_id"])
            except Exception:
                return None

        # Legacy fallback before supabase_bindings migration.
        row = conn.execute(
            """
            SELECT telegram_id
            FROM users
            WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        if not row:
            return None
        try:
            return int(row["telegram_id"])
        except Exception:
            return None

    def _upsert_weekly_archive(
        self,
        conn: sqlite3.Connection,
        telegram_id: int,
        week_key: str,
        points: int,
    ) -> None:
        wk = self._safe_week_key(week_key)
        if not wk:
            return
        pts = max(0, int(points or 0))
        conn.execute(
            """
            INSERT INTO weekly_points_archive (telegram_id, week_key, points, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id, week_key) DO UPDATE SET
                points = excluded.points,
                updated_at = excluded.updated_at
            """,
            (int(telegram_id), wk, pts, datetime.now().isoformat()),
        )

    # ------------------------------------------------------------------
    # Points ledger
    # ------------------------------------------------------------------

    def append_points_ledger_entry(
        self,
        *,
        telegram_id: Optional[int] = None,
        supabase_user_id: str = "",
        supabase_email: str = "",
        source: str,
        delta_points: int,
        balance_after: int,
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        with self._get_connection() as conn:
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=supabase_user_id,
                supabase_email=supabase_email,
                source=source,
                delta_points=delta_points,
                balance_after=balance_after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()

    def list_points_ledger_entries(
        self,
        *,
        limit: int = 20,
        supabase_user_id: str = "",
        supabase_email: str = "",
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 20), 200))
        normalized_user_id = str(supabase_user_id or "").strip().lower()
        normalized_email = str(supabase_email or "").strip().lower()
        if not normalized_user_id and not normalized_email:
            return []
        clauses: List[str] = []
        params: List[Any] = []
        if normalized_user_id:
            clauses.append("supabase_user_id = ?")
            params.append(normalized_user_id)
        if normalized_email:
            clauses.append("supabase_email = ?")
            params.append(normalized_email)
        where_sql = f"WHERE {' OR '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, telegram_id, supabase_user_id, supabase_email, source,
                       delta_points, balance_after, actor_email, reference_type,
                       reference_id, metadata_json, created_at
                FROM points_ledger
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                metadata = json.loads(str(row["metadata_json"] or "{}"))
            except Exception:
                metadata = {}
            out.append(
                {
                    "id": int(row["id"]),
                    "telegram_id": row["telegram_id"],
                    "supabase_user_id": str(row["supabase_user_id"] or ""),
                    "supabase_email": str(row["supabase_email"] or ""),
                    "source": str(row["source"] or ""),
                    "delta_points": int(row["delta_points"] or 0),
                    "balance_after": int(row["balance_after"] or 0),
                    "actor_email": str(row["actor_email"] or ""),
                    "reference_type": str(row["reference_type"] or ""),
                    "reference_id": str(row["reference_id"] or ""),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "created_at": row["created_at"],
                }
            )
        return out

    def get_points_ledger_summary(
        self,
        *,
        supabase_user_id: str = "",
        supabase_email: str = "",
        limit: int = 20,
    ) -> Dict[str, Any]:
        recent = self.list_points_ledger_entries(
            limit=limit,
            supabase_user_id=supabase_user_id,
            supabase_email=supabase_email,
        )
        by_source: Dict[str, Dict[str, int]] = {}
        for row in recent:
            source = str(row.get("source") or "unknown")
            bucket = by_source.setdefault(source, {"points": 0, "count": 0})
            bucket["points"] += int(row.get("delta_points") or 0)
            bucket["count"] += 1
        balance = int(recent[0]["balance_after"]) if recent else (
            self.get_points_by_supabase_user_id(supabase_user_id)
            if supabase_user_id
            else self.get_points_by_supabase_email(supabase_email)
        )
        return {
            "balance": max(0, balance),
            "recent": recent,
            "by_source": by_source,
        }

    # ------------------------------------------------------------------
    # Query usage
    # ------------------------------------------------------------------

    def track_query_usage(self, telegram_id: int, query_type: str) -> Dict[str, Any]:
        today_str = datetime.now().strftime("%Y-%m-%d")
        column = "daily_city_queries" if query_type == "city" else "daily_deb_queries"
        limit = (
            self._read_bonus_config("POLYWEATHER_BOT_CITY_DAILY_FREE_LIMIT", 10)
            if query_type == "city"
            else self._read_bonus_config("POLYWEATHER_BOT_DEB_DAILY_FREE_LIMIT", 10)
        )
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                f"SELECT {column}, daily_queries_date FROM users WHERE telegram_id = ?",
                (telegram_id,),
            ).fetchone()
            if not row:
                return {"allowed": False, "reason": "user_missing", "used": 0, "limit": limit}

            date = row["daily_queries_date"] or ""
            used = int(row[column] or 0) if date == today_str else 0

            if used >= limit:
                return {"allowed": False, "reason": "daily_limit", "used": used, "limit": limit}

            new_used = used + 1
            conn.execute(
                f"""
                UPDATE users
                SET {column} = ?, daily_queries_date = ?
                WHERE telegram_id = ?
                """,
                (new_used, today_str, telegram_id),
            )
            conn.commit()
            return {"allowed": True, "used": new_used, "limit": limit}

    # ------------------------------------------------------------------
    # User CRUD
    # ------------------------------------------------------------------

    def get_user(self, telegram_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
            row = cursor.fetchone()
            if row:
                user = dict(row)
                now = datetime.now()
                if user['web_expiry']:
                    expiry = datetime.fromisoformat(user['web_expiry'])
                    if expiry < now:
                        user['is_web_premium'] = False
                if user['group_expiry']:
                    expiry = datetime.fromisoformat(user['group_expiry'])
                    if expiry < now:
                        user['is_group_premium'] = False
                return user
        return None

    def get_user_by_supabase_user_id(self, supabase_user_id: str) -> Optional[Dict[str, Any]]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return None
            row = conn.execute(
                """
                SELECT *
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if row:
                return dict(row)
        return None

    def list_supabase_user_ids_for_telegram(self, telegram_id: int) -> List[str]:
        """Return all Supabase accounts currently bound to a Telegram user."""
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                ORDER BY updated_at DESC, supabase_user_id ASC
                """,
                (int(telegram_id),),
            ).fetchall()
            ids = {
                str(row["supabase_user_id"] or "").strip().lower()
                for row in rows
                if str(row["supabase_user_id"] or "").strip()
            }
            legacy = conn.execute(
                """
                SELECT supabase_user_id
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            legacy_id = str((legacy["supabase_user_id"] if legacy else "") or "").strip().lower()
            if legacy_id:
                ids.add(legacy_id)
            return sorted(ids)

    def search_users(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        text = str(query or "").strip()
        safe_limit = max(1, min(int(limit or 20), 100))
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if not text:
                rows = conn.execute(
                    """
                    SELECT
                        telegram_id,
                        username,
                        points,
                        daily_points,
                        daily_points_date,
                        weekly_points,
                        weekly_points_week,
                        message_count,
                        supabase_user_id,
                        supabase_email,
                        created_at,
                        last_message_at
                    FROM users
                    ORDER BY points DESC, message_count DESC, telegram_id ASC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
                return [dict(row) for row in rows]

            rows = conn.execute(
                """
                SELECT
                    telegram_id,
                    username,
                    points,
                    daily_points,
                    daily_points_date,
                    weekly_points,
                    weekly_points_week,
                    message_count,
                    supabase_user_id,
                    supabase_email,
                    created_at,
                    last_message_at
                FROM users
                WHERE
                    CAST(telegram_id AS TEXT) = ?
                    OR lower(trim(COALESCE(username, ''))) LIKE ?
                    OR lower(trim(COALESCE(supabase_email, ''))) LIKE ?
                ORDER BY points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (
                    text,
                    f"%{text.lower()}%",
                    f"%{text.lower()}%",
                    safe_limit,
                ),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_users_by_supabase_user_ids(
        self,
        supabase_user_ids: List[str],
    ) -> Dict[str, Dict[str, Any]]:
        keys = [
            str(item or "").strip().lower()
            for item in (supabase_user_ids or [])
            if str(item or "").strip()
        ]
        if not keys:
            return {}
        placeholders = ",".join("?" for _ in keys)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT
                    lower(trim(COALESCE(supabase_user_id, ''))) AS supabase_user_id,
                    telegram_id,
                    username,
                    supabase_email,
                    created_at,
                    points,
                    weekly_points,
                    message_count
                FROM users
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) IN ({placeholders})
                """,
                tuple(keys),
            ).fetchall()
            return {
                str(row["supabase_user_id"] or "").strip().lower(): dict(row)
                for row in rows
                if str(row["supabase_user_id"] or "").strip()
            }

    def get_points_by_supabase_user_id(self, supabase_user_id: str) -> int:
        user = self.get_user_by_supabase_user_id(supabase_user_id)
        if not user:
            return 0
        try:
            return max(0, int(user.get("points") or 0))
        except Exception:
            return 0

    def get_points_by_supabase_email(self, supabase_email: str) -> int:
        email = str(supabase_email or "").strip().lower()
        if not email:
            return 0
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT points
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                row = conn.execute(
                    """
                    SELECT u.points
                    FROM users u
                    JOIN supabase_bindings b ON b.telegram_id = u.telegram_id
                    WHERE lower(trim(COALESCE(b.supabase_email, ''))) = ?
                    LIMIT 1
                    """,
                    (email,),
                ).fetchone()
            if row:
                return max(0, int(row["points"] or 0))
        return 0

    def grant_points_by_supabase_email(
        self,
        supabase_email: str,
        amount: int,
        *,
        source: str = "manual_adjustment",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        email = str(supabase_email or "").strip().lower()
        points = int(amount or 0)
        if not email:
            return {"ok": False, "reason": "invalid_supabase_email"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email, supabase_user_id
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_email": email}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            after = before + points
            conn.execute(
                """
                UPDATE users
                SET points = ?
                WHERE telegram_id = ?
                """,
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=str(row["supabase_user_id"] or "").strip().lower(),
                supabase_email=str(row["supabase_email"] or email),
                source=source,
                delta_points=points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_email": str(row["supabase_email"] or email),
                "points_before": before,
                "points_added": points,
                "points_after": after,
            }

    def grant_points_by_supabase_user_id(
        self,
        supabase_user_id: str,
        amount: int,
        *,
        source: str = "manual_adjustment",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        points = int(amount or 0)
        if not key:
            return {"ok": False, "reason": "invalid_supabase_user_id"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return {"ok": False, "reason": "user_not_found", "supabase_user_id": key}
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_user_id": key}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            after = before + points
            conn.execute(
                """
                UPDATE users
                SET points = ?
                WHERE telegram_id = ?
                """,
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=key,
                supabase_email=str(row["supabase_email"] or ""),
                source=source,
                delta_points=points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_user_id": key,
                "supabase_email": str(row["supabase_email"] or ""),
                "points_before": before,
                "points_added": points,
                "points_after": after,
            }

    def deduct_points_by_supabase_email(
        self,
        supabase_email: str,
        amount: int,
        *,
        source: str = "points_redemption",
        actor_email: str = "",
        reference_type: str = "",
        reference_id: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        email = str(supabase_email or "").strip().lower()
        points = int(amount or 0)
        if not email:
            return {"ok": False, "reason": "invalid_supabase_email"}
        if points <= 0:
            return {"ok": False, "reason": "invalid_amount"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, username, points, supabase_email, supabase_user_id
                FROM users
                WHERE lower(trim(COALESCE(supabase_email, ''))) = ?
                LIMIT 1
                """,
                (email,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_not_found", "supabase_email": email}

            telegram_id = int(row["telegram_id"] or 0)
            before = int(row["points"] or 0)
            if before < points:
                return {
                    "ok": False,
                    "reason": "insufficient_points",
                    "points_available": before,
                    "points_needed": points,
                }
            after = before - points
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (after, telegram_id),
            )
            self._append_points_ledger_entry_conn(
                conn,
                telegram_id=telegram_id,
                supabase_user_id=str(row["supabase_user_id"] or "").strip().lower(),
                supabase_email=str(row["supabase_email"] or email),
                source=source,
                delta_points=-points,
                balance_after=after,
                actor_email=actor_email,
                reference_type=reference_type,
                reference_id=reference_id,
                metadata=metadata,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_email": str(row["supabase_email"] or email),
                "points_before": before,
                "points_deducted": points,
                "points_after": after,
            }

    def transfer_points_by_email(
        self,
        from_email: str,
        to_email: str,
        amount: int,
    ) -> Dict[str, Any]:
        """Transfer points from one user to another within a single transaction."""
        r_from = self.deduct_points_by_supabase_email(from_email, amount)
        if not r_from.get("ok"):
            return {"ok": False, "reason": f"deduct_failed: {r_from.get('reason')}", "from": r_from}
        r_to = self.grant_points_by_supabase_email(to_email, amount)
        if not r_to.get("ok"):
            # Rollback: grant back to source
            self.grant_points_by_supabase_email(from_email, amount)
            return {"ok": False, "reason": f"grant_failed: {r_to.get('reason')}", "to": r_to}
        return {
            "ok": True,
            "from": r_from,
            "to": r_to,
            "amount": amount,
        }

    def upsert_user(self, telegram_id: int, username: str):
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO users (telegram_id, username)
                VALUES (?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username
            """, (telegram_id, username))
            conn.commit()
        self._sync_bound_supabase_profiles_for_telegram(
            telegram_id=int(telegram_id),
            telegram_username=username,
        )

    def add_message_activity(
        self,
        telegram_id: int,
        text: str,
        points_to_add: int = 1,
        cooldown_sec: int = 30,
        daily_cap: int = 20,
        min_text_length: int = 4,
    ) -> Dict[str, Any]:
        """Award points for valid group activity with cooldown and daily cap."""
        now = datetime.now()
        normalized = "".join((text or "").split()).lower()
        if len(normalized) < min_text_length:
            return {"awarded": False, "reason": "too_short"}
        fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

        today_str = now.strftime("%Y-%m-%d")
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            # Keep dedupe table bounded.
            stale_day = (now - timedelta(days=14)).strftime("%Y-%m-%d")
            conn.execute(
                "DELETE FROM activity_fingerprints WHERE activity_date < ?",
                (stale_day,),
            )
            cursor = conn.execute(
                """
                SELECT points, daily_points, daily_points_date, weekly_points, weekly_points_week, last_message_at,
                       message_count, welcome_bonus_claimed
                FROM users WHERE telegram_id = ?
                """,
                (telegram_id,),
            )
            row = cursor.fetchone()
            if not row:
                return {"awarded": False, "reason": "user_missing"}

            duplicated = conn.execute(
                """
                SELECT 1
                FROM activity_fingerprints
                WHERE telegram_id = ? AND activity_date = ? AND fingerprint = ?
                LIMIT 1
                """,
                (telegram_id, today_str, fingerprint),
            ).fetchone()
            if duplicated:
                return {"awarded": False, "reason": "duplicate_content"}

            last_message_at = row["last_message_at"]
            if last_message_at:
                last_at = datetime.fromisoformat(last_message_at)
                if (now - last_at).total_seconds() < cooldown_sec:
                    return {"awarded": False, "reason": "cooldown"}

            daily_points = int(row["daily_points"] or 0)
            daily_points_date = row["daily_points_date"] or ""
            if daily_points_date != today_str:
                daily_points = 0
            # Guard against historical overflow values (legacy bug).
            if daily_points > daily_cap:
                daily_points = daily_cap

            weekly_points = int(row["weekly_points"] or 0)
            weekly_points_week = row["weekly_points_week"] or ""
            if weekly_points_week != week_key:
                if weekly_points_week and weekly_points > 0:
                    self._upsert_weekly_archive(
                        conn,
                        telegram_id=telegram_id,
                        week_key=weekly_points_week,
                        points=weekly_points,
                    )
                weekly_points = 0

            if daily_points >= daily_cap:
                conn.execute(
                    """
                    UPDATE users
                    SET last_message_at = ?, daily_points = ?, daily_points_date = ?,
                        weekly_points = ?, weekly_points_week = ?
                    WHERE telegram_id = ?
                    """,
                    (
                        now.isoformat(),
                        daily_points,
                        today_str,
                        weekly_points,
                        week_key,
                        telegram_id,
                    ),
                )
                self._upsert_weekly_archive(
                    conn,
                    telegram_id=telegram_id,
                    week_key=week_key,
                    points=weekly_points,
                )
                conn.commit()
                return {
                    "awarded": False,
                    "reason": "daily_cap",
                    "daily_points": daily_points,
                    "weekly_points": weekly_points,
                }

            remaining = max(0, daily_cap - daily_points)
            points_added = min(max(0, points_to_add), remaining)
            if points_added <= 0:
                conn.commit()
                return {
                    "awarded": False,
                    "reason": "daily_cap",
                    "daily_points": daily_points,
                    "weekly_points": weekly_points,
                }

            welcome_bonus = 0
            first_message_bonus = 0

            is_first_message_of_day = daily_points == 0
            is_new_user = int(row["message_count"] or 0) == 0 and not int(row["welcome_bonus_claimed"] or 0)

            if is_new_user:
                welcome_bonus = self._read_bonus_config("POLYWEATHER_BOT_WELCOME_BONUS", 20)
            if is_first_message_of_day:
                first_message_bonus = self._read_bonus_config("POLYWEATHER_BOT_FIRST_MESSAGE_BONUS", 2)

            total_added = points_added + welcome_bonus + first_message_bonus

            conn.execute("""
                UPDATE users
                SET message_count = message_count + 1,
                    points = points + ?,
                    daily_points = ?,
                    daily_points_date = ?,
                    weekly_points = ?,
                    weekly_points_week = ?,
                    last_message_at = ?,
                    welcome_bonus_claimed = MAX(welcome_bonus_claimed, ?)
                WHERE telegram_id = ?
            """, (
                total_added,
                daily_points + total_added,
                today_str,
                weekly_points + total_added,
                week_key,
                now.isoformat(),
                1 if welcome_bonus > 0 else 0,
                telegram_id,
            ))
            conn.execute(
                """
                INSERT OR IGNORE INTO activity_fingerprints
                (telegram_id, activity_date, fingerprint)
                VALUES (?, ?, ?)
                """,
                (telegram_id, today_str, fingerprint),
            )
            self._upsert_weekly_archive(
                conn,
                telegram_id=telegram_id,
                week_key=week_key,
                points=weekly_points + total_added,
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id)
            return {
                "awarded": True,
                "reason": "ok",
                "points_added": points_added,
                "welcome_bonus": welcome_bonus,
                "first_message_bonus": first_message_bonus,
                "total_added": total_added,
                "daily_points": daily_points + total_added,
                "weekly_points": weekly_points + total_added,
                "weekly_week": week_key,
            }

    def spend_points(self, telegram_id: int, amount: int) -> Dict[str, Any]:
        if amount <= 0:
            user = self.get_user(telegram_id)
            return {"ok": True, "balance": int((user or {}).get("points") or 0)}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT points FROM users WHERE telegram_id = ?",
                (telegram_id,),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}

            balance = int(row["points"] or 0)
            if balance < amount:
                return {"ok": False, "reason": "insufficient_points", "balance": balance, "required": amount}

            new_balance = balance - amount
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (new_balance, telegram_id),
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {"ok": True, "balance": new_balance, "spent": amount}

    def spend_points_by_supabase_user_id(self, supabase_user_id: str, amount: int) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return {"ok": False, "reason": "invalid_supabase_user_id", "balance": 0, "required": amount}
        if amount <= 0:
            return {"ok": True, "balance": self.get_points_by_supabase_user_id(key)}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if telegram_id is None:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}
            row = conn.execute(
                """
                SELECT telegram_id, points
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "user_missing", "balance": 0, "required": amount}

            telegram_id = int(row["telegram_id"])
            balance = int(row["points"] or 0)
            if balance < amount:
                return {"ok": False, "reason": "insufficient_points", "balance": balance, "required": amount}

            new_balance = balance - amount
            conn.execute(
                "UPDATE users SET points = ? WHERE telegram_id = ?",
                (new_balance, telegram_id),
            )
            conn.commit()
            self._sync_points_to_supabase_user_metadata(telegram_id, force=True)
            return {"ok": True, "balance": new_balance, "spent": amount}

    def set_premium(self, telegram_id: int, plan: str, months: int = 1):
        expiry = datetime.now() + timedelta(days=30 * months)
        col_is = f"is_{plan}_premium"
        col_expiry = f"{plan}_expiry"
        with self._get_connection() as conn:
            conn.execute(f"""
                UPDATE users 
                SET {col_is} = 1, {col_expiry} = ?
                WHERE telegram_id = ?
            """, (expiry.isoformat(), telegram_id))
            conn.commit()
            logger.info(f"User {telegram_id} upgraded to {plan} premium until {expiry}")

    # ------------------------------------------------------------------
    # Leaderboards
    # ------------------------------------------------------------------

    def get_leaderboard(self, limit: int = 10):
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT username, points, message_count 
                FROM users 
                ORDER BY points DESC 
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_weekly_leaderboard(self, limit: int = 10):
        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        username,
                        u.points AS points,
                        u.message_count AS message_count,
                        u.telegram_id AS telegram_id,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (week_key, week_key, limit),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_weekly_profile(self, telegram_id: int) -> Dict[str, Any]:
        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT
                    u.telegram_id,
                    COALESCE(u.points, 0) AS points,
                    COALESCE(u.message_count, 0) AS message_count,
                    COALESCE(a.points,
                        CASE
                            WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                            ELSE 0
                        END
                    ) AS weekly_points
                FROM users u
                LEFT JOIN weekly_points_archive a
                    ON a.telegram_id = u.telegram_id
                    AND a.week_key = ?
                ORDER BY weekly_points DESC, points DESC, message_count DESC, u.telegram_id ASC
                """,
                (week_key, week_key),
            ).fetchall()

        weekly_rank: Optional[int] = None
        weekly_points = 0
        total_ranked = 0
        for idx, row in enumerate(rows, start=1):
            row_weekly_points = int(row["weekly_points"] or 0)
            if row_weekly_points > 0:
                total_ranked += 1
            if int(row["telegram_id"] or 0) == int(telegram_id):
                weekly_rank = idx if row_weekly_points > 0 else None
                weekly_points = row_weekly_points
        return {
            "week_key": week_key,
            "weekly_points": max(0, int(weekly_points or 0)),
            "weekly_rank": weekly_rank,
            "total_ranked": total_ranked,
        }

    def get_weekly_profile_by_supabase_user_id(self, supabase_user_id: str) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return {"weekly_points": 0, "weekly_rank": None, "total_ranked": 0}

        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            target_telegram_id = self._find_telegram_id_by_supabase_user_id(conn, key)
            if target_telegram_id is None:
                return {"weekly_points": 0, "weekly_rank": None, "total_ranked": 0}
            rows = conn.execute(
                """
                SELECT
                    telegram_id,
                    COALESCE(points, 0) AS points,
                    COALESCE(message_count, 0) AS message_count,
                    CASE
                        WHEN weekly_points_week = ? THEN COALESCE(weekly_points, 0)
                        ELSE 0
                    END AS weekly_points
                FROM users
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                """,
                (week_key,),
            ).fetchall()

        weekly_rank: Optional[int] = None
        weekly_points = 0
        for idx, row in enumerate(rows, start=1):
            if int(row["telegram_id"] or 0) == int(target_telegram_id):
                weekly_rank = idx
                weekly_points = int(row["weekly_points"] or 0)
                break
        return {
            "weekly_points": max(0, int(weekly_points or 0)),
            "weekly_rank": weekly_rank,
            "total_ranked": len(rows),
        }

    # ------------------------------------------------------------------
    # Weekly rewards
    # ------------------------------------------------------------------

    def get_weekly_reward_candidates(self, week_key: str, limit: int = 10):
        wk = self._safe_week_key(week_key)
        if not wk:
            return []
        top_n = max(1, int(limit or 10))
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        u.telegram_id,
                        u.username,
                        lower(trim(COALESCE(u.supabase_user_id, ''))) AS supabase_user_id,
                        COALESCE(u.supabase_email, '') AS supabase_email,
                        COALESCE(u.points, 0) AS points,
                        COALESCE(u.message_count, 0) AS message_count,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                ORDER BY weekly_points DESC, points DESC, message_count DESC, telegram_id ASC
                LIMIT ?
                """,
                (wk, wk, top_n),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_weekly_participation_candidates(self, week_key: str, exclude_ids: set):
        wk = self._safe_week_key(week_key)
        if not wk:
            return []
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        u.telegram_id,
                        u.username,
                        COALESCE(a.points,
                            CASE
                                WHEN u.weekly_points_week = ? THEN COALESCE(u.weekly_points, 0)
                                ELSE 0
                            END
                        ) AS weekly_points
                    FROM users u
                    LEFT JOIN weekly_points_archive a
                        ON a.telegram_id = u.telegram_id
                        AND a.week_key = ?
                ) ranked
                WHERE weekly_points > 0
                """,
                (wk, wk),
            ).fetchall()
            return [dict(row) for row in rows if int(row["telegram_id"] or 0) not in exclude_ids]

    def is_weekly_reward_settled(self, week_key: str) -> bool:
        wk = self._safe_week_key(week_key)
        if not wk:
            return False
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM weekly_reward_runs WHERE week_key = ? LIMIT 1",
                (wk,),
            ).fetchone()
            return bool(row)

    def mark_weekly_reward_settled(
        self,
        week_key: str,
        winners_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        wk = self._safe_week_key(week_key)
        if not wk:
            return
        summary_json = None
        if isinstance(summary, dict):
            try:
                summary_json = json.dumps(summary, ensure_ascii=False)
            except Exception:
                summary_json = None
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO weekly_reward_runs (week_key, settled_at, winners_count, summary_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(week_key) DO UPDATE SET
                    settled_at = excluded.settled_at,
                    winners_count = excluded.winners_count,
                    summary_json = excluded.summary_json
                """,
                (
                    wk,
                    datetime.now().isoformat(),
                    max(0, int(winners_count or 0)),
                    summary_json,
                ),
            )
            conn.commit()

    def apply_weekly_reward_payout(
        self,
        week_key: str,
        telegram_id: int,
        rank: int,
        username: str,
        points_bonus: int,
        pro_days: int,
        supabase_user_id: str = "",
        pro_granted: bool = False,
        pro_error: str = "",
    ) -> bool:
        wk = self._safe_week_key(week_key)
        if not wk:
            return False
        bonus = max(0, int(points_bonus or 0))
        with self._get_connection() as conn:
            exists = conn.execute(
                """
                SELECT 1
                FROM weekly_reward_payouts
                WHERE week_key = ? AND telegram_id = ?
                LIMIT 1
                """,
                (wk, int(telegram_id)),
            ).fetchone()
            if exists:
                return False

            if bonus > 0:
                conn.execute(
                    "UPDATE users SET points = COALESCE(points, 0) + ? WHERE telegram_id = ?",
                    (bonus, int(telegram_id)),
                )
            conn.execute(
                """
                INSERT INTO weekly_reward_payouts (
                    week_key, telegram_id, rank, username, points_bonus, pro_days,
                    supabase_user_id, pro_granted, pro_error, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wk,
                    int(telegram_id),
                    int(rank or 0),
                    str(username or ""),
                    bonus,
                    max(0, int(pro_days or 0)),
                    str(supabase_user_id or "").strip().lower(),
                    1 if pro_granted else 0,
                    str(pro_error or ""),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            if bonus > 0:
                self._sync_points_to_supabase_user_metadata(
                    int(telegram_id),
                    force=True,
                )
            return True

    # ------------------------------------------------------------------
    # User growth snapshots & milestones
    # ------------------------------------------------------------------

    def record_user_growth_snapshot(
        self,
        *,
        snapshot_date: str,
        total_registered: int,
        verified_users: int,
        ever_signed_in: int,
        source: str = "supabase_auth_admin",
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO user_growth_snapshots (
                    snapshot_date, total_registered, verified_users,
                    ever_signed_in, source, recorded_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(snapshot_date) DO UPDATE SET
                    total_registered = excluded.total_registered,
                    verified_users = excluded.verified_users,
                    ever_signed_in = excluded.ever_signed_in,
                    source = excluded.source,
                    recorded_at = excluded.recorded_at
                """,
                (
                    str(snapshot_date or "").strip(),
                    max(0, int(total_registered or 0)),
                    max(0, int(verified_users or 0)),
                    max(0, int(ever_signed_in or 0)),
                    str(source or "supabase_auth_admin"),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()

    def list_user_growth_snapshots(self, limit: int = 90) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT snapshot_date, total_registered, verified_users,
                       ever_signed_in, source, recorded_at
                FROM user_growth_snapshots
                ORDER BY snapshot_date DESC
                LIMIT ?
                """,
                (max(1, min(int(limit or 90), 1000)),),
            ).fetchall()
            return [dict(row) for row in rows]

    def is_growth_milestone_settled(self, milestone: int) -> bool:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM growth_milestone_runs WHERE milestone = ? LIMIT 1",
                (int(milestone),),
            ).fetchone()
            return bool(row)

    def has_growth_milestone_payout(self, milestone: int, supabase_user_id: str) -> bool:
        with self._get_connection() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM growth_milestone_payouts
                WHERE milestone = ? AND supabase_user_id = ? AND status = 'granted'
                LIMIT 1
                """,
                (int(milestone), str(supabase_user_id or "").strip().lower()),
            ).fetchone()
            return bool(row)

    def list_growth_milestone_payouts(self, milestone: int) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT milestone, supabase_user_id, reward_days, status,
                       error, expires_at, updated_at
                FROM growth_milestone_payouts
                WHERE milestone = ?
                ORDER BY supabase_user_id ASC
                """,
                (int(milestone),),
            ).fetchall()
            return [dict(row) for row in rows]

    def record_growth_milestone_payout(
        self,
        milestone: int,
        supabase_user_id: str,
        reward_days: int,
        status: str,
        error: str,
        *,
        expires_at: str = "",
    ) -> bool:
        user_id = str(supabase_user_id or "").strip().lower()
        if not user_id:
            return False
        with self._get_connection() as conn:
            existing = conn.execute(
                """
                SELECT status FROM growth_milestone_payouts
                WHERE milestone = ? AND supabase_user_id = ?
                LIMIT 1
                """,
                (int(milestone), user_id),
            ).fetchone()
            if existing and str(existing[0] or "").strip().lower() == "granted":
                return False
            conn.execute(
                """
                INSERT INTO growth_milestone_payouts (
                    milestone, supabase_user_id, reward_days, status,
                    error, expires_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(milestone, supabase_user_id) DO UPDATE SET
                    reward_days = excluded.reward_days,
                    status = excluded.status,
                    error = excluded.error,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at
                """,
                (
                    int(milestone),
                    user_id,
                    max(0, int(reward_days or 0)),
                    str(status or ""),
                    str(error or ""),
                    str(expires_at or ""),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            return True

    def mark_growth_milestone_settled(
        self,
        milestone: int,
        verified_users: int,
        reward_days: int,
        rewarded_count: int,
        failed_count: int,
        summary: Optional[Dict[str, Any]] = None,
    ) -> None:
        summary_json = json.dumps(summary or {}, ensure_ascii=False)
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO growth_milestone_runs (
                    milestone, verified_users, reward_days, rewarded_count,
                    failed_count, summary_json, settled_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(milestone) DO NOTHING
                """,
                (
                    int(milestone),
                    max(0, int(verified_users or 0)),
                    max(0, int(reward_days or 0)),
                    max(0, int(rewarded_count or 0)),
                    max(0, int(failed_count or 0)),
                    summary_json,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
