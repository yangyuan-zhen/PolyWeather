from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS = 9
SCAN_PAYLOAD_DEFERRED_RUNWAY_POINTS = 12


def _compact_runway_history_points(
    history: Any,
    *,
    max_points: int,
) -> Dict[str, List[Dict[str, Any]]]:
    if not isinstance(history, dict) or max_points <= 0:
        return {}
    compacted: Dict[str, List[Dict[str, Any]]] = {}
    for runway, points in history.items():
        if not isinstance(points, list) or not points:
            continue
        compacted[str(runway)] = points[-max_points:]
    return compacted


def compact_ranked_scan_rows_for_payload(
    rows: List[Dict[str, Any]],
    *,
    full_history_rows: int = SCAN_PAYLOAD_FULL_RUNWAY_HISTORY_ROWS,
    deferred_runway_points: int = SCAN_PAYLOAD_DEFERRED_RUNWAY_POINTS,
) -> List[Dict[str, Any]]:
    compacted_rows: List[Dict[str, Any]] = []
    for index, row in enumerate(rows):
        if index < full_history_rows:
            compacted_rows.append(row)
            continue
        history = row.get("runway_plate_history")
        if not isinstance(history, dict) or not history:
            compacted_rows.append(row)
            continue
        next_row = dict(row)
        next_row["runway_plate_history"] = _compact_runway_history_points(
            history,
            max_points=deferred_runway_points,
        )
        compacted_rows.append(next_row)
    return compacted_rows


def build_scan_terminal_snapshot_id(
    filters: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    top_signal: Optional[Dict[str, Any]],
) -> str:
    seed_payload = {
        "filters": filters,
        "summary": {
            "candidate_total": summary.get("candidate_total"),
            "tradable_market_count": summary.get("tradable_market_count"),
            "avg_edge_percent": summary.get("avg_edge_percent"),
        },
        "top_signal": {
            "id": (top_signal or {}).get("id"),
            "edge_percent": (top_signal or {}).get("edge_percent"),
            "final_score": (top_signal or {}).get("final_score"),
        },
        "rows": [
            {
                "id": row.get("id"),
                "edge_percent": row.get("edge_percent"),
                "final_score": row.get("final_score"),
            }
            for row in rows[:10]
        ],
    }
    digest = hashlib.md5(
        json.dumps(seed_payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"scan-{digest[:10]}"


def _scan_row_id(row: Any) -> Optional[str]:
    if not isinstance(row, dict):
        return None
    row_id = row.get("id")
    if row_id is None:
        return None
    text = str(row_id)
    return text if text else None


def _scan_row_digest(row: Dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(row, ensure_ascii=True, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _rows_by_id(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return {}
    indexed: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_id = _scan_row_id(row)
        if row_id is not None:
            indexed[row_id] = row
    return indexed


def _full_scan_terminal_incremental_payload(
    *,
    current_payload: Dict[str, Any],
    since_snapshot_id: str,
) -> Dict[str, Any]:
    payload = dict(current_payload)
    payload["diff"] = {
        "mode": "full",
        "base_snapshot_id": since_snapshot_id,
        "snapshot_id": current_payload.get("snapshot_id"),
        "rows_changed": [],
        "removed_row_ids": [],
    }
    return payload


def build_scan_terminal_incremental_payload(
    *,
    filters: Dict[str, Any],
    current_payload: Dict[str, Any],
    since_snapshot_id: Optional[str],
    base_payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    since_snapshot_id = str(since_snapshot_id or "").strip()
    current_snapshot_id = current_payload.get("snapshot_id")
    if not since_snapshot_id or not current_snapshot_id:
        return dict(current_payload)
    if current_payload.get("stale") is True or current_payload.get("status") not in (
        "ready",
        "partial",
    ):
        return _full_scan_terminal_incremental_payload(
            current_payload=current_payload,
            since_snapshot_id=since_snapshot_id,
        )
    if since_snapshot_id == current_snapshot_id:
        return {
            "generated_at": current_payload.get("generated_at"),
            "snapshot_id": current_snapshot_id,
            "status": "not_modified",
            "stale": False,
            "stale_reason": None,
            "last_success_at": current_payload.get("last_success_at"),
            "last_failed_at": current_payload.get("last_failed_at"),
            "filters": filters,
            "summary": current_payload.get("summary") or {},
            "top_signal": current_payload.get("top_signal"),
            "rows": [],
            "diff": {
                "mode": "not_modified",
                "base_snapshot_id": since_snapshot_id,
                "snapshot_id": current_snapshot_id,
                "rows_changed": [],
                "removed_row_ids": [],
            },
        }

    if (
        not isinstance(base_payload, dict)
        or base_payload.get("snapshot_id") != since_snapshot_id
    ):
        return _full_scan_terminal_incremental_payload(
            current_payload=current_payload,
            since_snapshot_id=since_snapshot_id,
        )

    current_rows = _rows_by_id(current_payload)
    base_rows = _rows_by_id(base_payload)
    rows_changed: List[Dict[str, Any]] = []
    for row_id, row in current_rows.items():
        base_row = base_rows.get(row_id)
        if base_row is None or _scan_row_digest(base_row) != _scan_row_digest(row):
            rows_changed.append(row)

    removed_row_ids = [
        row_id for row_id in base_rows.keys() if row_id not in current_rows
    ]
    return {
        "generated_at": current_payload.get("generated_at"),
        "snapshot_id": current_snapshot_id,
        "status": current_payload.get("status") or "ready",
        "stale": False,
        "stale_reason": current_payload.get("stale_reason"),
        "last_success_at": current_payload.get("last_success_at"),
        "last_failed_at": current_payload.get("last_failed_at"),
        "filters": filters,
        "summary": current_payload.get("summary") or {},
        "top_signal": current_payload.get("top_signal"),
        "rows": [],
        "diff": {
            "mode": "row_delta",
            "base_snapshot_id": since_snapshot_id,
            "snapshot_id": current_snapshot_id,
            "rows_changed": rows_changed,
            "removed_row_ids": removed_row_ids,
        },
    }


def build_stale_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    success_payload: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str],
) -> Dict[str, Any]:
    payload = dict(success_payload)
    payload["status"] = "stale"
    payload["stale"] = True
    payload["stale_reason"] = error_message
    payload["last_success_at"] = success_payload.get("generated_at")
    payload["last_failed_at"] = failed_at
    payload["filters"] = filters
    return payload


def build_failed_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot_id": None,
        "status": "failed",
        "stale": False,
        "stale_reason": error_message,
        "last_success_at": None,
        "last_failed_at": failed_at or (datetime.utcnow().isoformat() + "Z"),
        "filters": filters,
        "summary": {
            "recommended_count": 0,
            "visible_count": 0,
            "candidate_total": 0,
            "avg_edge_percent": None,
            "avg_primary_confidence": None,
            "tradable_market_count": 0,
            "total_volume": 0.0,
            "resolved_market_type": "maxtemp",
        },
        "top_signal": None,
        "rows": [],
    }
