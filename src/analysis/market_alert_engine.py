"""
Rule-based weather alert engine for short-horizon trading signals.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _sf(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _to_unit_delta(celsius_delta: float, temp_symbol: str) -> float:
    if "F" in (temp_symbol or "").upper():
        return celsius_delta * 9.0 / 5.0
    return celsius_delta


def _minute_of_day(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm or ":" not in str(hhmm):
        return None
    try:
        hh, mm = str(hhmm).split(":")[:2]
        h = int(hh)
        m = int(mm)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return None
        return h * 60 + m
    except Exception:
        return None


def _minutes_delta(newer_hhmm: Optional[str], older_hhmm: Optional[str]) -> Optional[int]:
    newer = _minute_of_day(newer_hhmm)
    older = _minute_of_day(older_hhmm)
    if newer is None or older is None:
        return None
    d = newer - older
    if d <= 0:
        d += 24 * 60
    return d


def _angle_diff(a: float, b: float) -> float:
    d = abs((a - b) % 360.0)
    return min(d, 360.0 - d)


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lon = math.radians(lon2 - lon1)
    x = math.sin(d_lon) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360.0) % 360.0


def _is_southerly(wdir: Optional[float]) -> bool:
    if wdir is None:
        return False
    return 120.0 <= wdir <= 240.0


def _calc_momentum_alert(city_weather: Dict[str, Any], temp_symbol: str) -> Dict[str, Any]:
    recent = (city_weather.get("trend") or {}).get("recent") or []
    threshold_30m = _to_unit_delta(0.8, temp_symbol)

    if len(recent) < 2:
        return {
            "type": "momentum_spike",
            "triggered": False,
            "reason": "insufficient recent observations",
        }

    newest = recent[0]
    newest_temp = _sf(newest.get("temp"))
    newest_time = newest.get("time")
    if newest_temp is None:
        return {
            "type": "momentum_spike",
            "triggered": False,
            "reason": "latest observation missing temperature",
        }

    anchor = None
    anchor_dt = None
    for row in recent[1:]:
        dt = _minutes_delta(newest_time, row.get("time"))
        if dt is None:
            continue
        # Prefer a point close to 30 minutes.
        if 20 <= dt <= 45:
            anchor = row
            anchor_dt = dt
            break
        if anchor is None:
            anchor = row
            anchor_dt = dt

    if not anchor or not anchor_dt:
        return {
            "type": "momentum_spike",
            "triggered": False,
            "reason": "no usable time delta in recent observations",
        }

    anchor_temp = _sf(anchor.get("temp"))
    if anchor_temp is None:
        return {
            "type": "momentum_spike",
            "triggered": False,
            "reason": "anchor observation missing temperature",
        }

    delta_temp = newest_temp - anchor_temp
    slope_30m = delta_temp / anchor_dt * 30.0
    is_up = slope_30m > threshold_30m
    is_down = slope_30m < -threshold_30m

    return {
        "type": "momentum_spike",
        "triggered": bool(is_up or is_down),
        "direction": "up" if is_up else ("down" if is_down else "neutral"),
        "newest_temp": round(newest_temp, 2),
        "anchor_temp": round(anchor_temp, 2),
        "delta_temp": round(delta_temp, 2),
        "delta_minutes": anchor_dt,
        "slope_30m": round(slope_30m, 2),
        "threshold_30m": round(threshold_30m, 2),
    }


def _pick_model_value(multi_model: Dict[str, Any], model_name: str) -> Optional[float]:
    for k, v in (multi_model or {}).items():
        if str(k).strip().upper() == model_name.upper():
            return _sf(v)
    return None


def _calc_forecast_breakthrough_alert(city_weather: Dict[str, Any], temp_symbol: str) -> Dict[str, Any]:
    current_temp = _sf((city_weather.get("current") or {}).get("temp"))
    if current_temp is None:
        return {
            "type": "forecast_breakthrough",
            "triggered": False,
            "reason": "current temperature unavailable",
        }

    mm = city_weather.get("multi_model") or {}
    mgm_high = _pick_model_value(mm, "MGM")
    gfs_high = _pick_model_value(mm, "GFS")
    ecmwf_high = _pick_model_value(mm, "ECMWF")
    model_rows = [("MGM", mgm_high), ("GFS", gfs_high), ("ECMWF", ecmwf_high)]
    available = [(k, v) for k, v in model_rows if v is not None]

    if not available:
        return {
            "type": "forecast_breakthrough",
            "triggered": False,
            "reason": "MGM/GFS/ECMWF highs are unavailable",
        }

    baseline_name, baseline_val = max(available, key=lambda item: item[1])
    threshold = _to_unit_delta(0.2, temp_symbol)
    margin = current_temp - baseline_val
    triggered = margin > threshold and len(available) >= 2

    return {
        "type": "forecast_breakthrough",
        "triggered": triggered,
        "current_temp": round(current_temp, 2),
        "model_highs": {k: v for k, v in available},
        "baseline_model": baseline_name,
        "baseline_high": round(baseline_val, 2),
        "margin": round(margin, 2),
        "threshold": round(threshold, 2),
        "model_coverage": f"{len(available)}/3",
    }


def _pick_leading_station(city: str, nearby: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not nearby:
        return None
    city_l = (city or "").lower()

    def _temp(row: Dict[str, Any]) -> float:
        return _sf(row.get("temp")) or -999.0

    if city_l == "ankara":
        priority_rows = []
        for row in nearby:
            name = str(row.get("name") or "").lower()
            sid = str(row.get("istNo") or "").strip()
            if sid == "17130" or "center" in name or "bölge" in name or "etimesgut" in name:
                priority_rows.append(row)
        if priority_rows:
            return max(priority_rows, key=_temp)

    return max(nearby, key=_temp)


def _pick_ankara_center_station(nearby: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not nearby:
        return None

    def _temp(row: Dict[str, Any]) -> float:
        return _sf(row.get("temp")) or -999.0

    priority_rows = []
    for row in nearby:
        name = str(row.get("name") or "").lower()
        sid = str(row.get("istNo") or "").strip()
        if sid == "17130" or "center" in name or "b枚lge" in name or "etimesgut" in name:
            priority_rows.append(row)
    if priority_rows:
        return max(priority_rows, key=_temp)
    return None


def _calc_ankara_center_deb_alert(
    city_weather: Dict[str, Any],
    temp_symbol: str,
) -> Dict[str, Any]:
    city = (city_weather.get("name") or "").lower()
    if city != "ankara":
        return {
            "type": "ankara_center_deb_hit",
            "triggered": False,
            "reason": "city is not ankara",
        }

    deb_prediction = _sf((city_weather.get("deb") or {}).get("prediction"))
    if deb_prediction is None:
        return {
            "type": "ankara_center_deb_hit",
            "triggered": False,
            "reason": "deb prediction unavailable",
        }

    center_station = _pick_ankara_center_station(city_weather.get("mgm_nearby") or [])
    if not center_station:
        return {
            "type": "ankara_center_deb_hit",
            "triggered": False,
            "reason": "ankara center station unavailable",
        }

    center_temp = _sf(center_station.get("temp"))
    if center_temp is None:
        return {
            "type": "ankara_center_deb_hit",
            "triggered": False,
            "reason": "ankara center temperature unavailable",
        }

    airport_temp = _sf((city_weather.get("current") or {}).get("temp"))
    epsilon = _to_unit_delta(0.05, temp_symbol)
    triggered = center_temp + epsilon >= deb_prediction

    return {
        "type": "ankara_center_deb_hit",
        "triggered": triggered,
        "force_push": triggered,
        "center_station": {
            "name": center_station.get("name"),
            "istNo": center_station.get("istNo"),
            "temp": round(center_temp, 2),
        },
        "deb_prediction": round(deb_prediction, 2),
        "airport_temp": round(airport_temp, 2) if airport_temp is not None else None,
        "margin_vs_deb": round(center_temp - deb_prediction, 2),
        "center_lead_vs_airport": (
            round(center_temp - airport_temp, 2)
            if airport_temp is not None
            else None
        ),
    }


def _calc_advection_alert(city_weather: Dict[str, Any], temp_symbol: str) -> Dict[str, Any]:
    city = (city_weather.get("name") or "").lower()
    current = city_weather.get("current") or {}
    current_temp = _sf(current.get("temp"))
    wind_now = _sf(current.get("wind_dir"))
    wind_speed = _sf(current.get("wind_speed_kt"))

    if current_temp is None:
        return {
            "type": "advection",
            "triggered": False,
            "reason": "current temperature unavailable",
        }

    recent_obs = city_weather.get("metar_recent_obs") or []
    wind_prev = None
    for obs in recent_obs[1:]:
        w = _sf(obs.get("wdir"))
        if w is not None:
            wind_prev = w
            break

    nearby = city_weather.get("mgm_nearby") or []
    lead_station = _pick_leading_station(city, nearby)
    if not lead_station:
        return {
            "type": "advection",
            "triggered": False,
            "reason": "no nearby stations available",
        }

    lead_temp = _sf(lead_station.get("temp"))
    if lead_temp is None:
        return {
            "type": "advection",
            "triggered": False,
            "reason": "leading station temperature unavailable",
        }

    lead_delta = lead_temp - current_temp
    min_delta = _to_unit_delta(1.0, temp_symbol)
    if city == "ankara":
        # Ankara center station often leads airport by a bit less than 1C.
        min_delta = _to_unit_delta(0.8, temp_symbol)

    turned_southerly = _is_southerly(wind_now) and (wind_prev is not None and not _is_southerly(wind_prev))
    warm_flow_now = _is_southerly(wind_now) and (wind_speed is None or wind_speed >= 6.0)

    alignment = None
    aligned = True
    st_lat = _sf(lead_station.get("lat"))
    st_lon = _sf(lead_station.get("lon"))
    city_lat = _sf(city_weather.get("lat"))
    city_lon = _sf(city_weather.get("lon"))
    if all(v is not None for v in (st_lat, st_lon, city_lat, city_lon, wind_now)):
        station_to_city = _bearing_deg(st_lat, st_lon, city_lat, city_lon)
        wind_to_dir = (wind_now + 180.0) % 360.0  # meteorological wind_dir is "from"
        alignment = _angle_diff(station_to_city, wind_to_dir)
        aligned = alignment <= 70.0

    triggered = lead_delta >= min_delta and aligned and (turned_southerly or warm_flow_now)

    lead_minutes = None
    if triggered:
        if lead_delta >= _to_unit_delta(1.5, temp_symbol) and (alignment is None or alignment <= 45):
            lead_minutes = "20-30"
        else:
            lead_minutes = "20-40"

    return {
        "type": "advection",
        "triggered": triggered,
        "lead_station": {
            "name": lead_station.get("name"),
            "istNo": lead_station.get("istNo"),
            "temp": round(lead_temp, 2),
        },
        "lead_delta": round(lead_delta, 2),
        "threshold_delta": round(min_delta, 2),
        "wind_now": round(wind_now, 1) if wind_now is not None else None,
        "wind_prev": round(wind_prev, 1) if wind_prev is not None else None,
        "turned_southerly": turned_southerly,
        "wind_alignment_deg": round(alignment, 1) if alignment is not None else None,
        "lead_window_minutes": lead_minutes,
    }


def _calc_peak_passed_guard(city_weather: Dict[str, Any], temp_symbol: str) -> Dict[str, Any]:
    current = city_weather.get("current") or {}
    current_temp = _sf(current.get("temp"))
    max_so_far = _sf(current.get("max_so_far"))
    max_temp_time = current.get("max_temp_time")
    local_time = city_weather.get("local_time")

    if current_temp is None or max_so_far is None:
        return {"suppressed": False, "reason": "missing current/max_so_far"}

    local_min = _minute_of_day(local_time)
    peak_min = _minute_of_day(max_temp_time)
    if local_min is None or peak_min is None:
        return {"suppressed": False, "reason": "missing local_time/max_temp_time"}

    # Do not suppress in the morning; many cities still make their daily high later.
    if local_min < (14 * 60 + 30):
        return {"suppressed": False, "reason": "too early in local day"}

    if peak_min >= local_min:
        return {"suppressed": False, "reason": "peak has not passed yet"}

    minutes_since_peak = local_min - peak_min
    rollback = max_so_far - current_temp
    rollback_threshold = _to_unit_delta(0.8, temp_symbol)
    cooled_off = rollback >= rollback_threshold
    suppressed = minutes_since_peak >= 45 and cooled_off

    return {
        "suppressed": suppressed,
        "reason": "late-day peak already passed" if suppressed else "cool-off threshold not met",
        "current_temp": round(current_temp, 2),
        "max_so_far": round(max_so_far, 2),
        "max_temp_time": max_temp_time,
        "local_time": local_time,
        "minutes_since_peak": minutes_since_peak,
        "rollback": round(rollback, 2),
        "rollback_threshold": round(rollback_threshold, 2),
    }


def _join_trigger_types_cn(rules: Dict[str, Dict[str, Any]]) -> str:
    mapping = [
        ("ankara_center_deb_hit", "Center达到DEB"),
        ("momentum_spike", "动量突变"),
        ("forecast_breakthrough", "预测突破"),
        ("advection", "暖平流"),
    ]
    parts = [name for key, name in mapping if rules.get(key, {}).get("triggered")]
    return " + ".join(parts)


def _build_advice_cn(
    rules: Dict[str, Dict[str, Any]],
    temp_symbol: str,
    suppression: Optional[Dict[str, Any]] = None,
) -> str:
    if (suppression or {}).get("suppressed"):
        max_so_far = _sf((suppression or {}).get("max_so_far"))
        max_temp_time = (suppression or {}).get("max_temp_time")
        rollback = _sf((suppression or {}).get("rollback"))
        if max_so_far is not None and max_temp_time and rollback is not None:
            return (
                f"当地高温大概率已在 {max_temp_time} 前后兑现，"
                f"较日内高点 {max_so_far:.1f}{temp_symbol} 已回落 {rollback:.1f}{temp_symbol}，暂停主动推送。"
            )
        return "当地高温大概率已经兑现，当前进入回落阶段，暂停主动推送。"

    parts: List[str] = []
    center_deb = rules.get("ankara_center_deb_hit", {})
    advection = rules.get("advection", {})
    momentum = rules.get("momentum_spike", {})
    breakthrough = rules.get("forecast_breakthrough", {})

    if center_deb.get("triggered"):
        deb_prediction = _sf(center_deb.get("deb_prediction"))
        center_temp = _sf(((center_deb.get("center_station") or {}).get("temp")))
        if deb_prediction is not None and center_temp is not None:
            parts.append(
                f"Ankara Center {center_temp:.1f}{temp_symbol} 已触及 DEB {deb_prediction:.1f}{temp_symbol}"
            )
        else:
            parts.append("Ankara Center 已触及 DEB 预测值")
    if advection.get("triggered"):
        parts.append("风向转南，暖平流增强")
    if momentum.get("triggered"):
        d = _sf(momentum.get("slope_30m")) or 0.0
        if d > 0:
            parts.append("短时升温斜率过快")
        else:
            parts.append("短时降温斜率过快")
    if breakthrough.get("triggered"):
        parts.append("实测已击穿主流模型上沿")

    if not parts:
        return "当前未触发高优先级天气异动，继续观察实测与模型联动。"
    return "，".join(parts) + "。"


def _build_telegram_messages(
    city_weather: Dict[str, Any],
    rules: Dict[str, Dict[str, Any]],
    map_url: Optional[str],
    suppression: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    temp_symbol = city_weather.get("temp_symbol", "°C")
    city_name = city_weather.get("display_name") or city_weather.get("name", "").title()
    current_temp = _sf((city_weather.get("current") or {}).get("temp"))
    local_time = str(city_weather.get("local_time") or "").strip()
    obs_time = str(((city_weather.get("current") or {}).get("obs_time")) or "").strip()
    center_deb = rules.get("ankara_center_deb_hit", {})
    momentum = rules.get("momentum_spike", {})
    advection = rules.get("advection", {})

    if current_temp is None:
        return {"zh": "", "en": ""}

    suppressed = bool((suppression or {}).get("suppressed"))
    has_active_trigger = any(rule.get("triggered") for rule in rules.values())
    if suppressed:
        types_cn = "高温已过（暂停推送）"
    else:
        types_cn = _join_trigger_types_cn(rules) or "天气状态快照"
    delta_temp = _sf(momentum.get("delta_temp"))
    delta_min = momentum.get("delta_minutes")
    center_station = center_deb.get("center_station") or {}

    dyn = f"实测 {current_temp:.1f}{temp_symbol}"
    if delta_temp is not None and delta_min is not None:
        icon = "🚀" if delta_temp > 0 else ("🧊" if delta_temp < 0 else "➖")
        dyn += f" ({int(delta_min)}min 内 {delta_temp:+.1f}{temp_symbol}) {icon}"

    lead_line = ""
    if advection.get("triggered"):
        st_name = ((advection.get("lead_station") or {}).get("name")) or "nearby station"
        lead_delta = _sf(advection.get("lead_delta"))
        if lead_delta is not None:
            lead_line = f"联动：{st_name} 已领先 {lead_delta:+.1f}{temp_symbol}"

    center_deb_line = ""
    if center_deb.get("triggered"):
        center_name = center_station.get("name") or "Ankara Center"
        center_temp = _sf(center_station.get("temp"))
        deb_prediction = _sf(center_deb.get("deb_prediction"))
        airport_temp = _sf(center_deb.get("airport_temp"))
        lead_gap = _sf(center_deb.get("center_lead_vs_airport"))
        if center_temp is not None and deb_prediction is not None:
            center_deb_line = (
                f"Center信号：{center_name} {center_temp:.1f}{temp_symbol} 已达到 DEB {deb_prediction:.1f}{temp_symbol}"
            )
            if airport_temp is not None:
                center_deb_line += f" | 机场 {airport_temp:.1f}{temp_symbol}"
            if lead_gap is not None:
                center_deb_line += f" | 领先 {lead_gap:+.1f}{temp_symbol}"

    peak_line = ""
    if suppressed:
        max_so_far = _sf((suppression or {}).get("max_so_far"))
        max_temp_time = (suppression or {}).get("max_temp_time")
        rollback = _sf((suppression or {}).get("rollback"))
        if max_so_far is not None and max_temp_time and rollback is not None:
            peak_line = (
                f"高温状态：日内高点 {max_so_far:.1f}{temp_symbol} @ {max_temp_time}，"
                f"当前已回落 {rollback:.1f}{temp_symbol}"
            )

    advice = _build_advice_cn(rules, temp_symbol, suppression=suppression)
    final_map = map_url or "https://polyweather-pro.vercel.app/"
    title_zh = "🚨 PolyWeather 异动预警" if has_active_trigger else "📍 PolyWeather 状态快照"
    title_en = "🚨 PolyWeather Alert" if has_active_trigger else "📍 PolyWeather Status"

    lines_zh = [
        f"{title_zh} [{city_name}]",
        "",
        f"类型：{types_cn}",
        f"动态：{dyn}",
    ]
    if local_time or obs_time:
        if local_time and obs_time:
            lines_zh.append(f"时间：当地 {local_time} | 观测 {obs_time}")
        elif local_time:
            lines_zh.append(f"时间：当地 {local_time}")
        else:
            lines_zh.append(f"时间：观测 {obs_time}")
    if center_deb_line:
        lines_zh.append(center_deb_line)
    if peak_line:
        lines_zh.append(peak_line)
    if lead_line:
        lines_zh.append(lead_line)
    lines_zh.append(f"AI 建议：{advice}")
    lines_zh.append(f"点击查看实时地图：{final_map}")

    type_en = []
    if rules.get("ankara_center_deb_hit", {}).get("triggered"):
        type_en.append("Center Reached DEB")
    if rules.get("momentum_spike", {}).get("triggered"):
        type_en.append("Momentum Spike")
    if rules.get("forecast_breakthrough", {}).get("triggered"):
        type_en.append("Forecast Breakthrough")
    if rules.get("advection", {}).get("triggered"):
        type_en.append("Advection")
    type_en_str = "Peak Passed (suppressed)" if suppressed else (" + ".join(type_en) or "Weather snapshot")

    lines_en = [
        f"{title_en} [{city_name}]",
        "",
        f"Type: {type_en_str}",
        f"Now: {current_temp:.1f}{temp_symbol}",
    ]
    if local_time or obs_time:
        if local_time and obs_time:
            lines_en.append(f"Time: local {local_time} | observed {obs_time}")
        elif local_time:
            lines_en.append(f"Time: local {local_time}")
        else:
            lines_en.append(f"Time: observed {obs_time}")
    if center_deb_line:
        center_temp = _sf(center_station.get("temp"))
        deb_prediction = _sf(center_deb.get("deb_prediction"))
        if center_temp is not None and deb_prediction is not None:
            lines_en.append(
                f"Center signal: {center_temp:.1f}{temp_symbol} has reached DEB {deb_prediction:.1f}{temp_symbol}"
            )
    if peak_line:
        max_so_far = _sf((suppression or {}).get("max_so_far"))
        max_temp_time = (suppression or {}).get("max_temp_time")
        rollback = _sf((suppression or {}).get("rollback"))
        if max_so_far is not None and max_temp_time and rollback is not None:
            lines_en.append(
                f"Peak state: intraday high {max_so_far:.1f}{temp_symbol} at {max_temp_time}, "
                f"now off by {rollback:.1f}{temp_symbol}"
            )
    lines_en.append(f"Action: {advice}")
    lines_en.append(f"Map: {final_map}")

    return {"zh": "\n".join(lines_zh), "en": "\n".join(lines_en)}


def build_trading_alerts(
    city_weather: Dict[str, Any],
    map_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build weather-driven trading alerts for paid Telegram delivery and web usage.
    """
    temp_symbol = city_weather.get("temp_symbol", "°C")
    city = city_weather.get("name", "")
    now = datetime.now(timezone.utc).isoformat()

    rules: Dict[str, Dict[str, Any]] = {
        "ankara_center_deb_hit": _calc_ankara_center_deb_alert(city_weather, temp_symbol),
        "momentum_spike": _calc_momentum_alert(city_weather, temp_symbol),
        "forecast_breakthrough": _calc_forecast_breakthrough_alert(city_weather, temp_symbol),
        "advection": _calc_advection_alert(city_weather, temp_symbol),
    }

    triggered = [
        {
            "type": key,
            **value,
        }
        for key, value in rules.items()
        if value.get("triggered")
    ]
    suppression = _calc_peak_passed_guard(city_weather, temp_symbol)
    if suppression.get("suppressed") and triggered:
        suppression["raw_trigger_types"] = [alert.get("type") for alert in triggered if alert.get("type")]
        for alert in triggered:
            rule = rules.get(alert.get("type") or "")
            if not rule:
                continue
            rule["raw_triggered"] = True
            rule["triggered"] = False
            rule["suppressed"] = True
            rule["suppression_reason"] = suppression.get("reason")
        triggered = []
        force_push = False
        severity = "none"
    else:
        force_push = any(alert.get("force_push") for alert in triggered)
        severity = "high" if len(triggered) >= 2 else ("medium" if len(triggered) == 1 else "none")
        if force_push and severity == "none":
            severity = "medium"

    telegram = _build_telegram_messages(
        city_weather=city_weather,
        rules=rules,
        map_url=map_url,
        suppression=suppression,
    )

    return {
        "city": city,
        "generated_at": now,
        "temp_symbol": temp_symbol,
        "severity": severity,
        "trigger_count": len(triggered),
        "rules": rules,
        "suppression": suppression,
        "triggered_alerts": triggered,
        "telegram": telegram,
    }


