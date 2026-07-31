"""Offline DEB weight snapshot generation for the training loop.

The production path computes blend weights on demand from rolling history.
This module persists the same weights as a per-city snapshot so training and
inference are decoupled: any prediction day can be traced back to the exact
weight state (hyperparameters + sample counts) that produced it.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from src.analysis.deb_algorithm import calculate_dynamic_weight_components
from src.database.runtime_state import (
    DailyRecordRepository,
    DebWeightSnapshotRepository,
    RuntimeStateDB,
)

DEFAULT_WEIGHT_HYPERPARAMS: dict[str, Any] = {
    "lookback_days": 7,
    "decay_factor": 0.85,
    "bias_penalty": 0.5,
    "divergence_threshold": 3.0,
}


def build_city_weight_snapshot(
    city: str,
    by_date: dict[str, dict[str, Any]],
    *,
    hyperparams: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Compute the weight state a city would use with its latest forecasts.

    Uses the most recent record carrying forecasts as the current forecast
    set, and injects the full city history so no storage access is needed.
    """
    params = {**DEFAULT_WEIGHT_HYPERPARAMS, **(hyperparams or {})}
    current_forecasts: Optional[dict[str, Any]] = None
    for target_date in sorted((by_date or {}).keys(), reverse=True):
        record = by_date[target_date]
        if not isinstance(record, dict):
            continue
        forecasts = record.get("forecasts")
        if isinstance(forecasts, dict) and any(
            v is not None for v in forecasts.values()
        ):
            current_forecasts = forecasts
            break
    if not current_forecasts:
        return None

    components = calculate_dynamic_weight_components(
        city,
        current_forecasts,
        lookback_days=int(params["lookback_days"]),
        decay_factor=float(params["decay_factor"]),
        bias_penalty=float(params["bias_penalty"]),
        divergence_threshold=float(params["divergence_threshold"]),
        history_data={city: by_date},
    )
    weights = components.get("weights") or {}
    if not weights:
        return None
    return {
        "weights": weights,
        "maes": components.get("maes") or {},
        "biases": components.get("biases") or {},
        "forecast_models": list((components.get("forecasts") or {}).keys()),
        "samples": int(components.get("days_used") or 0),
        "days_used": int(components.get("days_used") or 0),
        "lookback_days": int(params["lookback_days"]),
        "decay_factor": float(params["decay_factor"]),
        "bias_penalty": float(params["bias_penalty"]),
        "divergence_threshold": float(params["divergence_threshold"]),
        "weights_info": components.get("weights_info"),
    }


def refresh_deb_weight_snapshots(
    *,
    db: Optional[RuntimeStateDB] = None,
    cities: Optional[list[str]] = None,
    hyperparams: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Regenerate and persist DEB weight snapshots for all (or selected) cities."""
    db = db or RuntimeStateDB.instance()
    daily_records = DailyRecordRepository(db).load_all()
    repo = DebWeightSnapshotRepository(db)
    updated = 0
    for city, by_date in (daily_records or {}).items():
        if cities is not None and city not in cities:
            continue
        snapshot = build_city_weight_snapshot(city, by_date, hyperparams=hyperparams)
        if snapshot is None:
            continue
        repo.upsert_snapshot(city, snapshot)
        updated += 1
    return {"updated_cities": updated, "total_cities": len(daily_records or {})}


def load_deb_weight_snapshot(
    city: str,
    *,
    db: Optional[RuntimeStateDB] = None,
) -> Optional[dict[str, Any]]:
    """Read a persisted snapshot when the opt-in flag is set, else None.

    The flag keeps the production on-demand path untouched until the
    snapshot-backed path is validated and switched over explicitly.
    """
    raw = str(os.getenv("POLYWEATHER_USE_DEB_WEIGHT_SNAPSHOT") or "").strip().lower()
    if raw not in {"1", "true", "yes", "on"}:
        return None
    return DebWeightSnapshotRepository(db).load_snapshot(city)
