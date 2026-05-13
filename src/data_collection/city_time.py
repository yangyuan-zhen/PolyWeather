from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from src.data_collection.city_registry import CITY_REGISTRY

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - Python always has zoneinfo in supported runtimes.
    ZoneInfo = None  # type: ignore[assignment]


CITY_TIME_ZONES = {
    "amsterdam": "Europe/Amsterdam",
    "ankara": "Europe/Istanbul",
    "atlanta": "America/New_York",
    "denver": "America/Denver",
    "austin": "America/Chicago",
    "beijing": "Asia/Shanghai",
    "buenos aires": "America/Argentina/Buenos_Aires",
    "busan": "Asia/Seoul",
    "cape town": "Africa/Johannesburg",
    "chengdu": "Asia/Shanghai",
    "chicago": "America/Chicago",
    "chongqing": "Asia/Shanghai",
    "dallas": "America/Chicago",
    "guangzhou": "Asia/Shanghai",
    "helsinki": "Europe/Helsinki",
    "hong kong": "Asia/Hong_Kong",
    "houston": "America/Chicago",
    "istanbul": "Europe/Istanbul",
    "jakarta": "Asia/Jakarta",
    "jeddah": "Asia/Riyadh",
    "karachi": "Asia/Karachi",
    "kuala lumpur": "Asia/Kuala_Lumpur",
    "lagos": "Africa/Lagos",
    "lau fau shan": "Asia/Hong_Kong",
    "london": "Europe/London",
    "los angeles": "America/Los_Angeles",
    "lucknow": "Asia/Kolkata",
    "madrid": "Europe/Madrid",
    "manila": "Asia/Manila",
    "mexico city": "America/Mexico_City",
    "miami": "America/New_York",
    "milan": "Europe/Rome",
    "moscow": "Europe/Moscow",
    "munich": "Europe/Berlin",
    "new york": "America/New_York",
    "panama city": "America/Panama",
    "paris": "Europe/Paris",
    "qingdao": "Asia/Shanghai",
    "san francisco": "America/Los_Angeles",
    "sao paulo": "America/Sao_Paulo",
    "seattle": "America/Los_Angeles",
    "seoul": "Asia/Seoul",
    "shanghai": "Asia/Shanghai",
    "shenzhen": "Asia/Shanghai",
    "singapore": "Asia/Singapore",
    "taipei": "Asia/Taipei",
    "tel aviv": "Asia/Jerusalem",
    "tokyo": "Asia/Tokyo",
    "toronto": "America/Toronto",
    "warsaw": "Europe/Warsaw",
    "wellington": "Pacific/Auckland",
    "wuhan": "Asia/Shanghai",
}


def normalize_city_key(city: Any) -> str:
    return str(city or "").strip().lower()


def get_city_timezone_name(city: Any) -> Optional[str]:
    return CITY_TIME_ZONES.get(normalize_city_key(city))


def _last_weekday(year: int, month: int, weekday: int) -> datetime:
    if month == 12:
        candidate = datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
    else:
        candidate = datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
    while candidate.weekday() != weekday:
        candidate -= timedelta(days=1)
    return candidate


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> datetime:
    candidate = datetime(year, month, 1, tzinfo=timezone.utc)
    while candidate.weekday() != weekday:
        candidate += timedelta(days=1)
    return candidate + timedelta(days=7 * (n - 1))


def _fallback_zone_offset_seconds(tz_name: str, at: datetime, standard_offset: int) -> int:
    moment = at.astimezone(timezone.utc)
    year = moment.year

    if tz_name in {
        "Europe/Amsterdam",
        "Europe/Berlin",
        "Europe/Helsinki",
        "Europe/London",
        "Europe/Madrid",
        "Europe/Paris",
        "Europe/Rome",
        "Europe/Warsaw",
    }:
        start = _last_weekday(year, 3, 6).replace(hour=1, minute=0, second=0, microsecond=0)
        end = _last_weekday(year, 10, 6).replace(hour=1, minute=0, second=0, microsecond=0)
        return standard_offset + 3600 if start <= moment < end else standard_offset

    north_america_standard = {
        "America/New_York": -18000,
        "America/Toronto": -18000,
        "America/Chicago": -21600,
        "America/Denver": -25200,
        "America/Los_Angeles": -28800,
    }
    if tz_name in north_america_standard:
        standard = north_america_standard[tz_name]
        start_hour_utc = 2 - (standard // 3600)
        end_hour_utc = 1 - (standard // 3600)
        start = _nth_weekday(year, 3, 6, 2).replace(hour=start_hour_utc, minute=0, second=0, microsecond=0)
        end = _nth_weekday(year, 11, 6, 1).replace(hour=end_hour_utc, minute=0, second=0, microsecond=0)
        return standard + 3600 if start <= moment < end else standard

    if tz_name == "Pacific/Auckland":
        standard = 43200
        start_local = _last_weekday(year, 9, 6).replace(hour=2, minute=0, second=0, microsecond=0)
        start = (start_local - timedelta(seconds=standard)).replace(tzinfo=timezone.utc)
        end_local = _nth_weekday(year, 4, 6, 1).replace(hour=3, minute=0, second=0, microsecond=0)
        end = (end_local - timedelta(seconds=standard + 3600)).replace(tzinfo=timezone.utc)
        return standard + 3600 if moment >= start or moment < end else standard

    if tz_name == "Asia/Jerusalem":
        start = (_last_weekday(year, 3, 6) - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = _last_weekday(year, 10, 6).replace(hour=0, minute=0, second=0, microsecond=0)
        return 10800 if start <= moment < end else 7200

    return standard_offset


def get_city_utc_offset_seconds(city: Any, at: Optional[datetime] = None) -> int:
    key = normalize_city_key(city)
    meta = CITY_REGISTRY.get(key, {}) or {}
    fallback = int(meta.get("tz_offset") or 0)
    tz_name = CITY_TIME_ZONES.get(key)
    if not tz_name or ZoneInfo is None:
        return _fallback_zone_offset_seconds(tz_name or "", at or datetime.now(timezone.utc), fallback)
    try:
        moment = at or datetime.now(timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        offset = moment.astimezone(ZoneInfo(tz_name)).utcoffset()
        if offset is None:
            return _fallback_zone_offset_seconds(tz_name, moment, fallback)
        return int(offset.total_seconds())
    except Exception:
        return _fallback_zone_offset_seconds(tz_name, at or datetime.now(timezone.utc), fallback)


def city_local_datetime(city: Any, at: Optional[datetime] = None) -> datetime:
    moment = at or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    tz_name = get_city_timezone_name(city)
    if tz_name and ZoneInfo is not None:
        try:
            return moment.astimezone(ZoneInfo(tz_name))
        except Exception:
            pass
    return moment.astimezone(timezone(timedelta(seconds=get_city_utc_offset_seconds(city, moment))))
