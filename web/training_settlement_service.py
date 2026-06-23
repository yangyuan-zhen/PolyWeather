"""Low-frequency DEB training settlement maintenance."""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Sequence

from loguru import logger

from src.analysis.deb_algorithm import bootstrap_recent_daily_history_if_missing
from src.data_collection.city_registry import CITY_REGISTRY


AnalysisRunner = Callable[[str], Mapping[str, Any]]
ActualReconciler = Callable[..., Mapping[str, Any]]

UNSUPPORTED_SETTLEMENT_SOURCES = {"wunderground"}
RECONCILE_SETTLEMENT_SOURCES = {"metar", "hko", "noaa"}


def _normalize_city(city: str) -> str:
    return str(city or "").strip().lower().replace("-", " ")


def _selected_city_names(
    city_registry: Mapping[str, Mapping[str, Any]],
    cities: Optional[Iterable[str]],
) -> Sequence[str]:
    selected = {_normalize_city(city) for city in (cities or []) if _normalize_city(city)}
    names = []
    for city in sorted(city_registry.keys()):
        normalized = _normalize_city(city)
        if selected and normalized not in selected:
            continue
        names.append(normalized)
    return tuple(names)


def _is_supported_training_city(city_meta: Mapping[str, Any]) -> bool:
    source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    if source in UNSUPPORTED_SETTLEMENT_SOURCES:
        return False
    return bool(
        str(city_meta.get("icao") or "").strip()
        or str(city_meta.get("settlement_station_code") or "").strip()
        or source in {"hko", "cwa", "ims", "ncm", "aeroweb"}
    )


def _can_reconcile_actual_history(city_meta: Mapping[str, Any]) -> bool:
    source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    return source in RECONCILE_SETTLEMENT_SOURCES


def _default_analysis_runner(city: str) -> Mapping[str, Any]:
    from web.analysis_service import _analyze

    return _analyze(city, force_refresh=False, detail_mode="panel")


def _default_actual_reconciler(city: str, *, lookback_days: int) -> Mapping[str, Any]:
    return bootstrap_recent_daily_history_if_missing(city, lookback_days=lookback_days)


def run_training_settlement_cycle(
    *,
    city_registry: Optional[Mapping[str, Mapping[str, Any]]] = None,
    cities: Optional[Iterable[str]] = None,
    analysis_runner: Optional[AnalysisRunner] = None,
    actual_reconciler: Optional[ActualReconciler] = None,
    lookback_days: int = 10,
) -> Dict[str, Any]:
    registry = city_registry or CITY_REGISTRY
    run_analysis = analysis_runner or _default_analysis_runner
    reconcile_actual = actual_reconciler or _default_actual_reconciler
    safe_lookback = max(1, int(lookback_days or 1))

    processed = 0
    failed = 0
    unsupported = 0
    items = []

    for city in _selected_city_names(registry, cities):
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
            analysis_payload = run_analysis(city)
            if _can_reconcile_actual_history(meta):
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
                    "analysis_status": str(
                        (analysis_payload or {}).get("status") or "ok"
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
        "items": items,
    }
