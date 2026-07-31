"""DEB normal-distribution probability engine (replaces weathernext2 as primary).

Serves Polymarket integer-degree bucket markets (e.g. "highest temperature in
Shanghai on Aug 1": buckets 31C-or-below / 32 / ... / 41C-or-higher, resolved to
whole degrees Celsius).

Distribution model (validated in data/deb_polymarket_buckets_report.json):
    mu = deb_prediction + bias(lead)
    sigma = max(sigma(lead), 0.5)
    P(T == tau) = Phi((tau + 0.5 - mu) / sigma) - Phi((tau - 0.5 - mu) / sigma)

`lead` = days from forecast publication to settlement date, stratified into
{0, 1, 2} where 2 means "2+ days". bias(lead)/sigma(lead) are pooled across
cities (53-city residual pool), trained walk-forward without leakage.

The payload shape matches `_weathernext2_probability_payload` so downstream
consumers (web/analysis_service.py probabilities block) work unchanged.
"""

from __future__ import annotations

import math
import statistics
from typing import Any, Dict, List, Optional

from src.database.runtime_state import (
    DebNormalResidualStatsRepository,
    RuntimeStateDB,
)

# Lead strata keys. Anything >= 2 days ahead collapses to "2".
LEAD_2PLUS = 2
_LEAD_KEYS = (0, 1, 2)

# Floor for sigma to avoid overconfident degenerate distributions.
MIN_SIGMA = 0.5

# Number of highest-probability buckets exposed in `probabilities`.
TOP_BUCKETS = 4

# Celsius -> Fahrenheit, matching settlement rounding to whole degrees.
def _c_to_f(value: float) -> float:
    return value * 9.0 / 5.0 + 32.0


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _lead_key(lead: Any) -> int:
    """Map raw lead (days) to a stratum key in {0, 1, 2}."""
    try:
        raw = max(0, int(round(float(lead))))
    except (TypeError, ValueError):
        raw = 1
    return min(raw, LEAD_2PLUS)


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _bucket_probability(mu: float, sigma: float, tau: float) -> float:
    """P(T == tau) for an integer-degree bucket [tau-0.5, tau+0.5)."""
    return _normal_cdf((tau + 0.5 - mu) / sigma) - _normal_cdf((tau - 0.5 - mu) / sigma)


def _bias_for_lead(stats: Optional[Dict[str, Any]], lead_key: int) -> float:
    if not stats:
        return 0.0
    biases = stats.get("lead_biases") or {}
    value = _sf(biases.get(str(lead_key)))
    if value is None:
        # Fall back to nearest available stratum.
        value = _sf(biases.get("1")) or _sf(biases.get("0"))
    return value if value is not None else 0.0


def _sigma_for_lead(stats: Optional[Dict[str, Any]], lead_key: int) -> float:
    if not stats:
        return 2.5
    sigmas = stats.get("lead_sigmas") or {}
    value = _sf(sigmas.get(str(lead_key)))
    if value is None:
        value = _sf(sigmas.get("1")) or _sf(sigmas.get("0"))
    return max(value if value is not None else 2.5, MIN_SIGMA)


def _load_deb_normal_stats(db: Optional[RuntimeStateDB] = None) -> Optional[Dict[str, Any]]:
    """Load lead-stratified residual stats; None when not trained yet."""
    try:
        return DebNormalResidualStatsRepository(db).load_stats()
    except Exception:
        return None


def _build_deb_normal_probability_payload(
    deb_prediction: Optional[float],
    lead: Any,
    temp_symbol: str,
    stats: Optional[Dict[str, Any]] = None,
    *,
    is_fahrenheit_city: bool = False,
    settlement_round: bool = True,
) -> Optional[Dict[str, Any]]:
    """Build the {engine, mu, probabilities, probabilities_all} probability payload.

    All internal math is Celsius. For Fahrenheit cities the buckets are converted
    to whole Fahrenheit degrees before emission (matching Wunderground resolution).

    Returns None when stats are missing or deb_prediction is unusable (caller then
    falls through to the weathernext2 branch).
    """
    deb_c = _sf(deb_prediction)
    if deb_c is None:
        return None
    stats = stats or _load_deb_normal_stats()
    if not stats:
        return None
    lead_key = _lead_key(lead)
    bias = _bias_for_lead(stats, lead_key)
    sigma = _sigma_for_lead(stats, lead_key)
    mu_c = deb_c + bias

    # Celsius bucket range covering mu +- 4 sigma.
    lo = int(math.floor(mu_c - 4.0 * sigma))
    hi = int(math.ceil(mu_c + 4.0 * sigma))
    buckets_c = [
        {"value": tau, "probability": round(_bucket_probability(mu_c, sigma, tau), 4)}
        for tau in range(lo, hi + 1)
    ]
    buckets_c = [b for b in buckets_c if b["probability"] > 0.0]

    def _emit(bucket: Dict[str, Any]) -> Dict[str, Any]:
        tau = bucket["value"]
        prob = bucket["probability"]
        if is_fahrenheit_city:
            tau_f = int(round(_c_to_f(tau)))
            return {
                "value": tau_f,
                "range": f"[{tau_f - 0.5}~{tau_f + 0.5})",
                "probability": prob,
            }
        return {
            "value": tau,
            "range": f"[{tau - 0.5}~{tau + 0.5})",
            "probability": prob,
        }

    probabilities_all = [_emit(b) for b in buckets_c]
    probabilities = sorted(
        probabilities_all, key=lambda item: _sf(item.get("probability")) or 0, reverse=True
    )[:TOP_BUCKETS]

    mu_out = mu_c if not is_fahrenheit_city else _c_to_f(mu_c)
    return {
        "engine": "deb_normal",
        "mu": round(mu_out, 2),
        "probabilities": probabilities,
        "probabilities_all": probabilities_all,
        "lead": lead_key,
    }


def _walk_forward_deb_residuals(
    daily_records: Dict[str, Dict[str, Dict[str, Any]]],
    *,
    min_history_days: int = 2,
) -> List[Dict[str, Any]]:
    """Walk-forward no-leakage residual rows: (lead, residual_c).

    `residual_c = actual_high_c - raw_deb_c` where `raw_deb_c` is the DEB blend
    recomputed using ONLY history strictly before the target date (same logic as
    `_build_training_rows` in deb_ml_calibration.py, minus the LightGBM step).

    `lead` is derived from the earliest probability snapshot timestamp of that
    (city, date) when available; otherwise falls back to 1 (default one-day-ahead).
    """
    from src.analysis.deb_algorithm import calculate_dynamic_weight_components
    from src.data_collection.city_registry import CITY_REGISTRY
    from src.database.runtime_state import ProbabilitySnapshotRepository

    f_cities = {
        str(c).strip().lower()
        for c, m in (CITY_REGISTRY or {}).items()
        if m.get("use_fahrenheit")
    }

    def _to_c(value: Any, city: str) -> Optional[float]:
        v = _sf(value)
        if v is None:
            return None
        return (v - 32.0) * 5.0 / 9.0 if city in f_cities else v

    # Earliest snapshot timestamp per (city, date) for lead computation.
    lead_by_cd: Dict[tuple[str, str], int] = {}
    try:
        snap_repo = ProbabilitySnapshotRepository()
        snap_rows = snap_repo.load_all_rows()
        from datetime import datetime

        for row in snap_rows:
            ts = row.get("timestamp")
            date_str = row.get("target_date") or row.get("date")
            if not ts or not date_str:
                continue
            try:
                ts_dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                tgt_dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
            except Exception:
                continue
            key = (str(row.get("city") or "").strip().lower(), str(date_str)[:10])
            if key[0] and key[1]:
                lead = (tgt_dt.date() - ts_dt.date()).days
                cur = lead_by_cd.get(key)
                if cur is None or lead < cur:
                    lead_by_cd[key] = lead
    except Exception:
        pass

    from datetime import datetime

    rows: List[Dict[str, Any]] = []
    for city, by_date in (daily_records or {}).items():
        if not isinstance(by_date, dict):
            continue
        history: Dict[str, Dict[str, Any]] = {}
        for target_date in sorted(by_date.keys()):
            record = by_date[target_date]
            if not isinstance(record, dict):
                continue
            actual = _sf(record.get("actual_high"))
            forecasts = record.get("forecasts")
            if actual is None or not isinstance(forecasts, dict) or not forecasts:
                history[target_date] = record
                continue
            components = calculate_dynamic_weight_components(
                city,
                forecasts,
                history_data={city: history},
            )
            raw = components.get("prediction")
            if raw is not None and int(components.get("days_used") or 0) >= min_history_days:
                actual_c = _to_c(actual, city)
                raw_c = _to_c(raw, city)
                if actual_c is not None and raw_c is not None:
                    lead = lead_by_cd.get((str(city).strip().lower(), str(target_date)[:10]), 1)
                    rows.append(
                        {
                            "city": str(city).strip().lower(),
                            "target_date": str(target_date)[:10],
                            "lead": lead,
                            "residual_c": actual_c - raw_c,
                        }
                    )
            history[target_date] = record
    return rows


def train_deb_lead_stats(
    daily_records: Dict[str, Dict[str, Dict[str, Any]]],
    *,
    min_samples: int = 20,
) -> Dict[str, Any]:
    """Train lead-stratified residual stats from settled history (no leakage).

    Returns:
        {
            "lead_biases": {"0": .., "1": .., "2": ..},
            "lead_sigmas": {"0": .., "1": .., "2": ..},
            "samples": total,
            "window_days": span of target dates,
            "trained": bool,
        }
    """
    rows = _walk_forward_deb_residuals(daily_records)
    by_lead: Dict[int, List[float]] = {}
    for row in rows:
        by_lead.setdefault(_lead_key(row["lead"]), []).append(row["residual_c"])

    lead_biases: Dict[str, float] = {}
    lead_sigmas: Dict[str, float] = {}
    total_samples = 0
    for lead_key in _LEAD_KEYS:
        resid = by_lead.get(lead_key, [])
        if len(resid) < min_samples:
            continue
        lead_biases[str(lead_key)] = round(statistics.median(resid), 3)
        lead_sigmas[str(lead_key)] = round(max(statistics.pstdev(resid), MIN_SIGMA), 3)
        total_samples += len(resid)

    if not lead_biases:
        return {
            "trained": False,
            "reason": "insufficient_lead_samples",
            "samples": len(rows),
        }

    dates = [row["target_date"] for row in rows]
    span_days = 0
    if dates:
        from datetime import datetime

        try:
            span_days = (
                datetime.strptime(max(dates), "%Y-%m-%d")
                - datetime.strptime(min(dates), "%Y-%m-%d")
            ).days + 1
        except Exception:
            span_days = 0

    return {
        "trained": True,
        "lead_biases": lead_biases,
        "lead_sigmas": lead_sigmas,
        "samples": total_samples,
        "window_days": span_days,
        "per_lead_samples": {str(k): len(v) for k, v in by_lead.items()},
    }
