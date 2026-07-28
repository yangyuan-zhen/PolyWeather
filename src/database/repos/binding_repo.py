import sqlite3
import os
import secrets
import threading
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from src.auth.supabase_admin_client import get_supabase_admin_client


class BindingRepo:
    _profile_sync_lock = threading.Lock()
    _profile_sync_cache: Dict[str, Dict[str, Any]] = {}

    def __init__(self, get_connection):
        self._get_connection = get_connection
        self._profile_sync_cache = {}
        self._profile_sync_lock = threading.Lock()

    # ----- Supabase endpoint helpers -----

    def _supabase_profiles_endpoint(self) -> str:
        return get_supabase_admin_client().profiles_endpoint()

    def _supabase_service_headers(self) -> Dict[str, str]:
        client = get_supabase_admin_client()
        if not client.configured:
            return {}
        return client._service_headers()

    def _supabase_admin_users_endpoint(self) -> str:
        return get_supabase_admin_client().admin_users_endpoint()

    # ----- Profile sync helpers -----

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

    # ----- Points sync helpers -----

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

    # ----- Public binding methods -----

    def bind_supabase_identity(
        self,
        telegram_id: int,
        supabase_user_id: str,
        supabase_email: str = "",
    ) -> Dict[str, Any]:
        """
        Bind Supabase account to Telegram account.

        Rules:
        - One supabase_user_id can only belong to one telegram_id.
        - One telegram_id can bind multiple supabase_user_id (shared points/profile).
        """
        normalized_uid = str(supabase_user_id or "").strip().lower()
        normalized_email = str(supabase_email or "").strip()
        if not normalized_uid:
            return {"ok": False, "reason": "invalid_supabase_user_id"}

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row

            # Ensure current telegram user row exists.
            conn.execute(
                """
                INSERT INTO users (telegram_id, username)
                VALUES (?, COALESCE((SELECT username FROM users WHERE telegram_id = ?), ''))
                ON CONFLICT(telegram_id) DO NOTHING
                """,
                (telegram_id, telegram_id),
            )

            current_row = conn.execute(
                """
                SELECT telegram_id, supabase_user_id, supabase_email
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            current_uid = str(
                (current_row["supabase_user_id"] if current_row else "") or ""
            ).strip().lower()

            owner_row = conn.execute(
                """
                SELECT telegram_id
                FROM supabase_bindings
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
                LIMIT 1
                """,
                (normalized_uid,),
            ).fetchone()
            owner_telegram_id = int(owner_row["telegram_id"]) if owner_row else None

            if owner_telegram_id is not None and owner_telegram_id != int(telegram_id):
                return {
                    "ok": False,
                    "reason": "supabase_already_bound_other",
                    "owner_telegram_id": owner_telegram_id,
                }

            conn.execute(
                """
                INSERT INTO supabase_bindings (supabase_user_id, telegram_id, supabase_email, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(supabase_user_id) DO UPDATE SET
                    telegram_id = excluded.telegram_id,
                    supabase_email = excluded.supabase_email,
                    updated_at = excluded.updated_at
                """,
                (normalized_uid, int(telegram_id), normalized_email, datetime.now().isoformat()),
            )

            if current_uid == normalized_uid:
                # Keep idempotent bind behavior while allowing email refresh.
                conn.execute(
                    """
                    UPDATE users
                    SET supabase_email = ?
                    WHERE telegram_id = ?
                    """,
                    (normalized_email, telegram_id),
                )
                user_row = conn.execute(
                    """
                    SELECT username
                    FROM users
                    WHERE telegram_id = ?
                    LIMIT 1
                    """,
                    (telegram_id,),
                ).fetchone()
                conn.commit()
                self._sync_supabase_profile_telegram_fields(
                    supabase_user_id=normalized_uid,
                    telegram_id=int(telegram_id),
                    telegram_username=str((user_row["username"] if user_row else "") or "").strip(),
                    force=True,
                )
                return {"ok": True, "reason": "already_bound_same"}

            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = ?, supabase_email = ?
                WHERE telegram_id = ?
                """,
                (normalized_uid, normalized_email, telegram_id),
            )
            user_row = conn.execute(
                """
                SELECT username
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            conn.commit()
            self._sync_supabase_profile_telegram_fields(
                supabase_user_id=normalized_uid,
                telegram_id=int(telegram_id),
                telegram_username=str((user_row["username"] if user_row else "") or "").strip(),
                force=True,
            )
            return {"ok": True, "reason": "bound"}

    def unbind_supabase_identity(self, telegram_id: int) -> Dict[str, Any]:
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            current = conn.execute(
                """
                SELECT supabase_user_id
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                """,
                (telegram_id,),
            ).fetchone()
            current_uid = str((current["supabase_user_id"] if current else "") or "").strip()
            links = conn.execute(
                """
                SELECT supabase_user_id
                FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            ).fetchall()
            linked_user_ids = {
                str((row["supabase_user_id"] if row else "") or "").strip().lower()
                for row in links
            }
            if current_uid:
                linked_user_ids.add(current_uid.lower())
            linked_user_ids = {item for item in linked_user_ids if item}
            if not current_uid and not linked_user_ids:
                return {"ok": True, "reason": "not_bound"}

            conn.execute(
                """
                DELETE FROM supabase_bindings
                WHERE telegram_id = ?
                """,
                (int(telegram_id),),
            )
            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = '', supabase_email = ''
                WHERE telegram_id = ?
                """,
                (telegram_id,),
            )
            conn.commit()
            for user_id in linked_user_ids:
                self._sync_supabase_profile_telegram_fields(
                    supabase_user_id=user_id,
                    telegram_id=None,
                    telegram_username=None,
                    force=True,
                )
            return {"ok": True, "reason": "unbound", "previous_supabase_user_id": current_uid}

    def create_bind_token(self, telegram_id: int, ttl_minutes: int = 10) -> str:
        token = secrets.token_urlsafe(16)
        now = datetime.now()
        expires_at = now + timedelta(minutes=max(1, int(ttl_minutes)))
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM telegram_bind_tokens
                WHERE telegram_id = ? OR expires_at < ?
                """,
                (int(telegram_id), now.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO telegram_bind_tokens (token, telegram_id, expires_at)
                VALUES (?, ?, ?)
                """,
                (token, int(telegram_id), expires_at.isoformat()),
            )
            conn.commit()
        return token

    def consume_bind_token(self, token: str) -> Optional[int]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT telegram_id, expires_at
                FROM telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            if now > expires_at:
                conn.execute("DELETE FROM telegram_bind_tokens WHERE token = ?", (token,))
                conn.commit()
                return None
            conn.execute("DELETE FROM telegram_bind_tokens WHERE token = ?", (token,))
            conn.commit()
            return int(row["telegram_id"])

    def peek_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT supabase_user_id, supabase_email, expires_at
                FROM web_telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            if now > expires_at:
                conn.execute("DELETE FROM web_telegram_bind_tokens WHERE token = ?", (token,))
                conn.commit()
                return None
            return {
                "supabase_user_id": str(row["supabase_user_id"] or "").strip().lower(),
                "supabase_email": str(row["supabase_email"] or "").strip(),
            }

    def create_web_bind_token(
        self,
        supabase_user_id: str,
        supabase_email: str = "",
        ttl_minutes: int = 10,
    ) -> str:
        normalized_uid = str(supabase_user_id or "").strip().lower()
        if not normalized_uid:
            raise ValueError("supabase_user_id is required")
        token = secrets.token_urlsafe(16)
        now = datetime.now()
        expires_at = now + timedelta(minutes=max(1, int(ttl_minutes)))
        with self._get_connection() as conn:
            conn.execute(
                """
                DELETE FROM web_telegram_bind_tokens
                WHERE supabase_user_id = ? OR expires_at < ?
                """,
                (normalized_uid, now.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO web_telegram_bind_tokens (
                    token, supabase_user_id, supabase_email, expires_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (token, normalized_uid, str(supabase_email or "").strip(), expires_at.isoformat()),
            )
            conn.commit()
        return token

    def consume_web_bind_token(self, token: str) -> Optional[Dict[str, str]]:
        token = str(token or "").strip()
        if not token:
            return None
        now = datetime.now()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT supabase_user_id, supabase_email, expires_at
                FROM web_telegram_bind_tokens
                WHERE token = ?
                LIMIT 1
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            try:
                expires_at = datetime.fromisoformat(row["expires_at"])
            except Exception:
                expires_at = now
            conn.execute("DELETE FROM web_telegram_bind_tokens WHERE token = ?", (token,))
            conn.commit()
            if now > expires_at:
                return None
            return {
                "supabase_user_id": str(row["supabase_user_id"] or "").strip().lower(),
                "supabase_email": str(row["supabase_email"] or "").strip(),
            }
