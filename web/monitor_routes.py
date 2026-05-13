"""市场监控 — JSON API for frontend React component."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from loguru import logger

from web.analysis_service import _analyze

router = APIRouter()

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


def _sf(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return round(float(v), 1)
    except (ValueError, TypeError):
        return None


def _trend_info(icao: str) -> tuple:
    try:
        from src.utils.telegram_push import _check_rising_trend
        if _check_rising_trend(icao):
            return ("↑", "rising")
    except Exception:
        pass
    try:
        from src.database.db_manager import DBManager
        obs = DBManager().get_airport_obs_recent(icao, minutes=60)
        temps = [r.get("temp_c") for r in obs if r.get("temp_c") is not None]
        if len(temps) >= 4 and temps[-1] < temps[len(temps) // 2]:
            return ("↓", "falling")
    except Exception:
        pass
    return ("→", "flat")


def _obs_age(obs_time_str: Optional[str]) -> Optional[int]:
    if not obs_time_str:
        return None
    try:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(str(obs_time_str)[:26], fmt)
                dt = dt.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - dt).total_seconds()
                return max(0, int(age // 60))
            except (ValueError, TypeError):
                continue
        ts = float(obs_time_str)
        if ts > 1_000_000_000:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            age = (datetime.now(timezone.utc) - dt).total_seconds()
            return max(0, int(age // 60))
    except (ValueError, TypeError, OSError):
        pass
    return None


def _build_cards() -> list:
    cards = []
    for cfg in _CITIES:
        try:
            cw = _analyze(cfg["key"])
            ac = cw.get("airport_current") or {}
            cur = cw.get("current") or {}
            ct = _sf(ac.get("temp")) or _sf(cur.get("temp"))
            msf = ac.get("max_so_far")
            mtt = ac.get("max_temp_time") or ""
            obs = ac.get("obs_time") or ""
            local_time = cw.get("local_time") or ""
            new_high = (ct is not None and msf is not None and ct >= msf + 0.3)
            tsym, tcss = _trend_info(cfg["icao"])
            age = _obs_age(obs)

            rw_html = ""
            if cfg.get("rw"):
                amos = cw.get("amos") or {}
                rw_obs = (amos.get("runway_obs") or {}) if amos else {}
                pairs = rw_obs.get("runway_pairs") or []
                temps = rw_obs.get("temperatures") or []
                for (r1, r2), (t, _d) in zip(pairs, temps):
                    if t is not None:
                        rw_html += f'<div class="runway-row"><span class="runway-label">{r1}/{r2}</span><span class="runway-temp">{round(float(t),1):.1f}°C</span></div>\n'

            cards.append({
                "en_name": cfg["en_name"], "airport": cfg["airport"],
                "obs_time": obs or local_time,
                "current_temp": ct, "max_so_far": _sf(msf), "max_temp_time": mtt,
                "trend_sym": tsym, "trend_css": tcss, "obs_age_min": age,
                "new_high": new_high,
                "temp_warm": ct is not None and ct >= 30,
                "runway_pairs": rw_html,
            })
        except Exception:
            logger.exception("monitor: failed city {}", cfg["key"])

    cards.sort(key=lambda c: (c["current_temp"] is not None, c["current_temp"] or -999), reverse=True)
    return cards


@router.get("/m/json")
async def monitor_json():
    return _build_cards()
