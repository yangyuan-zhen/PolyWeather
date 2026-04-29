from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from web.scan_city_ai_helpers import _safe_float
from web.scan_terminal_ai_compact import _normalize_ai_city_key
from web.scan_terminal_filters import safe_int as _safe_int
from web.scan_terminal_metar_gate import _apply_metar_gate_to_row


def _normalize_ai_items(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if isinstance(item, str):
            out.append({"row_id": item})
        elif isinstance(item, dict):
            row_id = str(item.get("row_id") or item.get("id") or "").strip()
            if row_id:
                out.append({**item, "row_id": row_id})
    return out


def _normalize_ai_city_theses(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        city = str(item.get("city") or item.get("city_name") or "").strip()
        if not city:
            continue
        out.append({**item, "city": city})
    return out


def _normalize_ai_city_forecasts(ai_raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_items = (
        ai_raw.get("city_forecasts")
        or ai_raw.get("city_predictions")
        or ai_raw.get("city_max_forecasts")
        or ai_raw.get("city_theses")
    )
    if not isinstance(raw_items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        city = str(item.get("city") or item.get("city_name") or "").strip()
        if not city:
            continue
        predicted = (
            item.get("predicted_max")
            if item.get("predicted_max") is not None
            else item.get("max_temp")
            if item.get("max_temp") is not None
            else item.get("prediction")
        )
        out.append(
            {
                **item,
                "city": city,
                "predicted_max": predicted,
                "range_low": item.get("range_low") if item.get("range_low") is not None else item.get("low"),
                "range_high": item.get("range_high") if item.get("range_high") is not None else item.get("high"),
                "reasoning_zh": item.get("reasoning_zh") or item.get("thesis_zh") or item.get("summary_zh"),
                "reasoning_en": item.get("reasoning_en") or item.get("thesis_en") or item.get("summary_en"),
            }
        )
    return out


def merge_scan_ai_result(
    payload: Dict[str, Any],
    ai_raw: Dict[str, Any],
    *,
    model: str,
    max_rows: int,
    timeout_sec: int,
    cache_ttl_sec: int,
    base_url: str,
    cached: bool = False,
    provider: str = "openai-compatible",
    duration_ms: Optional[int] = None,
    input_rows: Optional[int] = None,
) -> Dict[str, Any]:
    rows = [dict(row) for row in (payload.get("rows") or []) if isinstance(row, dict)]
    by_id = {str(row.get("id")): row for row in rows if row.get("id")}
    recommendations = _normalize_ai_items(ai_raw.get("recommendations"))
    vetoed = _normalize_ai_items(ai_raw.get("vetoed"))
    downgraded = _normalize_ai_items(ai_raw.get("downgraded"))
    watchlist = _normalize_ai_items(ai_raw.get("watchlist"))
    city_theses = _normalize_ai_city_theses(ai_raw.get("city_theses"))
    city_forecasts = _normalize_ai_city_forecasts(ai_raw)
    contract_notes = _normalize_ai_items(ai_raw.get("contract_notes"))

    veto_ids = {str(item.get("row_id")) for item in vetoed}
    downgrade_ids = {str(item.get("row_id")) for item in downgraded}
    recommended_ids: set[str] = set()
    watchlist_ids = {str(item.get("row_id")) for item in watchlist}

    thesis_by_city: Dict[str, Dict[str, Any]] = {}
    for item in city_theses:
        key = _normalize_ai_city_key(item.get("city"))
        if key:
            thesis_by_city[key] = item
    forecast_by_city: Dict[str, Dict[str, Any]] = {}
    for item in city_forecasts:
        key = _normalize_ai_city_key(item.get("city"))
        if key:
            forecast_by_city[key] = item

    for row in rows:
        city_key = _normalize_ai_city_key(row.get("city"))
        display_key = _normalize_ai_city_key(row.get("city_display_name"))
        thesis = thesis_by_city.get(city_key) or thesis_by_city.get(display_key)
        forecast = forecast_by_city.get(city_key) or forecast_by_city.get(display_key)
        if thesis:
            row["ai_city_thesis_zh"] = thesis.get("thesis_zh") or thesis.get("summary_zh")
            row["ai_city_thesis_en"] = thesis.get("thesis_en") or thesis.get("summary_en")
            row["ai_city_confidence"] = thesis.get("confidence")
            row["ai_city_model_cluster_note"] = thesis.get("model_cluster_note")
        if forecast:
            row["ai_predicted_max"] = _safe_float(forecast.get("predicted_max"))
            row["ai_predicted_low"] = _safe_float(forecast.get("range_low"))
            row["ai_predicted_high"] = _safe_float(forecast.get("range_high"))
            row["ai_forecast_unit"] = forecast.get("unit") or row.get("temp_symbol")
            row["ai_forecast_confidence"] = forecast.get("confidence")
            row["ai_peak_window_zh"] = forecast.get("peak_window_zh")
            row["ai_peak_window_en"] = forecast.get("peak_window_en")
            row["ai_airport_metar_read_zh"] = forecast.get("metar_read_zh")
            row["ai_airport_metar_read_en"] = forecast.get("metar_read_en")
            row["ai_forecast_reason_zh"] = forecast.get("reasoning_zh")
            row["ai_forecast_reason_en"] = forecast.get("reasoning_en")
            row["ai_city_model_cluster_note"] = forecast.get("model_cluster_note") or row.get("ai_city_model_cluster_note")
            row["ai_city_thesis_zh"] = row.get("ai_city_thesis_zh") or forecast.get("reasoning_zh")
            row["ai_city_thesis_en"] = row.get("ai_city_thesis_en") or forecast.get("reasoning_en")

    for item in contract_notes:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_forecast_match"] = item.get("forecast_match") or item.get("match")
        row["ai_forecast_match_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_forecast_match_reason_en"] = item.get("reason_en")

    for item in vetoed:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_decision"] = "veto"
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
    for item in downgraded:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_decision"] = "downgrade"
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
    for item in watchlist:
        row = by_id.get(str(item.get("row_id")))
        if not row:
            continue
        row["ai_watchlist_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_watchlist_reason_en"] = item.get("reason_en")
    for fallback_rank, item in enumerate(recommendations, start=1):
        row_id = str(item.get("row_id"))
        row = by_id.get(row_id)
        if not row:
            continue
        if row_id in veto_ids:
            continue
        recommended_ids.add(row_id)
        row["ai_decision"] = str(item.get("decision") or "approve").strip().lower() or "approve"
        row["ai_rank"] = _safe_int(item.get("rank"), fallback_rank)
        row["ai_confidence"] = item.get("confidence")
        row["ai_reason_zh"] = item.get("reason_zh") or item.get("reason")
        row["ai_reason_en"] = item.get("reason_en")
        row["ai_model_cluster_note"] = item.get("model_cluster_note")

    for row in rows:
        row_id = str(row.get("id"))
        if row_id not in recommended_ids and row_id not in veto_ids and row_id not in downgrade_ids:
            row["ai_decision"] = row.get("ai_decision") or "neutral"
        if row_id in watchlist_ids and row.get("ai_decision") == "neutral":
            row["ai_decision"] = "watchlist"
        _apply_metar_gate_to_row(row)

    def _ai_sort_key(row: Dict[str, Any]) -> tuple:
        decision = str(row.get("ai_decision") or "").lower()
        if decision == "veto":
            tier = 3
        elif decision == "downgrade":
            tier = 2
        elif row.get("ai_rank") is not None:
            tier = 0
        else:
            tier = 1
        return (
            tier,
            _safe_int(row.get("ai_rank"), 999),
            -float(row.get("final_score") or 0.0),
            -float(row.get("edge_percent") or 0.0),
        )

    rows.sort(key=_ai_sort_key)
    top_signal = next(
        (row for row in rows if str(row.get("ai_decision") or "").lower() != "veto"),
        rows[0] if rows else None,
    )
    input_meta = ai_raw.get("_polyweather_input_meta")
    sent_cities = input_meta.get("sent_cities") if isinstance(input_meta, dict) else None
    sent_contracts = input_meta.get("sent_contracts") if isinstance(input_meta, dict) else None
    ai_scan = {
        "status": "ready",
        "stage": "completed",
        "model": model,
        "cached": cached,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot_id": payload.get("snapshot_id"),
        "input_rows": input_rows if input_rows is not None else len(payload.get("rows") or []),
        "sent_rows": sent_contracts if sent_contracts is not None else min(len(payload.get("rows") or []), max_rows),
        "sent_cities": sent_cities,
        "sent_contracts": sent_contracts,
        "duration_ms": duration_ms,
        "timeout_sec": timeout_sec,
        "cache_ttl_sec": cache_ttl_sec,
        "provider": provider,
        "base_url": base_url,
        "summary_zh": ai_raw.get("summary_zh"),
        "summary_en": ai_raw.get("summary_en"),
        "city_forecasts": city_forecasts,
        "contract_notes": contract_notes,
        "city_theses": city_theses,
        "watchlist": watchlist,
        "recommended_count": sum(1 for row in rows if row.get("ai_rank") is not None),
        "vetoed_count": sum(1 for row in rows if row.get("ai_decision") == "veto"),
        "downgraded_count": sum(1 for row in rows if row.get("ai_decision") == "downgrade"),
        "watchlist_count": sum(1 for row in rows if row.get("ai_decision") == "watchlist"),
    }
    meta = ai_raw.get("_polyweather_meta")
    if isinstance(meta, dict):
        ai_scan["usage"] = meta.get("usage")
        ai_scan["finish_reason"] = meta.get("finish_reason")
    merged = {
        **payload,
        "rows": rows,
        "top_signal": top_signal,
        "ai_scan": ai_scan,
    }
    return merged
