"""Low-frequency DEB training settlement maintenance."""

from __future__ import annotations

import math
import time
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Sequence

from loguru import logger

from src.analysis.deb_algorithm import bootstrap_recent_daily_history_if_missing
from src.data_collection.city_registry import CITY_REGISTRY


AnalysisRunner = Callable[[str], Mapping[str, Any]]
ActualReconciler = Callable[..., Mapping[str, Any]]

UNSUPPORTED_SETTLEMENT_SOURCES = set()
RECONCILE_SETTLEMENT_SOURCES = {"metar", "hko", "noaa"}


def _normalize_city(city: str) -> str:
    return str(city or "").strip().lower().replace("-", " ")


def _selected_city_names(
    city_registry: Mapping[str, Mapping[str, Any]],
    cities: Optional[Iterable[str]],
) -> Sequence[str]:
    selected = {
        _normalize_city(city) for city in (cities or []) if _normalize_city(city)
    }
    names = []
    for city in sorted(city_registry.keys()):
        normalized = _normalize_city(city)
        if selected and normalized not in selected:
            continue
        names.append(normalized)
    return tuple(names)


def _rotating_analysis_slice(
    supported_names: Sequence[str],
    *,
    batch_size: int,
    interval_sec: int,
    now_ts: Optional[float] = None,
) -> tuple[Sequence[str], int]:
    """Pick the per-city analysis slice for this cycle.

    The slice index derives from ``wall_clock // interval`` so rotation
    survives worker restarts without persistent state. ``batch_size <= 0``
    (or >= city count) disables rotation and analyzes every city.
    """
    if batch_size <= 0 or batch_size >= len(supported_names):
        return tuple(supported_names), -1
    interval = max(1, int(interval_sec))
    timestamp = time.time() if now_ts is None else float(now_ts)
    cycle_index = int(timestamp // interval)
    window_count = math.ceil(len(supported_names) / batch_size)
    start = (cycle_index % window_count) * batch_size
    return tuple(supported_names[start : start + batch_size]), cycle_index


def _is_supported_training_city(city_meta: Mapping[str, Any]) -> bool:
    source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    if source in UNSUPPORTED_SETTLEMENT_SOURCES:
        return False
    return bool(
        str(city_meta.get("icao") or "").strip()
        or str(city_meta.get("settlement_station_code") or "").strip()
        or source in {"hko", "ims", "ncm", "aeroweb"}
    )


def _can_reconcile_actual_history(city_meta: Mapping[str, Any]) -> bool:
    source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    return source in RECONCILE_SETTLEMENT_SOURCES


def _default_analysis_runner(city: str) -> Mapping[str, Any]:
    from web.analysis_service import _analyze

    return _analyze(
        city,
        force_refresh=False,
        detail_mode="panel",
        archive_training_snapshots=True,
    )


def _default_actual_reconciler(city: str, *, lookback_days: int) -> Mapping[str, Any]:
    return bootstrap_recent_daily_history_if_missing(city, lookback_days=lookback_days)


def run_training_settlement_cycle(
    *,
    city_registry: Optional[Mapping[str, Mapping[str, Any]]] = None,
    cities: Optional[Iterable[str]] = None,
    analysis_runner: Optional[AnalysisRunner] = None,
    actual_reconciler: Optional[ActualReconciler] = None,
    lookback_days: int = 10,
    skip_analysis: bool = False,
    skip_reconcile: bool = False,
    analysis_batch_size: int = 0,
    analysis_interval_sec: int = 21600,
    now_ts: Optional[float] = None,
) -> Dict[str, Any]:
    registry = city_registry or CITY_REGISTRY
    # Per-city _analyze refreshes forecasts/deb_prediction in daily_records.
    # Full 51-city analysis takes 40+ minutes and accumulates the memory that
    # used to OOM this worker, so analysis rotates through a bounded slice of
    # cities per cycle (analysis_batch_size); reconcile stays full-coverage
    # because it is incremental and cheap.  batch_size <= 0 disables rotation.
    run_analysis = analysis_runner or _default_analysis_runner
    reconcile_actual = actual_reconciler or _default_actual_reconciler
    safe_lookback = max(1, int(lookback_days or 1))

    all_names = _selected_city_names(registry, cities)

    processed = 0
    failed = 0
    unsupported = 0
    items = []
    analysis_names: Sequence[str] = ()
    analysis_cycle_index = -1
    if not skip_analysis:
        supported_names = [
            name
            for name in all_names
            if _is_supported_training_city(registry.get(name) or {})
        ]
        analysis_names, analysis_cycle_index = _rotating_analysis_slice(
            supported_names,
            batch_size=int(analysis_batch_size or 0),
            interval_sec=analysis_interval_sec,
            now_ts=now_ts,
        )
        analysis_set = set(analysis_names)

    for city in all_names:
        meta = registry.get(city) or {}
        if not _is_supported_training_city(meta):
            unsupported += 1
            items.append(
                {
                    "city": city,
                    "ok": True,
                    "status": "unsupported",
                    "reason": "unsupported_settlement_source",
                }
            )
            continue

        try:
            analysis_payload = None
            did_analysis = False
            if not skip_analysis and city in analysis_set:
                analysis_payload = run_analysis(city)
                did_analysis = True
            if skip_reconcile:
                reconcile_payload = {
                    "ok": True,
                    "updated": 0,
                    "reason": "skipped_reconcile",
                    "source": str(meta.get("settlement_source") or "").strip().lower(),
                }
            elif _can_reconcile_actual_history(meta):
                reconcile_payload = reconcile_actual(city, lookback_days=safe_lookback)
            else:
                reconcile_payload = {
                    "ok": True,
                    "updated": 0,
                    "reason": "unsupported_reconcile_source",
                    "source": str(meta.get("settlement_source") or "").strip().lower(),
                }
            reconcile_ok = bool(reconcile_payload.get("ok", True))
            if reconcile_ok:
                processed += 1
            else:
                failed += 1
            items.append(
                {
                    "city": city,
                    "ok": reconcile_ok,
                    "status": "processed" if reconcile_ok else "failed",
                    "analysis_status": (
                        "skipped"
                        if skip_analysis
                        else (
                            "rotated_out"
                            if not did_analysis
                            else str((analysis_payload or {}).get("status") or "ok")
                        )
                    ),
                    "analysis_archive": dict(
                        (analysis_payload or {}).get("training_snapshot_archive") or {}
                    ),
                    "reconcile": dict(reconcile_payload or {}),
                }
            )
        except Exception as exc:
            failed += 1
            logger.warning("training settlement city failed city={}: {}", city, exc)
            items.append(
                {
                    "city": city,
                    "ok": False,
                    "status": "failed",
                    "error": str(exc),
                }
            )

    return {
        "ok": failed == 0,
        "processed": processed,
        "failed": failed,
        "unsupported": unsupported,
        "lookback_days": safe_lookback,
        "analysis_batch_size": int(analysis_batch_size or 0),
        "analysis_cycle_index": analysis_cycle_index,
        "analyzed_cities": list(analysis_names),
        "items": items,
    }
