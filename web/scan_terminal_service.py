from __future__ import annotations

import json
import os
import threading
import time
import hashlib
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from loguru import logger

from web.analysis_service import _analyze, _build_city_market_scan_payload
from web.core import CITIES

_SCAN_TERMINAL_CACHE_LOCK = threading.Lock()
_SCAN_TERMINAL_CACHE: Dict[str, Dict[str, Any]] = {}
_SCAN_TERMINAL_REFRESHING: set[str] = set()
SCAN_TERMINAL_PAYLOAD_TTL_SEC = max(
    5,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_PAYLOAD_TTL_SEC", "30")),
)
SCAN_TERMINAL_BUILD_TIMEOUT_SEC = max(
    8,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC", "22")),
)


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _normalize_scan_terminal_filters(
    raw_filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw = raw_filters if isinstance(raw_filters, dict) else {}
    min_price = _safe_float(raw.get("min_price"))
    max_price = _safe_float(raw.get("max_price"))
    if min_price is None:
        min_price = 0.05
    if max_price is None:
        max_price = 0.95
    min_price = max(0.0, min(1.0, min_price))
    max_price = max(0.0, min(1.0, max_price))
    if min_price > max_price:
        min_price, max_price = max_price, min_price

    high_liquidity_only = bool(raw.get("high_liquidity_only"))
    min_liquidity = _safe_float(raw.get("min_liquidity"))
    if min_liquidity is None:
        min_liquidity = 5000.0 if high_liquidity_only else 500.0
    if high_liquidity_only:
        min_liquidity = max(min_liquidity, 5000.0)

    return {
        "scan_mode": str(raw.get("scan_mode") or "tradable").strip().lower()
        or "tradable",
        "min_price": float(min_price),
        "max_price": float(max_price),
        "min_edge_pct": max(0.0, _safe_float(raw.get("min_edge_pct")) or 2.0),
        "min_liquidity": max(0.0, float(min_liquidity)),
        "high_liquidity_only": high_liquidity_only,
        "market_type": str(raw.get("market_type") or "maxtemp").strip().lower()
        or "maxtemp",
        "time_range": str(raw.get("time_range") or "today").strip().lower()
        or "today",
        "limit": max(1, min(_safe_int(raw.get("limit"), 25), 100)),
        "max_spread": max(0.0, _safe_float(raw.get("max_spread")) or 0.03),
    }


def _scan_terminal_cache_key(filters: Dict[str, Any]) -> str:
    normalized = _normalize_scan_terminal_filters(filters)
    return json.dumps(normalized, ensure_ascii=True, sort_keys=True)


def _get_cached_scan_terminal_payload(
    filters: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    cache_key = _scan_terminal_cache_key(filters)
    now = time.time()
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at = float(cached.get("t") or 0.0)
        if now - cached_at >= float(SCAN_TERMINAL_PAYLOAD_TTL_SEC):
            return None
        payload = cached.get("payload")
        if not isinstance(payload, dict):
            return None
        return dict(payload)


def _get_scan_terminal_cache_entry(filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        cached = _SCAN_TERMINAL_CACHE.get(cache_key)
        if not isinstance(cached, dict):
            return None
        return dict(cached)


def _build_scan_terminal_snapshot_id(
    filters: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    top_signal: Optional[Dict[str, Any]],
) -> str:
    seed_payload = {
        "filters": filters,
        "summary": {
            "candidate_total": summary.get("candidate_total"),
            "tradable_market_count": summary.get("tradable_market_count"),
            "avg_edge_percent": summary.get("avg_edge_percent"),
        },
        "top_signal": {
            "id": (top_signal or {}).get("id"),
            "edge_percent": (top_signal or {}).get("edge_percent"),
            "final_score": (top_signal or {}).get("final_score"),
        },
        "rows": [
            {
                "id": row.get("id"),
                "edge_percent": row.get("edge_percent"),
                "final_score": row.get("final_score"),
            }
            for row in rows[:10]
        ],
    }
    digest = hashlib.md5(
        json.dumps(seed_payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"scan-{digest[:10]}"


def _set_cached_scan_terminal_payload(
    filters: Dict[str, Any],
    payload: Dict[str, Any],
) -> None:
    cache_key = _scan_terminal_cache_key(filters)
    existing = _get_scan_terminal_cache_entry(filters) or {}
    with _SCAN_TERMINAL_CACHE_LOCK:
        _SCAN_TERMINAL_CACHE[cache_key] = {
            "t": time.time(),
            "payload": dict(payload),
            "success_t": time.time(),
            "success_payload": dict(payload),
            "last_error": existing.get("last_error"),
            "last_failed_at": existing.get("last_failed_at"),
        }


def _set_scan_terminal_failure_state(
    filters: Dict[str, Any],
    *,
    error_message: str,
) -> None:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        existing = _SCAN_TERMINAL_CACHE.get(cache_key) or {}
        existing["last_error"] = error_message
        existing["last_failed_at"] = datetime.utcnow().isoformat() + "Z"
        _SCAN_TERMINAL_CACHE[cache_key] = existing


def _start_scan_terminal_background_refresh(filters: Dict[str, Any]) -> bool:
    cache_key = _scan_terminal_cache_key(filters)
    with _SCAN_TERMINAL_CACHE_LOCK:
        if cache_key in _SCAN_TERMINAL_REFRESHING:
            return False
        _SCAN_TERMINAL_REFRESHING.add(cache_key)

    def _runner() -> None:
        try:
            _build_scan_terminal_payload_uncached(filters, force_refresh=True)
        except Exception as exc:  # pragma: no cover - defensive background guard
            logger.warning("scan terminal background refresh failed: {}", exc)
        finally:
            with _SCAN_TERMINAL_CACHE_LOCK:
                _SCAN_TERMINAL_REFRESHING.discard(cache_key)

    thread = threading.Thread(
        target=_runner,
        name="polyweather-scan-terminal-refresh",
        daemon=True,
    )
    thread.start()
    return True


def _build_stale_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    success_payload: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str],
) -> Dict[str, Any]:
    payload = dict(success_payload)
    payload["status"] = "stale"
    payload["stale"] = True
    payload["stale_reason"] = error_message
    payload["last_success_at"] = success_payload.get("generated_at")
    payload["last_failed_at"] = failed_at
    payload["filters"] = filters
    return payload


def _build_failed_scan_terminal_payload(
    *,
    filters: Dict[str, Any],
    error_message: str,
    failed_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot_id": None,
        "status": "failed",
        "stale": False,
        "stale_reason": error_message,
        "last_success_at": None,
        "last_failed_at": failed_at or (datetime.utcnow().isoformat() + "Z"),
        "filters": filters,
        "summary": {
            "recommended_count": 0,
            "visible_count": 0,
            "candidate_total": 0,
            "avg_edge_percent": None,
            "avg_primary_confidence": None,
            "tradable_market_count": 0,
            "total_volume": 0.0,
            "resolved_market_type": "maxtemp",
        },
        "top_signal": None,
        "rows": [],
    }


def _resolve_time_range_dates(data: Dict[str, Any], time_range: str) -> List[str]:
    local_date = str(data.get("local_date") or "").strip()
    multi_model_daily = data.get("multi_model_daily") or {}
    available_dates = sorted(
        str(date_key).strip()
        for date_key in (multi_model_daily.keys() if isinstance(multi_model_daily, dict) else [])
        if str(date_key).strip()
    )

    if not local_date:
        return available_dates[:1]
    if time_range == "today":
        return [local_date]

    try:
        local_dt = datetime.fromisoformat(local_date)
    except Exception:
        return available_dates[:7] if time_range == "week" else available_dates[:1]

    if time_range == "tomorrow":
        target = (local_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        if target in available_dates:
            return [target]
        future_dates = [date_key for date_key in available_dates if date_key > local_date]
        return future_dates[:1]

    if time_range == "week":
        target_dates = [date_key for date_key in available_dates if date_key >= local_date]
        if local_date not in target_dates:
            target_dates.insert(0, local_date)
        deduped: List[str] = []
        for date_key in target_dates:
            if date_key not in deduped:
                deduped.append(date_key)
            if len(deduped) >= 7:
                break
        return deduped

    return [local_date]


def _build_terminal_row(
    *,
    city: str,
    data: Dict[str, Any],
    scan: Dict[str, Any],
    row: Dict[str, Any],
) -> Dict[str, Any]:
    current = data.get("current") or {}
    multi_model_daily = data.get("multi_model_daily") or {}
    selected_date = str(row.get("selected_date") or scan.get("selected_date") or data.get("local_date") or "").strip()
    daily_entry = multi_model_daily.get(selected_date) if isinstance(multi_model_daily, dict) else {}
    if not isinstance(daily_entry, dict):
        daily_entry = {}

    display_name = str(data.get("display_name") or city).strip() or city
    market_slug = str(row.get("market_slug") or "").strip()
    side = str(row.get("side") or "").strip().lower()
    edge_percent = _safe_float(row.get("edge_percent"))
    final_score = _safe_float(row.get("final_score"))
    volume = _safe_float(row.get("volume")) or 0.0
    primary_signal = scan.get("primary_signal") or {}

    return {
        **row,
        "id": str(row.get("id") or f"{city}|{selected_date}|{market_slug}|{side}"),
        "city": city,
        "city_display_name": display_name,
        "selected_date": selected_date or None,
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current_temp": current.get("temp"),
        "current_max_so_far": current.get("max_so_far"),
        "deb_prediction": ((daily_entry.get("deb") or {}).get("prediction") if isinstance(daily_entry.get("deb"), dict) else None)
        or ((data.get("deb") or {}).get("prediction") if isinstance(data.get("deb"), dict) else None),
        "display_name": display_name,
        "airport": ((data.get("risk") or {}).get("airport") if isinstance(data.get("risk"), dict) else None),
        "risk_level": ((data.get("risk") or {}).get("level") if isinstance(data.get("risk"), dict) else None),
        "distribution_bias": scan.get("distribution_bias"),
        "distribution_preview": scan.get("distribution_preview") or row.get("distribution_preview") or [],
        "window_phase": row.get("window_phase") or scan.get("window_phase"),
        "window_score": row.get("window_score") if row.get("window_score") is not None else scan.get("window_score"),
        "signal_status": scan.get("signal_status"),
        "candidate_count": scan.get("candidate_count"),
        "resolved_market_type": scan.get("resolved_market_type") or "maxtemp",
        "market_key": f"{city}|{selected_date}|{market_slug}",
        "is_primary_signal": bool(primary_signal and primary_signal.get("id") == row.get("id")),
        "signal_confidence": final_score,
        "edge_percent": edge_percent,
        "final_score": final_score,
        "volume": volume,
    }


def _scan_city_terminal_rows(
    city: str,
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    data = _analyze(
        city,
        force_refresh=force_refresh,
        include_llm_commentary=False,
        detail_mode="market",
    )
    target_dates = _resolve_time_range_dates(data, filters["time_range"])
    rows: List[Dict[str, Any]] = []
    primary_scores: List[float] = []
    candidate_total = 0

    for target_date in target_dates:
        payload = _build_city_market_scan_payload(
            data,
            market_slug=None,
            target_date=target_date,
            lite=True,
            scan_filters=filters,
        )
        scan = payload.get("market_scan") or {}
        candidate_total += int(scan.get("candidate_count") or 0)
        primary_signal = scan.get("primary_signal")
        if not isinstance(primary_signal, dict) or not primary_signal:
            continue
        row = _build_terminal_row(
            city=city,
            data=data,
            scan=scan,
            row=primary_signal,
        )
        rows.append(row)
        score = _safe_float(row.get("final_score"))
        if score is not None:
            primary_scores.append(score)

    return {
        "city": city,
        "rows": rows,
        "candidate_total": candidate_total,
        "primary_scores": primary_scores,
    }


def _build_scan_terminal_payload_uncached(
    filters: Dict[str, Any],
    *,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    cached_entry = _get_scan_terminal_cache_entry(filters) or {}

    try:
        city_names = list(CITIES.keys())
        max_workers = max(1, min(4, len(city_names)))
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
                        logger.warning("scan terminal city failed city={}: {}", city_name, exc)
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
            error_message = failed_reasons[0] if failed_reasons else "all city market scans failed"
            _set_scan_terminal_failure_state(filters, error_message=error_message)
            failed_entry = _get_scan_terminal_cache_entry(filters) or {}
            success_payload = failed_entry.get("success_payload")
            failed_at = failed_entry.get("last_failed_at")
            if isinstance(success_payload, dict) and success_payload:
                return _build_stale_scan_terminal_payload(
                    filters=filters,
                    success_payload=success_payload,
                    error_message=error_message,
                    failed_at=failed_at,
                )
            return _build_failed_scan_terminal_payload(
                filters=filters,
                error_message=error_message,
                failed_at=failed_at,
            )

        primary_rows: List[Dict[str, Any]] = []
        primary_scores: List[float] = []
        candidate_total = 0

        for result in city_results:
            candidate_total += int(result.get("candidate_total") or 0)
            primary_rows.extend(result.get("rows") or [])
            primary_scores.extend(result.get("primary_scores") or [])

        primary_rows.sort(
            key=lambda row: (
                float(row.get("final_score") or 0.0),
                float(row.get("edge_percent") or 0.0),
            ),
            reverse=True,
        )

        ranked_rows: List[Dict[str, Any]] = []
        for index, row in enumerate(primary_rows[: filters["limit"]], start=1):
            ranked_rows.append(
                {
                    **row,
                    "rank": index,
                }
            )

        unique_market_volume: Dict[str, float] = {}
        for row in primary_rows:
            market_key = str(row.get("market_key") or row.get("id") or "").strip()
            if not market_key:
                continue
            unique_market_volume[market_key] = max(
                unique_market_volume.get(market_key, 0.0),
                float(row.get("volume") or 0.0),
            )

        avg_edge = None
        if primary_rows:
            edge_values = [
                float(row.get("edge_percent") or 0.0)
                for row in primary_rows
                if _safe_float(row.get("edge_percent")) is not None
            ]
            if edge_values:
                avg_edge = sum(edge_values) / len(edge_values)

        avg_confidence = None
        if primary_scores:
            avg_confidence = sum(primary_scores) / len(primary_scores)

        top_signal = ranked_rows[0] if ranked_rows else None
        summary = {
            "recommended_count": len(primary_rows),
            "visible_count": len(ranked_rows),
            "candidate_total": candidate_total,
            "avg_edge_percent": avg_edge,
            "avg_primary_confidence": avg_confidence,
            "tradable_market_count": len(unique_market_volume),
            "total_volume": sum(unique_market_volume.values()),
            "resolved_market_type": "maxtemp",
            "total_city_count": len(city_names),
            "scanned_city_count": len(city_results),
            "failed_city_count": len(failed_cities),
        }
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
        payload["snapshot_id"] = _build_scan_terminal_snapshot_id(
            filters,
            ranked_rows,
            summary,
            top_signal,
        )

        _set_cached_scan_terminal_payload(filters, payload)
        return payload
    except Exception as exc:
        error_message = str(exc)
        logger.exception("scan terminal payload build failed: {}", error_message)
        _set_scan_terminal_failure_state(filters, error_message=error_message)
        success_payload = cached_entry.get("success_payload")
        failed_at = _get_scan_terminal_cache_entry(filters).get("last_failed_at") if _get_scan_terminal_cache_entry(filters) else None
        if isinstance(success_payload, dict) and success_payload:
            return _build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=error_message,
                failed_at=failed_at,
            )
        return _build_failed_scan_terminal_payload(
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
        cached = _get_cached_scan_terminal_payload(filters)
        if cached is not None:
            return cached

        cached_entry = _get_scan_terminal_cache_entry(filters) or {}
        success_payload = cached_entry.get("success_payload")
        if isinstance(success_payload, dict) and success_payload:
            started = _start_scan_terminal_background_refresh(filters)
            return _build_stale_scan_terminal_payload(
                filters=filters,
                success_payload=success_payload,
                error_message=(
                    "正在后台刷新市场扫描快照"
                    if started
                    else "市场扫描快照正在刷新中"
                ),
                failed_at=cached_entry.get("last_failed_at"),
            )

    return _build_scan_terminal_payload_uncached(filters, force_refresh=force_refresh)
