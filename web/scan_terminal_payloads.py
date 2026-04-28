from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional


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
