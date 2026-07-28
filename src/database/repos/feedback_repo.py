"""User feedback repository."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class FeedbackRepo:
    """Repository for user feedback records."""

    def __init__(self, get_connection):
        self._get_connection = get_connection

    def append_user_feedback(
        self,
        category: str,
        message: str,
        source: str = "terminal",
        contact: Optional[str] = None,
        user_id: Optional[str] = None,
        user_email: Optional[str] = None,
        context_json: Optional[str] = None,
    ) -> int:
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO user_feedback (category, message, source, contact, user_id, user_email, context_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(category or "").strip(),
                    str(message or "").strip(),
                    str(source or "terminal").strip(),
                    str(contact or "").strip() or None,
                    str(user_id or "").strip() or None,
                    str(user_email or "").strip() or None,
                    str(context_json or "{}"),
                ),
            )
            return cursor.lastrowid or 0

    def list_user_feedback(
        self,
        limit: int = 50,
        offset: int = 0,
        status_filter: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            conditions: list[str] = []
            params: list[Any] = []
            if status_filter:
                conditions.append("status = ?")
                params.append(str(status_filter).strip())
            if user_id:
                conditions.append("user_id = ?")
                params.append(str(user_id).strip())
            where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
            rows = conn.execute(
                f"SELECT * FROM user_feedback {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                [*params, int(limit), int(offset)],
            ).fetchall()
            return [dict(r) for r in rows]

    def update_user_feedback_status(self, feedback_id: int, status: str) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE user_feedback SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (str(status or "").strip(), int(feedback_id)),
            )

    def update_user_feedback_reward(
        self,
        feedback_id: int,
        reward_points: int,
        reward_reason: str,
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE user_feedback SET reward_points = ?, reward_reason = ?, rewarded_at = CURRENT_TIMESTAMP, reward_status = 'granted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (int(reward_points), str(reward_reason or "").strip(), int(feedback_id)),
            )

    def grant_feedback_reward(
        self,
        feedback_id: int,
        reward_points: int,
        reward_reason: str,
    ) -> bool:
        self.update_user_feedback_reward(feedback_id, reward_points, reward_reason)
        return True
