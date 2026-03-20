from __future__ import annotations

import time as _time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from fastapi import HTTPException
from loguru import logger

from web.core import (
    _cache,
    CACHE_TTL,
    CACHE_TTL_ANKARA,
    CITIES,
    CITY_RISK_PROFILES,
    SETTLEMENT_SOURCE_LABELS,
    _is_excluded_model_name,
    _market_layer,
    _sf,
    _weather,
)
from src.analysis.deb_algorithm import calculate_dynamic_weights
from src.analysis.settlement_rounding import apply_city_settlement
from src.analysis.metar_narrator import describe_metar_report
from src.data_collection.city_registry import ALIASES

def _analyze(city: str, force_refresh: bool = False) -> Dict[str, Any]:
    """Fetch, analyse, and return structured weather data for one city."""
    # Check cache
    ttl = CACHE_TTL_ANKARA if city.lower() == "ankara" else CACHE_TTL
    
    if not force_refresh:
        cached = _cache.get(city)
        if cached and _time.time() - cached["t"] < ttl:
            return cached["d"]

    info = CITIES[city]
    lat, lon, is_f = info["lat"], info["lon"], info["f"]
    sym = "°F" if is_f else "°C"
    settlement_source = str(info.get("settlement_source") or "metar").strip().lower() or "metar"
    settlement_source_label = SETTLEMENT_SOURCE_LABELS.get(
        settlement_source,
        settlement_source.upper(),
    )

    # ── 1. Fetch raw data ──
    raw = _weather.fetch_all_sources(
        city,
        lat=lat,
        lon=lon,
        force_refresh=force_refresh,
    )
    om = raw.get("open-meteo", {})
    metar = raw.get("metar", {})
    mgm = raw.get("mgm") or {}
    settlement_current = raw.get("settlement_current") or {}
    ens_raw = raw.get("ensemble", {})
    mm = raw.get("multi_model", {})
    if not isinstance(om, dict):
        om = {}
    if not isinstance(metar, dict):
        metar = {}
    if not isinstance(mgm, dict):
        mgm = {}
    if not isinstance(settlement_current, dict):
        settlement_current = {}
    if not isinstance(ens_raw, dict):
        ens_raw = {}
    if not isinstance(mm, dict):
        mm = {}
    risk = CITY_RISK_PROFILES.get(city, {})

    # ── 2. Current conditions (city-specific settlement source first, then METAR/MGM fallback) ──
    mc = metar.get("current", {}) if metar else {}
    mg_cur = mgm.get("current", {}) if mgm else {}
    sc_cur = settlement_current.get("current", {}) if settlement_current else {}
    use_settlement_current = settlement_source in {"hko", "cwa"} and bool(sc_cur)
    primary_current = sc_cur if use_settlement_current else mc
    cur_temp = _sf(primary_current.get("temp"))
    if cur_temp is None:
        cur_temp = _sf(mc.get("temp"))
    if cur_temp is None:
        cur_temp = _sf(mg_cur.get("temp"))

    max_so_far = _sf(primary_current.get("max_temp_so_far"))
    if max_so_far is None:
        max_so_far = _sf(mc.get("max_temp_so_far"))
    if max_so_far is None:
        max_so_far = _sf(mg_cur.get("mgm_max_temp"))

    max_temp_time = primary_current.get("max_temp_time")
    if not max_temp_time and not use_settlement_current:
        max_temp_time = mc.get("max_temp_time")
    if not max_temp_time:
        max_temp_time = mg_cur.get("time", "")
        if " " in max_temp_time:
            max_temp_time = max_temp_time.split(" ")[1][:5]
    if max_temp_time == "":
        max_temp_time = None

    wu_settle = apply_city_settlement(city.lower(), max_so_far) if max_so_far is not None else None

    # Observation time → local
    obs_time_str = ""
    metar_age_min = None
    obs_t = ""
    if use_settlement_current:
        obs_t = str(settlement_current.get("observation_time") or "").strip()
    if not obs_t:
        obs_t = metar.get("observation_time", "") if metar else ""
    # 优先从 API 获取偏移；若缺失则尝试 NWS 动态偏移；最后回退静态配置
    utc_offset = om.get("utc_offset")
    if utc_offset is None:
        try:
            nws_periods = (raw.get("nws", {}) or {}).get("forecast_periods", []) or []
            if nws_periods:
                first_start = nws_periods[0].get("start_time")
                if first_start:
                    maybe_dt = datetime.fromisoformat(str(first_start))
                    if maybe_dt.utcoffset() is not None:
                        utc_offset = int(maybe_dt.utcoffset().total_seconds())
        except Exception:
            utc_offset = None
    if utc_offset is None:
        utc_offset = info.get("tz", 0)
    if obs_t and "T" in obs_t:
        try:
            dt = datetime.fromisoformat(str(obs_t).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            metar_age_min = int(
                (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
            )
        except Exception:
            obs_time_str = str(obs_t)[:16]

    settlement_today_obs = []
    if use_settlement_current:
        if obs_time_str and cur_temp is not None:
            settlement_today_obs.append({"time": obs_time_str, "temp": cur_temp})
        if (
            max_temp_time
            and max_so_far is not None
            and str(max_temp_time) != str(obs_time_str)
        ):
            settlement_today_obs.append({"time": str(max_temp_time), "temp": max_so_far})

    metar_today_obs_payload = (
        []
        if use_settlement_current
        else [
            {"time": t, "temp": v}
            for t, v in (metar.get("today_obs", []) if metar else [])
        ]
    )
    metar_recent_obs_payload = (
        [] if use_settlement_current else (metar.get("recent_obs", []) if metar else [])
    )

    # ── 3. Local time parsing ──
    local_time_full = om.get("current", {}).get("local_time", "")
    local_hour, local_minute = 12, 0
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(seconds=utc_offset)
    local_date_str = local_now.strftime("%Y-%m-%d")
    
    try:
        if local_time_full:
            local_date_str = local_time_full.split(" ")[0]
            tp = local_time_full.split(" ")[1].split(":")
            local_hour = int(tp[0])
            local_minute = int(tp[1]) if len(tp) > 1 else 0
        else:
            local_hour = local_now.hour
            local_minute = local_now.minute
    except Exception:
        local_hour = local_now.hour
        local_minute = local_now.minute
    local_time_str = f"{local_hour:02d}:{local_minute:02d}"
    local_hour_frac = local_hour + local_minute / 60

    # ── 4. Daily forecast ──
    daily = om.get("daily", {})
    dates = daily.get("time", [])[:5]
    maxtemps = daily.get("temperature_2m_max", [])[:5]
    sunrises = daily.get("sunrise", [])
    sunsets = daily.get("sunset", [])
    sunshine = daily.get("sunshine_duration", [])
    om_today = _sf(maxtemps[0]) if maxtemps else None

    forecast_daily = [{"date": d, "max_temp": t} for d, t in zip(dates, maxtemps)]
    if om_today is None:
        nws_high = _sf(raw.get("nws", {}).get("today_high"))
        mgm_high = _sf(mgm.get("today_high")) if mgm else None
        fallback_high = (
            nws_high
            if nws_high is not None
            else mgm_high
            if mgm_high is not None
            else max_so_far
            if max_so_far is not None
            else cur_temp
        )
        if fallback_high is not None:
            om_today = float(fallback_high)
            if not forecast_daily:
                forecast_daily = [{"date": local_date_str, "max_temp": om_today}]
    sunrise = (
        sunrises[0].split("T")[1][:5]
        if sunrises and "T" in str(sunrises[0])
        else ""
    )
    sunset = (
        sunsets[0].split("T")[1][:5]
        if sunsets and "T" in str(sunsets[0])
        else ""
    )
    sunshine_h = round(sunshine[0] / 3600, 1) if sunshine else 0

    # ── 5. Multi-model forecasts ──
    current_forecasts: Dict[str, float] = {}
    if om_today is not None:
        current_forecasts["Open-Meteo"] = om_today
    for m, v in mm.get("forecasts", {}).items():
        if v is not None and not _is_excluded_model_name(m):
            current_forecasts[m] = _sf(v)
    nws_high = _sf(raw.get("nws", {}).get("today_high"))
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    mgm_high = _sf(mgm.get("today_high")) if mgm else None
    if mgm_high is not None:
        current_forecasts["MGM"] = mgm_high

    # ── 6. DEB fusion ──
    deb_val, deb_weights = None, ""
    if current_forecasts:
        blended, winfo = calculate_dynamic_weights(city, current_forecasts)
        if blended is not None:
            deb_val = blended
            deb_weights = winfo

    # ── 7. Ensemble stats ──
    ens_data = {
        "median": _sf(ens_raw.get("median")),
        "p10": _sf(ens_raw.get("p10")),
        "p90": _sf(ens_raw.get("p90")),
    }

    # ── 8. METAR trend ──
    recent_temps = metar.get("recent_temps", []) if metar else []
    trend_info = {
        "direction": "unknown",
        "recent": [{"time": t, "temp": v} for t, v in recent_temps[:6]],
        "is_cooling": False,
        "is_dead_market": False,
    }
    if len(recent_temps) >= 2:
        t_only = [t for _, t in recent_temps]
        latest, prev = t_only[0], t_only[1]
        diff = latest - prev
        if len(t_only) >= 3:
            n = min(3, len(t_only))
            all_same = all(t == latest for t in t_only[:n])
            all_rising = all(t_only[i] >= t_only[i + 1] for i in range(n - 1))
            all_falling = all(t_only[i] <= t_only[i + 1] for i in range(n - 1))
            if all_same:
                trend_info["direction"] = "stagnant"
            elif all_rising and diff > 0:
                trend_info["direction"] = "rising"
            elif all_falling and diff < 0:
                trend_info["direction"] = "falling"
            else:
                trend_info["direction"] = "mixed"
        elif diff > 0:
            trend_info["direction"] = "rising"
        elif diff < 0:
            trend_info["direction"] = "falling"
        else:
            trend_info["direction"] = "stagnant"
    trend_info["is_cooling"] = trend_info["direction"] in ("falling", "stagnant")

    # ── 9. Peak hour detection ──
    hourly = om.get("hourly", {})
    h_times = hourly.get("time", [])
    h_temps = hourly.get("temperature_2m", [])
    h_rad = hourly.get("shortwave_radiation", [])
    h_dew = hourly.get("dew_point_2m", [])
    h_pressure = hourly.get("pressure_msl", [])
    h_wspd = hourly.get("wind_speed_10m", [])
    h_wdir = hourly.get("wind_direction_10m", [])
    h_precip_prob = hourly.get("precipitation_probability", [])
    h_cloud_cover = hourly.get("cloud_cover", [])
    if (not h_times or not h_temps) and metar:
        metar_today_obs = metar.get("today_obs", []) or []
        parsed_obs = []
        for item in metar_today_obs:
            try:
                t_str, t_val = item
                if t_str is None or t_val is None:
                    continue
                hh, minute_part = str(t_str).split(":")
                parsed_obs.append((int(hh), int(minute_part), float(t_val)))
            except Exception:
                continue
        if parsed_obs:
            parsed_obs.sort(key=lambda x: (x[0], x[1]))
            h_times = [f"{local_date_str}T{hh:02d}:{mm:02d}" for hh, mm, _ in parsed_obs]
            h_temps = [v for _, _, v in parsed_obs]
            h_rad = [0 for _ in parsed_obs]
            h_dew = [None for _ in parsed_obs]
            h_pressure = [None for _ in parsed_obs]
            h_wspd = [None for _ in parsed_obs]
            h_wdir = [None for _ in parsed_obs]
            h_precip_prob = [None for _ in parsed_obs]
            h_cloud_cover = [None for _ in parsed_obs]

    peak_hours = []
    if h_times and h_temps and om_today is not None:
        for ts, tmp in zip(h_times, h_temps):
            if ts.startswith(local_date_str) and abs(tmp - om_today) <= 0.2:
                hr = int(ts.split("T")[1][:2])
                if 8 <= hr <= 19:
                    peak_hours.append(ts.split("T")[1][:5])

    first_peak_h = int(peak_hours[0].split(":")[0]) if peak_hours else 13
    last_peak_h = int(peak_hours[-1].split(":")[0]) if peak_hours else 15

    if local_hour_frac > last_peak_h:
        peak_status = "past"
    elif first_peak_h <= local_hour_frac <= last_peak_h:
        peak_status = "in_window"
    else:
        peak_status = "before"

    # ── 10. Shared analysis (probability, trend, AI) via trend_engine ──
    # This single call replaces the duplicate probability engine, dead market
    # detection, forecast bust grading, and AI context building.
    from src.analysis.trend_engine import analyze_weather_trend as _trend_analyze, calculate_prob_distribution

    probabilities = []
    shadow_probabilities = []
    mu = None
    probability_engine = "legacy"
    probability_calibration_mode = "legacy"
    probability_calibration_version = None
    probability_raw_mu = None
    probability_raw_sigma = None
    probability_calibrated_mu = None
    probability_calibrated_sigma = None
    ai_text = ""
    try:
        _, _ai_context, sd = _trend_analyze(raw, sym, city)

        # Use structured data from shared engine
        mu = sd.get("mu")
        probabilities = sd.get("probabilities", [])
        shadow_probabilities = sd.get("shadow_probabilities", [])
        probability_engine = sd.get("probability_engine", "legacy")
        probability_calibration_mode = sd.get("probability_calibration_mode", "legacy")
        probability_calibration_version = sd.get("probability_calibration_version")
        probability_raw_mu = sd.get("probability_raw_mu")
        probability_raw_sigma = sd.get("probability_raw_sigma")
        probability_calibrated_mu = sd.get("probability_calibrated_mu")
        probability_calibrated_sigma = sd.get("probability_calibrated_sigma")
        trend_info["is_dead_market"] = sd.get("trend_info", {}).get("is_dead_market", False)
        trend_info["direction"] = sd.get("trend_info", {}).get("direction", trend_info.get("direction", "unknown"))
        trend_info["is_cooling"] = sd.get("trend_info", {}).get("is_cooling", False)
        peak_status = sd.get("peak_status", peak_status)

        # Use shared DEB if not already set
        if deb_val is None and sd.get("deb_prediction") is not None:
            deb_val = sd["deb_prediction"]
            deb_weights = sd.get("deb_weights", "")

    except Exception as e:
        logger.warning(f"Structured analysis skipped for {city}: {e}")

    ai_text = describe_metar_report(
        raw_metar=str(primary_current.get("raw_metar") or mc.get("raw_metar") or ""),
        temp_symbol=sym,
        fallback={
            "icao": metar.get("icao"),
            "station_name": metar.get("station_name"),
            "temp": cur_temp,
            "wind_speed_kt": _sf(primary_current.get("wind_speed_kt")),
            "wind_dir": _sf(primary_current.get("wind_dir")),
            "altimeter": _sf(primary_current.get("altimeter")),
            "wx_desc": primary_current.get("wx_desc"),
            "clouds": primary_current.get("clouds", []) or mc.get("clouds", []),
        },
    )

    # ── 12. Hourly data (today only, for chart) ──
    today_hourly: Dict[str, list] = {"times": [], "temps": [], "radiation": []}
    for i, ts in enumerate(h_times):
        if ts.startswith(local_date_str):
            today_hourly["times"].append(ts.split("T")[1][:5])
            today_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            today_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)

    # ── 12b. Next 48h hourly block for future-date analysis modal ──
    next_48h_hourly = {
        "times": [],
        "temps": [],
        "radiation": [],
        "dew_point": [],
        "pressure_msl": [],
        "wind_speed_10m": [],
        "wind_direction_10m": [],
        "precipitation_probability": [],
        "cloud_cover": [],
    }
    try:
        local_anchor = datetime.strptime(
            f"{local_date_str} {local_time_str}", "%Y-%m-%d %H:%M"
        )
    except Exception:
        local_anchor = None

    if local_anchor is not None:
        horizon = local_anchor + timedelta(hours=48)
        for i, ts in enumerate(h_times):
            try:
                ts_dt = datetime.fromisoformat(ts)
            except Exception:
                continue
            if ts_dt < local_anchor or ts_dt > horizon:
                continue
            next_48h_hourly["times"].append(ts)
            next_48h_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            next_48h_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)
            next_48h_hourly["dew_point"].append(h_dew[i] if i < len(h_dew) else None)
            next_48h_hourly["pressure_msl"].append(
                h_pressure[i] if i < len(h_pressure) else None
            )
            next_48h_hourly["wind_speed_10m"].append(
                h_wspd[i] if i < len(h_wspd) else None
            )
            next_48h_hourly["wind_direction_10m"].append(
                h_wdir[i] if i < len(h_wdir) else None
            )
            next_48h_hourly["precipitation_probability"].append(
                h_precip_prob[i] if i < len(h_precip_prob) else None
            )
            next_48h_hourly["cloud_cover"].append(
                h_cloud_cover[i] if i < len(h_cloud_cover) else None
            )

    # ── 13. Cloud description (METAR primary, MGM fallback) ──
    clouds = mc.get("clouds", [])
    cloud_desc = ""
    if clouds:
        c_map = {
            "BKN": "多云",
            "OVC": "阴天",
            "FEW": "少云",
            "SCT": "散云",
            "SKC": "晴",
            "CLR": "晴",
        }
        main = clouds[-1]
        cloud_desc = c_map.get(main.get("cover"), main.get("cover", ""))

    if not cloud_desc and mgm:
        mgc_cover = mgm.get("current", {}).get("cloud_cover")
        if mgc_cover is not None:
            cloud_desc_map = {
                0: "晴朗",
                1: "少云",
                2: "少云",
                3: "散云",
                4: "散云",
                5: "多云",
                6: "多云",
                7: "阴天",
                8: "阴天",
            }
            cloud_desc = cloud_desc_map.get(mgc_cover, "")

    # Final fallback: If we have ANY actual observation but no cloud info, it's usually clear.
    if not cloud_desc:
        if mc.get("temp") is not None or (mgm and mgm.get("current", {}).get("temp") is not None):
            # If weather phenomenon exists (e.g. rain), we'll let app.js handle wx_desc priority.
            # Otherwise, clear skies.
            if not mc.get("wx_desc"):
                cloud_desc = "晴朗"

    # ── 14. MGM data (Ankara-specific) ──
    mgm_data = {}
    if mgm:
        mgc = mgm.get("current", {})
        mgm_time_str = mgc.get("time", "")
        # MGM time is usually "2026-03-04T10:40:00.000Z" (UTC)
        if mgm_time_str and "T" in mgm_time_str:
            try:
                # Handle ISO format with Z or +00:00
                ts = mgm_time_str.replace("Z", "+00:00")
                if "+" in ts:
                    base, offset_part = ts.split("+", 1)
                    if "." in base:
                        base = base.split(".")[0]
                    ts = base + "+" + offset_part
                dt = datetime.fromisoformat(ts)
                local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset or 0)))
                mgm_time_str = local_dt.strftime("%H:%M")
            except Exception as e:
                logger.debug(f"MGM time conversion failed: {e}")
                pass
                
        mgm_data = {
            "temp": _sf(mgc.get("temp")),
            "time": mgm_time_str,
            "feels_like": _sf(mgc.get("feels_like")),
            "humidity": _sf(mgc.get("humidity")),
            "wind_dir": _sf(mgc.get("wind_dir")),
            "wind_speed_ms": _sf(mgc.get("wind_speed_ms")),
            "pressure": _sf(mgc.get("pressure")),
            "cloud_cover": mgc.get("cloud_cover"),
            "rain_24h": _sf(mgc.get("rain_24h")),
            "today_high": _sf(mgm.get("today_high")),
            "today_low": _sf(mgm.get("today_low")),
            "hourly": [],
        }

        mgm_hourly = mgm.get("hourly", [])
        for h in mgm_hourly:
            dt_str = h.get("time")
            val = _sf(h.get("temp"))
            if dt_str and "T" in dt_str and val is not None:
                try:
                    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                    local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
                    mgm_data["hourly"].append({
                        "time": local_dt.strftime("%Y-%m-%dT%H:%M"),
                        "temp": val
                    })
                except Exception:
                    pass


    # ── 15. Extended Multi-Model Daily ──
    multi_model_daily = {}
    mm_daily_raw = mm.get("daily_forecasts", {})
    for i, d_str in enumerate(dates):
        if i == 0:
            day_m = current_forecasts.copy()
            d_val, d_winfo = deb_val, deb_weights
        else:
            day_m = mm_daily_raw.get(d_str, {}).copy()
            if i < len(maxtemps) and maxtemps[i] is not None:
                day_m["Open-Meteo"] = _sf(maxtemps[i])
            
            # Add MGM per-day forecast
            mgm_daily = mgm.get("daily_forecasts", {})
            if d_str in mgm_daily:
                day_m["MGM"] = _sf(mgm_daily[d_str])

            day_m = {
                m: v for m, v in day_m.items() if not _is_excluded_model_name(m)
            }
            
            d_val, d_winfo = None, ""
            d_probs = []
            if day_m:
                try:
                    blended, winfo = calculate_dynamic_weights(city, day_m)
                    if blended is not None:
                        d_val = blended
                        d_winfo = winfo
                        
                        # Calculate future probability based on model divergence
                        m_vals = [v for v in day_m.values() if v is not None]
                        if len(m_vals) > 1:
                            # Use spread as a proxy for sigma. 
                            # sigma = (max-min)/2 with a floor of 0.6
                            d_sigma = max(0.6, (max(m_vals) - min(m_vals)) / 2.0)
                        else:
                            d_sigma = 1.0
                        
                        prob_obj = calculate_prob_distribution(d_val, d_sigma, None, sym)
                        d_probs = prob_obj.get("probabilities", [])
                except Exception:
                    pass
        
        if day_m:
            multi_model_daily[d_str] = {
                "models": day_m,
                "deb": {"prediction": d_val, "weights_info": d_winfo},
                "probabilities": d_probs if i > 0 else probabilities # Use today's real prob for today
            }

    # ── Assemble result ──
    result = {
        "name": city,
        "display_name": city.title(),
        "lat": lat,
        "lon": lon,
        "temp_symbol": sym,
        "local_time": local_time_str,
        "local_date": local_date_str,
        "risk": {
            "level": risk.get("risk_level", "low"),
            "emoji": risk.get("risk_emoji", "🟢"),
            "airport": risk.get("airport_name", ""),
            "icao": risk.get("icao", ""),
            "distance_km": risk.get("distance_km", 0),
            "warning": risk.get("warning", ""),
        },
        "current": {
            "temp": cur_temp,
            "max_so_far": max_so_far,
            "max_temp_time": max_temp_time,
            "wu_settlement": wu_settle,
            "settlement_source": settlement_source,
            "settlement_source_label": settlement_source_label,
            "obs_time": obs_time_str,
            "obs_age_min": metar_age_min,
            "report_time": metar.get("report_time") if metar else None,
            "receipt_time": metar.get("receipt_time") if metar else None,
            "obs_time_epoch": metar.get("obs_time_epoch") if metar else None,
            "wind_speed_kt": _sf(primary_current.get("wind_speed_kt")),
            "wind_dir": _sf(primary_current.get("wind_dir")),
            "humidity": _sf(primary_current.get("humidity")),
            "cloud_desc": cloud_desc,
            "clouds_raw": [
                {"cover": c.get("cover"), "base": c.get("base")} for c in clouds
            ],
            "visibility_mi": _sf(primary_current.get("visibility_mi")),
            "wx_desc": primary_current.get("wx_desc"),
            "raw_metar": primary_current.get("raw_metar"),
        },
        "mgm": mgm_data,
        "mgm_nearby": raw.get("mgm_nearby", []),
        "forecast": {
            "today_high": om_today,
            "daily": forecast_daily,
            "sunrise": sunrise,
            "sunset": sunset,
            "sunshine_hours": sunshine_h,
        },
        "source_forecasts": {
            "weather_gov": raw.get("nws") or {},
        },
        "multi_model": {k: v for k, v in current_forecasts.items() if v is not None},
        "multi_model_daily": multi_model_daily,
        "deb": {"prediction": deb_val, "weights_info": deb_weights},
        "ensemble": ens_data,
        "probabilities": {
            "mu": round(mu, 1) if mu is not None else None,
            "distribution": probabilities,
            "engine": probability_engine,
            "calibration_mode": probability_calibration_mode,
            "calibration_version": probability_calibration_version,
            "raw_mu": probability_raw_mu,
            "raw_sigma": probability_raw_sigma,
            "calibrated_mu": probability_calibrated_mu,
            "calibrated_sigma": probability_calibrated_sigma,
            "shadow_distribution": shadow_probabilities,
        },
        "trend": trend_info,
        "peak": {
            "hours": peak_hours,
            "first_h": first_peak_h,
            "last_h": last_peak_h,
            "status": peak_status,
        },
        "hourly": today_hourly,
        "hourly_next_48h": next_48h_hourly,
        "metar_today_obs": metar_today_obs_payload,
        "metar_recent_obs": metar_recent_obs_payload,
        "settlement_today_obs": settlement_today_obs,
        "ai_analysis": ai_text,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    _cache[city] = {"t": _time.time(), "d": result}
    return result


def _normalize_city_or_404(name: str) -> str:
    city = name.lower().strip().replace("-", " ")
    city = ALIASES.get(city, city)
    if city not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {city}")
    return city


def _build_city_summary_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": data.get("name"),
        "display_name": data.get("display_name"),
        "icao": data.get("risk", {}).get("icao"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current": {
            "temp": data.get("current", {}).get("temp"),
            "obs_time": data.get("current", {}).get("obs_time"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
        },
        "deb": {"prediction": data.get("deb", {}).get("prediction")},
        "risk": {
            "level": data.get("risk", {}).get("level"),
            "warning": data.get("risk", {}).get("warning"),
        },
        "updated_at": data.get("updated_at"),
    }


def _build_city_detail_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    city = str(data.get("name") or "").strip().lower()
    local_date = str(data.get("local_date") or "").strip()
    requested_date = str(target_date or "").strip()
    selected_date = requested_date or local_date

    multi_model_daily = data.get("multi_model_daily") or {}
    selected_daily = (
        multi_model_daily.get(selected_date)
        if isinstance(multi_model_daily, dict)
        else None
    )
    if not isinstance(selected_daily, dict):
        selected_daily = {}
        selected_date = local_date

    distribution = selected_daily.get("probabilities")
    if not isinstance(distribution, list) or not distribution:
        distribution = data.get("probabilities", {}).get("distribution", []) or []

    model_map = selected_daily.get("models") or data.get("multi_model") or {}
    if not isinstance(model_map, dict):
        model_map = {}

    anchor_temp = None
    anchor_model = None
    for model_name, raw_value in model_map.items():
        value = _sf(raw_value)
        if value is None:
            continue
        if anchor_temp is None or value > anchor_temp:
            anchor_temp = value
            anchor_model = str(model_name or "").strip() or None

    anchor_temp_c = anchor_temp
    temp_symbol = str(data.get("temp_symbol") or "")
    if anchor_temp_c is not None and "F" in temp_symbol.upper():
        anchor_temp_c = (anchor_temp_c - 32.0) * 5.0 / 9.0
    anchor_settlement = apply_city_settlement(city, anchor_temp_c) if anchor_temp_c is not None else None

    primary_bucket = None
    if isinstance(distribution, list) and distribution:
        if anchor_temp is None:
            primary_bucket = distribution[0]
        else:
            ranked_buckets = []
            for idx, row in enumerate(distribution):
                if not isinstance(row, dict):
                    continue
                bucket_temp = _sf(row.get("value"))
                bucket_prob = _sf(row.get("probability"))
                if bucket_temp is None:
                    continue
                prob_rank = bucket_prob if bucket_prob is not None else -1.0
                ranked_buckets.append((abs(bucket_temp - anchor_temp), -prob_rank, idx, row))
            if ranked_buckets:
                ranked_buckets.sort(key=lambda x: (x[0], x[1], x[2]))
                primary_bucket = ranked_buckets[0][3]
            else:
                primary_bucket = distribution[0]

    model_probability = None
    if isinstance(primary_bucket, dict) and primary_bucket.get("probability") is not None:
        try:
            raw_probability = float(primary_bucket.get("probability"))
            model_probability = raw_probability / 100.0 if raw_probability > 1.0 else raw_probability
        except Exception:
            model_probability = None

    fallback_sparkline = [
        p.get("probability", 0)
        for p in distribution[:8]
        if isinstance(p, dict)
    ]
    market_scan = _market_layer.build_market_scan(
        city=data.get("name"),
        target_date=selected_date or data.get("local_date"),
        temperature_bucket=primary_bucket if isinstance(primary_bucket, dict) else None,
        model_probability=model_probability,
        fallback_sparkline=fallback_sparkline,
        forced_market_slug=market_slug,
    )
    if isinstance(market_scan, dict):
        market_scan["anchor_model"] = anchor_model
        market_scan["anchor_high"] = anchor_temp
        market_scan["anchor_settlement"] = anchor_settlement
        market_scan["open_meteo_settlement"] = anchor_settlement
    return {
        "city": data.get("name"),
        "fetched_at": data.get("updated_at"),
        "overview": {
            "name": data.get("name"),
            "display_name": data.get("display_name"),
            "icao": data.get("risk", {}).get("icao"),
            "airport": data.get("risk", {}).get("airport"),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "local_time": data.get("local_time"),
            "local_date": data.get("local_date"),
            "temp_symbol": data.get("temp_symbol"),
            "current_temp": data.get("current", {}).get("temp"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
            "deb_prediction": data.get("deb", {}).get("prediction"),
            "risk_level": data.get("risk", {}).get("level"),
            "risk_warning": data.get("risk", {}).get("warning"),
            "updated_at": data.get("updated_at"),
        },
        "official": {
            "available": bool(data.get("current", {}).get("temp") is not None),
            "metar": {
                "observation_time": data.get("current", {}).get("obs_time"),
                "obs_age_min": data.get("current", {}).get("obs_age_min"),
                "report_time": data.get("current", {}).get("report_time"),
                "receipt_time": data.get("current", {}).get("receipt_time"),
                "raw_metar": data.get("current", {}).get("raw_metar"),
                "current": data.get("current"),
            },
            "weather_gov": {},
            "mgm": data.get("mgm") or {},
            "mgm_nearby": data.get("mgm_nearby") or [],
            "nearby_source": "mgm" if data.get("name") == "ankara" else "metar_cluster",
        },
        "timeseries": {
            "metar_recent_obs": data.get("metar_recent_obs") or [],
            "metar_today_obs": data.get("metar_today_obs") or [],
            "settlement_today_obs": data.get("settlement_today_obs") or [],
            "hourly": data.get("hourly") or {},
            "mgm_hourly": (data.get("mgm") or {}).get("hourly", []),
            "forecast_daily": (data.get("forecast") or {}).get("daily", []),
        },
        "models": {
            k: v
            for k, v in (data.get("multi_model") or {}).items()
            if not _is_excluded_model_name(k)
        },
        "probabilities": data.get("probabilities") or {"mu": None, "distribution": []},
        "market_scan": market_scan,
        "risk": data.get("risk"),
        "ai_analysis": data.get("ai_analysis") or "",
        "errors": {},
    }


# ──────────────────────────────────────────────────────────
#  Routes
# ──────────────────────────────────────────────────────────
