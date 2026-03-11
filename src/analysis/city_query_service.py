from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from src.analysis.trend_engine import analyze_weather_trend
from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.data_collection.city_risk_profiles import get_city_risk_profile


FAHRENHEIT_CITIES = {
    "dallas",
    "new york",
    "chicago",
    "miami",
    "atlanta",
    "seattle",
}


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def resolve_city_name(city_input: str) -> Tuple[Optional[str], List[str]]:
    city_input_norm = city_input.strip().lower()
    supported = list(CITY_REGISTRY.keys())

    # 1) Exact alias/name
    city_name = ALIASES.get(city_input_norm)
    if not city_name and city_input_norm in supported:
        city_name = city_input_norm

    # 2) Prefix match
    if not city_name and len(city_input_norm) >= 2:
        for alias, canonical in ALIASES.items():
            if alias.startswith(city_input_norm):
                city_name = canonical
                break
        if not city_name:
            for canonical in supported:
                if canonical.startswith(city_input_norm):
                    city_name = canonical
                    break

    return city_name, sorted(supported)


def _render_local_time(
    open_meteo: Dict[str, Any],
    metar: Dict[str, Any],
    fallback_utc_offset: int,
) -> str:
    utc_offset = open_meteo.get("utc_offset")
    if utc_offset is None:
        utc_offset = fallback_utc_offset
    try:
        local_now = datetime.now(timezone.utc).astimezone(
            timezone(timedelta(seconds=int(utc_offset)))
        )
        return local_now.strftime("%H:%M")
    except Exception:
        pass

    local_time = (open_meteo.get("current") or {}).get("local_time", "")
    if " " in str(local_time):
        return str(local_time).split(" ")[1][:5]

    metar_obs = metar.get("observation_time", "") if metar else ""
    if "T" in str(metar_obs):
        try:
            dt = datetime.fromisoformat(str(metar_obs).replace("Z", "+00:00"))
            utc_offset = open_meteo.get("utc_offset")
            if utc_offset is None:
                utc_offset = fallback_utc_offset
            local_dt = dt.astimezone(timezone(timedelta(seconds=int(utc_offset))))
            return local_dt.strftime("%H:%M")
        except Exception:
            return str(metar_obs).split("T")[1][:5]

    if " " in str(metar_obs):
        return str(metar_obs).split(" ")[1][:5]
    if metar_obs:
        return str(metar_obs)[:5]

    return "N/A"


def _derive_mgm_daily_highs_from_hourly(
    mgm: Dict[str, Any],
    fallback_utc_offset: int,
) -> Dict[str, float]:
    if not isinstance(mgm, dict):
        return {}
    hourly = mgm.get("hourly")
    if not isinstance(hourly, list) or not hourly:
        return {}

    samples: List[Tuple[str, float]] = []
    parsed_datetimes: List[datetime] = []
    local_tz = timezone(timedelta(seconds=int(fallback_utc_offset)))
    for row in hourly:
        if not isinstance(row, dict):
            continue
        temp = _sf(row.get("temp"))
        raw_time = str(row.get("time") or "").strip()
        if temp is None or not raw_time:
            continue

        date_key = None
        if "T" in raw_time:
            try:
                dt = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                if dt.tzinfo is not None:
                    dt = dt.astimezone(local_tz)
                else:
                    dt = dt.replace(tzinfo=local_tz)
                parsed_datetimes.append(dt)
                date_key = dt.strftime("%Y-%m-%d")
            except Exception:
                if len(raw_time) >= 10 and raw_time[4] == "-" and raw_time[7] == "-":
                    date_key = raw_time[:10]
        elif len(raw_time) >= 10 and raw_time[4] == "-" and raw_time[7] == "-":
            date_key = raw_time[:10]

        if not date_key:
            continue

        samples.append((date_key, temp))

    if not samples:
        return {}

    # Guardrail: do not derive "daily highs" from short intraday snippets.
    if parsed_datetimes:
        parsed_datetimes.sort()
        horizon_hours = (
            parsed_datetimes[-1] - parsed_datetimes[0]
        ).total_seconds() / 3600.0
        if horizon_hours < 30:
            return {}
    elif len(samples) < 24:
        return {}

    daily_highs: Dict[str, float] = {}
    for date_key, temp in samples:
        prev = daily_highs.get(date_key)
        daily_highs[date_key] = temp if prev is None else max(prev, temp)

    return daily_highs


def _append_future_forecast_lines(
    lines: List[str],
    weather_data: Dict[str, Any],
    dates: List[str],
    max_temps: List[Any],
    temp_symbol: str,
    fallback_utc_offset: int,
) -> None:
    mgm = weather_data.get("mgm") or {}
    mgm_daily = (mgm.get("daily_forecasts") or {}) if isinstance(mgm, dict) else {}
    mgm_hourly_daily = _derive_mgm_daily_highs_from_hourly(mgm, fallback_utc_offset)
    if not isinstance(mgm_daily, dict):
        mgm_daily = {}
    for date_key, day_high in mgm_hourly_daily.items():
        if date_key not in mgm_daily:
            mgm_daily[date_key] = day_high
    mm_raw = weather_data.get("multi_model") or {}
    mm_daily = mm_raw.get("daily_forecasts", {}) if isinstance(mm_raw, dict) else {}
    nws_periods = (weather_data.get("nws") or {}).get("forecast_periods", []) or []

    if len(dates) > 1:
        future_forecasts = []
        for d, t in zip(dates[1:], max_temps[1:]):
            mgm_value = mgm_daily.get(d) if isinstance(mgm_daily, dict) else None
            if mgm_value is not None:
                mgm_display = f"{float(mgm_value):.1f}"
                future_forecasts.append(
                    f"{d[5:]}: {t}{temp_symbol} | <b>MGM: {mgm_display}{temp_symbol}</b>"
                )
            else:
                future_forecasts.append(f"{d[5:]}: {t}{temp_symbol}")
        lines.append("📅 " + " | ".join(future_forecasts))
        return

    local_now = datetime.now(timezone.utc).astimezone(
        timezone(timedelta(seconds=int(fallback_utc_offset)))
    )
    today_local = local_now.strftime("%Y-%m-%d")

    if isinstance(mgm_daily, dict) and mgm_daily:
        future = []
        for day in sorted(mgm_daily.keys()):
            if day <= today_local:
                continue
            day_temp = mgm_daily.get(day)
            if day_temp is None:
                continue
            future.append(f"{day[5:]}: {day_temp}{temp_symbol}")
            if len(future) >= 2:
                break
        if future:
            lines.append("📅 " + " | ".join(future))
        return

    if isinstance(mm_daily, dict) and mm_daily:
        future = []
        for day in sorted(mm_daily.keys()):
            if day <= today_local:
                continue
            models = mm_daily.get(day, {}) or {}
            vals = [_sf(v) for v in models.values()]
            vals = [v for v in vals if v is not None]
            if not vals:
                continue
            vals.sort()
            median = vals[len(vals) // 2]
            future.append(f"{day[5:]}: MM中位 {median:.1f}{temp_symbol}")
            if len(future) >= 2:
                break
        if future:
            lines.append("📅 " + " | ".join(future))
        return

    if isinstance(nws_periods, list) and nws_periods:
        future = []
        seen_days = set()
        for period in nws_periods:
            if not period.get("is_daytime"):
                continue
            day_temp = _sf(period.get("temperature"))
            start_time = str(period.get("start_time") or "")
            if day_temp is None or "T" not in start_time:
                continue
            day = start_time[:10]
            if day <= today_local or day in seen_days:
                continue
            seen_days.add(day)
            future.append(f"{day[5:]}: NWS {day_temp:.0f}{temp_symbol}")
            if len(future) >= 2:
                break
        if future:
            lines.append("📅 " + " | ".join(future))


def _build_wx_summary(
    metar_current: Dict[str, Any],
    metar_clouds: List[Dict[str, Any]],
    mgm_cloud: Optional[Any],
) -> str:
    wx_desc = str(metar_current.get("wx_desc") or "").upper().strip()
    if wx_desc:
        tokens = set(wx_desc.split())
        rain_codes = {"RA", "DZ", "-RA", "+RA", "-DZ", "+DZ", "TSRA", "SHRA", "FZRA"}
        snow_codes = {"SN", "GR", "GS", "-SN", "+SN", "BLSN"}
        fog_codes = {"FG", "BR", "HZ", "FZFG"}
        ts_codes = {"TS", "TSRA"}
        if ts_codes & tokens:
            return "⛈️ 雷暴"
        if {"+RA", "+SN"} & tokens:
            return "🌧️ 大雨" if "+RA" in tokens else "❄️ 大雪"
        if rain_codes & tokens:
            return "🌧️ 小雨" if {"-RA", "-DZ", "DZ"} & tokens else "🌧️ 下雨"
        if snow_codes & tokens:
            return "❄️ 下雪"
        if fog_codes & tokens:
            return "🌫️ 雾 / 霾"

    cover_code = ""
    if metar_clouds:
        cover_code = str((metar_clouds[-1] or {}).get("cover") or "")

    if cover_code in ("SKC", "CLR") or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 1):
        return "☀️ 晴"
    if cover_code == "FEW" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 2):
        return "🌤️ 晴间少云"
    if cover_code == "SCT" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 4):
        return "⛅ 晴间多云"
    if cover_code == "BKN" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 6):
        return "🌥️ 多云"
    if cover_code == "OVC" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 8):
        return "☁️ 阴天"
    if mgm_cloud is not None:
        cloud_names = {
            0: "☀️ 晴",
            1: "☀️ 晴",
            2: "🌤️ 少云",
            3: "⛅ 散云",
            4: "⛅ 散云",
            5: "🌥️ 多云",
            6: "🌥️ 多云",
            7: "☁️ 阴",
            8: "☁️ 阴天",
        }
        return cloud_names.get(int(mgm_cloud), "")
    return ""


def build_city_query_report(
    city_name: str,
    weather_data: Dict[str, Any],
    city_query_cost: int,
) -> str:
    open_meteo = weather_data.get("open-meteo", {}) or {}
    metar = weather_data.get("metar", {}) or {}
    mgm = weather_data.get("mgm") or {}
    city_meta = CITY_REGISTRY.get(city_name.lower(), {})
    fallback_utc_offset = int(city_meta.get("tz_offset", 0))
    nws_periods = ((weather_data.get("nws") or {}).get("forecast_periods") or [])
    if nws_periods:
        try:
            first_start = nws_periods[0].get("start_time")
            if first_start:
                maybe_dt = datetime.fromisoformat(str(first_start))
                if maybe_dt.utcoffset() is not None:
                    fallback_utc_offset = int(maybe_dt.utcoffset().total_seconds())
        except Exception:
            pass

    city_is_fahrenheit = city_name.strip().lower() in FAHRENHEIT_CITIES
    temp_symbol = "°F" if city_is_fahrenheit else "°C"

    time_str = _render_local_time(open_meteo, metar, fallback_utc_offset)
    risk_profile = get_city_risk_profile(city_name)
    risk_emoji = risk_profile.get("risk_level", "⚠️") if risk_profile else "⚠️"

    msg_lines = [f"📍 <b>{city_name.title()}</b> ({time_str}) {risk_emoji}"]
    if risk_profile:
        bias = risk_profile.get("bias", "±0.0")
        msg_lines.append(
            f"⚠️ {risk_profile.get('airport_name', '')}: {bias}{temp_symbol} | {risk_profile.get('warning', '')}"
        )

    daily = open_meteo.get("daily", {}) or {}
    dates = (daily.get("time") or [])[:3]
    max_temps = (daily.get("temperature_2m_max") or [])[:3]

    nws_high = _sf((weather_data.get("nws") or {}).get("today_high"))
    mgm_high = _sf((mgm.get("today_high") if isinstance(mgm, dict) else None))
    metar_max_so_far = _sf((metar.get("current") or {}).get("max_temp_so_far"))

    today_t = _sf(max_temps[0]) if max_temps else None
    fallback_source = None
    metar_only_fallback = False
    if today_t is None:
        for source_name, candidate in (("NWS", nws_high), ("MGM", mgm_high)):
            if candidate is not None:
                today_t = candidate
                fallback_source = source_name
                break
    if today_t is None and metar_max_so_far is not None:
        today_t = metar_max_so_far
        metar_only_fallback = True

    today_t_display = f"{today_t:.1f}" if isinstance(today_t, (int, float)) else "N/A"
    sources = ["Open-Meteo"] if max_temps else []
    comp_parts: List[str] = []

    if nws_high is not None:
        if "NWS" not in sources:
            sources.append("NWS")
        if fallback_source != "NWS":
            comp_parts.append(f"NWS: {nws_high:.1f}{temp_symbol}")
    if mgm_high is not None:
        if "MGM" not in sources:
            sources.append("MGM")
        if fallback_source != "MGM":
            comp_parts.append(f"MGM: {mgm_high:.1f}{temp_symbol}")
    if fallback_source and fallback_source not in sources:
        sources.append(fallback_source)
    if metar_only_fallback:
        if not sources:
            sources = ["Model unavailable"]
        comp_parts.append(f"METAR实测回退: {metar_max_so_far:.1f}{temp_symbol}")
    if not sources:
        sources = ["N/A"]

    comp_str = f" ({' | '.join(comp_parts)})" if comp_parts else ""
    msg_lines.append(f"\n📊 <b>预报 ({' | '.join(sources)})</b>")
    msg_lines.append(
        f"👉 <b>今天: {today_t_display}{temp_symbol}{comp_str}</b>"
    )

    _append_future_forecast_lines(
        lines=msg_lines,
        weather_data=weather_data,
        dates=dates,
        max_temps=max_temps,
        temp_symbol=temp_symbol,
        fallback_utc_offset=fallback_utc_offset,
    )

    sunrises = daily.get("sunrise", []) or []
    sunsets = daily.get("sunset", []) or []
    sunshine_durations = daily.get("sunshine_duration", []) or []
    if sunrises and sunsets:
        sunrise_t = str(sunrises[0]).split("T")[1][:5] if "T" in str(sunrises[0]) else str(sunrises[0])
        sunset_t = str(sunsets[0]).split("T")[1][:5] if "T" in str(sunsets[0]) else str(sunsets[0])
        sun_line = f"🌅 日出 {sunrise_t} | 🌇 日落 {sunset_t}"
        if sunshine_durations:
            sun_line += f" | ☀️ 日照 {float(sunshine_durations[0]) / 3600:.1f}h"
        msg_lines.append(sun_line)

    metar_current = metar.get("current", {}) if isinstance(metar, dict) else {}
    mgm_current = mgm.get("current", {}) if isinstance(mgm, dict) else {}
    cur_temp = _sf(metar_current.get("temp"))
    if cur_temp is None:
        cur_temp = _sf(mgm_current.get("temp"))
    max_p = _sf(metar_current.get("max_temp_so_far"))
    max_p_time = metar_current.get("max_temp_time")
    obs_t_str = "N/A"
    metar_age_min = None
    main_source = "METAR" if metar else "MGM"

    if metar and metar.get("observation_time"):
        obs_t = str(metar.get("observation_time"))
        try:
            if "T" in obs_t:
                dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
                utc_offset = open_meteo.get("utc_offset")
                if utc_offset is None:
                    utc_offset = fallback_utc_offset
                local_dt = dt.astimezone(timezone(timedelta(seconds=int(utc_offset))))
                obs_t_str = local_dt.strftime("%H:%M")
                metar_age_min = int((datetime.now(timezone.utc) - dt).total_seconds() / 60)
            elif " " in obs_t:
                obs_t_str = obs_t.split(" ")[1][:5]
            else:
                obs_t_str = obs_t
        except Exception:
            obs_t_str = obs_t[:16]
    elif mgm:
        mgm_time = str(mgm_current.get("time") or "")
        if "T" in mgm_time:
            dt = datetime.fromisoformat(mgm_time.replace("Z", "+00:00"))
            mgm_time = dt.astimezone(timezone(timedelta(hours=3))).strftime("%H:%M")
        elif " " in mgm_time:
            mgm_time = mgm_time.split(" ")[1][:5]
        obs_t_str = mgm_time or "N/A"

    age_tag = ""
    if metar_age_min is not None:
        if metar_age_min >= 60:
            age_tag = f" ⚠️{metar_age_min}分钟前"
        elif metar_age_min >= 30:
            age_tag = f" 🔔{metar_age_min}分钟前"

    max_str = ""
    if max_p is not None:
        settled_val = int(max_p + 0.5)
        max_str = f" (最高: {max_p}{temp_symbol}"
        if max_p_time:
            max_str += f" @{max_p_time}"
        max_str += f" → WU {settled_val}{temp_symbol})"

    metar_clouds = metar_current.get("clouds", []) if isinstance(metar_current, dict) else []
    mgm_cloud = mgm_current.get("cloud_cover") if isinstance(mgm_current, dict) else None
    wx_summary = _build_wx_summary(metar_current, metar_clouds, mgm_cloud)
    wx_display = f" {wx_summary}" if wx_summary else ""
    msg_lines.append(
        f"\n✈️ <b>实测 ({main_source}): {cur_temp}{temp_symbol}</b>{max_str} |{wx_display} | {obs_t_str}{age_tag}"
    )

    if metar:
        wind = metar_current.get("wind_speed_kt")
        wind_dir = metar_current.get("wind_dir")
        vis = metar_current.get("visibility_mi")
        if not mgm:
            msg_lines.append(f"   [METAR] 🌪 {wind or 0}kt ({wind_dir or 0}°) | 👁️ {vis or 10}mi")
    if mgm:
        wind_dir = mgm_current.get("wind_dir")
        wind_speed_ms = mgm_current.get("wind_speed_ms")
        if wind_dir is not None and wind_speed_ms is not None:
            dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
            dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风"
            msg_lines.append(
                f"   [MGM] 🌬️ {dir_str}{wind_dir}° ({wind_speed_ms} m/s) | 💧 降水: {mgm_current.get('rain_24h') or 0}mm"
            )

    feature_str, ai_context, _structured = analyze_weather_trend(weather_data, temp_symbol, city_name)
    if feature_str:
        msg_lines.append("\n💡 <b>分析</b>:")
        for line in feature_str.split("\n"):
            if line.strip():
                msg_lines.append(f"- {line.strip()}")

        try:
            from src.analysis.ai_analyzer import get_ai_analysis

            mm = weather_data.get("multi_model", {}) or {}
            if not isinstance(mm, dict):
                mm = {}
            if mm.get("forecasts"):
                mm_parts = [
                    f"{k}:{v}{temp_symbol}"
                    for k, v in (mm.get("forecasts") or {}).items()
                    if v is not None
                ]
                if mm_parts:
                    ai_context += f"\n模型分歧: {' | '.join(mm_parts)}"

            ai_result = get_ai_analysis(ai_context, city_name, temp_symbol)
            if ai_result:
                msg_lines.append(f"\n{ai_result}")
        except Exception as exc:
            logger.error(f"调用 Groq AI 分析失败: {exc}")

    msg_lines.append(f"\n💸 本次消耗 <b>{city_query_cost}</b> 积分。")
    return "\n".join(msg_lines)
