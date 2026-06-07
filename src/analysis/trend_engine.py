"""
Trend Engine — Shared weather analysis module
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Extracted from bot_listener.py to provide a single source of truth
for both Telegram bot and web dashboard.
"""

import math
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple, Dict, Any

from src.analysis.deb_algorithm import (
    calculate_dynamic_weights,
    calculate_deb_prediction,
    get_deb_accuracy,
    update_daily_record,
    _is_excluded_model_name,
)
from src.analysis.deb_hourly_consensus import build_deb_hourly_consensus_path
from src.analysis.settlement_rounding import apply_city_settlement, is_exact_settlement_city
from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.city_risk_profiles import get_city_risk_profile

SETTLEMENT_SOURCE_LABELS = {
    "metar": "METAR",
    "hko": "HKO",
    "cwa": "CWA",
    "noaa": "NOAA",
    "mgm": "MGM",
    "wunderground": "Wunderground",
}

_CLOUD_RANK_LABELS = {
    0: "晴空到少云",
    1: "少云",
    2: "散云",
    3: "多云",
    4: "阴天",
}


def _sf(v):
    """Safe float conversion — prevents JSON str types from breaking math."""
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2.0


def _peak_hours_from_hourly_values(
    hourly_values: List[Tuple[str, float]],
    *,
    tolerance: float = 0.3,
) -> List[str]:
    if not hourly_values:
        return []
    peak_value = max(value for _, value in hourly_values)
    return [
        time_part
        for time_part, value in hourly_values
        if abs(value - peak_value) <= tolerance
    ]


def _resolve_peak_hours(
    weather_data: dict,
    local_date_str: str,
    open_meteo_times: Optional[List[Any]] = None,
    open_meteo_temps: Optional[List[Any]] = None,
    open_meteo_peak: Optional[Any] = None,
) -> List[str]:
    """Resolve the local high-temperature window, preferring multi-model hourly consensus."""
    deb = weather_data.get("deb") if isinstance(weather_data, dict) else {}
    if isinstance(deb, dict):
        consensus = deb.get("hourly_consensus")
        if isinstance(consensus, dict):
            c_times = consensus.get("times") or []
            c_temps = consensus.get("temps") or []
            hourly_values: List[Tuple[str, float]] = []
            for raw_time, raw_temp in zip(c_times, c_temps):
                t_str = str(raw_time or "")
                if "T" in t_str and not t_str.startswith(local_date_str):
                    continue
                time_part = t_str.split("T", 1)[1][:5] if "T" in t_str else t_str[:5]
                try:
                    hour = int(time_part[:2])
                except Exception:
                    continue
                value = _sf(raw_temp)
                if value is not None and 8 <= hour <= 19:
                    hourly_values.append((time_part, value))
            peak_hours = _peak_hours_from_hourly_values(hourly_values)
            if peak_hours:
                return peak_hours

    multi_model = weather_data.get("multi_model") if isinstance(weather_data, dict) else {}
    if isinstance(multi_model, dict):
        hourly_times = multi_model.get("hourly_times") or []
        hourly_forecasts = multi_model.get("hourly_forecasts") or {}
        if isinstance(hourly_forecasts, dict) and hourly_times:
            hourly_values: List[Tuple[str, float]] = []
            for idx, raw_time in enumerate(hourly_times):
                t_str = str(raw_time or "")
                if not t_str.startswith(local_date_str) or "T" not in t_str:
                    continue
                time_part = t_str.split("T", 1)[1][:5]
                try:
                    hour = int(time_part[:2])
                except Exception:
                    continue
                if not 8 <= hour <= 19:
                    continue
                values = []
                for model_name, series in hourly_forecasts.items():
                    if _is_excluded_model_name(model_name):
                        continue
                    if not isinstance(series, (list, tuple)) or idx >= len(series):
                        continue
                    value = _sf(series[idx])
                    if value is not None:
                        values.append(value)
                median_value = _median(values)
                if median_value is not None:
                    hourly_values.append((time_part, median_value))
            peak_hours = _peak_hours_from_hourly_values(hourly_values)
            if peak_hours:
                return peak_hours

    om_peak = _sf(open_meteo_peak)
    if open_meteo_times and open_meteo_temps and om_peak is not None:
        peak_hours = []
        for t_raw, temp_raw in zip(open_meteo_times, open_meteo_temps):
            t_str = str(t_raw or "")
            temp = _sf(temp_raw)
            if temp is None or not t_str.startswith(local_date_str) or "T" not in t_str:
                continue
            time_part = t_str.split("T", 1)[1][:5]
            try:
                hour = int(time_part[:2])
            except Exception:
                continue
            if 8 <= hour <= 19 and abs(temp - om_peak) <= 0.2:
                peak_hours.append(time_part)
        return peak_hours
    return []


def _resolve_settlement_source_label(city_name: Optional[str]) -> str:
    if not city_name:
        return "METAR"
    city_key = str(city_name).strip().lower()
    city_meta = CITY_REGISTRY.get(city_key, {})
    source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    if not source:
        source = "metar"
    return SETTLEMENT_SOURCE_LABELS.get(source, source.upper())


def _wind_bucket_label(wdir: Optional[float]) -> str:
    if wdir is None:
        return "风向信号不明确"
    deg = float(wdir) % 360
    if 135 <= deg < 225:
        return "南风主导"
    if 45 <= deg < 135:
        return "东风主导"
    if 225 <= deg < 315:
        return "西风主导"
    return "北风主导"


def _describe_recent_structure(
    recent_obs: List[Dict[str, Any]],
    peak_status: str,
    trend_direction: str,
    cur_temp: Optional[float],
    max_so_far: Optional[float],
    temp_symbol: str,
    primary_current: Dict[str, Any],
) -> Tuple[str, List[str]]:
    if len(recent_obs) < 2:
        return "", []

    oldest = recent_obs[-1]
    newest = recent_obs[0]

    temp_old = _sf(oldest.get("temp"))
    temp_new = _sf(newest.get("temp"))
    wdir_old = _sf(oldest.get("wdir"))
    wdir_new = _sf(newest.get("wdir"))
    altim_old = _sf(oldest.get("altim"))
    altim_new = _sf(newest.get("altim"))
    cloud_old = int(oldest.get("cloud_rank") or 0)
    cloud_new = int(newest.get("cloud_rank") or 0)
    humidity = _sf(primary_current.get("humidity"))
    wx_desc = str(primary_current.get("wx_desc") or "").strip()

    temp_delta = None
    if temp_old is not None and temp_new is not None:
        temp_delta = temp_new - temp_old

    wind_angle = None
    if wdir_old is not None and wdir_new is not None:
        wind_angle = abs(wdir_new - wdir_old)
        if wind_angle > 180:
            wind_angle = 360 - wind_angle

    altim_delta = None
    if altim_old is not None and altim_new is not None:
        altim_delta = altim_new - altim_old

    cloud_delta = cloud_new - cloud_old
    lines: List[str] = []

    if cloud_delta >= 2 and temp_delta is not None and temp_delta >= 0:
        lines.append("云层明显增厚，但近报尚未跟随降温，短时更像中高云增多或暖湿输送前段。")
    elif cloud_delta >= 2 and temp_delta is not None and temp_delta <= -0.5:
        lines.append("云量抬升且温度同步回落，云雨压温的约束正在增强。")
    elif cloud_delta <= -2 and temp_delta is not None and temp_delta >= 0.5:
        lines.append("云量回落并伴随升温，短时日照增温效率在改善。")

    if wind_angle is not None and wind_angle >= 60:
        lines.append(
            f"低层风向出现明显切换，由 {_wind_bucket_label(wdir_old)} 转为 {_wind_bucket_label(wdir_new)}。"
        )
    elif wdir_new is not None:
        lines.append(f"当前低层风场以{_wind_bucket_label(wdir_new)}为主。")

    if altim_delta is not None:
        if altim_delta <= -1.5 and trend_direction != "falling":
            lines.append("气压继续走低，边界层仍偏活跃，峰值尚不能轻判结束。")
        elif altim_delta >= 1.5 and peak_status != "before":
            lines.append("气压回升信号更明显，若后续再配合回落，日高温锁定概率会继续上升。")

    if humidity is not None and humidity >= 80 and not wx_desc:
        lines.append(f"湿度已到 {humidity:.0f}% 左右，后续若云层继续增厚，需要防范压温。")
    elif wx_desc:
        lines.append(f"当前伴随“{wx_desc}”天气现象，短时体感与实测升温效率通常都会受抑制。")

    if max_so_far is not None and cur_temp is not None:
        gap = max_so_far - cur_temp
        if gap >= 2.0 and peak_status != "before":
            lines.append(
                f"当前温度较今日峰值已回落 {gap:.1f}{temp_symbol}，若后续再无明显回补，日高温大概率已接近锁定。"
            )
        elif gap <= 0.5 and peak_status == "in_window":
            lines.append("当前温度仍贴近当日峰值，窗口内仍保留再创新高的可能。")

    if not lines:
        if trend_direction == "rising":
            lines.append("近报仍偏升温，短时还看不到明确见顶信号。")
        elif trend_direction == "falling":
            lines.append("近报已进入回落段，后续重点看回落是否延续。")
        else:
            lines.append("当前结构信号偏中性，仍需继续盯近报温度与风云演变。")

    return lines[0], lines


def analyze_weather_trend(
    weather_data: dict,
    temp_symbol: str,
    city_name: Optional[str] = None,
) -> Tuple[str, str, Dict[str, Any]]:
    """
    Analyze weather trend from multi-source data.

    Returns:
        (display_str, ai_context, structured_data)

        display_str: HTML-formatted insights for Telegram display
        ai_context:  plain-text context for AI analysis
        structured_data: dict with computed values for direct use:
            - mu: probability center
            - probabilities: [{value, range, probability}, ...]
            - trend_info: {direction, recent, is_cooling, is_dead_market}
            - peak_status: "before" / "in_window" / "past"
            - peak_hours: list of peak hour strings
            - deb_prediction: DEB blended value
            - current_forecasts: {model: temp, ...}
            - forecast_miss_deg: float
            - max_so_far: float
            - cur_temp: float
            - wu_settle: int
    """
    insights: List[str] = []
    ai_features: List[str] = []
    mu = None
    sorted_probs = []
    _deb_to_save = None
    settlement_source_label = _resolve_settlement_source_label(city_name)

    metar = weather_data.get("metar", {})
    open_meteo = weather_data.get("open-meteo", {})
    mgm = weather_data.get("mgm") or {}
    settlement_current = weather_data.get("settlement_current") or {}
    if not isinstance(settlement_current, dict):
        settlement_current = {}
    settlement_now = settlement_current.get("current") or {}
    if not isinstance(settlement_now, dict):
        settlement_now = {}
    nws = weather_data.get("nws", {})

    empty_result = ("", "", {})
    if not metar and not mgm and not settlement_now:
        return empty_result

    max_so_far = _sf(settlement_now.get("max_temp_so_far"))
    if max_so_far is None:
        max_so_far = (
            _sf(metar.get("current", {}).get("max_temp_so_far"))
            if metar
            else _sf(mgm.get("current", {}).get("mgm_max_temp"))
        )
    cur_temp = _sf(settlement_now.get("temp"))
    if cur_temp is None:
        cur_temp = (
            _sf(metar.get("current", {}).get("temp"))
            if metar
            else _sf(mgm.get("current", {}).get("temp"))
        )
    primary_current = settlement_now if settlement_now else (metar.get("current", {}) if metar else {})

    daily = open_meteo.get("daily", {})
    hourly = open_meteo.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])

    # === Forecasts ===
    current_forecasts: Dict[str, Optional[float]] = {}
    if daily.get("temperature_2m_max"):
        current_forecasts["Open-Meteo"] = _sf(daily.get("temperature_2m_max")[0])
    if nws.get("today_high") is not None:
        current_forecasts["NWS"] = _sf(nws.get("today_high"))
    
    mgm = weather_data.get("mgm", {})
    if mgm and mgm.get("today_high") is not None:
        current_forecasts["MGM"] = _sf(mgm.get("today_high"))
        
    if weather_data.get("hko_forecast") is not None:
        current_forecasts["HKO(港天文)"] = _sf(weather_data.get("hko_forecast"))
    if weather_data.get("cwa_forecast") is not None:
        current_forecasts["CWA(台气象)"] = _sf(weather_data.get("cwa_forecast"))

    mm_forecasts = weather_data.get("multi_model", {}).get("forecasts", {})
    for m_name, m_val in mm_forecasts.items():
        if m_val is not None and not _is_excluded_model_name(m_name):
            current_forecasts[m_name] = _sf(m_val)

    forecast_highs = [h for h in current_forecasts.values() if h is not None]
    forecast_high = max(forecast_highs) if forecast_highs else None
    forecast_median = (
        sorted(forecast_highs)[len(forecast_highs) // 2] if forecast_highs else None
    )

    wind_speed = primary_current.get("wind_speed_kt", 0)

    # === Local time/date (do not trust cached Open-Meteo local_time for date key) ===
    utc_offset = _sf(open_meteo.get("utc_offset"))
    if utc_offset is None and city_name:
        try:
            from src.data_collection.city_registry import CITY_REGISTRY

            city_meta = CITY_REGISTRY.get(str(city_name).lower())
            if isinstance(city_meta, dict):
                utc_offset = _sf(city_meta.get("tz_offset"))
        except Exception:
            pass

    city_now = None
    if utc_offset is not None:
        try:
            city_now = datetime.now(timezone.utc).astimezone(
                timezone(timedelta(seconds=int(utc_offset)))
            )
        except Exception:
            city_now = None

    local_time_full = str((open_meteo.get("current") or {}).get("local_time") or "").strip()
    if city_now is not None:
        local_date_str = city_now.strftime("%Y-%m-%d")
        local_hour = city_now.hour
        local_minute = city_now.minute
    else:
        try:
            local_date_str = local_time_full.split(" ")[0]
            time_parts = local_time_full.split(" ")[1].split(":")
            local_hour = int(time_parts[0])
            local_minute = int(time_parts[1]) if len(time_parts) > 1 else 0
        except Exception:
            fallback_now = datetime.now()
            local_date_str = fallback_now.strftime("%Y-%m-%d")
            local_hour = fallback_now.hour
            local_minute = fallback_now.minute

    # Use settlement/METAR observation date in city local time when available (reliable for actual_high date key).
    obs_time_raw = str(settlement_current.get("observation_time") or "").strip()
    if not obs_time_raw:
        obs_time_raw = str(metar.get("observation_time") or "").strip()
    if obs_time_raw and utc_offset is not None:
        try:
            obs_dt = datetime.fromisoformat(obs_time_raw.replace("Z", "+00:00"))
            if obs_dt.tzinfo is None:
                obs_dt = obs_dt.replace(tzinfo=timezone.utc)
            local_date_str = obs_dt.astimezone(
                timezone(timedelta(seconds=int(utc_offset)))
            ).strftime("%Y-%m-%d")
        except Exception:
            pass
    local_hour_frac = local_hour + local_minute / 60

    daily_dates = daily.get("time", []) or []
    daily_highs = daily.get("temperature_2m_max", []) or []
    if local_date_str in daily_dates:
        try:
            local_day_idx = daily_dates.index(local_date_str)
            local_day_high = _sf(
                daily_highs[local_day_idx]
                if local_day_idx < len(daily_highs)
                else None
            )
            if local_day_high is not None:
                current_forecasts["Open-Meteo"] = local_day_high
        except Exception:
            pass
        forecast_highs = [h for h in current_forecasts.values() if h is not None]
        forecast_high = max(forecast_highs) if forecast_highs else None
        forecast_median = (
            sorted(forecast_highs)[len(forecast_highs) // 2] if forecast_highs else None
        )

    # === DEB ===
    deb_prediction = None
    deb_raw_prediction = None
    deb_hourly_consensus = None
    deb_version = None
    deb_bias_adjustment = 0.0
    deb_bias_samples = 0
    deb_selected_version, deb_guard_reason = None, None
    deb_weights = ""
    deb_quality = {}
    if city_name and current_forecasts:
        deb_result = calculate_deb_prediction(
            city_name,
            current_forecasts,
            raw_calculator=calculate_dynamic_weights,
        )
        if deb_result.get("prediction") is not None:
            deb_prediction = deb_result.get("prediction")
            deb_raw_prediction = deb_result.get("raw_prediction")
            deb_version = deb_result.get("version")
            deb_selected_version = deb_result.get("selected_version")
            deb_guard_reason = deb_result.get("guard_reason")
            deb_bias_adjustment = deb_result.get("bias_adjustment") or 0.0
            deb_bias_samples = deb_result.get("bias_samples") or 0
            deb_weights = deb_result.get("weights_info") or ""
            deb_quality = {
                "quality_tier": deb_result.get("quality_tier"),
                "recommendation": deb_result.get("recommendation"),
                "recent_hit_rate": deb_result.get("recent_hit_rate"),
                "recent_samples": deb_result.get("recent_samples"),
                "recent_hits": deb_result.get("recent_hits"),
                "recent_mae": deb_result.get("recent_mae"),
            }
            insights.insert(
                0,
                f"🧬 <b>DEB 融合预测</b>：<b>{deb_prediction}{temp_symbol}</b> ({deb_weights})",
            )
            ai_features.append(
                f"🧬 DEB系统已通过历史偏差矫正算出期待点是: {deb_prediction}{temp_symbol}。"
            )
        _deb_to_save = deb_prediction

    # === METAR trend ===
    recent_temps = metar.get("recent_temps", [])
    trend_desc = ""
    trend_direction = "unknown"
    trend_display = ""
    if len(recent_temps) >= 2:
        temps_only = [t for _, t in recent_temps]
        latest_val = temps_only[0]
        prev_val = temps_only[1]
        diff = latest_val - prev_val
        if len(temps_only) >= 3:
            all_same = all(t == latest_val for t in temps_only[:3])
            all_rising = all(
                temps_only[i] >= temps_only[i + 1]
                for i in range(min(3, len(temps_only)) - 1)
            )
            all_falling = all(
                temps_only[i] <= temps_only[i + 1]
                for i in range(min(3, len(temps_only)) - 1)
            )
            trend_display = " → ".join(
                [f"{t}{temp_symbol}@{tm}" for tm, t in recent_temps[:3]]
            )
            if all_same:
                trend_desc = f"📉 温度暂时停滞（{trend_display}）。"
                trend_direction = "stagnant"
            elif all_rising and diff > 0:
                trend_desc = f"📈 仍在升温（{trend_display}）。"
                trend_direction = "rising"
            elif all_falling and diff < 0:
                trend_desc = f"📉 已开始降温（{trend_display}）。"
                trend_direction = "falling"
            else:
                trend_desc = f"📊 温度波动中（{trend_display}）。"
                trend_direction = "mixed"
        elif diff == 0:
            trend_display = (
                f"{prev_val}{temp_symbol}@{recent_temps[1][0]} → "
                f"{latest_val}{temp_symbol}@{recent_temps[0][0]}"
            )
            trend_desc = f"📉 温度持平（{trend_display}）。"
            trend_direction = "stagnant"
        elif diff > 0:
            trend_display = (
                f"{prev_val}{temp_symbol}@{recent_temps[1][0]} → "
                f"{latest_val}{temp_symbol}@{recent_temps[0][0]}"
            )
            trend_desc = f"📈 仍在升温（{prev_val} → {latest_val}{temp_symbol}）。"
            trend_direction = "rising"
        else:
            trend_display = (
                f"{prev_val}{temp_symbol}@{recent_temps[1][0]} → "
                f"{latest_val}{temp_symbol}@{recent_temps[0][0]}"
            )
            trend_desc = f"📉 已开始降温（{prev_val} → {latest_val}{temp_symbol}）。"
            trend_direction = "falling"

    is_cooling = trend_direction == "falling"

    om_today = _sf(current_forecasts.get("Open-Meteo"))
    if city_name and deb_prediction is not None:
        mm = weather_data.get("multi_model") or {}
        if isinstance(mm, dict):
            deb_hourly_consensus = build_deb_hourly_consensus_path(
                city=city_name,
                hourly_times=mm.get("hourly_times") or [],
                hourly_forecasts=mm.get("hourly_forecasts") or {},
                daily_forecasts=current_forecasts,
                deb_prediction=deb_prediction,
                local_date=local_date_str,
            )

    # === Peak hours ===
    peak_weather_data = weather_data
    if deb_hourly_consensus:
        peak_weather_data = {
            **weather_data,
            "deb": {
                **(weather_data.get("deb") or {}),
                "hourly_consensus": deb_hourly_consensus,
            },
        }
    peak_hours = _resolve_peak_hours(
        peak_weather_data,
        local_date_str,
        times,
        temps,
        om_today,
    )
    if peak_hours:
        first_peak_h = int(peak_hours[0].split(":")[0])
        last_peak_h = int(peak_hours[-1].split(":")[0])
    else:
        first_peak_h, last_peak_h = 13, 15

    # Peak status
    if local_hour_frac > last_peak_h:
        peak_status = "past"
    elif first_peak_h <= local_hour_frac <= last_peak_h:
        peak_status = "in_window"
    else:
        peak_status = "before"

    if city_name and current_forecasts and deb_prediction is not None:
        # DEB blending uses the already-computed set of model forecasts
                if ai_features and "DEB系统已通过历史偏差矫正算出期待点是" in ai_features[0]:
                    ai_features[0] = (
                        f"🧬 DEB系统已通过历史偏差矫正算出期待点是: {deb_prediction}{temp_symbol}。"
                    )

    if trend_direction == "stagnant":
        if peak_status == "before":
            trend_desc = (
                f"🕒 峰值窗口前温度暂时停滞（{trend_display or '近2-3报持平'}），"
                "尚不能据此判定到顶。"
            )
        elif peak_status == "in_window":
            trend_desc = (
                f"⏱️ 峰值窗口内温度停滞（{trend_display or '近2-3报持平'}），"
                "需继续观察后续是否再创新高。"
            )
        else:
            trend_desc = (
                f"📉 峰值窗口后温度停滞（{trend_display or '近2-3报持平'}），"
                "存在到顶迹象。"
            )
    elif trend_direction == "falling" and peak_status == "before":
        trend_desc = (
            f"📉 峰值窗口前出现回落（{trend_display or '近2报回落'}），"
            "暂不能单凭回落判定今日高温已锁定。"
        )

    recent_obs = metar.get("recent_obs", [])
    dynamic_summary, dynamic_notes = _describe_recent_structure(
        recent_obs=recent_obs,
        peak_status=peak_status,
        trend_direction=trend_direction,
        cur_temp=cur_temp,
        max_so_far=max_so_far,
        temp_symbol=temp_symbol,
        primary_current=primary_current,
    )
    if dynamic_summary:
        insights.append(f"🧩 <b>结构解读</b>：{dynamic_summary}")
    for note in dynamic_notes:
        ai_features.append(f"🧩 结构解读: {note}")

    # === Ensemble ===
    ensemble = weather_data.get("ensemble", {})
    ens_p10 = _sf(ensemble.get("p10"))
    ens_p90 = _sf(ensemble.get("p90"))
    ens_median = _sf(ensemble.get("median"))
    ens_data = {"p10": ens_p10, "p90": ens_p90, "median": ens_median}

    sigma = None
    fallback_sigma = False

    if ens_p10 is not None and ens_p90 is not None and ens_median is not None:
        msg1 = (
            f"📊 <b>集合预报</b>：中位数 {ens_median}{temp_symbol}，"
            f"90% 区间 [{ens_p10}{temp_symbol} - {ens_p90}{temp_symbol}]。"
        )
        if not is_cooling:
            insights.append(msg1)
        ai_features.append(msg1)

        if om_today is not None:
            if om_today > ens_p90 and (
                max_so_far is None or max_so_far < om_today - 0.5
            ):
                ai_features.append(
                    f"⚡ 预报偏高：确定性预报 {om_today}{temp_symbol} 超集合90%上限，"
                    f"更可能接近 {ens_median}{temp_symbol}。"
                )
            elif om_today < ens_p10 and (
                max_so_far is None or max_so_far < ens_median
            ):
                ai_features.append(
                    f"⚡ 预报偏低：确定性预报 {om_today}{temp_symbol} 低于集合90%下限，"
                    f"更可能接近 {ens_median}{temp_symbol}。"
                )

        # === Sigma calculation ===
        sigma = (ens_p90 - ens_p10) / 2.56
        if sigma < 0.1:
            sigma = 0.1

        # MAE floor
        if city_name:
            acc = get_deb_accuracy(city_name)
            if acc:
                _, hist_mae, _, _ = acc
                if hist_mae > sigma:
                    sigma = hist_mae

        # Shock Score
        shock_score = 0.0
        if len(recent_obs) >= 2:
            oldest = recent_obs[-1]
            newest = recent_obs[0]
            wdir_old = _sf(oldest.get("wdir"))
            wdir_new = _sf(newest.get("wdir"))
            wspd_new = _sf(newest.get("wspd")) or 0
            if wdir_old is not None and wdir_new is not None:
                angle_diff = abs(wdir_new - wdir_old)
                if angle_diff > 180:
                    angle_diff = 360 - angle_diff
                wind_weight = min(wspd_new / 15.0, 1.0)
                shock_score += min(angle_diff / 90.0, 1.0) * wind_weight * 0.4
            cloud_old = oldest.get("cloud_rank", 0)
            cloud_new = newest.get("cloud_rank", 0)
            shock_score += min(abs(cloud_new - cloud_old) / 3.0, 1.0) * 0.35
            altim_old = _sf(oldest.get("altim"))
            altim_new = _sf(newest.get("altim"))
            if altim_old is not None and altim_new is not None:
                shock_score += min(abs(altim_new - altim_old) / 4.0, 1.0) * 0.25

        if shock_score > 0.05:
            sigma *= 1 + 0.5 * shock_score

        # Time decay
        if local_hour_frac > last_peak_h:
            sigma *= 0.3
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            sigma *= 0.7
    else:
        # Fallback for sigma when ensemble is missing
        fallback_sigma = True
        if forecast_highs and len(forecast_highs) > 1:
            sigma = max(0.6, (max(forecast_highs) - min(forecast_highs)) / 2.0)
        else:
            sigma = 1.0
            
        if city_name:
            acc = get_deb_accuracy(city_name)
            if acc and acc[1] > sigma:
                sigma = acc[1]

        if local_hour_frac > last_peak_h:
            sigma *= 0.3
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            sigma *= 0.7

    # === Dead Market ===
    is_dead_market = False
    if max_so_far is not None and cur_temp is not None:
        if local_hour >= 21 and max_so_far - cur_temp >= 3.0:
            is_dead_market = True
        elif local_hour > last_peak_h and max_so_far - cur_temp >= 1.5:
            is_dead_market = True

    # === Probability Engine ===
    probabilities: List[Dict[str, Any]] = []
    probabilities_all: List[Dict[str, Any]] = []
    forecast_miss_deg = 0.0

    if is_dead_market:
        settled_wu = apply_city_settlement(city_name, max_so_far) if max_so_far is not None else 0
        dead_msg = (
            f"🎲 <b>结算预测</b>：已锁定 {settled_wu}{temp_symbol} "
            f"({settlement_source_label} 死盘确认)"
        )
        insights.append(dead_msg)
        ai_features.append("🎲 状态: 确认死盘，结算已无悬念。")
        if max_so_far is not None:
            mu = max_so_far
            probabilities = [
                {"value": settled_wu, "range": f"[{settled_wu-0.5}~{settled_wu+0.5})", "probability": 1.0}
            ]
            probabilities_all = probabilities
    elif (ens_p10 is not None and ens_p90 is not None) or fallback_sigma:
        # Forecast miss magnitude
        if max_so_far is not None and forecast_median is not None:
            forecast_miss_deg = round(forecast_median - max_so_far, 1)

        fallback_center = forecast_median if forecast_median is not None else (forecast_high if forecast_high is not None else cur_temp)
        center = ens_median if ens_median is not None else fallback_center

        # Reality-anchored μ
        if (
            max_so_far is not None
            and forecast_median is not None
            and peak_status in ("past", "in_window")
            and max_so_far < forecast_median - 2.0
        ):
            if is_cooling or peak_status == "past":
                mu = max_so_far
            else:
                mu = max_so_far + 0.5
        else:
            mu = (
                forecast_median * 0.7 + center * 0.3
                if forecast_median is not None and center is not None
                else center
            )
            if max_so_far is not None and mu is not None and max_so_far > mu:
                mu = max_so_far + (0.3 if not is_cooling else 0.0)

        # Forecast miss severity for AI
        if forecast_miss_deg > 2.0 and peak_status in ("past", "in_window"):
            severity = "重" if forecast_miss_deg > 5.0 else ("中" if forecast_miss_deg > 3.0 else "轻")
            min_fc = min((v for v in forecast_highs if v is not None), default=None)
            _trend_dir = "降温" if is_cooling else ("停滞" if "停滞" in trend_desc else "升温")
            ai_features.append(
                f"🚨 预报崩盘 [{severity}级失准]: 最低预报 {min_fc}{temp_symbol} vs "
                f"实测最高 {max_so_far}{temp_symbol}，偏差 {forecast_miss_deg}°。当前趋势: {_trend_dir}。"
            )

        # Probability (legacy Gaussian buckets)
        probs_result = calculate_prob_distribution(
            mu, sigma, max_so_far, temp_symbol, city_name
        )
        mu = probs_result.get("mu", mu)
        probabilities = probs_result.get("probabilities", [])
        probabilities_all = probs_result.get("probabilities_all", probabilities)
        sorted_probs = probs_result.get("sorted_probs", [])

        if sorted_probs:
            prob_parts = [
                f"{int(t)}{temp_symbol} [{t - 0.5}~{t + 0.5}) {p * 100:.0f}%"
                for t, p in sorted_probs[:4]
            ]
            if prob_parts:
                prob_str = " | ".join(prob_parts)
                insights.append(f"🎲 <b>结算概率</b> (μ={mu:.1f})：{prob_str}")
                ai_features.append(f"🎲 数学概率分布：{prob_str}")

    # === Actual exceeds forecast ===
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
            exceed_by = max_so_far - forecast_high
            bt_msg = (
                f"🚨 <b>实测已超预报</b>：{max_so_far}{temp_symbol} 超过上限 "
                f"{forecast_high}{temp_symbol}（+{exceed_by:.1f}°）。"
            )
            insights.append(bt_msg)
            ai_features.append(
                f"🚨 异常: 实测已冲破所有预报上限 ({max_so_far}{temp_symbol} vs {forecast_high}{temp_symbol})。"
            )
    if trend_desc:
        ai_features.append(trend_desc)

    # === Settlement boundary ===
    if max_so_far is not None:
        settled = apply_city_settlement(city_name, max_so_far)
        from src.analysis.settlement_rounding import is_exact_settlement_city
        is_floor = is_exact_settlement_city(str(city_name).lower())
        
        fractional = max_so_far - int(max_so_far)
        
        if is_floor:
            # For flooring cities like HK, boundary is at 1.0 (approaching next integer)
            dist_to_next = 1.0 - fractional
            if dist_to_next <= 0.3:
                msg = (
                    f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → {settlement_source_label} 结算 "
                    f"<b>{settled}{temp_symbol}</b>，但只差 <b>{dist_to_next:.1f}°</b> "
                    f"就会进位到 {settled + 1}{temp_symbol}！"
                )
                insights.append(msg)
                ai_features.append(msg)
        else:
            # Standard rounding boundary at 0.5
            dist_to_boundary = abs(fractional - 0.5)
            if dist_to_boundary <= 0.3:
                if fractional < 0.5:
                    msg = (
                        f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → {settlement_source_label} 结算 "
                        f"<b>{settled}{temp_symbol}</b>，但只差 {0.5 - fractional:.1f}° "
                        f"就会进位到 {settled + 1}{temp_symbol}！"
                    )
                else:
                    msg = (
                        f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → {settlement_source_label} 结算 "
                        f"<b>{settled}{temp_symbol}</b>，刚刚越过进位线，再降 "
                        f"<b>{fractional - 0.5:.1f}°</b> 就会回落到 {settled - 1}{temp_symbol}。"
                    )
                insights.append(msg)
                ai_features.append(msg)

    # === Peak window AI hints ===
    if peak_hours:
        window = (
            f"{peak_hours[0]} - {peak_hours[-1]}"
            if len(peak_hours) > 1
            else peak_hours[0]
        )
        ai_features.append(
            f"🧭 峰值窗口判定: 当前 {local_hour:02d}:{local_minute:02d}，"
            f"预报最热窗口 {window}，状态={peak_status}。"
        )
        if local_hour <= last_peak_h:
            if last_peak_h < 6:
                ai_features.append("⚠️ <b>提示</b>：预测最热在凌晨，后续气温可能一路走低。")
            elif local_hour < first_peak_h and (
                max_so_far is None or max_so_far < forecast_high
            ):
                target_temp = om_today if om_today is not None else forecast_high
                ai_features.append(
                    f"🎯 <b>关注重点</b>：看看那个时段能否涨到 {target_temp}{temp_symbol}。"
                )

        remain_hrs = first_peak_h - local_hour_frac
        if local_hour_frac > last_peak_h:
            ai_features.append(f"⏱️ 状态: 预报峰值时段已过 ({window})。")
            ai_features.append("✅ 判定约束: 峰值窗口已过，可结合回落幅度判断是否锁定。")
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            remain_in_window = last_peak_h - local_hour_frac
            if remain_in_window < 1:
                ai_features.append(
                    f"⏱️ 状态: 正处于预报最热窗口 ({window})内，距窗口结束约 {int(remain_in_window * 60)} 分钟。"
                )
            else:
                ai_features.append(
                    f"⏱️ 状态: 正处于预报最热窗口 ({window})内，距窗口结束约 {remain_in_window:.1f}h。"
                )
            ai_features.append("⚠️ 判定约束: 窗口内即使停滞，也需后续2报确认未再创新高。")
        elif remain_hrs < 1:
            ai_features.append(
                f"⏱️ 状态: 距最热时段开始还有约 {int(remain_hrs * 60)} 分钟 ({window})，尚未进入峰值窗口。"
            )
            ai_features.append("🚫 判定约束: 峰值窗口前禁止判定‘已锁定/已确认底线’。")
        else:
            ai_features.append(f"⏱️ 状态: 距最热时段开始还有约 {remain_hrs:.1f}h ({window})。")
            ai_features.append("🚫 判定约束: 峰值窗口前禁止判定‘已锁定/已确认底线’。")

    # === AI fact features ===
    if cur_temp is not None:
        ai_features.append(f"🌡️ 当前实测温度: {cur_temp}{temp_symbol}。")
    if max_so_far is not None:
        ai_features.append(
            f"🏔️ 今日实测最高温: {max_so_far}{temp_symbol} "
            f"({settlement_source_label}结算={apply_city_settlement(city_name, max_so_far)}{temp_symbol})。"
        )
    if city_name:
        _profile = get_city_risk_profile(city_name)
        if _profile and _profile.get("metar_rounding"):
            ai_features.append(f"⚠️ METAR特性: {_profile['metar_rounding']}")
    if wind_speed:
        wind_dir = primary_current.get("wind_dir", "未知")
        ai_features.append(f"🌬️ 当下风况: 约 {wind_speed}kt (方向 {wind_dir}°)。")
    humidity = primary_current.get("humidity")
    if humidity and humidity > 80:
        ai_features.append(f"💦 湿度极高 ({humidity}%)。")

    clouds = primary_current.get("clouds", [])
    if clouds:
        cover = clouds[-1].get("cover", "")
        c_desc = {"OVC": "全阴", "BKN": "多云", "SCT": "散云", "FEW": "少云"}.get(cover, cover)
        ai_features.append(f"☁️ 天空状况: {c_desc}。")

    wx_desc = primary_current.get("wx_desc")
    if wx_desc:
        ai_features.append(f"🌧️ 天气现象: {wx_desc}。")

    max_temp_time_str = primary_current.get("max_temp_time", "")
    if max_so_far is not None and max_temp_time_str:
        try:
            max_h = int(max_temp_time_str.split(":")[0])
            max_temp_rad = 0.0
            hourly_rad = hourly.get("shortwave_radiation", [])
            for t_str, rad in zip(times, hourly_rad):
                if t_str.startswith(local_date_str) and int(t_str.split("T")[1][:2]) == max_h:
                    max_temp_rad = rad if rad is not None else 0.0
                    break
            if max_temp_rad < 50:
                ai_features.append(
                    f"🌙 动力事实: 最高温出现在低辐射时段 ({max_temp_time_str}, 辐射{max_temp_rad:.0f}W/m²)。"
                )
        except Exception:
            pass

    # === Save daily record (with μ + prob snapshot) ===
    try:
        _prob_list = None
        if sorted_probs:
            _prob_list = [
                {"value": int(t), "probability": round(p, 3)}
                for t, p in sorted_probs[:4]
            ]
        elif is_dead_market and max_so_far is not None:
            _prob_list = [{"value": apply_city_settlement(city_name, max_so_far), "probability": 1.0}]

        update_daily_record(
            city_name,
            local_date_str,
            current_forecasts,
            max_so_far,
            deb_prediction=_deb_to_save,
            mu=mu,
            probabilities=_prob_list,
        )
    except Exception:
        pass

    # === Build recent list for trend_info ===
    recent_list = []
    for tm, t in recent_temps[:4]:
        recent_list.append({"time": tm, "temp": t})

    # === Structured result ===
    structured = {
        "mu": mu,
        "probabilities": probabilities,
        "probabilities_all": probabilities_all or probabilities,
        "probability_engine": "legacy",
        "trend_info": {
            "direction": trend_direction if 'trend_direction' in dir() else "unknown",
            "recent": recent_list,
            "is_cooling": is_cooling,
            "is_dead_market": is_dead_market,
        },
        "peak_status": peak_status,
        "peak_hours": peak_hours,
        "deb_prediction": deb_prediction,
        "deb_raw_prediction": deb_raw_prediction,
        "deb_hourly_consensus": deb_hourly_consensus,
        "deb_version": deb_version,
        "deb_selected_version": deb_selected_version,
        "deb_guard_reason": deb_guard_reason,
        "deb_bias_adjustment": deb_bias_adjustment,
        "deb_bias_samples": deb_bias_samples,
        "deb_weights": deb_weights,
        "deb_quality": deb_quality,
        "current_forecasts": current_forecasts,
        "ens_data": ens_data,
        "forecast_miss_deg": forecast_miss_deg,
        "max_so_far": max_so_far,
        "cur_temp": cur_temp,
        "wu_settle": apply_city_settlement(city_name, max_so_far) if max_so_far is not None else None,
        "dynamic_commentary": {
            "summary": dynamic_summary,
            "notes": dynamic_notes,
        },
    }
    display_str = "\n".join(insights) if insights else ""
    return display_str, "\n".join(ai_features), structured


def calculate_prob_distribution(
    mu: float, sigma: float, max_so_far: Optional[float], temp_symbol: str, city_name: str = ""
) -> Dict[str, Any]:
    """
    Generalized Gaussian probability distribution calculation.
    """
    if mu is None or sigma is None:
        return {}

    def _norm_cdf(x, m, s):
        # 0.5 * (1 + erf( (x-m)/(s*sqrt(2)) ))
        return 0.5 * (1 + math.erf((x - m) / (s * math.sqrt(2))))

    min_possible_wu = apply_city_settlement(city_name, max_so_far) if max_so_far is not None else -999
    probs = {}
    
    # Range: mu +/- 3 sigma or at least +/- 2 degrees
    search_range = max(2, int(sigma * 2.5))
    is_exact = is_exact_settlement_city(city_name)
    target_mu = apply_city_settlement(city_name, mu)
    if is_exact:
        target_mu = int(math.floor(mu))
    
    for n in range(target_mu - search_range, target_mu + search_range + 1):
        if n < min_possible_wu:
            continue
        if is_exact:
            # 向下取整的概率区间为 [n, n + 1)
            p = _norm_cdf(n + 1.0, mu, sigma) - _norm_cdf(n, mu, sigma)
        else:
            # 常规四舍五入的概率区间为 [n - 0.5, n + 0.5)
            p = _norm_cdf(n + 0.5, mu, sigma) - _norm_cdf(n - 0.5, mu, sigma)
            
        if p > 0.01:
            probs[n] = p

    total_p = sum(probs.values())
    sorted_probs = []
    probabilities = []
    probabilities_all = []
    
    if total_p > 0:
        norm_probs = {k: v / total_p for k, v in probs.items()}
        sorted_probs = sorted(norm_probs.items(), key=lambda x: x[1], reverse=True)
        for t, p in sorted_probs:
            rng_str = f"[{t}.0~{t+1}.0)" if is_exact else f"[{t-0.5}~{t+0.5})"
            probabilities_all.append({
                "value": int(t),
                "range": rng_str,
                "probability": round(p, 3)
            })
        probabilities = probabilities_all[:4]

    return {
        "mu": mu,
        "sigma": sigma,
        "probabilities": probabilities,
        "probabilities_all": probabilities_all,
        "sorted_probs": sorted_probs
    }
