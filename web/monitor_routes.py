"""市场监控网页版 — 寄生 FastAPI，复用 _analyze() 全量数据。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from loguru import logger

from web.analysis_service import _analyze

router = APIRouter()
templates = Jinja2Templates(directory="web/templates")

# ── city config (与 telegram_push 一致) ──

_CITIES: List[Dict[str, Any]] = [
    {"key": "seoul",       "en_name": "Seoul",       "icao": "RKSI",    "airport": "Incheon",      "tz": 9,  "tz_abbr": "KST",  "rw": True},
    {"key": "busan",       "en_name": "Busan",       "icao": "RKPK",    "airport": "Gimhae",       "tz": 9,  "tz_abbr": "KST",  "rw": True},
    {"key": "tokyo",       "en_name": "Tokyo",       "icao": "44166",   "airport": "Haneda",       "tz": 9,  "tz_abbr": "JST",  "rw": False},
    {"key": "ankara",      "en_name": "Ankara",      "icao": "17128",   "airport": "Esenboğa",     "tz": 3,  "tz_abbr": "TRT",  "rw": False},
    {"key": "helsinki",    "en_name": "Helsinki",    "icao": "EFHK",    "airport": "Vantaa",       "tz": 3,  "tz_abbr": "EEST", "rw": False},
    {"key": "amsterdam",   "en_name": "Amsterdam",   "icao": "EHAM",    "airport": "Schiphol",     "tz": 2,  "tz_abbr": "CEST", "rw": False},
    {"key": "istanbul",    "en_name": "Istanbul",    "icao": "17058",   "airport": "Airport",      "tz": 3,  "tz_abbr": "TRT",  "rw": False},
    {"key": "paris",       "en_name": "Paris",       "icao": "LFPB",    "airport": "Le Bourget",   "tz": 2,  "tz_abbr": "CEST", "rw": False},
    {"key": "hong kong",   "en_name": "Hong Kong",   "icao": "HKO",     "airport": "Observatory",  "tz": 8,  "tz_abbr": "HKT",  "rw": False},
    {"key": "lau fau shan","en_name": "Lau Fau Shan","icao": "LFS",     "airport": "Lau Fau Shan", "tz": 8,  "tz_abbr": "HKT",  "rw": False},
    {"key": "taipei",      "en_name": "Taipei",      "icao": "466920",  "airport": "Songshan",     "tz": 8,  "tz_abbr": "TST",  "rw": False},
]

# ── helpers ──

def _sf(v: Any) -> Optional[float]:
    """Safe float."""
    if v is None:
        return None
    try:
        return round(float(v), 1)
    except (ValueError, TypeError):
        return None

def _trend_info(icao: str) -> tuple[str, str]:
    """Return (symbol, css_class) from _check_rising_trend."""
    try:
        from src.utils.telegram_push import _check_rising_trend
        ok = _check_rising_trend(icao)
    except Exception:
        return ("→", "flat")
    if ok:
        return ("↑", "rising")
    # Check if falling (temp decreasing)
    try:
        from src.database.db_manager import DBManager
        obs = DBManager().get_airport_obs_recent(icao, minutes=60)
        temps = [r.get("temp_c") for r in obs if r.get("temp_c") is not None]
        if len(temps) >= 4 and temps[-1] < temps[len(temps)//2]:
            return ("↓", "falling")
    except Exception:
        pass
    return ("→", "flat")

def _obs_age(obs_time_str: Optional[str]) -> Optional[int]:
    """Compute minutes since observation time."""
    if not obs_time_str:
        return None
    try:
        # Try parsing various formats
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                     "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                dt = datetime.strptime(str(obs_time_str)[:26], fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - dt).total_seconds()
                return max(0, int(age // 60))
            except ValueError:
                continue
        # Try as epoch
        ts = float(obs_time_str)
        if ts > 1_000_000_000:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            age = (datetime.now(timezone.utc) - dt).total_seconds()
            return max(0, int(age // 60))
    except (ValueError, TypeError):
        pass
    return None

def _runway_pairs(city_weather: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract runway pairs from AMOS data."""
    amos = city_weather.get("amos") or {}
    rw_obs = (amos.get("runway_obs") or {}) if amos else {}
    pairs = rw_obs.get("runway_pairs") or []
    temps = rw_obs.get("temperatures") or []
    result = []
    for (r1, r2), (t, _d) in zip(pairs, temps):
        if t is not None:
            result.append({"label": f"{r1}/{r2}", "temp": round(float(t), 1)})
    return result

def _build_city_card(city: str, city_weather: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Build a single city's card data."""
    ac = city_weather.get("airport_current") or {}
    cur = city_weather.get("current") or {}
    ct = _sf(ac.get("temp")) or _sf(cur.get("temp"))
    max_so_far = ac.get("max_so_far")
    max_temp_time = ac.get("max_temp_time")
    obs_time_str = ac.get("obs_time") or ""
    local_time = city_weather.get("local_time") or ""
    new_high = (ct is not None and max_so_far is not None and ct >= max_so_far + 0.3)

    trend_sym, trend_css = _trend_info(cfg["icao"])
    age = _obs_age(obs_time_str)
    rw = _runway_pairs(city_weather) if cfg.get("rw") else []

    return {
        "en_name": cfg["en_name"],
        "airport": cfg["airport"],
        "icao": cfg["icao"],
        "obs_time_str": obs_time_str or local_time,
        "local_time": local_time,
        "current_temp": ct,
        "max_so_far": _sf(max_so_far),
        "max_temp_time": max_temp_time,
        "trend_sym": trend_sym,
        "trend_css": trend_css,
        "obs_age_min": age,
        "new_high": new_high,
        "runway_pairs": rw,
    }

def _load_all_cities() -> List[Dict[str, Any]]:
    cards = []
    for cfg in _CITIES:
        try:
            cw = _analyze(cfg["key"])
            card = _build_city_card(cfg["key"], cw, cfg)
            cards.append(card)
        except Exception:
            logger.exception("monitor: failed to load city {}", cfg["key"])
    # Sort by temp descending, None at bottom
    cards.sort(key=lambda c: (c["current_temp"] is not None, c["current_temp"] or -999), reverse=True)
    return cards

# ── routes ──

@router.get("/m", response_class=HTMLResponse)
async def monitor_page(request: Request):
    cities = _load_all_cities()
    return templates.TemplateResponse("monitor.html", {
        "request": request,
        "cities": cities,
        "full_page": True,
        "generated_at": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
    })

@router.get("/m/cards", response_class=HTMLResponse)
async def monitor_cards(request: Request):
    cities = _load_all_cities()
    return templates.TemplateResponse("monitor.html", {
        "request": request,
        "cities": cities,
        "full_page": False,
        "generated_at": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
    })
