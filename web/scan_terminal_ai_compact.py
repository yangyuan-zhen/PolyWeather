from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from web.scan_city_ai_helpers import _safe_float, _truncate_ai_text


def _compact_ai_candidate(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "action": row.get("action"),
        "side": row.get("side"),
        "target_label": row.get("target_label"),
        "target_value": row.get("target_value"),
        "target_threshold": row.get("target_threshold"),
        "target_unit": row.get("target_unit"),
        "market_probability": row.get("market_probability"),
        "market_event_probability": row.get("market_event_probability"),
        "yes_ask": row.get("yes_ask"),
        "no_ask": row.get("no_ask"),
        "ask": row.get("ask"),
        "spread": row.get("spread"),
        "quote_age_ms": row.get("quote_age_ms"),
        "cluster_role": row.get("cluster_role"),
        "model_cluster_sources": _compact_ai_model_sources(row),
        "metar_context": row.get("metar_context") or {},
        "window_phase": row.get("window_phase"),
        "peak_window_label": row.get("peak_window_label"),
        "minutes_until_peak_start": row.get("minutes_until_peak_start"),
        "minutes_until_peak_end": row.get("minutes_until_peak_end"),
        "trend_alignment": row.get("trend_alignment"),
        "tradable": row.get("tradable"),
        "accepting_orders": row.get("accepting_orders"),
    }


def _normalize_ai_city_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")


def _compact_ai_model_sources(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_sources = row.get("model_cluster_sources")
    if not isinstance(raw_sources, dict):
        return []
    sources: List[Dict[str, Any]] = []
    for name, value in raw_sources.items():
        if _safe_float(value) is None:
            continue
        sources.append({"model": str(name), "value": value})
    return sources[:12]


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
    return sorted_points[-max(1, int(limit)) :]


def _compact_ai_text(value: Any, limit: int = 700) -> Optional[str]:
    text = _truncate_ai_text(value, limit).strip()
    return text or None


def _compact_hourly_context(raw_hourly: Any) -> Dict[str, Any]:
    if not isinstance(raw_hourly, dict):
        return {}
    times = raw_hourly.get("times") or raw_hourly.get("time") or []
    temps = raw_hourly.get("temps") or raw_hourly.get("temperature_2m") or []
    radiation = raw_hourly.get("radiation") or raw_hourly.get("shortwave_radiation") or []
    if not isinstance(times, list) or not isinstance(temps, list):
        return {}

    points: List[Dict[str, Any]] = []
    for idx, raw_time in enumerate(times):
        temp = _safe_float(temps[idx] if idx < len(temps) else None)
        if temp is None:
            continue
        time_text = str(raw_time or "").strip()
        if "T" in time_text:
            time_text = time_text.split("T", 1)[1][:5]
        elif len(time_text) > 5:
            time_text = time_text[:5]
        point: Dict[str, Any] = {"time": time_text, "temp": temp}
        rad = _safe_float(radiation[idx] if isinstance(radiation, list) and idx < len(radiation) else None)
        if rad is not None:
            point["radiation"] = rad
        points.append(point)

    if not points:
        return {}
    max_point = max(points, key=lambda item: _safe_float(item.get("temp")) or -999.0)
    sample_indexes = {
        idx
        for idx in range(len(points))
        if idx % 2 == 0 or idx >= len(points) - 4 or points[idx] is max_point
    }
    samples = [points[idx] for idx in sorted(sample_indexes)][-14:]
    return {
        "sample_count": len(points),
        "forecast_hourly_max": max_point,
        "samples": samples,
    }


def _compact_taf_context(raw_taf_data: Any) -> Dict[str, Any]:
    if not isinstance(raw_taf_data, dict):
        return {}
    signal = raw_taf_data.get("signal") if isinstance(raw_taf_data.get("signal"), dict) else {}
    source = signal or raw_taf_data
    raw_taf = raw_taf_data.get("raw_taf") or source.get("raw_taf")
    compact: Dict[str, Any] = {
        "available": bool(source.get("available") or raw_taf),
        "raw_taf": _compact_ai_text(raw_taf, 900),
        "issue_time": raw_taf_data.get("issue_time") or source.get("issue_time"),
        "valid_time_from": raw_taf_data.get("valid_time_from") or source.get("valid_time_from"),
        "valid_time_to": raw_taf_data.get("valid_time_to") or source.get("valid_time_to"),
        "peak_window": source.get("peak_window"),
        "suppression_level": source.get("suppression_level"),
        "disruption_level": source.get("disruption_level"),
        "wind_shift": source.get("wind_shift"),
        "wind_regimes": source.get("wind_regimes"),
        "summary_zh": _compact_ai_text(source.get("summary_zh"), 260),
        "summary_en": _compact_ai_text(source.get("summary_en"), 260),
    }
    segments = source.get("segments") if isinstance(source.get("segments"), list) else []
    markers = source.get("markers") if isinstance(source.get("markers"), list) else []
    if segments:
        compact["segments"] = segments[:3]
    if markers:
        compact["markers"] = markers[:4]
    return {key: value for key, value in compact.items() if value not in (None, "", [])}


def _compact_vertical_context(raw_vertical: Any) -> Dict[str, Any]:
    if not isinstance(raw_vertical, dict):
        return {}
    keys = [
        "source",
        "window_start",
        "window_end",
        "suppression_risk",
        "trigger_risk",
        "mixing_strength",
        "shear_risk",
        "heating_setup",
        "heating_score",
        "summary_zh",
        "summary_en",
    ]
    compact: Dict[str, Any] = {}
    for key in keys:
        value = raw_vertical.get(key)
        if isinstance(value, str):
            value = _compact_ai_text(value, 280)
        if value not in (None, "", []):
            compact[key] = value
    return compact


def _compact_intraday_context(raw_intraday: Any) -> Dict[str, Any]:
    if not isinstance(raw_intraday, dict):
        return {}
    compact: Dict[str, Any] = {}
    for key in [
        "headline",
        "headline_en",
        "confidence",
        "base_case_bucket",
        "upside_bucket",
        "downside_bucket",
        "next_observation_time",
        "peak_window",
    ]:
        value = raw_intraday.get(key)
        if isinstance(value, str):
            value = _compact_ai_text(value, 220)
        if value not in (None, "", []):
            compact[key] = value
    signals = raw_intraday.get("signal_contributions")
    if isinstance(signals, list):
        compact["signal_contributions"] = [
            {
                "label": item.get("label"),
                "label_en": item.get("label_en"),
                "direction": item.get("direction"),
                "strength": item.get("strength"),
                "summary": _compact_ai_text(item.get("summary"), 180),
                "summary_en": _compact_ai_text(item.get("summary_en"), 180),
            }
            for item in signals[:4]
            if isinstance(item, dict)
        ]
    return compact


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


def _city_observation_anchor(data: Dict[str, Any]) -> Dict[str, Any]:
    current = data.get("current") if isinstance(data.get("current"), dict) else {}
    settlement_station = data.get("settlement_station") if isinstance(data.get("settlement_station"), dict) else {}
    airport_current = data.get("airport_current") if isinstance(data.get("airport_current"), dict) else {}
    risk = data.get("risk") if isinstance(data.get("risk"), dict) else {}
    source = str(
        current.get("settlement_source")
        or settlement_station.get("settlement_source")
        or "metar"
    ).strip().lower()
    is_hko = source == "hko"
    if is_hko:
        station_code = (
            current.get("station_code")
            or settlement_station.get("settlement_station_code")
            or "HKO"
        )
        station_label = (
            current.get("station_name")
            or settlement_station.get("settlement_station_label")
            or "Hong Kong Observatory"
        )
        return {
            "source": "hko",
            "source_label": "Hong Kong Observatory",
            "is_airport_metar": False,
            "station_code": station_code,
            "station_label": station_label,
            "read_label_zh": "香港天文台观测解读",
            "read_label_en": "Hong Kong Observatory observation read",
            "instruction_zh": (
                "该城市使用香港天文台/HKO 官方站点观测，提供温度、今日最高/最低温、相对湿度、"
                "10分钟平均风速和风向数据。它不是机场 METAR，不得使用 METAR、TAF、机场报文、报文时间等称谓，"
                "应使用「观测时间」「风速」「风向」「湿度」等官方气象站用语。"
                "观测解读必须具体说明：最新观测时间、温度、风向风速对升温路径的影响（增温/降温/中性）、"
                "湿度是否可能压制日间升温。涉及风时必须说明具体风向及来源（如「偏北风」「海风/陆风」）。"
                "如果有今日最高温和最低温数据，应结合判断温度走势。"
            ),
            "instruction_en": (
                "This city uses Hong Kong Observatory/HKO official station observations, providing temperature, "
                "today's high/low, relative humidity, 10-min mean wind speed and direction. "
                "It is NOT an airport METAR; do not use METAR, TAF, airport bulletin, or report time terminology. "
                "Use terms like observation time, wind speed, wind direction, humidity. "
                "The observation read must be specific: latest observation time, temperature, whether the wind "
                "direction tends to warm, cool or be neutral for today's high path and why, and whether humidity "
                "may suppress daytime heating. When mentioning wind, specify the direction and source "
                "(e.g. northerly, sea breeze/land breeze). If today's high/low are available, use them to assess the trend."
            ),
        }
    return {
        "source": "metar",
        "source_label": "METAR",
        "is_airport_metar": True,
        "station_code": risk.get("icao") or airport_current.get("station_code"),
        "station_label": risk.get("airport") or airport_current.get("station_label"),
        "read_label_zh": "机场报文解读",
        "read_label_en": "airport-bulletin read",
        "instruction_zh": "该城市使用机场 METAR/TAF 作为日内实况证据。",
        "instruction_en": "This city uses airport METAR/TAF as intraday observation evidence.",
    }


def _compact_ai_city_group(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    first = rows[0]
    return {
        "city": first.get("city"),
        "city_display_name": first.get("city_display_name") or first.get("display_name") or first.get("city"),
        "selected_date": first.get("selected_date") or first.get("local_date"),
        "local_time": first.get("local_time"),
        "temp_symbol": first.get("temp_symbol") or first.get("target_unit"),
        "current_temp": first.get("current_temp"),
        "current_max_so_far": first.get("current_max_so_far"),
        "window_phase": first.get("window_phase"),
        "remaining_window_minutes": first.get("remaining_window_minutes"),
        "peak_window_label": first.get("peak_window_label"),
        "minutes_until_peak_start": first.get("minutes_until_peak_start"),
        "minutes_until_peak_end": first.get("minutes_until_peak_end"),
        "metar_context": first.get("metar_context") or {},
        "model_cluster": {
            "core_low": first.get("cluster_core_low"),
            "core_high": first.get("cluster_core_high"),
            "median": first.get("cluster_median"),
            "deb_reference": first.get("cluster_deb_reference"),
            "model_count": first.get("cluster_model_count"),
            "sources": _compact_ai_model_sources(first),
        },
        "contracts": [_compact_ai_candidate(row) for row in rows],
    }


def build_scan_ai_prompt(payload: Dict[str, Any], *, max_rows: int) -> Dict[str, Any]:
    raw_rows = [
        row
        for row in (payload.get("rows") or [])[:max_rows]
        if isinstance(row, dict) and row.get("id")
    ]
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in raw_rows:
        key = "|".join(
            [
                _normalize_ai_city_key(row.get("city") or row.get("city_display_name")),
                str(row.get("selected_date") or row.get("local_date") or ""),
            ]
        )
        grouped.setdefault(key, []).append(row)
    cities = [_compact_ai_city_group(rows) for rows in grouped.values() if rows]
    sent_contracts = sum(len(city.get("contracts") or []) for city in cities)
    return {
        "schema_version": "city_forecast_v1",
        "snapshot_id": payload.get("snapshot_id"),
        "generated_at": payload.get("generated_at"),
        "summary": payload.get("summary") or {},
        "filters": payload.get("filters") or {},
        "city_count": len(cities),
        "candidate_row_count": len(raw_rows),
        "cities": cities,
        "_polyweather_input_meta": {
            "sent_cities": len(cities),
            "sent_contracts": sent_contracts,
        },
    }
