import sqlite3
import os
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
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
            self._ensure_column(conn, "users", "daily_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_points_date", "TEXT")
            self._ensure_column(conn, "users", "weekly_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "weekly_points_week", "TEXT")
            self._ensure_column(conn, "users", "supabase_user_id", "TEXT")
            self._ensure_column(conn, "users", "supabase_email", "TEXT")
            conn.commit()
            logger.info(f"Database initialized successfully path={self.db_path}")

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        existing = {
            row[1]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

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
            row = conn.execute(
                """
                SELECT *
                FROM users
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
                LIMIT 1
                """,
                (key,),
            ).fetchone()
            if row:
                return dict(row)
        return None

    def get_points_by_supabase_user_id(self, supabase_user_id: str) -> int:
        user = self.get_user_by_supabase_user_id(supabase_user_id)
        if not user:
            return 0
        try:
            return max(0, int(user.get("points") or 0))
        except Exception:
            return 0

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
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE users
                SET supabase_user_id = ?, supabase_email = ?
                WHERE telegram_id = ?
                """,
                (supabase_user_id.strip(), supabase_email.strip(), telegram_id),
            )
            conn.commit()

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
            row = conn.execute(
                """
                SELECT telegram_id, points
                FROM users
                WHERE lower(trim(COALESCE(supabase_user_id, ''))) = ?
                LIMIT 1
                """,
                (key,),
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
                    points,
                    message_count,
                    CASE
                        WHEN weekly_points_week = ? THEN COALESCE(weekly_points, 0)
                        ELSE 0
                    END AS weekly_points
                FROM users
                ORDER BY weekly_points DESC, points DESC, message_count DESC
                LIMIT ?
                """,
                (week_key, limit),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_weekly_profile_by_supabase_user_id(self, supabase_user_id: str) -> Dict[str, Any]:
        key = str(supabase_user_id or "").strip().lower()
        if not key:
            return {"weekly_points": 0, "weekly_rank": None, "total_ranked": 0}

        now = datetime.now()
        iso_year, iso_week, _ = now.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT
                    telegram_id,
                    lower(trim(COALESCE(supabase_user_id, ''))) AS supabase_key,
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
            if str(row["supabase_key"] or "") == key:
                weekly_rank = idx
                weekly_points = int(row["weekly_points"] or 0)
                break
        return {
            "weekly_points": max(0, int(weekly_points or 0)),
            "weekly_rank": weekly_rank,
            "total_ranked": len(rows),
        }
