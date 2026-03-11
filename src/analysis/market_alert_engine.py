"""
Rule-based weather alert engine for short-horizon trading signals.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from src.analysis.settlement_rounding import wu_round


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

    for row in nearby:
        name = str(row.get("name") or "").strip().lower()
        sid = str(row.get("istNo") or "").strip()
        if sid == "17130":
            return row
        if name in {"ankara (bölge/center)", "ankara (bolge/center)"}:
            return row
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


def _norm_probability(v: Any) -> Optional[float]:
    n = _sf(v)
    if n is None:
        return None
    if n > 1.0:
        n = n / 100.0
    return max(0.0, min(1.0, n))


def _fmt_percent(v: Any) -> str:
    n = _norm_probability(v)
    if n is None:
        return "--"
    return f"{n * 100:.1f}%"


def _fmt_cents(v: Any) -> str:
    n = _norm_probability(v)
    if n is None:
        return "--"
    cents = n * 100.0
    return f"{cents:.1f}c"


def _bucket_label(bucket: Any) -> Optional[str]:
    if not isinstance(bucket, dict):
        return None
    direct = (
        str(bucket.get("label") or "").strip()
        or str(bucket.get("bucket") or "").strip()
        or str(bucket.get("range") or "").strip()
    )
    if direct:
        normalized = re.sub(
            r"(?<!°)(-?\d+(?:\.\d+)?)\s*C(\+)?",
            r"\1°C\2",
            direct,
            flags=re.IGNORECASE,
        )
        return normalized
    value = _sf(bucket.get("value"))
    if value is not None:
        return f"{round(value)}°C"
    temp = _sf(bucket.get("temp"))
    if temp is not None:
        return f"{round(temp)}°C"
    return None


def _row_yes_buy_prob(row: Dict[str, Any]) -> Optional[float]:
    if not isinstance(row, dict):
        return None
    return _norm_probability(row.get("yes_buy"))


def _has_actionable_yes_buy_quote(row: Dict[str, Any]) -> bool:
    quote = _row_yes_buy_prob(row)
    # 0 usually means no actionable orderbook bid, not a tradable quote.
    return quote is not None and quote > 0.0


def _to_celsius(temp: Optional[float], temp_symbol: str) -> Optional[float]:
    if temp is None:
        return None
    if "F" in (temp_symbol or "").upper():
        return (temp - 32.0) * 5.0 / 9.0
    return temp


def _extract_open_meteo_today_high_c(city_weather: Dict[str, Any]) -> Optional[float]:
    forecast = city_weather.get("forecast") or {}
    om_today = _sf(forecast.get("today_high"))

    if om_today is None:
        om = city_weather.get("open-meteo") or {}
        daily = om.get("daily") or {}
        series = daily.get("temperature_2m_max") or []
        if isinstance(series, list) and series:
            om_today = _sf(series[0])

    if om_today is None:
        return None

    temp_symbol = str(city_weather.get("temp_symbol") or "")
    return _to_celsius(om_today, temp_symbol)


def _bucket_value(row: Dict[str, Any]) -> Optional[float]:
    for key in ("value", "temp"):
        value = _sf(row.get(key))
        if value is not None:
            return value

    label = str(row.get("label") or "").strip()
    m = re.search(r"(-?\d+(?:\.\d+)?)", label)
    if not m:
        return None
    return _sf(m.group(1))


def _bucket_bounds(row: Dict[str, Any]) -> Optional[Tuple[Optional[float], Optional[float]]]:
    value = _bucket_value(row)
    if value is None:
        return None

    label = str(row.get("label") or "").lower()
    is_upper_tail = any(key in label for key in ("+", "or higher", "or above", "and above"))
    is_lower_tail = any(key in label for key in ("<=", "or lower", "or below", "and below"))

    if is_upper_tail and not is_lower_tail:
        return value, None
    if is_lower_tail and not is_upper_tail:
        return None, value
    return value, value


def _distance_to_bucket(target: float, bounds: Tuple[Optional[float], Optional[float]]) -> float:
    lower, upper = bounds
    if lower is not None and target < lower:
        return lower - target
    if upper is not None and target > upper:
        return target - upper
    return 0.0


def _pick_bucket_for_forecast(
    rows: List[Dict[str, Any]],
    forecast_settlement: Optional[int],
    forecast_today_high_c: Optional[float],
) -> Optional[Dict[str, Any]]:
    if not rows:
        return None

    target = (
        float(forecast_settlement)
        if forecast_settlement is not None
        else forecast_today_high_c
    )
    if target is None:
        return None

    best_row: Optional[Dict[str, Any]] = None
    best_distance: Optional[float] = None
    best_has_quote = False
    best_probability = -1.0
    best_rank = 10**9

    for idx, row in enumerate(rows):
        bounds = _bucket_bounds(row)
        if not bounds:
            continue

        distance = _distance_to_bucket(target, bounds)
        has_quote = _has_actionable_yes_buy_quote(row)
        probability = _norm_probability(row.get("probability"))
        probability_rank = probability if probability is not None else -1.0

        if best_row is None:
            best_row = row
            best_distance = distance
            best_has_quote = has_quote
            best_probability = probability_rank
            best_rank = idx
            continue

        assert best_distance is not None
        if distance < best_distance:
            best_row = row
            best_distance = distance
            best_has_quote = has_quote
            best_probability = probability_rank
            best_rank = idx
            continue

        if abs(distance - best_distance) <= 1e-9:
            if has_quote and not best_has_quote:
                best_row = row
                best_distance = distance
                best_has_quote = has_quote
                best_probability = probability_rank
                best_rank = idx
            elif has_quote == best_has_quote and probability_rank > best_probability:
                best_row = row
                best_distance = distance
                best_has_quote = has_quote
                best_probability = probability_rank
                best_rank = idx
            elif (
                has_quote == best_has_quote
                and abs(probability_rank - best_probability) <= 1e-9
                and idx < best_rank
            ):
                best_row = row
                best_distance = distance
                best_has_quote = has_quote
                best_probability = probability_rank
                best_rank = idx

    return best_row


def _extract_market_snapshot(city_weather: Dict[str, Any]) -> Dict[str, Any]:
    scan = city_weather.get("market_scan") or {}
    if not isinstance(scan, dict):
        return {"available": False}
    if not scan.get("available"):
        return {"available": False}

    yes_buy = _norm_probability(scan.get("yes_buy"))
    yes_sell = _norm_probability(scan.get("yes_sell"))
    market_prob = _norm_probability(
        scan.get("market_price")
        or ((scan.get("yes_token") or {}).get("implied_probability"))
    )
    model_prob = _norm_probability(scan.get("model_probability"))
    spread = None
    if yes_buy is not None and yes_sell is not None:
        spread = abs(yes_sell - yes_buy)

    top_bucket = None
    top_bucket_rows: List[Dict[str, Any]] = []
    all_bucket_rows: List[Dict[str, Any]] = []
    source_buckets = scan.get("all_buckets")
    if not isinstance(source_buckets, list) or not source_buckets:
        source_buckets = scan.get("top_buckets") or []

    if isinstance(source_buckets, list):
        normalized = []
        for row in source_buckets:
            if not isinstance(row, dict):
                continue
            p = _norm_probability(row.get("probability"))
            if p is None:
                continue
            normalized.append((p, row))
        if normalized:
            normalized.sort(key=lambda x: x[0], reverse=True)
            top_bucket = normalized[0][1]
            for p, row in normalized:
                row_slug = str(row.get("slug") or "").strip()
                row_market_url = f"https://polymarket.com/market/{row_slug}" if row_slug else None
                all_bucket_rows.append(
                    {
                        "label": _bucket_label(row),
                        "probability": p,
                        "yes_buy": _norm_probability(row.get("yes_buy")),
                        "yes_sell": _norm_probability(row.get("yes_sell")),
                        "value": _sf(row.get("value") or row.get("temp")),
                        "slug": row_slug or None,
                        "market_url": row_market_url,
                    }
                )
            top_bucket_rows = all_bucket_rows[:4]

    market_url = None
    websocket = scan.get("websocket") or {}
    if isinstance(websocket, dict):
        market_url = str(websocket.get("market_url") or "").strip() or None
    if not market_url:
        primary_market = scan.get("primary_market") or {}
        if isinstance(primary_market, dict):
            slug = str(primary_market.get("slug") or "").strip()
            if slug:
                market_url = f"https://polymarket.com/market/{slug}"

    open_meteo_today_high_c = _extract_open_meteo_today_high_c(city_weather)
    open_meteo_settlement = wu_round(open_meteo_today_high_c)
    forecast_bucket = _pick_bucket_for_forecast(
        rows=all_bucket_rows,
        forecast_settlement=open_meteo_settlement,
        forecast_today_high_c=open_meteo_today_high_c,
    )
    forecast_market_url = None
    if isinstance(forecast_bucket, dict):
        forecast_market_url = str(forecast_bucket.get("market_url") or "").strip() or None

    return {
        "available": True,
        "selected_bucket": _bucket_label(scan.get("temperature_bucket")),
        "top_bucket": _bucket_label(top_bucket) if isinstance(top_bucket, dict) else None,
        "top_bucket_prob": _norm_probability(
            top_bucket.get("probability") if isinstance(top_bucket, dict) else None
        ),
        "market_prob": market_prob,
        "model_prob": model_prob,
        "yes_buy": yes_buy,
        "yes_sell": yes_sell,
        "spread": spread,
        "edge_percent": _sf(scan.get("edge_percent")),
        "signal_label": scan.get("signal_label"),
        "confidence": scan.get("confidence"),
        "top_bucket_rows": top_bucket_rows,
        "all_bucket_rows": all_bucket_rows,
        "open_meteo_today_high_c": open_meteo_today_high_c,
        "open_meteo_settlement": open_meteo_settlement,
        "forecast_bucket": forecast_bucket,
        "primary_market_url": market_url,
        "market_url": forecast_market_url or market_url,
    }


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
    market_snapshot: Optional[Dict[str, Any]] = None,
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
    market_snapshot = market_snapshot or _extract_market_snapshot(city_weather)

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
    if market_snapshot.get("available") and market_snapshot.get("top_bucket_rows"):
        lines_zh.append("市场结算概率分布（Top4）：")
        for row in (market_snapshot.get("top_bucket_rows") or [])[:4]:
            label = row.get("label") or "--"
            prob_text = _fmt_percent(row.get("probability"))
            yes_buy_text = _fmt_cents(row.get("yes_buy"))
            lines_zh.append(f"{label} {prob_text} | Yes: {yes_buy_text}")
    if market_snapshot.get("available") and not market_snapshot.get("top_bucket_rows"):
        market_edge = _sf(market_snapshot.get("edge_percent"))
        market_edge_text = f"{market_edge:+.1f}%" if market_edge is not None else "--"
        lines_zh.append(
            "市场联动：同桶 "
            f"模型 {_fmt_percent(market_snapshot.get('model_prob'))} vs "
            f"市场 {_fmt_percent(market_snapshot.get('market_prob'))} | "
            f"Yes {_fmt_cents(market_snapshot.get('yes_buy'))}/{_fmt_cents(market_snapshot.get('yes_sell'))} | "
            f"点差 {_fmt_cents(market_snapshot.get('spread'))} | "
            f"偏差 {market_edge_text} | "
            f"信号 {market_snapshot.get('signal_label') or '--'}/{market_snapshot.get('confidence') or '--'}"
        )
        if market_snapshot.get("top_bucket"):
            lines_zh.append(
                f"市场最热桶：{market_snapshot.get('top_bucket')} "
                f"({_fmt_percent(market_snapshot.get('top_bucket_prob'))})"
            )
    if market_snapshot.get("market_url"):
        lines_zh.append(f"市场链接：{market_snapshot.get('market_url')}")
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
    if market_snapshot.get("available") and market_snapshot.get("top_bucket_rows"):
        lines_en.append("Settlement distribution (Top4):")
        for row in (market_snapshot.get("top_bucket_rows") or [])[:4]:
            label = row.get("label") or "--"
            prob_text = _fmt_percent(row.get("probability"))
            yes_buy_text = _fmt_cents(row.get("yes_buy"))
            lines_en.append(f"{label} {prob_text} | Yes: {yes_buy_text}")
    if market_snapshot.get("available") and not market_snapshot.get("top_bucket_rows"):
        market_edge = _sf(market_snapshot.get("edge_percent"))
        market_edge_text = f"{market_edge:+.1f}%" if market_edge is not None else "--"
        lines_en.append(
            "Market: same-bucket "
            f"model {_fmt_percent(market_snapshot.get('model_prob'))} vs "
            f"market {_fmt_percent(market_snapshot.get('market_prob'))} | "
            f"Yes {_fmt_cents(market_snapshot.get('yes_buy'))}/{_fmt_cents(market_snapshot.get('yes_sell'))} | "
            f"spread {_fmt_cents(market_snapshot.get('spread'))} | "
            f"edge {market_edge_text} | "
            f"signal {market_snapshot.get('signal_label') or '--'}/{market_snapshot.get('confidence') or '--'}"
        )
        if market_snapshot.get("top_bucket"):
            lines_en.append(
                f"Top market bucket: {market_snapshot.get('top_bucket')} "
                f"({_fmt_percent(market_snapshot.get('top_bucket_prob'))})"
            )
    if market_snapshot.get("market_url"):
        lines_en.append(f"Market link: {market_snapshot.get('market_url')}")
    lines_en.append(f"Action: {advice}")
    lines_en.append(f"Map: {final_map}")

    return {"zh": "\n".join(lines_zh), "en": "\n".join(lines_en)}


def _build_telegram_messages_mispricing(
    city_weather: Dict[str, Any],
    rules: Dict[str, Dict[str, Any]],
    market_snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    temp_symbol = str(city_weather.get("temp_symbol") or "°C")
    city_name = city_weather.get("display_name") or city_weather.get("name", "").title()
    current = city_weather.get("current") or {}
    current_temp = _sf(current.get("temp"))
    if current_temp is None:
        return {"zh": "", "en": ""}

    snapshot = market_snapshot or _extract_market_snapshot(city_weather)
    momentum = rules.get("momentum_spike", {})
    local_time = str(city_weather.get("local_time") or "").strip()
    obs_time = str(current.get("obs_time") or "").strip()

    delta_temp = _sf(momentum.get("delta_temp"))
    delta_min = momentum.get("delta_minutes")
    momentum_emoji = "➡️"
    if delta_temp is not None:
        momentum_emoji = "🚀" if delta_temp > 0 else ("📉" if delta_temp < 0 else "➡️")

    dynamic_text = f"实测 {current_temp:.1f}{temp_symbol}"
    if delta_temp is not None and delta_min is not None:
        dynamic_text = (
            f"实测 {current_temp:.1f}{temp_symbol} "
            f"({int(delta_min)}min 内 {delta_temp:+.1f}{temp_symbol}) {momentum_emoji}"
        )

    om_high_c = _sf(snapshot.get("open_meteo_today_high_c"))
    om_settle = snapshot.get("open_meteo_settlement")
    forecast_bucket = snapshot.get("forecast_bucket") or {}
    match_bucket_label = str(forecast_bucket.get("label") or "--").strip() or "--"
    match_bucket_yes_prob = _norm_probability(forecast_bucket.get("yes_buy"))
    match_bucket_yes = (
        _fmt_cents(match_bucket_yes_prob)
        if match_bucket_yes_prob is not None and match_bucket_yes_prob > 0.0
        else "--"
    )
    market_url = str(
        snapshot.get("market_url")
        or snapshot.get("primary_market_url")
        or ""
    ).strip()

    lines_zh = [f"🚨 PolyWeather 错价雷达 [{city_name}]"]
    lines_zh.append("")
    if om_high_c is not None and om_settle is not None:
        lines_zh.append(
            f"基准：Open-Meteo 今日高温 {om_high_c:.1f}C（结算参考 {om_settle}C）"
        )
    else:
        lines_zh.append("基准：Open-Meteo 今日高温 --（结算参考 --）")
    lines_zh.append(f"命中桶：{match_bucket_label} | Yes: {match_bucket_yes}")
    lines_zh.append("触发：该桶 Yes 价格 < 10c，疑似低估")
    lines_zh.append("")
    lines_zh.append(f"动态：{dynamic_text}")
    if local_time or obs_time:
        if local_time and obs_time:
            lines_zh.append(f"时间：当地 {local_time} | 观测 {obs_time}")
        elif local_time:
            lines_zh.append(f"时间：当地 {local_time}")
        else:
            lines_zh.append(f"时间：观测 {obs_time}")
    lines_zh.append("")
    if market_url:
        lines_zh.append(f"市场链接：{market_url}")

    lines_en = [
        f"🚨 PolyWeather Mispricing Radar [{city_name}]",
        "",
        f"Now: {dynamic_text}",
    ]
    if market_url:
        lines_en.append(f"Market link: {market_url}")

    return {"zh": "\n".join(lines_zh), "en": "\n".join(lines_en)}


def _select_rule_evidence(rule: Dict[str, Any], keys: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in keys:
        if key in rule:
            out[key] = rule.get(key)
    return out


def _build_alert_evidence(
    city_weather: Dict[str, Any],
    rules: Dict[str, Dict[str, Any]],
    triggered: List[Dict[str, Any]],
    suppression: Dict[str, Any],
    market_snapshot: Dict[str, Any],
    temp_symbol: str,
) -> Dict[str, Any]:
    current = city_weather.get("current") or {}
    deb = city_weather.get("deb") or {}

    momentum = rules.get("momentum_spike") or {}
    breakthrough = rules.get("forecast_breakthrough") or {}
    advection = rules.get("advection") or {}
    ankara_center = rules.get("ankara_center_deb_hit") or {}

    top_rows = []
    for row in (market_snapshot.get("top_bucket_rows") or [])[:4]:
        if not isinstance(row, dict):
            continue
        top_rows.append(
            {
                "label": row.get("label"),
                "probability": row.get("probability"),
                "yes_buy": row.get("yes_buy"),
                "yes_sell": row.get("yes_sell"),
                "market_url": row.get("market_url"),
            }
        )

    trigger_types = [row.get("type") for row in triggered if row.get("type")]
    forecast_bucket = market_snapshot.get("forecast_bucket") or {}

    return {
        "version": 1,
        "city": city_weather.get("name"),
        "generated_local_time": city_weather.get("local_time"),
        "observed_at": current.get("obs_time"),
        "temp_symbol": temp_symbol,
        "inputs": {
            "current_temp": _sf(current.get("temp")),
            "deb_prediction": _sf(deb.get("prediction")),
            "wu_settle": current.get("wu_settle"),
            "obs_age_min": current.get("obs_age_min"),
        },
        "trigger_summary": {
            "trigger_count": len(trigger_types),
            "trigger_types": trigger_types,
            "suppressed": bool(suppression.get("suppressed")),
            "suppression_reason": suppression.get("reason"),
            "suppression_snapshot": _select_rule_evidence(
                suppression,
                [
                    "minutes_since_peak",
                    "rollback",
                    "rollback_threshold",
                    "max_temp_time",
                    "max_so_far",
                    "current_temp",
                ],
            ),
        },
        "rules": {
            "momentum_spike": _select_rule_evidence(
                momentum,
                [
                    "triggered",
                    "direction",
                    "delta_temp",
                    "delta_minutes",
                    "slope_30m",
                    "threshold_30m",
                ],
            ),
            "forecast_breakthrough": _select_rule_evidence(
                breakthrough,
                [
                    "triggered",
                    "baseline_model",
                    "baseline_high",
                    "current_temp",
                    "margin",
                    "threshold",
                    "model_coverage",
                ],
            ),
            "advection": _select_rule_evidence(
                advection,
                [
                    "triggered",
                    "lead_delta",
                    "threshold_delta",
                    "wind_now",
                    "wind_prev",
                    "turned_southerly",
                    "wind_alignment_deg",
                    "lead_window_minutes",
                ],
            ),
            "ankara_center_deb_hit": _select_rule_evidence(
                ankara_center,
                [
                    "triggered",
                    "deb_prediction",
                    "airport_temp",
                    "margin_vs_deb",
                    "center_lead_vs_airport",
                ],
            ),
        },
        "market": {
            "available": bool(market_snapshot.get("available")),
            "market_prob": market_snapshot.get("market_prob"),
            "model_prob": market_snapshot.get("model_prob"),
            "edge_percent": market_snapshot.get("edge_percent"),
            "yes_buy": market_snapshot.get("yes_buy"),
            "yes_sell": market_snapshot.get("yes_sell"),
            "spread": market_snapshot.get("spread"),
            "signal_label": market_snapshot.get("signal_label"),
            "confidence": market_snapshot.get("confidence"),
            "top_bucket": market_snapshot.get("top_bucket"),
            "top_bucket_prob": market_snapshot.get("top_bucket_prob"),
            "open_meteo_today_high_c": market_snapshot.get("open_meteo_today_high_c"),
            "open_meteo_settlement": market_snapshot.get("open_meteo_settlement"),
            "forecast_bucket": {
                "label": forecast_bucket.get("label"),
                "probability": forecast_bucket.get("probability"),
                "yes_buy": forecast_bucket.get("yes_buy"),
                "yes_sell": forecast_bucket.get("yes_sell"),
                "market_url": forecast_bucket.get("market_url"),
            }
            if isinstance(forecast_bucket, dict)
            else None,
            "top4": top_rows,
            "market_url": market_snapshot.get("market_url"),
            "primary_market_url": market_snapshot.get("primary_market_url"),
        },
    }


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
    market_snapshot = _extract_market_snapshot(city_weather)

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

    telegram = _build_telegram_messages_mispricing(
        city_weather=city_weather,
        rules=rules,
        market_snapshot=market_snapshot,
    )
    evidence = _build_alert_evidence(
        city_weather=city_weather,
        rules=rules,
        triggered=triggered,
        suppression=suppression,
        market_snapshot=market_snapshot,
        temp_symbol=temp_symbol,
    )

    return {
        "city": city,
        "generated_at": now,
        "temp_symbol": temp_symbol,
        "severity": severity,
        "trigger_count": len(triggered),
        "rules": rules,
        "market_snapshot": market_snapshot,
        "suppression": suppression,
        "triggered_alerts": triggered,
        "evidence": evidence,
        "telegram": telegram,
    }


