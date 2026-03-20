from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.database.runtime_state import (
    ProbabilitySnapshotRepository,
    STATE_STORAGE_DUAL,
    STATE_STORAGE_SQLITE,
    get_state_storage_mode,
)

DEDUP_SCAN_LINES = 200
MU_THRESHOLD = 0.2
SIGMA_THRESHOLD = 0.15
MAX_SO_FAR_THRESHOLD = 0.2
_snapshot_repo = ProbabilitySnapshotRepository()


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _compact_snapshot(distribution: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    compact: List[Dict[str, Any]] = []
    for row in distribution or []:
        if not isinstance(row, dict):
            continue
        value = row.get("value")
        probability = row.get("probability")
        if value is None or probability is None:
            continue
        try:
            compact.append(
                {
                    "v": int(value),
                    "p": round(float(probability), 3),
                }
            )
        except Exception:
            continue
        if len(compact) >= 4:
            break
    return compact


def _top_bucket(snapshot: Optional[List[Dict[str, Any]]]) -> Optional[int]:
    best_value = None
    best_prob = -1.0
    for row in snapshot or []:
        if not isinstance(row, dict):
            continue
        value = row.get("v")
        prob = _sf(row.get("p"))
        if value is None or prob is None:
            continue
        if prob > best_prob:
            best_value = int(value)
            best_prob = prob
    return best_value


def _load_recent_rows(path: str, max_lines: int = DEDUP_SCAN_LINES) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.readlines()[-max_lines:]
    rows = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _should_skip_append(path: str, payload: Dict[str, Any]) -> bool:
    mode = get_state_storage_mode()
    if mode == STATE_STORAGE_SQLITE:
        recent_rows = _snapshot_repo.load_recent_rows(
            str(payload.get("city") or ""),
            str(payload.get("date") or ""),
            DEDUP_SCAN_LINES,
        )
    else:
        recent_rows = _load_recent_rows(path)
    city = payload.get("city")
    date_str = payload.get("date")
    if not city or not date_str:
        return False

    for row in reversed(recent_rows):
        if row.get("city") != city or row.get("date") != date_str:
            continue
        if row.get("peak_status") != payload.get("peak_status"):
            return False
        if row.get("probability_mode") != payload.get("probability_mode"):
            return False

        current_top = _top_bucket(payload.get("prob_snapshot"))
        previous_top = _top_bucket(row.get("prob_snapshot"))
        current_shadow_top = _top_bucket(payload.get("shadow_prob_snapshot"))
        previous_shadow_top = _top_bucket(row.get("shadow_prob_snapshot"))
        if current_top != previous_top or current_shadow_top != previous_shadow_top:
            return False

        if abs((_sf(payload.get("raw_mu")) or 0.0) - (_sf(row.get("raw_mu")) or 0.0)) > MU_THRESHOLD:
            return False
        if abs((_sf(payload.get("raw_sigma")) or 0.0) - (_sf(row.get("raw_sigma")) or 0.0)) > SIGMA_THRESHOLD:
            return False
        if abs((_sf(payload.get("max_so_far")) or 0.0) - (_sf(row.get("max_so_far")) or 0.0)) > MAX_SO_FAR_THRESHOLD:
            return False

        return True

    return False


def append_probability_snapshot(
    city_name: str,
    *,
    local_date: str,
    observation_time: Optional[str],
    temp_symbol: str,
    raw_mu: Optional[float],
    raw_sigma: Optional[float],
    deb_prediction: Optional[float],
    ens_data: Optional[Dict[str, Any]],
    current_forecasts: Optional[Dict[str, Any]],
    max_so_far: Optional[float],
    peak_status: Optional[str],
    probabilities: Optional[List[Dict[str, Any]]],
    shadow_probabilities: Optional[List[Dict[str, Any]]],
    calibration_summary: Optional[Dict[str, Any]],
    archive_path: Optional[str] = None,
) -> None:
    city_key = str(city_name or "").strip().lower()
    if not city_key:
        return

    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = archive_path or os.path.join(
        root_dir,
        "data",
        "probability_training_snapshots.jsonl",
    )

    calibration_summary = calibration_summary or {}
    ens_data = ens_data or {}
    current_forecasts = current_forecasts or {}
    timestamp = str(observation_time or datetime.utcnow().isoformat() + "Z").strip()

    payload = {
        "city": city_key,
        "timestamp": timestamp,
        "date": local_date,
        "temp_symbol": temp_symbol,
        "raw_mu": _sf(raw_mu),
        "raw_sigma": _sf(raw_sigma),
        "deb_prediction": _sf(deb_prediction),
        "ensemble": {
            "p10": _sf(ens_data.get("p10")),
            "median": _sf(ens_data.get("median")),
            "p90": _sf(ens_data.get("p90")),
        },
        "multi_model": {
            key: _sf(value)
            for key, value in current_forecasts.items()
            if _sf(value) is not None
        },
        "max_so_far": _sf(max_so_far),
        "peak_status": peak_status,
        "prob_snapshot": _compact_snapshot(probabilities),
        "shadow_prob_snapshot": _compact_snapshot(shadow_probabilities),
        "probability_engine": calibration_summary.get("engine"),
        "probability_mode": calibration_summary.get("mode"),
        "calibration_version": calibration_summary.get("calibration_version"),
        "calibration_source": calibration_summary.get("calibration_source"),
        "calibrated_mu": _sf(calibration_summary.get("calibrated_mu")),
        "calibrated_sigma": _sf(calibration_summary.get("calibrated_sigma")),
    }

    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)

    if _should_skip_append(path, payload):
        return

    mode = get_state_storage_mode()
    if mode in {STATE_STORAGE_DUAL, STATE_STORAGE_SQLITE}:
        _snapshot_repo.append_snapshot(payload)

    if mode != STATE_STORAGE_SQLITE:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
