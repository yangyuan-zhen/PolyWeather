"""Independent high-frequency observation collector for the web runtime."""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Iterable, List, Optional, Sequence, Tuple

from loguru import logger

from src.data_collection.amos_station_sources import AMOS_AIRPORT_CODES
from src.data_collection.amsc_awos_sources import AMSC_AWOS_AIRPORTS
from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.hko_obs_sources import HKO_STATIONS
from src.database.db_manager import DBManager
from src.database.runtime_state import ObservationCollectorStatusRepository


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
        status_recorder: Optional[ObservationCollectorStatusRepository] = None,
        observation_store: Optional[Any] = None,
        async_cache_refresh: Optional[bool] = None,
        cache_refresh_workers: Optional[int] = None,
    ) -> None:
        self.weather = weather
        self.profiles = list(profiles)
        self.cache_refresher = cache_refresher
        self.status_recorder = status_recorder
        self.observation_store = observation_store
        self._last_run_ts: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()
        self._cache_refresh_lock = threading.Lock()
        self._cache_refresh_inflight: set[str] = set()
        self._cache_refresh_async = (
            _env_bool("POLYWEATHER_OBSERVATION_COLLECTOR_CACHE_REFRESH_ASYNC", True)
            if async_cache_refresh is None
            else bool(async_cache_refresh)
        )
        worker_count = max(
            1,
            min(
                4,
                int(
                    cache_refresh_workers
                    if cache_refresh_workers is not None
                    else _env_int("POLYWEATHER_OBSERVATION_COLLECTOR_CACHE_REFRESH_WORKERS", 1)
                ),
            ),
        )
        self._cache_refresh_executor: Optional[ThreadPoolExecutor] = (
            ThreadPoolExecutor(max_workers=worker_count)
            if callable(cache_refresher) and self._cache_refresh_async
            else None
        )

    def run_due_once(self, *, now_ts: Optional[float] = None) -> int:
        now = float(time.time() if now_ts is None else now_ts)
        due: List[tuple[ObservationSourceProfile, str, Optional[int]]] = []
        with self._lock:
            for profile in self.profiles:
                interval = max(1, int(profile.interval_sec or 60))
                for city in profile.cities:
                    key = (profile.source, city)
                    last_ts = float(self._last_run_ts.get(key) or 0.0)
                    if now - last_ts >= interval:
                        self._last_run_ts[key] = now
                        due.append((profile, city, None))

        due.extend(self._claim_due_refresh_requests(now))

        completed = 0
        for profile, city, request_id in due:
            started_wall = time.time()
            started_ts = now if now_ts is not None else started_wall
            ok = False
            error: Optional[str] = None
            try:
                ok = self._collect_city_source(profile.source, city)
                if ok:
                    completed += 1
                    self._refresh_city_cache(city)
                else:
                    error = "no_results"
            except Exception as exc:
                error = str(exc) or exc.__class__.__name__
                logger.warning(
                    "observation collector source failed source={} city={}: {}",
                    profile.source,
                    city,
                    exc,
                )
            finally:
                completed_ts = started_ts + max(0.0, time.time() - started_wall)
                self._record_source_status(
                    profile=profile,
                    city=city,
                    due_ts=now,
                    started_ts=started_ts,
                    completed_ts=completed_ts,
                    ok=ok,
                    error=error,
                )
                self._mark_refresh_request_done(request_id, ok=ok, error=error)
        return completed

    def _claim_due_refresh_requests(self, now: float) -> List[tuple[ObservationSourceProfile, str, Optional[int]]]:
        store = self.observation_store
        claimer = getattr(store, "claim_observation_refresh_requests", None)
        if not callable(claimer):
            return []
        try:
            requests = claimer(limit=50, owner="observation_collector", now_ts=now)
        except Exception as exc:
            logger.debug("observation refresh request claim skipped: {}", exc)
            return []
        due: List[tuple[ObservationSourceProfile, str, Optional[int]]] = []
        for request in requests or []:
            if not isinstance(request, dict):
                continue
            city = str(request.get("city") or "").strip().lower()
            requested_source = str(request.get("source") or "").strip().lower()
            request_id = int(request.get("id") or 0) or None
            matched = False
            rate_limited = False
            for profile in self.profiles:
                profile_source = str(profile.source or "").strip().lower()
                if requested_source and requested_source != profile_source:
                    continue
                if city not in set(profile.cities):
                    continue
                key = (profile.source, city)
                interval = max(1, int(profile.interval_sec or 60))
                with self._lock:
                    last_ts = float(self._last_run_ts.get(key) or 0.0)
                    if last_ts and now - last_ts < interval:
                        rate_limited = True
                        continue
                    self._last_run_ts[key] = now
                due.append((profile, city, request_id))
                matched = True
            if not matched:
                reason = "rate_limited" if rate_limited else "no_matching_profile"
                self._mark_refresh_request_done(request_id, ok=False, error=reason)
        return due

    def _mark_refresh_request_done(
        self,
        request_id: Optional[int],
        *,
        ok: bool,
        error: Optional[str],
    ) -> None:
        if not request_id:
            return
        store = self.observation_store
        marker = getattr(store, "mark_observation_refresh_request_done", None)
        if not callable(marker):
            return
        try:
            marker(
                request_id,
                status="done" if ok else "failed",
                error="" if ok else str(error or "collection_failed"),
            )
        except Exception as exc:
            logger.debug("observation refresh request completion skipped id={}: {}", request_id, exc)

    def _record_source_status(
        self,
        *,
        profile: ObservationSourceProfile,
        city: str,
        due_ts: float,
        started_ts: float,
        completed_ts: float,
        ok: bool,
        error: Optional[str],
    ) -> None:
        if not self.status_recorder:
            return
        try:
            self.status_recorder.record_result(
                source=profile.source,
                city=city,
                interval_sec=profile.interval_sec,
                due_ts=due_ts,
                started_ts=started_ts,
                completed_ts=completed_ts,
                ok=ok,
                error=error,
            )
        except Exception as exc:
            logger.warning(
                "observation collector status write failed source={} city={}: {}",
                profile.source,
                city,
                exc,
            )

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
        ok = bool(results)
        if ok:
            self._store_raw_observations(normalized_source, normalized_city, results)
        return ok

    @staticmethod
    def _observation_value(row: dict[str, Any]) -> Optional[float]:
        for key in ("temp_c", "temperature_c", "temp", "value"):
            try:
                value = row.get(key)
                if value is not None and value != "":
                    return float(value)
            except (TypeError, ValueError):
                continue
        current = row.get("current")
        if isinstance(current, dict):
            try:
                value = current.get("temp")
                if value is not None and value != "":
                    return float(value)
            except (TypeError, ValueError):
                return None
        return None

    @staticmethod
    def _observation_time(row: dict[str, Any]) -> str:
        for key in ("observation_time", "observed_at", "obs_time", "time_utc", "time"):
            value = str(row.get(key) or "").strip()
            if value:
                return value
        return ""

    @staticmethod
    def _station_code(row: dict[str, Any]) -> str:
        for key in ("station_code", "icao", "istNo", "station_id", "code"):
            value = str(row.get(key) or "").strip()
            if value:
                return value
        return ""

    @staticmethod
    def _station_name(row: dict[str, Any]) -> str:
        for key in ("station_name", "station_label", "name", "label"):
            value = str(row.get(key) or "").strip()
            if value:
                return value
        return ""

    def _iter_raw_observation_rows(
        self,
        source: str,
        results: dict[str, Any],
    ) -> Iterable[dict[str, Any]]:
        for value in (results or {}).values():
            if isinstance(value, dict):
                yield value
                continue
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        yield item

    def _store_raw_observations(self, source: str, city: str, results: dict[str, Any]) -> None:
        store = self.observation_store
        writer = getattr(store, "append_raw_observation", None)
        if not callable(writer):
            return
        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        wrote = 0
        for row in self._iter_raw_observation_rows(source, results):
            value = self._observation_value(row)
            if value is None:
                continue
            payload_source = str(row.get("source") or row.get("source_code") or source).strip().lower()
            try:
                writer(
                    source=payload_source or source,
                    city=city,
                    value=value,
                    observed_at=self._observation_time(row),
                    fetched_at=fetched_at,
                    station_code=self._station_code(row),
                    station_name=self._station_name(row),
                    runway=str(row.get("runway") or "").strip(),
                    value_unit=str(row.get("unit") or row.get("temp_unit") or "c").strip().lower(),
                    status="ok",
                    payload=dict(row),
                )
                wrote += 1
            except Exception as exc:
                logger.debug(
                    "raw observation store write skipped source={} city={}: {}",
                    source,
                    city,
                    exc,
                )
        if wrote:
            logger.debug("raw observations stored source={} city={} count={}", source, city, wrote)

    def _refresh_city_cache(self, city: str) -> None:
        if not callable(self.cache_refresher):
            return
        normalized_city = str(city or "").strip().lower()
        if not normalized_city:
            return
        if self._cache_refresh_executor is None:
            self._refresh_city_cache_inline(normalized_city)
            return
        with self._cache_refresh_lock:
            if normalized_city in self._cache_refresh_inflight:
                return
            self._cache_refresh_inflight.add(normalized_city)
        try:
            self._cache_refresh_executor.submit(self._refresh_city_cache_task, normalized_city)
        except Exception as exc:
            with self._cache_refresh_lock:
                self._cache_refresh_inflight.discard(normalized_city)
            logger.warning(
                "observation collector cache refresh queue failed city={}: {}",
                normalized_city,
                exc,
            )

    def _refresh_city_cache_task(self, city: str) -> None:
        try:
            self._refresh_city_cache_inline(city)
        finally:
            with self._cache_refresh_lock:
                self._cache_refresh_inflight.discard(city)

    def _refresh_city_cache_inline(self, city: str) -> None:
        try:
            self.cache_refresher(city)
        except Exception as exc:
            logger.warning("observation collector cache refresh failed city={}: {}", city, exc)

    def close(self) -> None:
        if self._cache_refresh_executor is not None:
            self._cache_refresh_executor.shutdown(wait=False)


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
    status_recorder: Optional[ObservationCollectorStatusRepository] = None,
    observation_store: Optional[Any] = None,
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
        status_recorder=status_recorder or ObservationCollectorStatusRepository(),
        observation_store=observation_store or DBManager(),
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
