import json
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


class PaymentRepo:
    def __init__(self, get_connection):
        self._get_connection = get_connection

    @staticmethod
    def _refund_case_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        try:
            notes = json.loads(str(row["notes_json"] or "[]"))
        except Exception:
            notes = []
        return {
            "id": int(row["id"]),
            "status": str(row["status"] or ""),
            "reason": str(row["reason"] or ""),
            "intent_id": str(row["intent_id"] or ""),
            "tx_hash": str(row["tx_hash"] or ""),
            "user_id": str(row["user_id"] or ""),
            "amount_usdc": str(row["amount_usdc"] or ""),
            "created_by": str(row["created_by"] or ""),
            "handled_by": str(row["handled_by"] or ""),
            "notes": notes if isinstance(notes, list) else [],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def create_refund_case(
        self,
        *,
        reason: str,
        intent_id: str = "",
        tx_hash: str = "",
        user_id: str = "",
        amount_usdc: str = "",
        created_by: str = "",
        note: str = "",
    ) -> Dict[str, Any]:
        normalized_reason = str(reason or "").strip().lower()
        if not normalized_reason:
            return {"ok": False, "reason": "invalid_refund_reason"}
        now = datetime.now().isoformat()
        notes = []
        note_text = str(note or "").strip()
        if note_text:
            notes.append(
                {
                    "note": note_text,
                    "by": str(created_by or "").strip().lower(),
                    "at": now,
                }
            )
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                INSERT INTO payment_refund_cases (
                    status,
                    reason,
                    intent_id,
                    tx_hash,
                    user_id,
                    amount_usdc,
                    created_by,
                    handled_by,
                    notes_json,
                    created_at,
                    updated_at
                )
                VALUES ('open', ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
                """,
                (
                    normalized_reason,
                    str(intent_id or "").strip(),
                    str(tx_hash or "").strip().lower(),
                    str(user_id or "").strip().lower(),
                    str(amount_usdc or "").strip(),
                    str(created_by or "").strip().lower(),
                    json.dumps(notes, ensure_ascii=False, default=str),
                    now,
                    now,
                ),
            )
            case_id = int(cursor.lastrowid)
            row = conn.execute(
                """
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                WHERE id = ?
                """,
                (case_id,),
            ).fetchone()
            conn.commit()
        return self._refund_case_row_to_dict(row)

    def update_refund_case(
        self,
        case_id: int,
        *,
        status: str,
        handled_by: str = "",
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        safe_id = int(case_id or 0)
        normalized_status = str(status or "").strip().lower()
        allowed = {"open", "processing", "refunded", "rejected", "closed"}
        if safe_id <= 0 or normalized_status not in allowed:
            return None
        now = datetime.now().isoformat()
        actor = str(handled_by or "").strip().lower()
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT notes_json
                FROM payment_refund_cases
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not row:
                return None
            try:
                notes = json.loads(str(row["notes_json"] or "[]"))
            except Exception:
                notes = []
            if not isinstance(notes, list):
                notes = []
            note_text = str(note or "").strip()
            if note_text:
                notes.append({"note": note_text, "by": actor, "at": now})
            conn.execute(
                """
                UPDATE payment_refund_cases
                SET status = ?,
                    handled_by = ?,
                    notes_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    normalized_status,
                    actor,
                    json.dumps(notes, ensure_ascii=False, default=str),
                    now,
                    safe_id,
                ),
            )
            updated = conn.execute(
                """
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                WHERE id = ?
                """,
                (safe_id,),
            ).fetchone()
            conn.commit()
        return self._refund_case_row_to_dict(updated)

    def list_refund_cases(
        self,
        *,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 50), 200))
        normalized_status = str(status or "").strip().lower()
        params: List[Any] = []
        where_sql = ""
        if normalized_status:
            where_sql = "WHERE status = ?"
            params.append(normalized_status)
        params.append(safe_limit)
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""
                SELECT id, status, reason, intent_id, tx_hash, user_id,
                       amount_usdc, created_by, handled_by, notes_json,
                       created_at, updated_at
                FROM payment_refund_cases
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [self._refund_case_row_to_dict(row) for row in rows]

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
    def _payment_audit_resolution_key(
        event_type: str,
        payload: Dict[str, Any],
    ) -> Tuple[str, str, str, str, str]:
        confirm_failure = (
            payload.get("confirm_failure")
            if isinstance(payload.get("confirm_failure"), dict)
            else {}
        )
        reason = str(
            payload.get("reason")
            or confirm_failure.get("reason")
            or payload.get("error")
            or "unknown"
        ).strip().lower()
        intent_id = str(
            payload.get("intent_id")
            or payload.get("payment_intent_id")
            or confirm_failure.get("intent_id")
            or ""
        ).strip().lower()
        user_id = str(payload.get("user_id") or "").strip().lower()
        tx_hash = str(
            payload.get("tx_hash")
            or confirm_failure.get("tx_hash")
            or ""
        ).strip().lower()
        return str(event_type or "").strip().lower(), reason, user_id, intent_id, tx_hash

    def mark_related_payment_audit_events_resolved(
        self,
        event_id: int,
        resolved_by: str,
    ) -> List[Dict[str, Any]]:
        safe_id = int(event_id or 0)
        actor = str(resolved_by or "").strip().lower()
        if safe_id <= 0 or not actor:
            return []

        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            target = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE id = ?
                LIMIT 1
                """,
                (safe_id,),
            ).fetchone()
            if not target:
                return []

            try:
                target_payload = json.loads(str(target["payload_json"] or "{}"))
            except Exception:
                target_payload = {}
            if not isinstance(target_payload, dict):
                target_payload = {}

            target_key = self._payment_audit_resolution_key(
                str(target["event_type"] or ""),
                target_payload,
            )
            if not (target_key[3] or target_key[4]):
                single = self.mark_payment_audit_event_resolved(safe_id, actor)
                return [single] if single else []

            rows = conn.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM payment_audit_events
                WHERE event_type = ?
                ORDER BY id DESC
                """,
                (str(target["event_type"] or ""),),
            ).fetchall()

            resolved_at = datetime.now().isoformat()
            resolved_rows: List[Dict[str, Any]] = []
            for row in rows:
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                if str(payload.get("resolved_at") or "").strip():
                    continue
                if self._payment_audit_resolution_key(
                    str(row["event_type"] or ""),
                    payload,
                ) != target_key:
                    continue

                payload["resolved_at"] = resolved_at
                payload["resolved_by"] = actor
                conn.execute(
                    """
                    UPDATE payment_audit_events
                    SET payload_json = ?
                    WHERE id = ?
                    """,
                    (json.dumps(payload, ensure_ascii=False), int(row["id"])),
                )
                resolved_rows.append(
                    {
                        "id": int(row["id"]),
                        "event_type": str(row["event_type"] or ""),
                        "payload": payload,
                        "created_at": row["created_at"],
                    }
                )

            conn.commit()
            return resolved_rows
