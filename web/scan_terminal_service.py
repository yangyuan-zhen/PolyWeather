from __future__ import annotations

import re
import threading
import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from src.database.db_manager import DBManager
from web.core import CITIES
from web.services.scan_terminal_config import (
    SCAN_TERMINAL_BUILD_TIMEOUT_SEC,
    SCAN_TERMINAL_MAX_WORKERS,
    SCAN_TERMINAL_PAYLOAD_TTL_SEC,
    SCAN_TERMINAL_PREWARM_PAYLOAD_TIMEOUT_SEC,
)
from src.data_collection.city_registry import ALIASES
from web.scan_terminal_cache import (
    clear_scan_terminal_refreshing,
    get_cached_scan_terminal_payload,
    get_scan_terminal_cache_entry,
    mark_scan_terminal_refreshing,
    scan_terminal_cache_key,
    set_cached_scan_terminal_payload,
    set_scan_terminal_failure_state,
)
from web.scan_terminal_city_row import (
    _fetch_scan_terminal_multi_model_batch,
    _scan_city_terminal_rows,
)
from web.scan_terminal_filters import (
    normalize_scan_terminal_filters as _normalize_scan_terminal_filters,
)
from web.scan_terminal_payloads import (
    build_failed_scan_terminal_payload,
    build_scan_terminal_incremental_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
    compact_ranked_scan_rows_for_payload,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result

_SCAN_TERMINAL_INFLIGHT_BUILD_LOCK = threading.Lock()
_SCAN_TERMINAL_INFLIGHT_BUILDS: Dict[str, Future] = {}
_SCAN_PREWARM_DB = DBManager()
SCAN_TERMINAL_STALE_SUCCESS_MAX_AGE_SEC = max(
    SCAN_TERMINAL_PAYLOAD_TTL_SEC * 2,
    600,
)


def _normalize_locale(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "en-US" if text.startswith("en") else "zh-CN"


def _normalize_city_key(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", " ")
    text = re.sub(r"\s+", " ", text)
    return ALIASES.get(text, text)


def _rows_count(payload: Dict[str, Any]) -> int:
    rows = payload.get("rows")
    return len(rows) if isinstance(rows, list) else 0


def _model_bearing_rows_count(rows: Any) -> int:
    if not isinstance(rows, list):
        return 0
    count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        sources = row.get("model_cluster_sources")
        if isinstance(sources, dict) and sources:
            count += 1
    return count


def _success_payload_within_stale_window(cached_entry: Dict[str, Any]) -> bool:
    timestamp = cached_entry.get("success_t") or cached_entry.get("t")
    try:
        success_ts = float(timestamp)
    except Exception:
        return True
    return (time.time() - success_ts) <= float(SCAN_TERMINAL_STALE_SUCCESS_MAX_AGE_SEC)


def _build_scan_terminal_incremental_from_cache_entry(
    *,
    filters: Dict[str, Any],
    current_payload: Dict[str, Any],
    cached_entry: Optional[Dict[str, Any]],
    since_snapshot_id: Optional[str],
) -> Dict[str, Any]:
    base_payload: Optional[Dict[str, Any]] = None
    since_snapshot_id = str(since_snapshot_id or "").strip()
    candidates: List[Any] = [current_payload]
    if isinstance(cached_entry, dict):
        candidates.extend(
            [
                cached_entry.get("success_payload"),
                cached_entry.get("previous_success_payload"),
                cached_entry.get("payload"),
            ]
        )
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("snapshot_id") == since_snapshot_id:
            base_payload = candidate
            break
    return build_scan_terminal_incremental_payload(
        filters=filters,
        current_payload=current_payload,
        since_snapshot_id=since_snapshot_id,
        base_payload=base_payload,
    )


def _build_stale_payload_for_timeout_if_better_cached(
    *,
    filters: Dict[str, Any],
    cached_entry: Dict[str, Any],
    ranked_rows: List[Dict[str, Any]],
    timeout_message: Optional[str],
) -> Optional[Dict[str, Any]]:
    success_payload = cached_entry.get("success_payload")
    if not isinstance(success_payload, dict) or not success_payload.get("rows"):
        return None
    if _model_bearing_rows_count(ranked_rows) > _model_bearing_rows_count(
        success_payload.get("rows")
    ):
        return None
    if _rows_count(success_payload) < len(ranked_rows):
        return None

    error_message = timeout_message or "市场扫描快照正在刷新中"
    set_scan_terminal_failure_state(filters, error_message=error_message)
    failed_entry = get_scan_terminal_cache_entry(filters) or cached_entry
    return build_stale_scan_terminal_payload(
        filters=filters,
        success_payload=success_payload,
        error_message=error_message,
        failed_at=failed_entry.get("last_failed_at"),
    )


def _start_scan_terminal_background_refresh(filters: Dict[str, Any]) -> bool:
    if not mark_scan_terminal_refreshing(filters):
        return False

    def _runner() -> None:
        try:
            _build_scan_terminal_payload_singleflight(filters, force_refresh=False)
        except Exception as exc:  # pragma: no cover - defensive background guard
            logger.warning("scan terminal background refresh failed: {}", exc)
        finally:
            clear_scan_terminal_refreshing(filters)

    thread = threading.Thread(
        target=_runner,
        name="polyweather-scan-terminal-refresh",
        daemon=True,
    )
    thread.start()
    return True


def _build_scan_terminal_payload_uncached(
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
    timeout_sec: Optional[float] = None,
) -> Dict[str, Any]:
    cached_entry = get_scan_terminal_cache_entry(filters) or {}

    try:
        city_names = list(CITIES.keys())
        build_timeout_sec = float(
            timeout_sec
            if timeout_sec is not None
            else SCAN_TERMINAL_BUILD_TIMEOUT_SEC
        )
        timezone_offset = filters.get("timezone_offset_seconds")
        if timezone_offset is not None:
            target_tz = int(timezone_offset)
            city_names = [
                city_name
                for city_name in city_names
                if int((CITIES.get(city_name) or {}).get("tz", 0)) == target_tz
            ]
        region_filter = str(filters.get("trading_region") or "").strip().lower()
        if region_filter and region_filter not in ("all", ""):
            from web.scan_terminal_filters import market_region_from_tz_offset as _tz_region

            def _city_in_region(city_name: str) -> bool:
                city_meta = CITIES.get(city_name) or {}
                tz = city_meta.get("tz", 0)
                return _tz_region(tz)["key"] == region_filter

            city_names = [c for c in city_names if _city_in_region(c)]
        city_results: List[Dict[str, Any]] = []
        failed_cities: List[str] = []
        failed_reasons: List[str] = []
        multi_model_overrides = _fetch_scan_terminal_multi_model_batch(city_names)
        scan_city_names = (
            [city_name for city_name in city_names if city_name in multi_model_overrides]
            if multi_model_overrides
            else city_names
        )
        max_workers = max(1, min(SCAN_TERMINAL_MAX_WORKERS, len(scan_city_names)))

        timed_out = False
        timeout_message: Optional[str] = None
        if multi_model_overrides:
            for city_name in scan_city_names:
                try:
                    city_results.append(
                        _scan_city_terminal_rows(
                            city_name,
                            filters,
                            force_refresh=force_refresh,
                            multi_model_override=multi_model_overrides.get(city_name),
                            allow_direct_fetch=False,
                        )
                    )
                except Exception as exc:
                    failed_cities.append(city_name)
                    failed_reasons.append(str(exc))
                    logger.warning(
                        "scan terminal city failed city={}: {}", city_name, exc
                    )
        else:
            executor = ThreadPoolExecutor(max_workers=max_workers)
            future_map = {
                executor.submit(
                    _scan_city_terminal_rows,
                    city_name,
                    filters,
                    force_refresh=force_refresh,
                    multi_model_override=multi_model_overrides.get(city_name),
                    allow_direct_fetch=False,
                ): city_name
                for city_name in scan_city_names
            }
            try:
                try:
                    completed = as_completed(
                        future_map,
                        timeout=build_timeout_sec,
                    )
                    for future in completed:
                        city_name = future_map[future]
                        try:
                            city_results.append(future.result())
                        except Exception as exc:
                            failed_cities.append(city_name)
                            failed_reasons.append(str(exc))
                            logger.warning(
                                "scan terminal city failed city={}: {}", city_name, exc
                            )
                except FutureTimeoutError:
                    timed_out = True
                    timeout_message = (
                        f"scan terminal build timed out after {build_timeout_sec:g}s"
                    )
                    failed_reasons.append(timeout_message)
                    for future, city_name in future_map.items():
                        if not future.done():
                            future.cancel()
                            failed_cities.append(city_name)
                    logger.warning(
                        "{}; completed={}/{}",
                        timeout_message,
                        len(city_results),
                        len(scan_city_names),
                    )
            finally:
                executor.shutdown(wait=False)

        if scan_city_names and len(failed_cities) >= len(scan_city_names):
            error_message = (
                failed_reasons[0] if failed_reasons else "all city market scans failed"
            )
            set_scan_terminal_failure_state(filters, error_message=error_message)
            failed_entry = get_scan_terminal_cache_entry(filters) or {}
            success_payload = failed_entry.get("success_payload")
            failed_at = failed_entry.get("last_failed_at")
            if isinstance(success_payload, dict) and success_payload:
                return build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=error_message,
                    failed_at=failed_at,
                )
            return build_failed_scan_terminal_payload(
                filters=filters,
                error_message=error_message,
                failed_at=failed_at,
            )

        ranked_result = build_ranked_scan_terminal_result(
            city_results=city_results,
            filters=filters,
            total_city_count=len(city_names),
            failed_city_count=len(failed_cities),
        )
        ranked_rows = compact_ranked_scan_rows_for_payload(
            ranked_result["ranked_rows"]
        )

        if timed_out and not ranked_rows:
            success_payload = cached_entry.get("success_payload")
            if isinstance(success_payload, dict) and success_payload.get("rows"):
                return build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=timeout_message or "市场扫描快照正在刷新中",
                    failed_at=cached_entry.get("last_failed_at"),
                )

        summary = ranked_result["summary"]
        top_signal = ranked_result["top_signal"]
        if timed_out:
            stale_payload = _build_stale_payload_for_timeout_if_better_cached(
                filters=filters,
                cached_entry=cached_entry,
                ranked_rows=ranked_rows,
                timeout_message=timeout_message,
            )
            if stale_payload is not None:
                return stale_payload
        success_payload = cached_entry.get("success_payload")
        if (
            isinstance(success_payload, dict)
            and _model_bearing_rows_count(success_payload.get("rows")) > 0
            and _model_bearing_rows_count(ranked_rows) == 0
        ):
            error_message = "scan terminal refresh returned rows without model forecasts"
            set_scan_terminal_failure_state(filters, error_message=error_message)
            failed_entry = get_scan_terminal_cache_entry(filters) or {}
            return build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=error_message,
                failed_at=failed_entry.get("last_failed_at"),
            )

        payload = {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "filters": filters,
            "summary": summary,
            "top_signal": top_signal,
            "rows": ranked_rows,
            "status": "partial" if timed_out else "ready",
            "stale": False,
            "stale_reason": timeout_message,
            "last_success_at": None,
            "last_failed_at": None,
        }
        payload["snapshot_id"] = build_scan_terminal_snapshot_id(
            filters,
            ranked_rows,
            summary,
            top_signal,
        )

        set_cached_scan_terminal_payload(filters, payload)
        return payload
    except Exception as exc:
        error_message = str(exc)
        logger.exception("scan terminal payload build failed: {}", error_message)
        set_scan_terminal_failure_state(filters, error_message=error_message)
        success_payload = cached_entry.get("success_payload")
        failed_entry = get_scan_terminal_cache_entry(filters) or {}
        failed_at = failed_entry.get("last_failed_at")
        if isinstance(success_payload, dict) and success_payload:
            return build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=error_message,
                failed_at=failed_at,
            )
        return build_failed_scan_terminal_payload(
            filters=filters,
            error_message=error_message,
            failed_at=failed_at,
        )


def _build_scan_terminal_payload_singleflight(
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    cache_key = scan_terminal_cache_key(filters)
    owner = False
    with _SCAN_TERMINAL_INFLIGHT_BUILD_LOCK:
        future = _SCAN_TERMINAL_INFLIGHT_BUILDS.get(cache_key)
        if future is None:
            owner = True
            future = Future()
            _SCAN_TERMINAL_INFLIGHT_BUILDS[cache_key] = future

    if not owner:
        logger.debug("scan terminal joining in-flight build key={}", cache_key)
        return future.result()

    try:
        payload = _build_scan_terminal_payload_uncached(
            filters,
            force_refresh=force_refresh,
        )
    except Exception as exc:
        future.set_exception(exc)
        raise
    else:
        future.set_result(payload)
        return payload
    finally:
        with _SCAN_TERMINAL_INFLIGHT_BUILD_LOCK:
            if _SCAN_TERMINAL_INFLIGHT_BUILDS.get(cache_key) is future:
                _SCAN_TERMINAL_INFLIGHT_BUILDS.pop(cache_key, None)


def build_scan_terminal_payload(
    raw_filters: Optional[Dict[str, Any]] = None,
    *,
    force_refresh: bool = False,
    diff: bool = False,
    since_snapshot_id: Optional[str] = None,
    timing_recorder: Any = None,
) -> Dict[str, Any]:
    filters = (
        timing_recorder.measure(
            "normalize_filters",
            lambda: _normalize_scan_terminal_filters(raw_filters),
        )
        if timing_recorder is not None
        else _normalize_scan_terminal_filters(raw_filters)
    )
    if not force_refresh:
        cached = (
            timing_recorder.measure(
                "cache_lookup",
                lambda: get_cached_scan_terminal_payload(
                    filters,
                    ttl_sec=SCAN_TERMINAL_PAYLOAD_TTL_SEC,
                ),
            )
            if timing_recorder is not None
            else get_cached_scan_terminal_payload(
                filters, ttl_sec=SCAN_TERMINAL_PAYLOAD_TTL_SEC
            )
        )
        if cached is not None:
            if diff and since_snapshot_id:
                cached_entry = get_scan_terminal_cache_entry(filters) or {}
                return _build_scan_terminal_incremental_from_cache_entry(
                    filters=filters,
                    current_payload=cached,
                    cached_entry=cached_entry,
                    since_snapshot_id=since_snapshot_id,
                )
            return cached

        cached_entry = (
            timing_recorder.measure(
                "stale_cache_lookup",
                lambda: get_scan_terminal_cache_entry(filters) or {},
            )
            if timing_recorder is not None
            else get_scan_terminal_cache_entry(filters) or {}
        )
        success_payload = cached_entry.get("success_payload")
        if (
            isinstance(success_payload, dict)
            and success_payload
            and _success_payload_within_stale_window(cached_entry)
        ):
            started = _start_scan_terminal_background_refresh(filters)
            payload = build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=(
                    "正在后台刷新市场扫描快照" if started else "市场扫描快照正在刷新中"
                ),
                failed_at=cached_entry.get("last_failed_at"),
            )
            if diff and since_snapshot_id:
                return _build_scan_terminal_incremental_from_cache_entry(
                    filters=filters,
                    current_payload=payload,
                    cached_entry=cached_entry,
                    since_snapshot_id=since_snapshot_id,
                )
            return payload
        started = _start_scan_terminal_background_refresh(filters)
        payload = build_failed_scan_terminal_payload(
            filters=filters,
            error_message=(
                "市场扫描快照正在初始化"
                if started
                else "市场扫描快照正在刷新中"
            ),
            failed_at=cached_entry.get("last_failed_at"),
        )
        if diff and since_snapshot_id:
            return _build_scan_terminal_incremental_from_cache_entry(
                filters=filters,
                current_payload=payload,
                cached_entry=cached_entry,
                since_snapshot_id=since_snapshot_id,
            )
        return payload

    payload = (
        timing_recorder.measure(
            "uncached_build",
            lambda: _build_scan_terminal_payload_singleflight(
                filters,
                force_refresh=force_refresh,
            ),
        )
        if timing_recorder is not None
        else _build_scan_terminal_payload_singleflight(filters, force_refresh=force_refresh)
    )
    if diff and since_snapshot_id:
        cached_entry = get_scan_terminal_cache_entry(filters) or {}
        return _build_scan_terminal_incremental_from_cache_entry(
            filters=filters,
            current_payload=payload,
            cached_entry=cached_entry,
            since_snapshot_id=since_snapshot_id,
        )
    return payload


_SCAN_PREWARM_STARTED = False
_SCAN_PREWARM_LOCK = threading.Lock()
_SCAN_TERMINAL_PREWARM_RAW_FILTERS = [
    {
        "scan_mode": "tradable",
        "min_price": 0.05,
        "max_price": 0.95,
        "min_edge_pct": 2,
        "min_liquidity": 500,
        "market_type": "maxtemp",
        "time_range": "today",
        "limit": 25,
    },
    {
        "scan_mode": "tradable",
        "min_price": 0.05,
        "max_price": 0.95,
        "min_edge_pct": 2,
        "min_liquidity": 500,
        "market_type": "maxtemp",
        "time_range": "today",
        "limit": 180,
    }
]


def _scan_terminal_prewarm_filters() -> List[Dict[str, Any]]:
    return [
        _normalize_scan_terminal_filters(filters)
        for filters in _SCAN_TERMINAL_PREWARM_RAW_FILTERS
    ]


def _warm_scan_terminal_payloads() -> int:
    ok = 0
    for filters in _scan_terminal_prewarm_filters():
        try:
            _build_scan_terminal_payload_uncached(
                filters,
                force_refresh=False,
                timeout_sec=SCAN_TERMINAL_PREWARM_PAYLOAD_TIMEOUT_SEC,
            )
            ok += 1
        except Exception as exc:
            logger.warning("scan terminal payload pre-warm failed: {}", exc)
    return ok


def _queue_scan_terminal_city_prewarm(city: str) -> str:
    _SCAN_PREWARM_DB.enqueue_observation_refresh_request(
        city=city,
        kind="panel",
        priority="normal",
        reason="scan_terminal_prewarm",
    )
    return city


def start_scan_terminal_prewarm() -> None:
    """Warm analysis caches for all cities at startup so the first terminal
    scan returns quickly without forcing every city through a cold external
    source refresh path.

    Runs once per process.  Safe to call from any thread and at any point
    during the server lifecycle.
    """
    global _SCAN_PREWARM_STARTED
    with _SCAN_PREWARM_LOCK:
        if _SCAN_PREWARM_STARTED:
            return
        _SCAN_PREWARM_STARTED = True

    city_names = list(CITIES.keys())
    logger.info(
        "scan terminal pre-warm starting cities={} workers={}",
        len(city_names),
        SCAN_TERMINAL_MAX_WORKERS,
    )

    def _warm_one(city: str) -> str:
        try:
            _queue_scan_terminal_city_prewarm(city)
        except Exception:
            pass
        return city

    def _run():
        started = time.time()
        ok = 0
        try:
            workers = max(1, min(SCAN_TERMINAL_MAX_WORKERS, len(city_names)))
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = {ex.submit(_warm_one, c): c for c in city_names}
                for f in as_completed(futures):
                    try:
                        f.result()
                        ok += 1
                    except Exception:
                        pass
            payload_ok = _warm_scan_terminal_payloads()
            elapsed = int(time.time() - started)
            logger.info(
                "scan terminal pre-warm finished ok={}/{} payloads={} elapsed={}s",
                ok,
                len(city_names),
                payload_ok,
                elapsed,
            )
        except (ValueError, OSError, IOError):
            # Process is shutting down — file handles / threads may be closed
            logger.info(
                "scan terminal pre-warm interrupted (shutdown) ok={}/{}",
                ok,
                len(city_names),
            )
        except Exception:
            logger.exception("scan terminal pre-warm failed")

    threading.Thread(target=_run, name="scan-prewarm", daemon=True).start()
