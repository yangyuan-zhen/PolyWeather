"""Independent high-frequency observation collector for the web runtime."""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, List, Optional, Sequence, Tuple

from loguru import logger

from src.data_collection.amos_station_sources import AMOS_AIRPORT_CODES
from src.data_collection.amsc_awos_sources import AMSC_AWOS_AIRPORTS
from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.hko_obs_sources import HKO_STATIONS


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


def _normalized_cities(cities: Iterable[str]) -> Tuple[str, ...]:
    return tuple(sorted({str(city or "").strip().lower() for city in cities if str(city or "").strip()}))


@dataclass(frozen=True)
class ObservationSourceProfile:
    source: str
    cities: Tuple[str, ...]
    interval_sec: int


class ObservationCollector:
    def __init__(
        self,
        *,
        weather: Any,
        profiles: Sequence[ObservationSourceProfile],
        cache_refresher: Optional[Callable[[str], Any]] = None,
    ) -> None:
        self.weather = weather
        self.profiles = list(profiles)
        self.cache_refresher = cache_refresher
        self._last_run_ts: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()

    def run_due_once(self, *, now_ts: Optional[float] = None) -> int:
        now = float(time.time() if now_ts is None else now_ts)
        due: List[tuple[ObservationSourceProfile, str]] = []
        with self._lock:
            for profile in self.profiles:
                interval = max(1, int(profile.interval_sec or 60))
                for city in profile.cities:
                    key = (profile.source, city)
                    last_ts = float(self._last_run_ts.get(key) or 0.0)
                    if now - last_ts >= interval:
                        self._last_run_ts[key] = now
                        due.append((profile, city))

        completed = 0
        for profile, city in due:
            try:
                if self._collect_city_source(profile.source, city):
                    completed += 1
                    self._refresh_city_cache(city)
            except Exception as exc:
                logger.warning(
                    "observation collector source failed source={} city={}: {}",
                    profile.source,
                    city,
                    exc,
                )
        return completed

    def _collect_city_source(self, source: str, city: str) -> bool:
        normalized_source = str(source or "").strip().lower()
        normalized_city = str(city or "").strip().lower()
        if not normalized_source or not normalized_city:
            return False
        use_fahrenheit = bool(self.weather._uses_fahrenheit(normalized_city))
        results: dict[str, Any] = {}

        if normalized_source == "amsc_awos":
            self.weather._attach_china_amsc_awos_data(results, normalized_city, use_fahrenheit)
        elif normalized_source == "amos":
            self.weather._attach_korean_amos_data(results, normalized_city, use_fahrenheit)
        elif normalized_source == "madis_hfmetar":
            self.weather._attach_madis_hfmetar_data(results, normalized_city, use_fahrenheit)
        elif normalized_source == "hko_obs":
            self.weather._attach_hko_obs_official_nearby(results, normalized_city, use_fahrenheit)
        elif normalized_source == "cowin_obs":
            self.weather._attach_cowin_official_nearby(results, normalized_city, use_fahrenheit)
        else:
            logger.debug("observation collector skipped unknown source={}", normalized_source)
            return False
        return bool(results)

    def _refresh_city_cache(self, city: str) -> None:
        if not callable(self.cache_refresher):
            return
        try:
            self.cache_refresher(city)
        except Exception as exc:
            logger.warning("observation collector cache refresh failed city={}: {}", city, exc)


def build_observation_source_profiles() -> List[ObservationSourceProfile]:
    us_madis_cities = [
        city
        for city, meta in CITY_REGISTRY.items()
        if str((meta or {}).get("icao") or "").strip().upper().startswith("K")
    ]
    return [
        ObservationSourceProfile(
            source="amos",
            cities=_normalized_cities(AMOS_AIRPORT_CODES.keys()),
            interval_sec=max(30, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_AMOS_SEC", 60)),
        ),
        ObservationSourceProfile(
            source="amsc_awos",
            cities=_normalized_cities(AMSC_AWOS_AIRPORTS.keys()),
            interval_sec=max(60, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_AMSC_SEC", 180)),
        ),
        ObservationSourceProfile(
            source="madis_hfmetar",
            cities=_normalized_cities(us_madis_cities),
            interval_sec=max(60, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_MADIS_SEC", 300)),
        ),
        ObservationSourceProfile(
            source="cowin_obs",
            cities=("hong kong",),
            interval_sec=max(30, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_COWIN_SEC", 60)),
        ),
        ObservationSourceProfile(
            source="hko_obs",
            cities=_normalized_cities(HKO_STATIONS.keys()),
            interval_sec=max(60, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_HKO_SEC", 600)),
        ),
    ]


_COLLECTOR_THREAD: Optional[threading.Thread] = None
_COLLECTOR_LOCK = threading.Lock()


def start_observation_collector_loop(
    *,
    weather: Any,
    cache_refresher: Optional[Callable[[str], Any]] = None,
    profiles: Optional[Sequence[ObservationSourceProfile]] = None,
) -> Optional[threading.Thread]:
    if not _env_bool("POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED", True):
        return None
    tick_sec = max(5, _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_TICK_SEC", 30))
    initial_delay_sec = max(
        0,
        _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_INITIAL_DELAY_SEC", 5),
    )
    selected_profiles = list(profiles or build_observation_source_profiles())
    collector = ObservationCollector(
        weather=weather,
        profiles=selected_profiles,
        cache_refresher=cache_refresher,
    )

    global _COLLECTOR_THREAD
    with _COLLECTOR_LOCK:
        if _COLLECTOR_THREAD is not None and _COLLECTOR_THREAD.is_alive():
            return _COLLECTOR_THREAD

        def _runner() -> None:
            logger.info(
                "observation collector started profiles={} tick_sec={}",
                len(selected_profiles),
                tick_sec,
            )
            if initial_delay_sec:
                time.sleep(initial_delay_sec)
            while True:
                started = time.time()
                collector.run_due_once(now_ts=started)
                elapsed = time.time() - started
                time.sleep(max(1.0, tick_sec - elapsed))

        _COLLECTOR_THREAD = threading.Thread(
            target=_runner,
            name="observation-collector",
            daemon=True,
        )
        _COLLECTOR_THREAD.start()
        return _COLLECTOR_THREAD
