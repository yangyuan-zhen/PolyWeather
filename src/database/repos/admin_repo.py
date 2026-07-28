import sqlite3
from datetime import datetime
from typing import Optional, Dict, Any


class AdminRepo:
    def __init__(self, get_connection):
        self._get_connection = get_connection

    @staticmethod
    def _mask_secret_value(value: str) -> str:
        text = str(value or "")
        if not text:
            return ""
        if len(text) <= 8:
            return "***"
        return f"{text[:4]}...{text[-4:]}"

    def get_runtime_secret(self, key: str) -> Optional[str]:
        normalized_key = str(key or "").strip()
        if not normalized_key:
            return None
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT value
                FROM runtime_secrets
                WHERE key = ?
                LIMIT 1
                """,
                (normalized_key,),
            ).fetchone()
        if not row:
            return None
        value = str(row["value"] or "")
        return value if value else None

    def get_runtime_secret_metadata(self, key: str) -> Dict[str, Any]:
        normalized_key = str(key or "").strip()
        if not normalized_key:
            return {
                "key": "",
                "configured": False,
                "masked": "",
                "updated_at": "",
                "updated_by": "",
                "source": "runtime_store",
            }
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT key, value, updated_at, updated_by
                FROM runtime_secrets
                WHERE key = ?
                LIMIT 1
                """,
                (normalized_key,),
            ).fetchone()
        if not row:
            return {
                "key": normalized_key,
                "configured": False,
                "masked": "",
                "updated_at": "",
                "updated_by": "",
                "source": "runtime_store",
            }
        value = str(row["value"] or "")
        return {
            "key": normalized_key,
            "configured": bool(value),
            "masked": self._mask_secret_value(value),
            "length": len(value),
            "updated_at": str(row["updated_at"] or ""),
            "updated_by": str(row["updated_by"] or ""),
            "source": "runtime_store",
        }

    def set_runtime_secret(
        self,
        key: str,
        value: str,
        *,
        updated_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_key = str(key or "").strip()
        secret_value = str(value or "").strip()
        if not normalized_key:
            raise ValueError("runtime secret key is required")
        if not secret_value:
            raise ValueError("runtime secret value is required")
        now = datetime.now().isoformat()
        operator = str(updated_by or "").strip()
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO runtime_secrets (key, value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                (normalized_key, secret_value, now, operator),
            )
            conn.commit()
        return self.get_runtime_secret_metadata(normalized_key)
