"""Runway-specific helpers for Telegram push."""

import re
from typing import Any, Dict, List, Optional, Set, Tuple


from src.data_collection.city_time import get_city_utc_offset_seconds
from src.database import db_manager as _db_manager
from src.utils.telegram_i18n import copy_text as _copy

from ._config import (
    FOCUS_RUNWAY_PAIRS,
    SETTLEMENT_RUNWAY_PAIRS,
    SETTLEMENT_RUNWAY_TARGETS,
    WIND_REGIME,
)
from ._helpers import (
    _parse_iso_datetime_utc,
    _safe_float,
)


def _normalize_runway_label(value: Any) -> str:
    return re.sub(r"[^0-9A-Z]+", "", str(value or "").strip().upper())


def _runway_pair_key(r1: Any, r2: Any) -> Tuple[str, str]:
    a = _normalize_runway_label(r1)
    b = _normalize_runway_label(r2)
    return tuple(sorted((a, b)))  # type: ignore[return-value]


def _is_settlement_runway(city: str, r1: str, r2: str) -> bool:
    """Check if a runway pair is the settlement anchor for this city."""
    pair_set = SETTLEMENT_RUNWAY_PAIRS.get((city or "").strip().lower(), set())
    return _runway_pair_key(r1, r2) in pair_set


def _settlement_runway_target_for_city(city: str) -> str:
    city_key = (city or "").strip().lower()
    return _normalize_runway_label(SETTLEMENT_RUNWAY_TARGETS.get(city_key))


def _focus_runway_pairs_for_city(city: str) -> Set[Tuple[str, str]]:
    return {_runway_pair_key(a, b) for a, b in FOCUS_RUNWAY_PAIRS.get(city, set())}


def _runway_pair_from_point(pair: Any, point: Any) -> Tuple[str, str]:
    if isinstance(point, dict):
        rw = str(point.get("runway") or "")
        parts = [_normalize_runway_label(p) for p in rw.split("/") if p.strip()]
        if len(parts) >= 2:
            return parts[0], parts[1]
    try:
        r1, r2 = pair
        return _normalize_runway_label(r1), _normalize_runway_label(r2)
    except Exception:
        return "", ""


def _settlement_endpoint_for_point(
    city: str,
    pair: Any,
    point: Any,
) -> Optional[Dict[str, Any]]:
    if not isinstance(point, dict):
        point = {}
    r1, r2 = _runway_pair_from_point(pair, point)
    if not r1 or not r2 or not _is_settlement_runway(city, r1, r2):
        return None

    target = _settlement_runway_target_for_city(city)
    if target:
        direct_temp = _safe_float(point.get("settlement_runway_temp"))
        direct_runway = _normalize_runway_label(point.get("settlement_runway"))
        if direct_temp is not None and (not direct_runway or direct_runway == target):
            return {
                "temp": direct_temp,
                "pair": f"{r1}/{r2}",
                "runway": target,
                "position": point.get("settlement_runway_position") or "settlement",
                "label": "settle",
            }

        tdz = _safe_float(point.get("tdz_temp"))
        end = _safe_float(point.get("end_temp"))
        if target == r1:
            temp = tdz if tdz is not None else end
            position = "tdz" if tdz is not None else "end_fallback"
        elif target == r2:
            temp = end if end is not None else tdz
            position = "end" if end is not None else "tdz_fallback"
        else:
            return None
        if temp is None:
            return None
        return {
            "temp": temp,
            "pair": f"{r1}/{r2}",
            "runway": target,
            "position": position,
            "label": "settle",
        }

    tmax = _safe_float(point.get("target_runway_max"))
    if tmax is None:
        return None
    return {
        "temp": tmax,
        "pair": f"{r1}/{r2}",
        "runway": "",
        "position": "max",
        "label": "max",
    }


def _settlement_endpoint_from_obs(
    city: str,
    runway_pairs: List[Any],
    point_temps: Optional[List[Any]] = None,
) -> Optional[Dict[str, Any]]:
    points = point_temps or []
    for i, pair in enumerate(runway_pairs or []):
        point = points[i] if i < len(points) else {}
        endpoint = _settlement_endpoint_for_point(city, pair, point)
        if endpoint is not None:
            return endpoint
    return None


def _select_focus_runway_obs(
    city: str,
    runway_pairs: List[Any],
    runway_temps: List[Any],
    point_temps: Optional[List[Any]] = None,
) -> Tuple[List[Any], List[Any], List[Any]]:
    """Return only market-relevant runway pairs when configured for the city.

    If a configured focus pair is not present in the upstream payload, fall back
    to the original lists so the push still carries useful airport evidence.
    """
    focus_pairs = _focus_runway_pairs_for_city(city)
    if not focus_pairs or not runway_pairs or not runway_temps:
        return runway_pairs, runway_temps, point_temps or []

    selected_pairs: List[Any] = []
    selected_temps: List[Any] = []
    selected_points: List[Any] = []
    points = point_temps or []
    for i, (pair, temp) in enumerate(zip(runway_pairs, runway_temps)):
        try:
            r1, r2 = pair
        except Exception:
            continue
        if _runway_pair_key(r1, r2) not in focus_pairs:
            continue
        selected_pairs.append(pair)
        selected_temps.append(temp)
        if i < len(points):
            selected_points.append(points[i])

    if selected_pairs:
        return selected_pairs, selected_temps, selected_points
    return runway_pairs, runway_temps, points


def _settlement_runway_for_city(city: str) -> Optional[Tuple[str, str]]:
    """Return the settlement runway pair for a city, if configured."""
    pairs = SETTLEMENT_RUNWAY_PAIRS.get((city or "").strip().lower(), set())
    return next(iter(pairs)) if pairs else None


def _wind_regime_label(city: str, wind_dir: Optional[int], language: Optional[str] = None) -> Optional[str]:
    """Classify wind direction into a thermal regime label."""
    if wind_dir is None:
        return None
    regimes = WIND_REGIME.get((city or "").strip().lower(), {})
    sea = regimes.get("sea_breeze")
    warm = regimes.get("warm_advection")
    if sea and sea[0] != sea[1] and sea[0] <= wind_dir <= sea[1]:
        return _copy(language, "sea-breeze cooling", "海风降温")
    if warm and warm[0] != warm[1] and warm[0] <= wind_dir <= warm[1]:
        return _copy(language, "warm advection", "暖平流增强")
    return None


def _runway_row_temp_for_city(city: str, row: Dict[str, Any]) -> Optional[float]:
    endpoint = _settlement_endpoint_for_point(city, row.get("runway"), row)
    if endpoint is not None:
        return _safe_float(endpoint.get("temp"))
    target_runway_max = _safe_float(row.get("target_runway_max"))
    if target_runway_max is not None:
        return target_runway_max
    return _safe_float(row.get("tdz_temp"))


def _compute_slope_15m(icao: str, current_temp: float, city: str = "") -> Optional[float]:
    """Estimate 15-minute temperature trend from runway_obs_log."""
    try:
        db = _db_manager.DBManager()
        rows = db.get_runway_obs_recent(icao, minutes=20)
        temps = []
        for r in rows:
            t = _runway_row_temp_for_city(city, r)
            if t is not None:
                temps.append(float(t))
        if len(temps) >= 2:
            # Compare latest vs earliest in ~15 min window
            return round(current_temp - temps[0], 1)
    except Exception:
        pass
    return None


def _runway_heat_signal(
    current_temp: float,
    slope_15m: Optional[float],
    wind_dir: Optional[int],
    city: str,
    language: Optional[str] = None,
) -> str:
    """Compute a simple runway heat signal label."""
    if slope_15m is None:
        return ""
    regime = _wind_regime_label(city, wind_dir, language)
    warm_regime = _copy(language, "warm advection", "暖平流增强")
    sea_regime = _copy(language, "sea-breeze cooling", "海风降温")
    if slope_15m >= 1.0:
        return _copy(language, "🚀 Peak push strengthening", "🚀 冲顶增强") if regime == warm_regime else _copy(language, "🔥 Warming", "🔥 升温中")
    if slope_15m >= 0.5:
        return _copy(language, "🔥 Warming", "🔥 升温中")
    if slope_15m >= -0.2:
        return _copy(language, "⚠️ Watch sea-breeze cooling", "⚠️ 高位观察") if regime == sea_regime else _copy(language, "⏸️ Holding near high", "⏸️ 高位横盘")
    return _copy(language, "🧊 Peak-risk cooling", "🧊 过峰风险")


def _focused_runway_max(city: str, city_weather: Dict[str, Any]) -> Optional[float]:
    amos = city_weather.get("amos") or {}
    runway_obs = (amos.get("runway_obs") or {}) if isinstance(amos, dict) else {}
    runway_pairs = runway_obs.get("runway_pairs") or []
    runway_temps = runway_obs.get("temperatures") or []
    runway_pairs, runway_temps, _points = _select_focus_runway_obs(
        city,
        runway_pairs,
        runway_temps,
        runway_obs.get("point_temperatures") or [],
    )
    endpoint = _settlement_endpoint_from_obs(city, runway_pairs, _points)
    if endpoint is not None:
        return float(endpoint["temp"])
    del runway_pairs
    valid = [float(t) for (t, _d) in runway_temps if t is not None]
    return max(valid) if valid else None


def _runway_history_point_local_date(point: Dict[str, Any], utc_offset_seconds: int) -> str:
    from datetime import timedelta

    raw_time = (
        point.get("time")
        or point.get("timestamp")
        or point.get("observed_at")
        or point.get("otime_utc")
        or ""
    )
    parsed = _parse_iso_datetime_utc(raw_time)
    if parsed is None:
        return ""
    return (parsed + timedelta(seconds=utc_offset_seconds)).date().isoformat()


def _today_runway_history_points(
    points: Any,
    *,
    local_date: str,
    utc_offset_seconds: int,
) -> List[Dict[str, Any]]:
    if not isinstance(points, list):
        return []
    if not local_date:
        return [p for p in points if isinstance(p, dict)]
    return [
        p
        for p in points
        if isinstance(p, dict)
        and _runway_history_point_local_date(p, utc_offset_seconds) == local_date
    ]


def _runway_history_context(city_weather: Dict[str, Any], city: str) -> Tuple[str, int]:
    from datetime import timedelta

    local_date = str(city_weather.get("local_date") or "").strip()
    anchor_values = [
        (city_weather.get("amos") or {}).get("observation_time"),
        (city_weather.get("airport_primary") or {}).get("obs_time"),
        (city_weather.get("airport_current") or {}).get("obs_time"),
        (city_weather.get("current") or {}).get("observed_at"),
        (city_weather.get("canonical_temperature") or {}).get("observed_at"),
    ]
    anchor_dt = next(
        (parsed for parsed in (_parse_iso_datetime_utc(value) for value in anchor_values) if parsed is not None),
        None,
    )
    try:
        utc_offset_seconds = int(
            city_weather.get("utc_offset_seconds")
            if city_weather.get("utc_offset_seconds") is not None
            else get_city_utc_offset_seconds(city, anchor_dt),
        )
    except Exception:
        utc_offset_seconds = 0
    if not local_date and anchor_dt is not None:
        local_date = (anchor_dt + timedelta(seconds=utc_offset_seconds)).date().isoformat()
    return local_date, utc_offset_seconds


def _runway_history_daily_max(city_weather: Dict[str, Any], city: str) -> Optional[float]:
    """Compute today's local-date runway high from runway_plate_history."""
    history = city_weather.get("runway_plate_history")
    if not isinstance(history, dict) or not history:
        return None
    local_date, utc_offset_seconds = _runway_history_context(city_weather, city)
    settlement_pair = _settlement_runway_for_city(city)
    if settlement_pair:
        settlement_key = f"{settlement_pair[0]}/{settlement_pair[1]}"
        settlement_pts = _today_runway_history_points(
            history.get(settlement_key),
            local_date=local_date,
            utc_offset_seconds=utc_offset_seconds,
        )
        if settlement_pts:
            temps = [p.get("temp") for p in settlement_pts if isinstance(p, dict) and p.get("temp") is not None]
            if temps:
                return round(max(temps), 1)
    # Fallback: max across all runways
    all_temps = []
    for pts in history.values():
        today_pts = _today_runway_history_points(
            pts,
            local_date=local_date,
            utc_offset_seconds=utc_offset_seconds,
        )
        all_temps.extend(p.get("temp") for p in today_pts if p.get("temp") is not None)
    return round(max(all_temps), 1) if all_temps else None
