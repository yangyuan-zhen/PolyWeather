"""Low-priority cache warmer for user-facing aggregate payloads."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, List, Mapping, Optional, Sequence

from loguru import logger

from src.database.db_manager import DBManager


ASIA_CORE_CITIES = (
    "hong kong",
    "taipei",
    "tokyo",
    "seoul",
    "busan",
    "shanghai",
    "beijing",
    "guangzhou",
    "qingdao",
    "shenzhen",
    "chongqing",
    "chengdu",
    "singapore",
    "kuala lumpur",
    "jakarta",
)
EUROPE_CORE_CITIES = (
    "istanbul",
    "ankara",
    "moscow",
    "tel aviv",
    "london",
    "paris",
    "madrid",
    "milan",
    "warsaw",
    "amsterdam",
    "helsinki",
)
US_CORE_CITIES = (
    "new york",
    "los angeles",
    "san francisco",
    "austin",
    "houston",
    "chicago",
    "dallas",
    "miami",
    "atlanta",
    "seattle",
)
DEFAULT_HOT_CITIES = ASIA_CORE_CITIES + EUROPE_CORE_CITIES + US_CORE_CITIES
SOURCE_PRIORITY_WEIGHT = {
    "hko": 10,
    "noaa": 8,
    "mgm": 8,
    "metar": 6,
    "wunderground": 4,
}
_CACHE_WARMER_DB = DBManager()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _normalize_city_name(city: str) -> str:
    return str(city or "").strip().lower().replace("-", " ")


def _parse_city_list(raw: Optional[str]) -> Sequence[str]:
    if not raw:
        return ()
    out: List[str] = []
    for part in raw.split(","):
        city = _normalize_city_name(part)
        if city and city not in out:
            out.append(city)
    return tuple(out)


def _coerce_utc_offset_seconds(meta: Mapping[str, Any]) -> int:
    for key in ("tz", "tz_offset", "utc_offset_seconds"):
        raw = meta.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except Exception:
            continue
        if abs(value) <= 24:
            value *= 3600
        return int(value)
    return 0


def _local_hour(meta: Mapping[str, Any], now_utc: datetime) -> int:
    offset = _coerce_utc_offset_seconds(meta)
    return int((now_utc + timedelta(seconds=offset)).hour)


@dataclass(frozen=True)
class WarmCandidate:
    city: str
    score: int
    local_hour: int
    settlement_source: str


def rank_priority_cities(
    cities: Mapping[str, Mapping[str, Any]],
    *,
    now_utc: Optional[datetime] = None,
    hot_cities: Optional[Iterable[str]] = None,
) -> List[WarmCandidate]:
    """Rank cities by local activity window and source usefulness."""

    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    hot_set = {
        _normalize_city_name(city)
        for city in (DEFAULT_HOT_CITIES if hot_cities is None else hot_cities)
    }
    ranked: List[WarmCandidate] = []
    for raw_city, raw_meta in cities.items():
        city = _normalize_city_name(raw_city)
        if not city:
            continue
        meta = raw_meta or {}
        hour = _local_hour(meta, now)
        source = str(meta.get("settlement_source") or "metar").strip().lower()
        score = SOURCE_PRIORITY_WEIGHT.get(source, 3)
        if city in hot_set:
            score += 30
        if 9 <= hour < 18:
            score += 40
        elif 6 <= hour < 22:
            score += 25
        else:
            score += 2
        ranked.append(
            WarmCandidate(
                city=city,
                score=score,
                local_hour=hour,
                settlement_source=source,
            )
        )
    ranked.sort(key=lambda item: (-item.score, item.local_hour, item.city))
    return ranked


def build_priority_city_batch(
    cities: Mapping[str, Mapping[str, Any]],
    *,
    now_utc: Optional[datetime] = None,
    batch_size: int = 8,
    hot_cities: Optional[Iterable[str]] = None,
) -> List[str]:
    ranked = rank_priority_cities(cities, now_utc=now_utc, hot_cities=hot_cities)
    limit = max(0, int(batch_size or 0))
    return [candidate.city for candidate in ranked[:limit]]


class CacheWarmer:
    def __init__(
        self,
        *,
        city_provider: Callable[[], Mapping[str, Mapping[str, Any]]],
        scan_warmer: Callable[..., Any],
        city_panel_warmer: Callable[..., Any],
        scan_interval_sec: int = 120,
        city_interval_sec: int = 30,
        city_batch_size: int = 16,
        hot_cities: Optional[Iterable[str]] = None,
    ) -> None:
        self.city_provider = city_provider
        self.scan_warmer = scan_warmer
        self.city_panel_warmer = city_panel_warmer
        self.scan_interval_sec = max(60, int(scan_interval_sec or 120))
        self.city_interval_sec = max(30, int(city_interval_sec or 30))
        self.city_batch_size = max(1, min(32, int(city_batch_size or 16)))
        self.hot_cities = tuple(hot_cities or DEFAULT_HOT_CITIES)
        self._last_scan_ts = 0.0
        self._last_city_ts = 0.0
        self._city_cursor = 0

    def run_due_once(self, *, now_ts: Optional[float] = None) -> int:
        now = float(time.time() if now_ts is None else now_ts)
        completed = 0
        if now - self._last_scan_ts >= self.scan_interval_sec:
            self._last_scan_ts = now
            if self._warm_scan():
                completed += 1
        if now - self._last_city_ts >= self.city_interval_sec:
            self._last_city_ts = now
            completed += self._warm_city_batch(now_ts=now)
        return completed

    def _warm_scan(self) -> bool:
        try:
            self.scan_warmer({}, force_refresh=False)
            return True
        except Exception as exc:
            logger.warning("cache warmer scan payload failed: {}", exc)
            return False

    def _warm_city_batch(self, *, now_ts: float) -> int:
        try:
            cities = self.city_provider() or {}
        except Exception as exc:
            logger.warning("cache warmer city provider failed: {}", exc)
            return 0
        ranked = rank_priority_cities(
            cities,
            now_utc=datetime.fromtimestamp(now_ts, timezone.utc),
            hot_cities=self.hot_cities,
        )
        if not ranked:
            return 0
        start = self._city_cursor % len(ranked)
        self._city_cursor += self.city_batch_size
        selected = ranked[start : start + self.city_batch_size]
        if len(selected) < self.city_batch_size:
            selected.extend(ranked[: self.city_batch_size - len(selected)])

        completed = 0
        for candidate in selected:
            try:
                self.city_panel_warmer(candidate.city, force_refresh=False)
                completed += 1
            except Exception as exc:
                logger.warning(
                    "cache warmer city panel failed city={} source={}: {}",
                    candidate.city,
                    candidate.settlement_source,
                    exc,
                )
        return completed


def _queue_city_panel_refresh(city: str, *, force_refresh: bool = False) -> bool:
    _CACHE_WARMER_DB.enqueue_observation_refresh_request(
        city=city,
        kind="panel",
        priority="normal",
        reason="cache_warmer",
    )
    return True


def build_default_cache_warmer() -> CacheWarmer:
    from web.core import CITIES
    from web.scan_terminal_service import build_scan_terminal_payload

    hot_cities = _parse_city_list(os.getenv("POLYWEATHER_WARMER_HOT_CITIES"))
    return CacheWarmer(
        city_provider=lambda: CITIES,
        scan_warmer=build_scan_terminal_payload,
        city_panel_warmer=_queue_city_panel_refresh,
        scan_interval_sec=_env_int("POLYWEATHER_WARMER_SCAN_INTERVAL_SEC", 120),
        city_interval_sec=_env_int("POLYWEATHER_WARMER_CITY_INTERVAL_SEC", 30),
        city_batch_size=_env_int("POLYWEATHER_WARMER_CITY_BATCH_SIZE", 16),
        hot_cities=hot_cities or DEFAULT_HOT_CITIES,
    )


def warmer_enabled() -> bool:
    return _env_bool("POLYWEATHER_WARMER_ENABLED", True)


def warmer_tick_sec() -> int:
    return max(10, _env_int("POLYWEATHER_WARMER_TICK_SEC", 30))
