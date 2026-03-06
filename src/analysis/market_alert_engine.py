"""
Rule-based weather/market alert engine for short-horizon Polymarket trading.
"""

from __future__ import annotations

import math
import re
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


def _convert_temp(value: float, from_unit: Optional[str], temp_symbol: str) -> float:
    from_u = (from_unit or "").upper()
    to_f = "F" in (temp_symbol or "").upper()
    if from_u == "F" and not to_f:
        return (value - 32.0) * 5.0 / 9.0
    if from_u == "C" and to_f:
        return (value * 9.0 / 5.0) + 32.0
    return value


def _extract_numbers(text: str) -> List[float]:
    out: List[float] = []
    for m in re.finditer(r"-?\d+(?:\.\d+)?", text or ""):
        try:
            out.append(float(m.group(0)))
        except Exception:
            continue
    return out


def _extract_market_strikes(
    market_snapshot: Dict[str, Any],
    temp_symbol: str,
) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for market in market_snapshot.get("markets", []) or []:
        m_question = market.get("question") or ""
        m_id = market.get("id")

        threshold = _sf(market.get("threshold"))
        threshold_unit = market.get("threshold_unit")
        if threshold is not None:
            candidates.append(
                {
                    "strike": _convert_temp(threshold, threshold_unit, temp_symbol),
                    "source": "market_threshold",
                    "market_id": m_id,
                    "question": m_question,
                }
            )

        for outcome in market.get("outcomes", []) or []:
            name = str(outcome.get("name") or "")
            name_l = name.lower()
            if name_l in ("yes", "no"):
                continue
            if not any(tok in name_l for tok in ("-", "to", "below", "under", "above", "over", "deg", "f", "c")):
                continue
            vals = [v for v in _extract_numbers(name) if -80 <= v <= 160]
            for v in vals:
                candidates.append(
                    {
                        "strike": _convert_temp(v, threshold_unit, temp_symbol),
                        "source": "outcome_number",
                        "market_id": m_id,
                        "question": m_question,
                    }
                )
    return candidates


def _find_market_by_id(markets: List[Dict[str, Any]], market_id: Any) -> Optional[Dict[str, Any]]:
    for m in markets:
        if str(m.get("id")) == str(market_id):
            return m
    return None


def _extract_market_prices(target_market: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    prices: Dict[str, Any] = {
        "question": None,
        "yes_buy": None,
        "yes_sell": None,
        "yes_last": None,
        "no_buy": None,
        "no_sell": None,
        "no_last": None,
    }
    if not target_market:
        return prices

    prices["question"] = target_market.get("question")
    for oc in target_market.get("outcomes", []) or []:
        name = str(oc.get("name") or "").strip().lower()
        if name not in ("yes", "no"):
            continue
        prefix = "yes" if name == "yes" else "no"
        prices[f"{prefix}_buy"] = _sf(oc.get("buy_price"))
        prices[f"{prefix}_sell"] = _sf(oc.get("sell_price"))
        prices[f"{prefix}_last"] = _sf(oc.get("last_trade_price"))
        if prices[f"{prefix}_last"] is None:
            prices[f"{prefix}_last"] = _sf(oc.get("last_price"))
    return prices


def _format_market_price(value: Optional[float]) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.0f}c"


def _format_temp_display(value: Optional[float], temp_symbol: str) -> str:
    if value is None:
        return f"-{temp_symbol}"
    rounded = round(float(value), 1)
    if abs(rounded - round(rounded)) < 1e-9:
        return f"{int(round(rounded))}{temp_symbol}"
    return f"{rounded:.1f}{temp_symbol}"


def _calc_kill_zone_alert(
    city_weather: Dict[str, Any],
    market_snapshot: Dict[str, Any],
    temp_symbol: str,
) -> Dict[str, Any]:
    current_temp = _sf((city_weather.get("current") or {}).get("temp"))
    if current_temp is None:
        return {
            "type": "kill_zone",
            "triggered": False,
            "reason": "current temperature unavailable",
        }

    candidates = _extract_market_strikes(market_snapshot, temp_symbol)
    if not candidates:
        return {
            "type": "kill_zone",
            "triggered": False,
            "reason": "no market strike candidates found",
        }

    nearest = min(candidates, key=lambda row: abs(current_temp - row["strike"]))
    strike = _sf(nearest.get("strike"))
    if strike is None:
        return {
            "type": "kill_zone",
            "triggered": False,
            "reason": "failed to parse strike temperature",
        }

    threshold = _to_unit_delta(0.3, temp_symbol)
    distance = abs(current_temp - strike)
    triggered = distance < threshold

    markets = market_snapshot.get("markets", []) or []
    target_market = _find_market_by_id(markets, nearest.get("market_id"))
    market_prices = _extract_market_prices(target_market)

    no_probability = None
    if target_market:
        yes_price = market_prices.get("yes_buy")
        no_price = market_prices.get("no_buy")
        if no_price is None and yes_price is not None:
            no_price = max(0.0, min(1.0, 1.0 - yes_price))
        no_probability = no_price

    return {
        "type": "kill_zone",
        "triggered": triggered,
        "current_temp": round(current_temp, 2),
        "strike_price": round(strike, 2),
        "market_label": f"{_format_temp_display(strike, temp_symbol)} 档位",
        "distance": round(distance, 2),
        "threshold": round(threshold, 2),
        "market_id": nearest.get("market_id"),
        "question": nearest.get("question"),
        "strike_source": nearest.get("source"),
        "no_probability": round(no_probability, 4) if no_probability is not None else None,
        "market_prices": market_prices,
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


def _join_trigger_types_cn(rules: Dict[str, Dict[str, Any]]) -> str:
    mapping = [
        ("momentum_spike", "动量突变"),
        ("forecast_breakthrough", "预测突破"),
        ("kill_zone", "临界触发"),
        ("advection", "暖平流"),
    ]
    parts = [name for key, name in mapping if rules.get(key, {}).get("triggered")]
    return " + ".join(parts)


def _build_advice_cn(
    rules: Dict[str, Dict[str, Any]],
    temp_symbol: str,
) -> str:
    parts: List[str] = []
    advection = rules.get("advection", {})
    momentum = rules.get("momentum_spike", {})
    breakthrough = rules.get("forecast_breakthrough", {})
    kill_zone = rules.get("kill_zone", {})

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

    no_prob = _sf(kill_zone.get("no_probability"))
    strike = _sf(kill_zone.get("strike_price"))
    if kill_zone.get("triggered") and no_prob is not None and strike is not None:
        parts.append(f'{no_prob * 100:.0f}% 概率的 {strike:.1f}{temp_symbol} "No" 单需谨慎')
    elif kill_zone.get("triggered") and strike is not None:
        parts.append(f"接近 {strike:.1f}{temp_symbol} 结算阻力位，波动率可能激增")

    if not parts:
        return "当前未触发高优先级异动，继续观察盘口与实测联动。"
    return "，".join(parts) + "。"


def _build_telegram_messages(
    city_weather: Dict[str, Any],
    rules: Dict[str, Dict[str, Any]],
    map_url: Optional[str],
) -> Dict[str, str]:
    temp_symbol = city_weather.get("temp_symbol", "°C")
    city_name = city_weather.get("display_name") or city_weather.get("name", "").title()
    current_temp = _sf((city_weather.get("current") or {}).get("temp"))
    momentum = rules.get("momentum_spike", {})
    kill_zone = rules.get("kill_zone", {})
    advection = rules.get("advection", {})

    if current_temp is None:
        return {"zh": "", "en": ""}

    types_cn = _join_trigger_types_cn(rules) or "盘口异动"
    delta_temp = _sf(momentum.get("delta_temp"))
    delta_min = momentum.get("delta_minutes")
    strike = _sf(kill_zone.get("strike_price"))
    distance = _sf(kill_zone.get("distance"))
    market_label = str(kill_zone.get("market_label") or "").strip()
    market_prices = kill_zone.get("market_prices") or {}

    dyn = f"实测 {current_temp:.1f}{temp_symbol}"
    if delta_temp is not None and delta_min is not None:
        icon = "🚀" if delta_temp > 0 else ("🧊" if delta_temp < 0 else "➖")
        dyn += f" ({int(delta_min)}min 内 {delta_temp:+.1f}{temp_symbol}) {icon}"

    strike_line = ""
    if strike is not None and distance is not None:
        if current_temp < strike:
            strike_line = f"距离 {strike:.1f}{temp_symbol} 档位：还差 {distance:.1f}{temp_symbol}"
        else:
            strike_line = f"距离 {strike:.1f}{temp_symbol} 档位：高出 {distance:.1f}{temp_symbol}"

    lead_line = ""
    if advection.get("triggered"):
        st_name = ((advection.get("lead_station") or {}).get("name")) or "nearby station"
        lead_delta = _sf(advection.get("lead_delta"))
        if lead_delta is not None:
            lead_line = f"联动：{st_name} 已领先 {lead_delta:+.1f}{temp_symbol}"

    price_line = ""
    if any(
        market_prices.get(key) is not None
        for key in ("yes_buy", "yes_sell", "no_buy", "no_sell")
    ):
        price_prefix = f"盘口（{market_label}）：" if market_label else "盘口："
        price_line = (
            price_prefix
            + 
            f"Yes 买 {_format_market_price(market_prices.get('yes_buy'))} / 卖 {_format_market_price(market_prices.get('yes_sell'))} | "
            f"No 买 {_format_market_price(market_prices.get('no_buy'))} / 卖 {_format_market_price(market_prices.get('no_sell'))}"
        )

    advice = _build_advice_cn(rules, temp_symbol)
    final_map = map_url or "https://polyweather-pro.vercel.app/"

    lines_zh = [
        f"🚨 PolyWeather 异动预警 [{city_name}]",
        "",
        f"类型：{types_cn}",
        f"动态：{dyn}",
    ]
    if strike_line:
        lines_zh.append(strike_line)
    if price_line:
        lines_zh.append(price_line)
    if lead_line:
        lines_zh.append(lead_line)
    lines_zh.append(f"AI 建议：{advice}")
    lines_zh.append(f"点击查看实时地图：{final_map}")

    type_en = []
    if rules.get("momentum_spike", {}).get("triggered"):
        type_en.append("Momentum Spike")
    if rules.get("forecast_breakthrough", {}).get("triggered"):
        type_en.append("Forecast Breakthrough")
    if rules.get("kill_zone", {}).get("triggered"):
        type_en.append("Kill Zone")
    if rules.get("advection", {}).get("triggered"):
        type_en.append("Advection")
    type_en_str = " + ".join(type_en) or "Market anomaly"

    lines_en = [
        f"🚨 PolyWeather Alert [{city_name}]",
        "",
        f"Type: {type_en_str}",
        f"Now: {current_temp:.1f}{temp_symbol}",
    ]
    if strike is not None and distance is not None:
        lines_en.append(f"Distance to {strike:.1f}{temp_symbol} strike: {distance:.1f}{temp_symbol}")
    if price_line:
        price_label_en = f"Quotes ({market_label}): " if market_label else "Quotes: "
        lines_en.append(
            price_label_en
            +
            f"Yes buy {_format_market_price(market_prices.get('yes_buy'))} / sell {_format_market_price(market_prices.get('yes_sell'))} | "
            f"No buy {_format_market_price(market_prices.get('no_buy'))} / sell {_format_market_price(market_prices.get('no_sell'))}"
        )
    lines_en.append(f"Action: {advice}")
    lines_en.append(f"Map: {final_map}")

    return {"zh": "\n".join(lines_zh), "en": "\n".join(lines_en)}


def build_trading_alerts(
    city_weather: Dict[str, Any],
    market_snapshot: Dict[str, Any],
    map_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build weather+market trading alerts for paid Telegram delivery and web usage.
    """
    temp_symbol = city_weather.get("temp_symbol", "°C")
    city = city_weather.get("name", "")
    now = datetime.now(timezone.utc).isoformat()

    rules: Dict[str, Dict[str, Any]] = {
        "momentum_spike": _calc_momentum_alert(city_weather, temp_symbol),
        "forecast_breakthrough": _calc_forecast_breakthrough_alert(city_weather, temp_symbol),
        "kill_zone": _calc_kill_zone_alert(city_weather, market_snapshot, temp_symbol),
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
    severity = "high" if len(triggered) >= 2 else ("medium" if len(triggered) == 1 else "none")

    telegram = _build_telegram_messages(
        city_weather=city_weather,
        rules=rules,
        map_url=map_url,
    )

    return {
        "city": city,
        "generated_at": now,
        "temp_symbol": temp_symbol,
        "severity": severity,
        "trigger_count": len(triggered),
        "rules": rules,
        "triggered_alerts": triggered,
        "telegram": telegram,
    }


