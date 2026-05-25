from __future__ import annotations

import re
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from web.analysis_service import _analyze
from web.core import CITIES
from web.services.scan_ai_config import (
    SCAN_TERMINAL_BUILD_TIMEOUT_SEC,
    SCAN_TERMINAL_MAX_WORKERS,
    SCAN_TERMINAL_PAYLOAD_TTL_SEC,
)
from src.data_collection.city_registry import ALIASES
from web.scan_terminal_cache import (
    clear_scan_terminal_refreshing,
    get_cached_scan_terminal_payload,
    get_scan_terminal_cache_entry,
    mark_scan_terminal_refreshing,
    set_cached_scan_terminal_payload,
    set_scan_terminal_failure_state,
)
from web.scan_terminal_city_row import _scan_city_terminal_rows
from web.scan_terminal_filters import (
    normalize_scan_terminal_filters as _normalize_scan_terminal_filters,
)
from web.scan_terminal_payloads import (
    build_failed_scan_terminal_payload,
    build_scan_terminal_snapshot_id,
    build_stale_scan_terminal_payload,
)
from web.scan_terminal_ranker import build_ranked_scan_terminal_result
def _normalize_locale(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "en-US" if text.startswith("en") else "zh-CN"


def _normalize_city_key(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", " ")
    text = re.sub(r"\s+", " ", text)
    return ALIASES.get(text, text)


def _start_scan_terminal_background_refresh(filters: Dict[str, Any]) -> bool:
    if not mark_scan_terminal_refreshing(filters):
        return False

    def _runner() -> None:
        try:
            _build_scan_terminal_payload_uncached(filters, force_refresh=True)
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
) -> Dict[str, Any]:
    cached_entry = get_scan_terminal_cache_entry(filters) or {}

    try:
        city_names = list(CITIES.keys())
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
        max_workers = max(1, min(SCAN_TERMINAL_MAX_WORKERS, len(city_names)))
        city_results: List[Dict[str, Any]] = []
        failed_cities: List[str] = []
        failed_reasons: List[str] = []

        timed_out = False
        timeout_message: Optional[str] = None
        executor = ThreadPoolExecutor(max_workers=max_workers)
        future_map = {
            executor.submit(
                _scan_city_terminal_rows,
                city_name,
                filters,
                force_refresh=force_refresh,
            ): city_name
            for city_name in city_names
        }
        try:
            try:
                completed = as_completed(
                    future_map,
                    timeout=float(SCAN_TERMINAL_BUILD_TIMEOUT_SEC),
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
                    f"scan terminal build timed out after "
                    f"{SCAN_TERMINAL_BUILD_TIMEOUT_SEC}s"
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
                    len(city_names),
                )
        finally:
            executor.shutdown(wait=False)

        if city_names and len(failed_cities) >= len(city_names):
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
        ranked_rows = ranked_result["ranked_rows"]

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


def build_scan_terminal_payload(
    raw_filters: Optional[Dict[str, Any]] = None,
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    filters = _normalize_scan_terminal_filters(raw_filters)
    if not force_refresh:
        cached = get_cached_scan_terminal_payload(
            filters, ttl_sec=SCAN_TERMINAL_PAYLOAD_TTL_SEC
        )
        if cached is not None:
            return cached

        cached_entry = get_scan_terminal_cache_entry(filters) or {}
        success_payload = cached_entry.get("success_payload")
        if isinstance(success_payload, dict) and success_payload:
            started = _start_scan_terminal_background_refresh(filters)
            return build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=(
                    "正在后台刷新市场扫描快照" if started else "市场扫描快照正在刷新中"
                ),
                failed_at=cached_entry.get("last_failed_at"),
            )

    return _build_scan_terminal_payload_uncached(filters, force_refresh=force_refresh)


_SCAN_PREWARM_STARTED = False
_SCAN_PREWARM_LOCK = threading.Lock()


def start_scan_terminal_prewarm() -> None:
    """Warm analysis caches for all cities at startup so the first terminal
    scan returns quickly instead of forcing every city through a cold
    _analyze() path.

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
            _analyze(city, force_refresh=False, detail_mode="panel")
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
            elapsed = int(time.time() - started)
            logger.info(
                "scan terminal pre-warm finished ok={}/{} elapsed={}s",
                ok,
                len(city_names),
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
