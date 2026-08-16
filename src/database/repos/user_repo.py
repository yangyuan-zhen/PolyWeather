"""User repository — users, points, weekly, ledger, growth milestones."""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import sqlite3

from loguru import logger

from src.auth.supabase_admin_client import get_supabase_admin_client


class UserRepo:
    """Repository for user accounts, points, and growth milestones."""

    _sync_lock = threading.Lock()
    _sync_cache: Dict[str, Dict[str, Any]] = {}

    def __init__(self, get_connection):
        self._get_connection = get_connection
        self._sync_cache = {}
        self._sync_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Supabase sync helpers (copied verbatim from DBManager)
    # ------------------------------------------------------------------

    def _supabase_service_headers(self) -> Dict[str, str]:
        client = get_supabase_admin_client()
        if not client.configured:
            return {}
        return client._service_headers()

    def _supabase_admin_users_endpoint(self) -> str:
        return get_supabase_admin_client().admin_users_endpoint()

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

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

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
                        supabase_user_id,
                        supabase_email,
                        created_at
                    FROM users
                    ORDER BY points DESC, telegram_id ASC
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
                    supabase_user_id,
                    supabase_email,
                    created_at
                FROM users
                WHERE
                    CAST(telegram_id AS TEXT) = ?
                    OR lower(trim(COALESCE(username, ''))) LIKE ?
                    OR lower(trim(COALESCE(supabase_email, ''))) LIKE ?
                ORDER BY points DESC, telegram_id ASC
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
                    points
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
                SELECT username, points
                FROM users
                ORDER BY points DESC
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

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
