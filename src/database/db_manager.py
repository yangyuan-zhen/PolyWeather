import sqlite3
import os
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from loguru import logger


class DBManager:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = self._resolve_db_path(db_path)
        self._init_db()

    def _resolve_db_path(self, db_path: Optional[str]) -> str:
        raw = (db_path or os.getenv("POLYWEATHER_DB_PATH") or "").strip()
        if not raw:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            return os.path.join(project_root, "data", "polyweather.db")
        return raw

    def _get_connection(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        """Create tables if they don't exist."""
        # Ensure directory exists
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    telegram_id INTEGER PRIMARY KEY,
                    username TEXT,
                    is_web_premium BOOLEAN DEFAULT 0,
                    web_expiry TIMESTAMP,
                    is_group_premium BOOLEAN DEFAULT 0,
                    group_expiry TIMESTAMP,
                    points INTEGER DEFAULT 0,
                    daily_points INTEGER DEFAULT 0,
                    daily_points_date TEXT,
                    message_count INTEGER DEFAULT 0,
                    last_message_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS activity_fingerprints (
                    telegram_id INTEGER NOT NULL,
                    activity_date TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (telegram_id, activity_date, fingerprint)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_points_archive (
                    telegram_id INTEGER NOT NULL,
                    week_key TEXT NOT NULL,
                    points INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (telegram_id, week_key)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_reward_runs (
                    week_key TEXT PRIMARY KEY,
                    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    winners_count INTEGER DEFAULT 0,
                    summary_json TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_reward_payouts (
                    week_key TEXT NOT NULL,
                    telegram_id INTEGER NOT NULL,
                    rank INTEGER DEFAULT 0,
                    username TEXT,
                    points_bonus INTEGER DEFAULT 0,
                    pro_days INTEGER DEFAULT 0,
                    supabase_user_id TEXT,
                    pro_granted INTEGER DEFAULT 0,
                    pro_error TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (week_key, telegram_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS payment_runtime_state (
                    state_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS payment_audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_audit_events_created_at ON payment_audit_events(created_at DESC)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS supabase_bindings (
                    supabase_user_id TEXT PRIMARY KEY,
                    telegram_id INTEGER NOT NULL,
                    supabase_email TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_supabase_bindings_telegram_id ON supabase_bindings(telegram_id)"
            )
            self._ensure_column(conn, "users", "daily_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_points_date", "TEXT")
            self._ensure_column(conn, "users", "weekly_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "weekly_points_week", "TEXT")
            self._ensure_column(conn, "users", "supabase_user_id", "TEXT")
            self._ensure_column(conn, "users", "supabase_email", "TEXT")
            # Migrate legacy one-to-one binding column into mapping table.
            conn.execute(
                """
                INSERT OR IGNORE INTO supabase_bindings (
                    supabase_user_id, telegram_id, supabase_email, created_at, updated_at
                )
                SELECT
                    lower(trim(COALESCE(supabase_user_id, ''))),
                    telegram_id,
                    COALESCE(supabase_email, ''),
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                FROM users
                WHERE trim(COALESCE(supabase_user_id, '')) <> ''
                """
            )
            conn.commit()
            logger.info(f"Database initialized successfully path={self.db_path}")

    def get_payment_runtime_state(self, state_key: str) -> Optional[Dict[str, Any]]:
        key = str(state_key or "").strip()
        if not key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT payload_json
                FROM payment_runtime_state
                WHERE state_key = ?
                LIMIT 1
                """,
                (key,),
            ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                return None
            return payload if isinstance(payload, dict) else None

    def set_payment_runtime_state(self, state_key: str, payload: Dict[str, Any]) -> None:
        key = str(state_key or "").strip()
        if not key:
            return
        body = payload if isinstance(payload, dict) else {}
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO payment_runtime_state (state_key, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (key, json.dumps(body, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

    def append_payment_audit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        kind = str(event_type or "").strip().lower()
        if not kind:
            return
        body = payload if isinstance(payload, dict) else {}
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO payment_audit_events (event_type, payload_json, created_at)
                VALUES (?, ?, ?)
                """,
                (kind, json.dumps(body, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

    def list_payment_audit_events(
        self,
        limit: int = 50,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 50), 500))
        kind = str(event_type or "").strip().lower()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if kind:
                rows = conn.execute(
                    """
                    SELECT id, event_type, payload_json, created_at
                    FROM payment_audit_events
                    WHERE event_type = ?
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (kind, safe_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, event_type, payload_json, created_at
                    FROM payment_audit_events
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
            out = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                out.append(
                    {
                        "id": int(row["id"]),
                        "event_type": str(row["event_type"] or ""),
                        "payload": payload if isinstance(payload, dict) else {},
                        "created_at": row["created_at"],
                    }
                )
            return out

    def mark_payment_audit_event_resolved(
        self,
        event_id: int,
        resolved_by: str,
    ) -> Optional[Dict[str, Any]]:
        safe_id = int(event_id or 0)
        actor = str(resolved_by or "").strip().lower()
        if safe_id <= 0 or not actor:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except Exception:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            payload["resolved_at"] = datetime.now().isoformat()
            payload["resolved_by"] = actor
            conn.execute(
                """
                UPDATE payment_audit_events
                SET payload_json = ?
                WHERE id = ?
                """,
                (json.dumps(payload, ensure_ascii=False), safe_id),
            )
            conn.commit()
            return {
                "id": int(row["id"]),
                "event_type": str(row["event_type"] or ""),
                "payload": payload,
                "created_at": row["created_at"],
            }

    @staticmethod
    def _safe_week_key(value: str) -> str:
        text = str(value or "").strip()
        if len(text) >= 8 and "-W" in text:
            return text[:8]
        return ""

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

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        existing = {
            row[1]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

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

    def grant_points_by_supabase_email(
        self,
        supabase_email: str,
        amount: int,
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
                SELECT telegram_id, username, points, supabase_email
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
            conn.commit()
            return {
                "ok": True,
                "telegram_id": telegram_id,
                "username": str(row["username"] or ""),
                "supabase_email": str(row["supabase_email"] or email),
                "points_before": before,
                "points_added": points,
                "points_after": after,
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
                conn.commit()
                return {"ok": True, "reason": "already_bound_same"}

            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = ?, supabase_email = ?
                WHERE telegram_id = ?
                """,
                (normalized_uid, normalized_email, telegram_id),
            )
            conn.commit()
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
                LIMIT 1
                """,
                (int(telegram_id),),
            ).fetchone()
            if not current_uid and not links:
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
            return {"ok": True, "reason": "unbound", "previous_supabase_user_id": current_uid}

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
                SELECT points, daily_points, daily_points_date, weekly_points, weekly_points_week, last_message_at
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
                return {
                    "awarded": False,
                    "reason": "daily_cap",
                    "daily_points": daily_points,
                    "weekly_points": weekly_points,
                }

            conn.execute("""
                UPDATE users 
                SET message_count = message_count + 1,
                    points = points + ?,
                    daily_points = ?,
                    daily_points_date = ?,
                    weekly_points = ?,
                    weekly_points_week = ?,
                    last_message_at = ?
                WHERE telegram_id = ?
            """, (
                points_added,
                daily_points + points_added,
                today_str,
                weekly_points + points_added,
                week_key,
                now.isoformat(),
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
                points=weekly_points + points_added,
            )
            conn.commit()
            return {
                "awarded": True,
                "reason": "ok",
                "points_added": points_added,
                "daily_points": daily_points + points_added,
                "weekly_points": weekly_points + points_added,
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
                ORDER BY weekly_points DESC, points DESC, message_count DESC
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
            return True
