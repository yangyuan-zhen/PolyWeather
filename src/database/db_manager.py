import sqlite3
import os
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
            self._ensure_column(conn, "users", "daily_points", "INTEGER DEFAULT 0")
            self._ensure_column(conn, "users", "daily_points_date", "TEXT")
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

    def upsert_user(self, telegram_id: int, username: str):
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO users (telegram_id, username)
                VALUES (?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username
            """, (telegram_id, username))
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
        normalized = "".join((text or "").split())
        if len(normalized) < min_text_length:
            return {"awarded": False, "reason": "too_short"}

        today_str = now.strftime("%Y-%m-%d")
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT points, daily_points, daily_points_date, last_message_at
                FROM users WHERE telegram_id = ?
                """,
                (telegram_id,),
            )
            row = cursor.fetchone()
            if not row:
                return {"awarded": False, "reason": "user_missing"}

            last_message_at = row["last_message_at"]
            if last_message_at:
                last_at = datetime.fromisoformat(last_message_at)
                if (now - last_at).total_seconds() < cooldown_sec:
                    return {"awarded": False, "reason": "cooldown"}

            daily_points = int(row["daily_points"] or 0)
            daily_points_date = row["daily_points_date"] or ""
            if daily_points_date != today_str:
                daily_points = 0

            if daily_points >= daily_cap:
                conn.execute(
                    """
                    UPDATE users
                    SET last_message_at = ?, daily_points = ?, daily_points_date = ?
                    WHERE telegram_id = ?
                    """,
                    (now.isoformat(), daily_points, today_str, telegram_id),
                )
                conn.commit()
                return {"awarded": False, "reason": "daily_cap", "daily_points": daily_points}

            conn.execute("""
                UPDATE users 
                SET message_count = message_count + 1,
                    points = points + ?,
                    daily_points = ?,
                    daily_points_date = ?,
                    last_message_at = ?
                WHERE telegram_id = ?
            """, (points_to_add, daily_points + points_to_add, today_str, now.isoformat(), telegram_id))
            conn.commit()
            return {
                "awarded": True,
                "reason": "ok",
                "daily_points": daily_points + points_to_add,
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
