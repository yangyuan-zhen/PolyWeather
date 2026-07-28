"""Analytics events repository (ops audit, app analytics, funnel)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class AnalyticsRepo:
    """Repository for ops audit events and app analytics."""

    def __init__(self, get_connection):
        self._get_connection = get_connection

    def append_ops_audit_event(
        self,
        action: str,
        *,
        actor_email: str = "",
        target_user_id: str = "",
        target_email: str = "",
        target_type: str = "",
        target_id: str = "",
        payload_json: Optional[str] = None,
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO ops_audit_events (action, actor_email, target_user_id, target_email, target_type, target_id, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(action or "").strip(),
                    str(actor_email or "").strip(),
                    str(target_user_id or "").strip(),
                    str(target_email or "").strip(),
                    str(target_type or "").strip(),
                    str(target_id or "").strip(),
                    str(payload_json or "{}"),
                ),
            )

    def list_ops_audit_events(
        self,
        limit: int = 50,
        offset: int = 0,
        action_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            if action_filter:
                rows = conn.execute(
                    "SELECT * FROM ops_audit_events WHERE action = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (str(action_filter).strip(), int(limit), int(offset)),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM ops_audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (int(limit), int(offset)),
                ).fetchall()
            return [dict(r) for r in rows]

    def append_app_analytics_event(
        self,
        event_type: str,
        *,
        user_id: Optional[str] = None,
        client_id: Optional[str] = None,
        session_id: Optional[str] = None,
        payload_json: Optional[str] = None,
    ) -> int:
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO app_analytics_events (event_type, user_id, client_id, session_id, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(event_type or "").strip(),
                    str(user_id or "").strip() or None,
                    str(client_id or "").strip() or None,
                    str(session_id or "").strip() or None,
                    str(payload_json or "{}"),
                ),
            )
            return cursor.lastrowid or 0

    def list_app_analytics_events(
        self,
        event_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            if event_type:
                rows = conn.execute(
                    "SELECT * FROM app_analytics_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (str(event_type).strip(), int(limit), int(offset)),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM app_analytics_events ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (int(limit), int(offset)),
                ).fetchall()
            return [dict(r) for r in rows]

    def get_app_analytics_funnel_summary(
        self,
        event_types: List[str],
        since: Optional[str] = None,
    ) -> Dict[str, int]:
        if not event_types:
            return {}
        placeholders = ",".join("?" for _ in event_types)
        params: list[Any] = [str(et).strip() for et in event_types]
        if since:
            params.append(str(since).strip())
            since_clause = "AND created_at >= ?"
        else:
            since_clause = ""
        with self._get_connection() as conn:
            rows = conn.execute(
                f"SELECT event_type, COUNT(*) AS cnt FROM app_analytics_events WHERE event_type IN ({placeholders}) {since_clause} GROUP BY event_type",
                params,
            ).fetchall()
            return {row["event_type"]: row["cnt"] for row in rows}
