from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from web.core import CITIES
from web.analysis_service import _analyze, _build_city_market_scan_payload
from web.scan_city_ai_helpers import _safe_float
from web.scan_terminal_ai_compact import _build_metar_decision_context
from web.scan_terminal_filters import (
    market_region_from_tz_offset as _market_region_from_tz_offset,
    safe_int as _safe_int,
)


def _resolve_time_range_dates(data: Dict[str, Any], time_range: str) -> List[str]:
    local_date = str(data.get("local_date") or "").strip()
    multi_model_daily = data.get("multi_model_daily") or {}
    available_dates = sorted(
        str(date_key).strip()
        for date_key in (multi_model_daily.keys() if isinstance(multi_model_daily, dict) else [])
        if str(date_key).strip()
    )

    if not local_date:
        return available_dates[:1]
    if time_range == "today":
        return [local_date]

    try:
        local_dt = datetime.fromisoformat(local_date)
    except Exception:
        return available_dates[:7] if time_range == "week" else available_dates[:1]

    if time_range == "tomorrow":
        target = (local_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        if target in available_dates:
            return [target]
        future_dates = [date_key for date_key in available_dates if date_key > local_date]
        return future_dates[:1]

    if time_range == "week":
        target_dates = [date_key for date_key in available_dates if date_key >= local_date]
        if local_date not in target_dates:
            target_dates.insert(0, local_date)
        deduped: List[str] = []
        for date_key in target_dates:
            if date_key not in deduped:
                deduped.append(date_key)
            if len(deduped) >= 7:
                break
        return deduped

    return [local_date]


def _build_terminal_row(
    *,
    city: str,
    data: Dict[str, Any],
    scan: Dict[str, Any],
    row: Dict[str, Any],
) -> Dict[str, Any]:
    current = data.get("current") or {}
    multi_model_daily = data.get("multi_model_daily") or {}
    selected_date = str(row.get("selected_date") or scan.get("selected_date") or data.get("local_date") or "").strip()
    daily_entry = multi_model_daily.get(selected_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    display_name = str(data.get("display_name") or city).strip() or city
    market_slug = str(row.get("market_slug") or "").strip()
    side = str(row.get("side") or "").strip().lower()
    edge_percent = _safe_float(row.get("edge_percent"))
    final_score = _safe_float(row.get("final_score"))
    volume = _safe_float(row.get("volume")) or 0.0
    primary_signal = scan.get("primary_signal") or {}
    city_meta = CITIES.get(city) or {}
    tz_offset = _safe_int(city_meta.get("tz"), 0)
    market_region = _market_region_from_tz_offset(tz_offset)
    metar_context = _build_metar_decision_context(data)

    return {
        **row,
        "id": str(row.get("id") or f"{city}|{selected_date}|{market_slug}|{side}"),
        "city": city,
        "city_display_name": display_name,
        "trading_region": market_region["key"],
        "trading_region_label": market_region["label_en"],
        "trading_region_label_zh": market_region["label_zh"],
        "trading_region_sort": market_region.get("sort_order", 0),
        "tz_offset_seconds": tz_offset,
        "selected_date": selected_date or None,
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current_temp": current.get("temp"),
        "current_max_so_far": current.get("max_so_far"),
        "metar_context": metar_context,
        "metar_today_obs": metar_context.get("today_obs") or [],
        "metar_recent_obs": metar_context.get("recent_obs") or [],
        "settlement_today_obs": metar_context.get("settlement_today_obs") or [],
        "metar_status": {
            "available_for_today": metar_context.get("available_for_today"),
            "stale_for_today": metar_context.get("stale_for_today"),
            "last_observation_time": metar_context.get("last_observation_time"),
            "last_temp": metar_context.get("last_temp"),
        },
        "deb_prediction": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None)
        or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None),
        "display_name": display_name,
        "airport": ((data.get("risk") or {}).get("airport") if isinstance(data.get("risk"), dict) else None),
        "risk_level": ((data.get("risk") or {}).get("level") if isinstance(data.get("risk"), dict) else None),
        "distribution_bias": scan.get("distribution_bias"),
        "distribution_preview": scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "distribution_full": scan.get("distribution_full") or scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "model_cluster_sources": daily_entry.get("models") if isinstance(daily_entry.get("models"), dict) else data.get("multi_model"),
        "window_phase": row.get("window_phase") or scan.get("window_phase"),
        "window_score": row.get("window_score") if row.get("window_score") is not None else scan.get("window_score"),
        "signal_status": scan.get("signal_status"),
        "candidate_count": scan.get("candidate_count"),
        "resolved_market_type": scan.get("resolved_market_type") or "maxtemp",
        "market_key": f"{city}|{selected_date}|{market_slug}",
        "is_primary_signal": bool(primary_signal and primary_signal.get("id") == row.get("id")),
        "signal_confidence": final_score,
        "edge_percent": edge_percent,
        "final_score": final_score,
        "volume": volume,
        "amos": data.get("amos") or None,
        "top_buckets": scan.get("top_buckets") or [],
        "all_buckets": scan.get("all_buckets") or [],
    }


def _scan_city_terminal_rows(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    data = _analyze(
        city,
        force_refresh=force_refresh,
        include_llm_commentary=False,
        detail_mode="market",
    )
    target_dates = _resolve_time_range_dates(data, filters["time_range"])
    rows: List[Dict[str, Any]] = []
    primary_scores: List[float] = []
    candidate_total = 0

    for target_date in target_dates:
        payload = _build_city_market_scan_payload(
            data,
            market_slug=None,
            target_date=target_date,
            lite=True,
            scan_filters=filters,
        )
        scan = payload.get("market_scan") or {}
        candidate_total += int(scan.get("candidate_count") or 0)
        raw_rows = scan.get("scan_rows")
        if not isinstance(raw_rows, list) or not raw_rows:
            raw_rows = [scan.get("primary_signal")] if isinstance(scan.get("primary_signal"), dict) else []
        if not raw_rows:
            continue
        for raw_row in raw_rows:
            if not isinstance(raw_row, dict) or not raw_row:
                continue
            row = _build_terminal_row(
                city=city,
                data=data,
                scan=scan,
                row=raw_row,
            )
            rows.append(row)
            score = _safe_float(row.get("final_score"))
            if score is not None and row.get("is_primary_signal"):
                primary_scores.append(score)

    return {
        "city": city,
        "rows": rows,
        "candidate_total": candidate_total,
        "primary_scores": primary_scores,
    }
