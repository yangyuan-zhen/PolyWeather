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
                    message_count INTEGER DEFAULT 0,
                    last_message_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
            logger.info(f"Database initialized successfully path={self.db_path}")

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

    def add_message_activity(self, telegram_id: int, points_to_add: int = 1):
        """Update message count and add points with simple anti-spam logic."""
        now = datetime.now()
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT last_message_at FROM users WHERE telegram_id = ?", (telegram_id,))
            row = cursor.fetchone()
            if row and row[0]:
                last_at = datetime.fromisoformat(row[0])
                if (now - last_at).total_seconds() < 5:  # 5 second cooldown
                    return False
            
            conn.execute("""
                UPDATE users 
                SET message_count = message_count + 1,
                    points = points + ?,
                    last_message_at = ?
                WHERE telegram_id = ?
            """, (points_to_add, now.isoformat(), telegram_id))
            conn.commit()
            return True

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
