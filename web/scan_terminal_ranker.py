from __future__ import annotations

from typing import Any, Dict, List, Optional

from web.core import _sf as _safe_float


def build_ranked_scan_terminal_result(
    *,
    city_results: List[Dict[str, Any]],
    filters: Dict[str, Any],
    total_city_count: int,
    failed_city_count: int,
) -> Dict[str, Any]:
    primary_rows: List[Dict[str, Any]] = []
    primary_scores: List[float] = []
    candidate_total = 0

    for result in city_results:
        candidate_total += int(result.get("candidate_total") or 0)
        primary_rows.extend(result.get("rows") or [])
        primary_scores.extend(result.get("primary_scores") or [])

    primary_rows.sort(
        key=lambda row: (
            float(row.get("final_score") or 0.0),
            float(row.get("edge_percent") or 0.0),
        ),
        reverse=True,
    )

    ranked_rows: List[Dict[str, Any]] = [
        {
            **row,
            "rank": index,
        }
        for index, row in enumerate(primary_rows[: filters["limit"]], start=1)
    ]

    unique_market_volume: Dict[str, float] = {}
    for row in primary_rows:
        market_key = str(row.get("market_key") or row.get("id") or "").strip()
        if not market_key:
            continue
        unique_market_volume[market_key] = max(
            unique_market_volume.get(market_key, 0.0),
            float(row.get("volume") or 0.0),
        )

    avg_edge: Optional[float] = None
    if primary_rows:
        edge_values = [
            float(row.get("edge_percent") or 0.0)
            for row in primary_rows
            if _safe_float(row.get("edge_percent")) is not None
        ]
        if edge_values:
            avg_edge = sum(edge_values) / len(edge_values)

    avg_confidence: Optional[float] = None
    if primary_scores:
        avg_confidence = sum(primary_scores) / len(primary_scores)

    top_signal = ranked_rows[0] if ranked_rows else None
    summary = {
        "recommended_count": len(primary_rows),
        "visible_count": len(ranked_rows),
        "candidate_total": candidate_total,
        "avg_edge_percent": avg_edge,
        "avg_primary_confidence": avg_confidence,
        "tradable_market_count": len(unique_market_volume),
        "total_volume": sum(unique_market_volume.values()),
        "resolved_market_type": "maxtemp",
        "total_city_count": total_city_count,
        "scanned_city_count": len(city_results),
        "failed_city_count": failed_city_count,
    }

    return {
        "primary_rows": primary_rows,
        "ranked_rows": ranked_rows,
        "summary": summary,
        "top_signal": top_signal,
    }
