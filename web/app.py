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

# ──────────────────────────────────────────────────────────
#  City Registry
# ──────────────────────────────────────────────────────────
CITIES: Dict[str, Dict[str, Any]] = {
    "ankara":       {"lat": 40.1281,  "lon": 32.9951,   "f": False}, # LTAC (Esenboğa)
    "london":       {"lat": 51.5048,  "lon": 0.0522,    "f": False}, # EGLC (London City)
    "paris":        {"lat": 49.0097,  "lon": 2.5480,    "f": False}, # LFPG (Charles de Gaulle)
    "seoul":        {"lat": 37.4602,  "lon": 126.4407,  "f": False}, # RKSI (Incheon)
    "toronto":      {"lat": 43.6777,  "lon": -79.6248,  "f": False}, # CYYZ (Pearson)
    "buenos aires": {"lat": -34.8222, "lon": -58.5358,  "f": False}, # SAEZ (Ezeiza)
    "wellington":   {"lat": -41.3272, "lon": 174.8053,  "f": False}, # NZWN (Wellington)
    "new york":     {"lat": 40.7769,  "lon": -73.8740,  "f": True},  # KLGA (LaGuardia)
    "chicago":      {"lat": 41.9742,  "lon": -87.9073,  "f": True},  # KORD (O'Hare)
    "dallas":       {"lat": 32.8471,  "lon": -96.8518,  "f": True},  # KDAL (Dallas Love Field)
    "miami":        {"lat": 25.7959,  "lon": -80.2870,  "f": True},  # KMIA (Miami)
    "atlanta":      {"lat": 33.6407,  "lon": -84.4277,  "f": True},  # KATL (Hartsfield-Jackson)
    "seattle":      {"lat": 47.4502,  "lon": -122.3088, "f": True},  # KSEA (Sea-Tac)
}

ALIASES = {
    "ank": "ankara", "lon": "london", "par": "paris",
    "nyc": "new york", "chi": "chicago", "dal": "dallas",
    "mia": "miami", "atl": "atlanta", "sea": "seattle",
    "tor": "toronto", "sel": "seoul", "ba": "buenos aires",
    "wel": "wellington",
}

# ──────────────────────────────────────────────────────────
#  Cache (5-min TTL)
# ──────────────────────────────────────────────────────────
_cache: Dict[str, Dict] = {}
CACHE_TTL = 300


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
def _analyze(city: str) -> Dict[str, Any]:
    """Fetch, analyse, and return structured weather data for one city."""
    # Check cache
    cached = _cache.get(city)
    if cached and _time.time() - cached["t"] < CACHE_TTL:
        return cached["d"]

    info = CITIES[city]
    lat, lon, is_f = info["lat"], info["lon"], info["f"]
    sym = "°F" if is_f else "°C"

    # ── 1. Fetch raw data ──
    raw = _weather.fetch_all_sources(city, lat=lat, lon=lon)
    om = raw.get("open-meteo", {})
    metar = raw.get("metar", {})
    mgm = raw.get("mgm", {})
    ens_raw = raw.get("ensemble", {})
    mm = raw.get("multi_model", {})
    risk = CITY_RISK_PROFILES.get(city, {})

    # ── 2. Current conditions (METAR primary, MGM fallback) ──
    mc = metar.get("current", {}) if metar else {}
    mg_cur = mgm.get("current", {}) if mgm else {}

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
    utc_offset = om.get("utc_offset", 0)
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
    local_date_str = datetime.now().strftime("%Y-%m-%d")
    try:
        local_date_str = local_time_full.split(" ")[0]
        tp = local_time_full.split(" ")[1].split(":")
        local_hour = int(tp[0])
        local_minute = int(tp[1]) if len(tp) > 1 else 0
    except Exception:
        local_hour = datetime.now().hour
        local_minute = datetime.now().minute
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

    # ── 10. Probability distribution ──
    probabilities = []
    mu = None
    if (
        ens_data["p10"] is not None
        and ens_data["p90"] is not None
        and ens_data["median"] is not None
    ):
        sigma = (ens_data["p90"] - ens_data["p10"]) / 2.56
        if sigma < 0.1:
            sigma = 0.1

        # Historical MAE floor
        acc = get_deb_accuracy(city)
        if acc:
            _, hist_mae, _, _ = acc
            if hist_mae > sigma:
                sigma = hist_mae

        # Shock score
        recent_obs = metar.get("recent_obs", []) if metar else []
        shock = 0.0
        if len(recent_obs) >= 2:
            o_obs, n_obs = recent_obs[-1], recent_obs[0]
            wd_o, wd_n = _sf(o_obs.get("wdir")), _sf(n_obs.get("wdir"))
            ws_n = _sf(n_obs.get("wspd")) or 0
            if wd_o is not None and wd_n is not None:
                ad = abs(wd_n - wd_o)
                if ad > 180:
                    ad = 360 - ad
                shock += min(ad / 90, 1) * min(ws_n / 15, 1) * 0.4
            cr_o = o_obs.get("cloud_rank", 0)
            cr_n = n_obs.get("cloud_rank", 0)
            shock += min(abs(cr_n - cr_o) / 3, 1) * 0.35
            ap_o, ap_n = _sf(o_obs.get("altim")), _sf(n_obs.get("altim"))
            if ap_o is not None and ap_n is not None:
                shock += min(abs(ap_n - ap_o) / 4, 1) * 0.25
        if shock > 0.05:
            sigma *= 1 + 0.5 * shock

        # Time-based sigma adjustment
        if local_hour_frac > last_peak_h:
            sigma *= 0.3
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            sigma *= 0.7

        # Mu calculation
        forecast_highs = [h for h in current_forecasts.values() if h is not None]
        forecast_median = (
            sorted(forecast_highs)[len(forecast_highs) // 2]
            if forecast_highs
            else ens_data["median"]
        )
        mu = (
            forecast_median * 0.7 + ens_data["median"] * 0.3
            if forecast_median is not None
            else ens_data["median"]
        )
        if max_so_far is not None and max_so_far > mu:
            mu = max_so_far + (0.3 if not trend_info["is_cooling"] else 0.0)

        def _norm_cdf(x, m, s):
            return 0.5 * (1 + math.erf((x - m) / (s * math.sqrt(2))))

        min_wu = round(max_so_far) if max_so_far is not None else -999
        probs = {}
        for n in range(round(mu) - 2, round(mu) + 3):
            if n < min_wu:
                continue
            p = _norm_cdf(n + 0.5, mu, sigma) - _norm_cdf(n - 0.5, mu, sigma)
            if p > 0.01:
                probs[n] = p
        total = sum(probs.values())
        if total > 0:
            probs = {k: v / total for k, v in probs.items()}
            for t, p in sorted(probs.items(), key=lambda x: x[1], reverse=True)[:4]:
                probabilities.append(
                    {"value": t, "range": f"[{t-0.5}~{t+0.5})", "probability": round(p, 3)}
                )

    # ── 11. Dead market detection ──
    is_dead = False
    if max_so_far is not None and cur_temp is not None:
        if local_hour >= 21 and max_so_far - cur_temp >= 3.0:
            is_dead = True
        elif local_hour > last_peak_h and max_so_far - cur_temp >= 1.5:
            is_dead = True
    trend_info["is_dead_market"] = is_dead

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

    # ── 14. MGM data (Ankara-specific) ──
    mgm_data = {}
    if mgm:
        mgc = mgm.get("current", {})
        mgm_data = {
            "feels_like": _sf(mgc.get("feels_like")),
            "humidity": _sf(mgc.get("humidity")),
            "wind_dir": _sf(mgc.get("wind_dir")),
            "wind_speed_ms": _sf(mgc.get("wind_speed_ms")),
            "pressure": _sf(mgc.get("pressure")),
            "cloud_cover": mgc.get("cloud_cover"),
            "rain_24h": _sf(mgc.get("rain_24h")),
        }

    # ── 15. AI Analysis ──
    ai_text = ""
    try:
        from src.analysis.ai_analyzer import get_ai_analysis

        ai_parts = []
        if deb_val is not None:
            ai_parts.append(f"🧬 DEB融合预测: {deb_val}{sym}")
        if ens_data["median"] is not None:
            ai_parts.append(
                f"📊 集合预报: 中位数 {ens_data['median']}{sym}, "
                f"90%区间 [{ens_data['p10']}{sym} - {ens_data['p90']}{sym}]"
            )
        if cur_temp is not None:
            ai_parts.append(f"🌡️ 当前实测温度: {cur_temp}{sym}")
        if max_so_far is not None:
            ai_parts.append(
                f"🏔️ 今日实测最高温: {max_so_far}{sym} (WU结算={wu_settle}{sym})"
            )
        if trend_info["recent"]:
            ts_str = " → ".join(
                [f"{r['temp']}{sym}@{r['time']}" for r in trend_info["recent"][:3]]
            )
            ai_parts.append(f"📈 METAR趋势: {ts_str}")
        if probabilities:
            prob_str = " | ".join(
                [
                    f"{p['value']}{sym} {p['range']} {int(p['probability']*100)}%"
                    for p in probabilities
                ]
            )
            ai_parts.append(f"🎲 数学概率分布：{prob_str}")

        window = (
            f"{peak_hours[0]} - {peak_hours[-1]}"
            if len(peak_hours) > 1
            else (peak_hours[0] if peak_hours else "13:00 - 15:00")
        )
        if peak_status == "past":
            ai_parts.append(f"⏱️ 状态: 预报峰值时段已过 ({window})。")
        elif peak_status == "in_window":
            remain_w = last_peak_h - local_hour_frac
            ai_parts.append(
                f"⏱️ 状态: 正处于预报最热窗口 ({window})内，距窗口结束约 {int(remain_w*60)} 分钟。"
            )
        else:
            remain = first_peak_h - local_hour_frac
            if remain < 1:
                ai_parts.append(
                    f"⏱️ 状态: 距最热时段开始还有约 {int(remain*60)} 分钟 ({window})，尚未进入峰值窗口。"
                )
            else:
                ai_parts.append(
                    f"⏱️ 状态: 距最热时段开始还有约 {remain:.1f}h ({window})。"
                )

        wind_speed = _sf(mc.get("wind_speed_kt"))
        wind_dir = _sf(mc.get("wind_dir"))
        if wind_speed:
            ai_parts.append(f"🌬️ 风况: 约 {wind_speed}kt (方向 {wind_dir or '未知'}°)。")
        if cloud_desc:
            ai_parts.append(f"☁️ 天空: {cloud_desc}。")
        if current_forecasts:
            mm_str = " | ".join(
                [f"{k}:{v}{sym}" for k, v in current_forecasts.items() if v]
            )
            ai_parts.append(f"模型分歧: {mm_str}")

        ai_context = "\n".join(ai_parts)
        ai_text = get_ai_analysis(ai_context, city, sym)
    except Exception as e:
        logger.warning(f"AI analysis skipped for {city}: {e}")

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
        "forecast": {
            "today_high": om_today,
            "daily": forecast_daily,
            "sunrise": sunrise,
            "sunset": sunset,
            "sunshine_hours": sunshine_h,
        },
        "multi_model": {k: v for k, v in current_forecasts.items() if v is not None},
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
            }
        )
    return {"cities": out}


@app.get("/api/city/{name}")
async def city_detail(name: str):
    """Return full weather analysis for a single city."""
    name = name.lower().strip().replace("-", " ")
    name = ALIASES.get(name, name)
    if name not in CITIES:
        raise HTTPException(404, detail=f"Unknown city: {name}")
    return _analyze(name)


# ──────────────────────────────────────────────────────────
#  Entrypoint
# ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
