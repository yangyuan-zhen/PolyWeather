from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from web.core import CITIES, _sf as _safe_float
from web.analysis_service import _analyze
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
        "wunderground_current": data.get("wunderground_current") or {},
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
        "probability_engine": scan.get("probability_engine") or (data.get("probabilities") or {}).get("engine"),
        "probability_calibration_mode": scan.get("probability_calibration_mode") or (data.get("probabilities") or {}).get("calibration_mode"),
        "model_cluster_sources": daily_entry.get("models") if isinstance(daily_entry.get("models"), dict) else data.get("multi_model", {}).get("forecasts"),
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
        "runway_plate_history": data.get("runway_plate_history") or {},
    }


def _scan_city_terminal_rows(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    return _scan_city_terminal_rows_quick(city, filters, force_refresh=force_refresh)


def _scan_city_terminal_rows_quick(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Fast path that returns cached analysis rows only — returns a single row per city
    with cached analysis data (Obs, DEB, probabilities) but no market prices."""
    data = _analyze(
        city,
        force_refresh=force_refresh,
        detail_mode="panel",
    )
    row = _build_quick_row(city=city, data=data)
    return {
        "city": city,
        "rows": [row] if row else [],
        "candidate_total": 1,
        "primary_scores": [float(row.get("final_score") or 0)] if row else [],
    }


def _build_quick_row(
    *,
    city: str,
    data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    curr = data.get("current") or {}
    risk = data.get("risk") or {}
    deb = data.get("deb") or {}
    probs = data.get("probabilities") or {}
    multi = data.get("multi_model") or {}
    distribution = probs.get("distribution") or []
    local_date = str(data.get("local_date") or "")
    local_time = str(data.get("local_time") or "")
    city_meta = CITIES.get(city) or {}
    tz_offset = data.get("utc_offset_seconds")
    if tz_offset is None:
        tz_offset = _safe_int(city_meta.get("tz"), 0)
    market_region = _market_region_from_tz_offset(tz_offset)

    multi_model_daily = data.get("multi_model_daily") or {}
    daily_entry = multi_model_daily.get(local_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    id_parts = [city, local_date or "today"]
    if data.get("temp_symbol") == "°F":
        id_parts.append("F")
    row_id = hashlib.sha256("|".join(id_parts).encode()).hexdigest()[:16]

    row: Dict[str, Any] = {
        "id": f"{city}:{local_date or 'today'}",
        "city": city,
        "city_display_name": str(data.get("display_name") or city),
        "airport": str(risk.get("airport") or ""),
        "local_date": local_date,
        "local_time": local_time,
        "tz_offset_seconds": tz_offset,
        "temp_symbol": data.get("temp_symbol"),
        "risk_level": risk.get("level"),
        "current_temp": curr.get("temp"),
        "current_max_so_far": curr.get("max_so_far"),
        "wunderground_current": data.get("wunderground_current") or {},
        "deb_prediction": deb.get("prediction"),
        "model_cluster_sources": (
            daily_entry.get("models")
            if isinstance(daily_entry.get("models"), dict)
            else {
                str(k): v for k, v in multi.get("forecasts", {}).items()
                if v is not None
            }
        ),
        "distribution_preview": distribution[:6] if distribution else [],
        "distribution_full": probs.get("distribution_all") or distribution,
        "probability_engine": probs.get("engine"),
        "probability_calibration_mode": probs.get("calibration_mode"),
        "trading_region": market_region["key"],
        "trading_region_label": market_region["label_en"],
        "trading_region_label_zh": market_region["label_zh"],
        "trading_region_sort": market_region.get("sort_order", 0),
        "active": True,
        "closed": False,
        "tradable": False,
        "is_primary_signal": True,
        "accepting_orders": False,
        "row_id": row_id,
        "runway_plate_history": data.get("runway_plate_history") or {},
    }
    # Compute a simple edge: model top probability vs neutral
    best_model_prob = max(
        (float(b.get("probability") or 0) for b in distribution[:6]),
        default=None,
    )
    row["model_probability"] = best_model_prob
    row["final_score"] = float(deb.get("prediction") or 0)
    return row


# ── METAR/observation context helpers (moved from deleted scan_terminal_ai_compact) ──


def _observation_sort_key(point: Dict[str, Any]) -> tuple[int, str]:
    raw_time = str(point.get("time") or "").strip()
    try:
        parsed = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
        return parsed.hour * 60 + parsed.minute, raw_time
    except Exception:
        pass
    match = re.search(r"(\d{1,2}):(\d{2})", raw_time)
    if match:
        hour = max(0, min(23, int(match.group(1))))
        minute = max(0, min(59, int(match.group(2))))
        return hour * 60 + minute, raw_time
    return 9999, raw_time


def _compact_observation_points(raw_points: Any, limit: int = 24) -> List[Dict[str, Any]]:
    if not isinstance(raw_points, list):
        return []
    points: List[Dict[str, Any]] = []
    for item in raw_points:
        if isinstance(item, dict):
            temp = _safe_float(item.get("temp"))
            time_value = str(item.get("time") or item.get("obs_time") or item.get("time_label") or "").strip()
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            time_value = str(item[0] or "").strip()
            temp = _safe_float(item[1])
        else:
            continue
        if temp is None or not time_value:
            continue
        points.append({"time": time_value, "temp": temp})
    sorted_points = sorted(points, key=_observation_sort_key)
    return sorted_points[-max(1, int(limit)):]


def _build_metar_decision_context(data: Dict[str, Any]) -> Dict[str, Any]:
    today_obs = _compact_observation_points(data.get("metar_today_obs"), 36)
    recent_obs = _compact_observation_points(data.get("metar_recent_obs"), 12)
    settlement_obs = _compact_observation_points(data.get("settlement_today_obs"), 36)
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    metar_status = data.get("metar_status") if isinstance(data.get("metar_status"), dict) else {}

    source_obs = today_obs or recent_obs or settlement_obs
    trend_source = recent_obs or source_obs[-4:]
    last_point = source_obs[-1] if source_obs else {}
    first_trend = trend_source[0] if trend_source else {}
    last_trend = trend_source[-1] if trend_source else {}
    max_point = None
    for point in source_obs:
        if max_point is None or float(point["temp"]) >= float(max_point["temp"]):
            max_point = point

    last_temp = _safe_float(last_point.get("temp"))
    first_temp = _safe_float(first_trend.get("temp"))
    trend_last_temp = _safe_float(last_trend.get("temp"))
    trend_delta = (
        trend_last_temp - first_temp
        if trend_last_temp is not None and first_temp is not None and len(trend_source) >= 2
        else None
    )
    station = data.get("risk") if isinstance(data.get("risk"), dict) else {}
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    settlement_station = data.get("settlement_station") if isinstance(data.get("settlement_station"), dict) else {}
    settlement_source = str(
        current.get("settlement_source")
        or settlement_station.get("settlement_source")
        or "metar"
    ).strip().lower()
    is_hko = settlement_source == "hko"
    source_label = "HKO" if is_hko else "METAR"
    return {
        "source": source_label,
        "is_airport_metar": not is_hko,
        "station": (
            current.get("station_code")
            or settlement_station.get("settlement_station_code")
            or station.get("icao")
            or airport_current.get("station_code")
        ),
        "station_label": (
            current.get("station_name")
            or settlement_station.get("settlement_station_label")
            or station.get("airport")
            or airport_current.get("station_label")
        ),
        "today_obs": today_obs[-12:],
        "recent_obs": recent_obs[-8:],
        "settlement_today_obs": settlement_obs[-12:],
        "obs_count": len(source_obs),
        "last_time": last_point.get("time"),
        "last_temp": last_temp,
        "max_temp": _safe_float((max_point or {}).get("temp")),
        "max_time": (max_point or {}).get("time"),
        "trend_delta": trend_delta,
        "stale_for_today": bool(metar_status.get("stale_for_today")),
        "available_for_today": bool(metar_status.get("available_for_today")),
        "last_observation_time": metar_status.get("last_observation_time"),
        "airport_current_temp": _safe_float(airport_current.get("temp")),
        "airport_max_so_far": _safe_float(airport_current.get("max_so_far")),
        "airport_obs_time": airport_current.get("obs_time"),
        "airport_report_time": airport_current.get("report_time"),
        "airport_raw_metar": airport_current.get("raw_metar"),
        "airport_wx_desc": airport_current.get("wx_desc"),
        "airport_cloud_desc": airport_current.get("cloud_desc"),
        "airport_visibility_mi": _safe_float(airport_current.get("visibility_mi")),
        "airport_wind_speed_kt": _safe_float(airport_current.get("wind_speed_kt")),
        "airport_wind_dir": _safe_float(airport_current.get("wind_dir")),
        "airport_humidity": _safe_float(airport_current.get("humidity")),
    }
