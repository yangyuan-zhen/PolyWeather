"""
PolyWeather Web Map API
~~~~~~~~~~~~~~~~~~~~~~~
FastAPI backend that reuses existing weather data collection and analysis modules.
Serves a Leaflet-based interactive map frontend.
"""

import sys
import os
import math
import time as _time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

# Project root setup
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from loguru import logger

from src.utils.config_loader import load_config
from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.city_risk_profiles import CITY_RISK_PROFILES
from src.analysis.deb_algorithm import calculate_dynamic_weights, get_deb_accuracy

# ──────────────────────────────────────────────────────────
#  Setup
# ──────────────────────────────────────────────────────────
app = FastAPI(title="PolyWeather Map", version="1.0")

_static = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(_static, exist_ok=True)
app.mount("/static", StaticFiles(directory=_static), name="static")

_config = load_config()
_weather = WeatherDataCollector(_config)

from src.data_collection.city_registry import CITY_REGISTRY, ALIASES

# ──────────────────────────────────────────────────────────
#  City Registry Transformation
# ──────────────────────────────────────────────────────────
# Convert registry to the internal format expected by app logic
CITIES: Dict[str, Dict[str, Any]] = {
    cid: {
        "lat": info["lat"],
        "lon": info["lon"],
        "f": info["use_fahrenheit"],
        "tz": info["tz_offset"]
    }
    for cid, info in CITY_REGISTRY.items()
}

# ──────────────────────────────────────────────────────────
#  Cache (5-min TTL)
# ──────────────────────────────────────────────────────────
_cache: Dict[str, Dict] = {}
CACHE_TTL = 300
CACHE_TTL_ANKARA = 60  # Ankara measurement updates frequent, narrower cache


def _sf(v) -> Optional[float]:
    """Safe float conversion."""
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────
#  Core Analysis  (replicates bot_listener logic → JSON)
# ──────────────────────────────────────────────────────────
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

    # ── 1. Fetch raw data ──
    raw = _weather.fetch_all_sources(city, lat=lat, lon=lon)
    om = raw.get("open-meteo", {})
    metar = raw.get("metar", {})
    mgm = raw.get("mgm") or {}
    ens_raw = raw.get("ensemble", {})
    mm = raw.get("multi_model", {})
    risk = CITY_RISK_PROFILES.get(city, {})

    # ── 2. Current conditions (METAR primary, MGM fallback) ──
    mc = metar.get("current", {}) if metar else {}
    mg_cur = mgm.get("current", {}) if mgm else {}
    city_lower = city.lower()

    cur_temp = _sf(mc.get("temp"))
    if cur_temp is None:
        cur_temp = _sf(mg_cur.get("temp"))

    max_so_far = _sf(mc.get("max_temp_so_far"))
    if max_so_far is None:
        max_so_far = _sf(mg_cur.get("mgm_max_temp"))

    max_temp_time = mc.get("max_temp_time")
    if not max_temp_time:
        max_temp_time = mg_cur.get("time", "")
        if " " in max_temp_time:
            max_temp_time = max_temp_time.split(" ")[1][:5]

    wu_settle = round(max_so_far) if max_so_far is not None else None

    # Observation time → local
    obs_time_str = ""
    metar_age_min = None
    obs_t = metar.get("observation_time", "") if metar else ""
    # 优先从 API 获取偏移，若失败则使用 CITIES 预设的静态偏移 (兜底当地时间)
    utc_offset = om.get("utc_offset", info.get("tz", 0))
    if obs_t and "T" in obs_t:
        try:
            dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
            local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
            obs_time_str = local_dt.strftime("%H:%M")
            metar_age_min = int(
                (datetime.now(timezone.utc) - dt).total_seconds() / 60
            )
        except Exception:
            obs_time_str = obs_t[:16]

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
        if v is not None:
            current_forecasts[m] = _sf(v)
    nws_high = _sf(raw.get("nws", {}).get("today_high"))
    if nws_high is not None:
        current_forecasts["NWS"] = nws_high
    mb_high = _sf(raw.get("meteoblue", {}).get("today_high"))
    if mb_high is not None:
        current_forecasts["Meteoblue"] = mb_high
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
    from src.analysis.ai_analyzer import get_ai_analysis

    probabilities = []
    mu = None
    ai_text = ""
    try:
        _, ai_context, sd = _trend_analyze(raw, sym, city)

        # Use structured data from shared engine
        mu = sd.get("mu")
        probabilities = sd.get("probabilities", [])
        trend_info["is_dead_market"] = sd.get("trend_info", {}).get("is_dead_market", False)
        trend_info["direction"] = sd.get("trend_info", {}).get("direction", trend_info.get("direction", "unknown"))
        trend_info["is_cooling"] = sd.get("trend_info", {}).get("is_cooling", False)
        peak_status = sd.get("peak_status", peak_status)

        # Use shared DEB if not already set
        if deb_val is None and sd.get("deb_prediction") is not None:
            deb_val = sd["deb_prediction"]
            deb_weights = sd.get("deb_weights", "")

        # Append multi-model divergence for AI
        if current_forecasts and ai_context:
            mm_str = " | ".join(
                [f"{k}:{v}{sym}" for k, v in current_forecasts.items() if v]
            )
            ai_context += f"\n模型分歧: {mm_str}"

        if ai_context:
            ai_text = get_ai_analysis(ai_context, city, sym)
    except Exception as e:
        logger.warning(f"Analysis/AI skipped for {city}: {e}")

    # ── 12. Hourly data (today only, for chart) ──
    today_hourly: Dict[str, list] = {"times": [], "temps": [], "radiation": []}
    for i, ts in enumerate(h_times):
        if ts.startswith(local_date_str):
            today_hourly["times"].append(ts.split("T")[1][:5])
            today_hourly["temps"].append(h_temps[i] if i < len(h_temps) else None)
            today_hourly["radiation"].append(h_rad[i] if i < len(h_rad) else None)

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
            "obs_time": obs_time_str,
            "obs_age_min": metar_age_min,
            "wind_speed_kt": _sf(mc.get("wind_speed_kt")),
            "wind_dir": _sf(mc.get("wind_dir")),
            "humidity": _sf(mc.get("humidity")),
            "cloud_desc": cloud_desc,
            "clouds_raw": [
                {"cover": c.get("cover"), "base": c.get("base")} for c in clouds
            ],
            "visibility_mi": _sf(mc.get("visibility_mi")),
            "wx_desc": mc.get("wx_desc"),
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
        "multi_model": {k: v for k, v in current_forecasts.items() if v is not None},
        "multi_model_daily": multi_model_daily,
        "deb": {"prediction": deb_val, "weights_info": deb_weights},
        "ensemble": ens_data,
        "probabilities": {
            "mu": round(mu, 1) if mu else None,
            "distribution": probabilities,
        },
        "trend": trend_info,
        "peak": {
            "hours": peak_hours,
            "first_h": first_peak_h,
            "last_h": last_peak_h,
            "status": peak_status,
        },
        "hourly": today_hourly,
        "metar_today_obs": [
            {"time": t, "temp": v}
            for t, v in (metar.get("today_obs", []) if metar else [])
        ],
        "ai_analysis": ai_text,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    _cache[city] = {"t": _time.time(), "d": result}
    return result


# ──────────────────────────────────────────────────────────
#  Routes
# ──────────────────────────────────────────────────────────
@app.get("/")
async def index():
    return FileResponse(os.path.join(_static, "index.html"))


@app.get("/api/cities")
async def list_cities():
    """Return all supported cities with coordinates and risk level."""
    out = []
    for name, info in CITIES.items():
        risk = CITY_RISK_PROFILES.get(name, {})
        out.append(
            {
                "name": name,
                "display_name": name.title(),
                "lat": info["lat"],
                "lon": info["lon"],
                "risk_level": risk.get("risk_level", "low"),
                "risk_emoji": risk.get("risk_emoji", "🟢"),
                "airport": risk.get("airport_name", ""),
                "icao": risk.get("icao", ""),
                "temp_unit": "fahrenheit" if info["f"] else "celsius",
                "is_major": CITY_REGISTRY.get(name, {}).get("is_major", True),
            }
        )
    return {"cities": out}


@app.get("/api/city/{name}")
async def city_detail(name: str, force_refresh: bool = False):
    """Return full weather analysis for a single city."""
    name = name.lower().strip().replace("-", " ")
    name = ALIASES.get(name, name)
    if name not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {name}")
    return _analyze(name, force_refresh=force_refresh)


@app.get("/api/history/{name}")
async def city_history(name: str):
    """Return historical accuracy data (DEB, mu, actuals) for a city."""
    name = name.lower().strip().replace("-", " ")
    name = ALIASES.get(name, name)
    
    from src.analysis.deb_algorithm import load_history
    import os
    
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    history_file = os.path.join(project_root, "data", "daily_records.json")
    data = load_history(history_file)
    
    if name not in data:
        return {"history": []}
        
    city_data = data[name]
    out = []
    for d, rec in sorted(city_data.items()):
        act = rec.get("actual_high")
        deb = rec.get("deb_prediction")
        mu = rec.get("mu")
        
        # Only return items where we have at least an actual or a prediction
        out.append({
            "date": d,
            "actual": float(act) if act is not None else None,
            "deb": float(deb) if deb is not None else None,
            "mu": float(mu) if mu is not None else None,
        })
    return {"history": out}

# ──────────────────────────────────────────────────────────
#  Entrypoint
# ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
