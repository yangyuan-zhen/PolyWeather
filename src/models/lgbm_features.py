from __future__ import annotations

import json
import os
from datetime import datetime
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from src.analysis.deb_algorithm import load_history
from src.data_collection.city_registry import ALIASES
from src.database.runtime_state import (
    DailyRecordRepository,
    ProbabilitySnapshotRepository,
    STATE_STORAGE_FILE,
    STATE_STORAGE_SQLITE,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
    get_state_storage_mode,
)


BASE_MODEL_COLUMNS: List[Tuple[str, str]] = [
    ("Open-Meteo", "open_meteo"),
    ("ECMWF", "ecmwf"),
    ("GFS", "gfs"),
    ("GEM", "gem"),
    ("JMA", "jma"),
    ("ICON", "icon"),
    ("MGM", "mgm"),
    ("NWS", "nws"),
]

FEATURE_NAMES: List[str] = [
    "actual_high_lag_1",
    "actual_high_lag_2",
    "actual_high_lag_3",
    "actual_high_lag_7",
    "actual_high_mean_7",
    "actual_high_mean_14",
    "actual_high_trend_3",
    *[column for _, column in BASE_MODEL_COLUMNS],
    "deb_prediction",
    "model_median",
    "model_spread",
    "current_temp",
    "max_so_far",
    "humidity",
    "wind_speed_kt",
    "visibility_mi",
    "local_hour",
    "month",
    "weekday",
    "peak_status_code",
]

PEAK_STATUS_CODES = {
    "before": 0.0,
    "in_window": 1.0,
    "past": 2.0,
}


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_date(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _parse_timestamp(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _history_file_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if get_state_storage_mode() == STATE_STORAGE_FILE:
        return os.path.join(root, "data", "daily_records.json")
    return ""


def _snapshot_archive_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if get_state_storage_mode() == STATE_STORAGE_FILE:
        return os.path.join(root, "data", "probability_training_snapshots.jsonl")
    return ""


def _normalized_city_key(city_name: str) -> str:
    city_key = str(city_name or "").strip().lower()
    return ALIASES.get(city_key, city_key)


def _safe_mean(values: List[Optional[float]]) -> Optional[float]:
    valid = [float(v) for v in values if v is not None]
    if not valid:
        return None
    return float(mean(valid))


def _peak_status_code(value: Any) -> Optional[float]:
    status = str(value or "").strip().lower()
    if not status:
        return None
    return PEAK_STATUS_CODES.get(status, -1.0)


def _compute_model_summary(features: Dict[str, Optional[float]]) -> Tuple[Optional[float], Optional[float]]:
    values = [
        features.get(column)
        for _, column in BASE_MODEL_COLUMNS
        if features.get(column) is not None
    ]
    values = [float(v) for v in values if v is not None]
    if not values:
        return None, None
    ordered = sorted(values)
    median_value = ordered[len(ordered) // 2]
    spread_value = ordered[-1] - ordered[0] if len(ordered) >= 2 else 0.0
    return float(median_value), float(spread_value)


def load_snapshot_index(archive_path: Optional[str] = None) -> Dict[Tuple[str, str], Dict[str, Any]]:
    mode = get_state_storage_mode()
    if mode == STATE_STORAGE_SQLITE:
        latest_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in ProbabilitySnapshotRepository().load_all_rows():
            if not isinstance(row, dict):
                continue
            city = _normalized_city_key(str(row.get("city") or ""))
            date_str = str(row.get("date") or "").strip()
            if not city or not date_str:
                continue
            key = (city, date_str)
            current_best = latest_rows.get(key)
            if current_best is None or str(row.get("timestamp") or "") >= str(
                current_best.get("timestamp") or ""
            ):
                latest_rows[key] = row
        return latest_rows

    path = archive_path or _snapshot_archive_path()
    if not path or not os.path.exists(path):
        return {}

    latest_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            city = _normalized_city_key(str(row.get("city") or ""))
            date_str = str(row.get("date") or "").strip()
            if not city or not date_str:
                continue
            key = (city, date_str)
            current_best = latest_rows.get(key)
            if current_best is None or str(row.get("timestamp") or "") >= str(
                current_best.get("timestamp") or ""
            ):
                latest_rows[key] = row
    return latest_rows


def _extract_history_rows(
    history_data: Dict[str, Any],
    city_name: str,
    exclude_date: Optional[str] = None,
) -> List[Tuple[str, float]]:
    city_key = _normalized_city_key(city_name)
    city_rows = history_data.get(city_key) if isinstance(history_data, dict) else None
    if not isinstance(city_rows, dict):
        return []

    rows: List[Tuple[str, float]] = []
    for date_str, record in city_rows.items():
        if exclude_date and str(date_str) >= str(exclude_date):
            continue
        if not isinstance(record, dict):
            continue
        actual = _sf(record.get("actual_high"))
        if actual is None:
            continue
        rows.append((str(date_str), float(actual)))
    rows.sort(key=lambda item: item[0])
    return rows


def _lag(values: List[float], distance: int) -> Optional[float]:
    if len(values) < distance:
        return None
    return float(values[-distance])


def build_runtime_feature_map(
    *,
    city_name: str,
    current_forecasts: Dict[str, Any],
    deb_prediction: Optional[float],
    current_temp: Optional[float],
    max_so_far: Optional[float],
    humidity: Optional[float],
    wind_speed_kt: Optional[float],
    visibility_mi: Optional[float],
    local_hour: int,
    local_date: str,
    peak_status: str,
    history_data: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Dict[str, Optional[float]]], Dict[str, Any]]:
    data = history_data if isinstance(history_data, dict) else load_history(_history_file_path())
    history_rows = _extract_history_rows(data, city_name, exclude_date=local_date)
    history_values = [value for _, value in history_rows]

    if not history_values:
        return None, {"reason": "no_history", "history_count": 0}

    date_obj = _parse_date(local_date)
    if date_obj is None:
        return None, {"reason": "invalid_date", "history_count": len(history_values)}

    features: Dict[str, Optional[float]] = {
        "actual_high_lag_1": _lag(history_values, 1),
        "actual_high_lag_2": _lag(history_values, 2),
        "actual_high_lag_3": _lag(history_values, 3),
        "actual_high_lag_7": _lag(history_values, 7),
        "actual_high_mean_7": _safe_mean(history_values[-7:]),
        "actual_high_mean_14": _safe_mean(history_values[-14:]),
        "actual_high_trend_3": (
            history_values[-1] - history_values[-3] if len(history_values) >= 3 else None
        ),
        "deb_prediction": _sf(deb_prediction),
        "current_temp": _sf(current_temp),
        "max_so_far": _sf(max_so_far),
        "humidity": _sf(humidity),
        "wind_speed_kt": _sf(wind_speed_kt),
        "visibility_mi": _sf(visibility_mi),
        "local_hour": float(local_hour),
        "month": float(date_obj.month),
        "weekday": float(date_obj.weekday()),
        "peak_status_code": _peak_status_code(peak_status),
    }

    for model_name, column in BASE_MODEL_COLUMNS:
        features[column] = _sf(current_forecasts.get(model_name))

    model_median, model_spread = _compute_model_summary(features)
    features["model_median"] = model_median
    features["model_spread"] = model_spread

    return features, {
        "reason": "ok",
        "history_count": len(history_values),
    }


def _features_to_vector(features: Dict[str, Optional[float]], feature_names: Optional[List[str]] = None) -> List[float]:
    ordered_names = feature_names or FEATURE_NAMES
    vector: List[float] = []
    for name in ordered_names:
        value = features.get(name)
        vector.append(float("nan") if value is None else float(value))
    return vector


def build_training_samples(
    history_data: Optional[Dict[str, Any]] = None,
    snapshot_index: Optional[Dict[Tuple[str, str], Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    mode = get_state_storage_mode()
    if isinstance(history_data, dict):
        runtime_history = history_data
    elif mode == STATE_STORAGE_SQLITE:
        runtime_history = DailyRecordRepository().load_all()
    else:
        runtime_history = load_history(_history_file_path())
    if mode == STATE_STORAGE_SQLITE:
        truth_history = TruthRecordRepository().load_all()
        training_feature_history = TrainingFeatureRecordRepository().load_all()
    else:
        truth_history = runtime_history
        training_feature_history = {}
    snapshots = snapshot_index if isinstance(snapshot_index, dict) else load_snapshot_index()
    samples: List[Dict[str, Any]] = []
    excluded_keys: set[tuple[str, str]] = set()

    for (city_name, date_str), snapshot in (snapshots or {}).items():
        if not isinstance(snapshot, dict):
            continue
        truth_row = ((truth_history.get(city_name) or {}).get(str(date_str)) or {})
        target = _sf(truth_row.get("actual_high"))
        if target is None:
            runtime_record = ((runtime_history.get(city_name) or {}).get(str(date_str)) or {})
            target = _sf(runtime_record.get("actual_high"))
        if target is None:
            continue
        observation = snapshot.get("observation") if isinstance(snapshot.get("observation"), dict) else {}
        current_forecasts = snapshot.get("multi_model") if isinstance(snapshot.get("multi_model"), dict) else {}
        local_hour = _sf(observation.get("local_hour"))
        if local_hour is None:
            timestamp = _parse_timestamp(snapshot.get("timestamp"))
            local_hour = float(timestamp.hour) if timestamp is not None else 12.0
        feature_map, meta = build_runtime_feature_map(
            city_name=city_name,
            current_forecasts=current_forecasts,
            deb_prediction=_sf(snapshot.get("deb_prediction")) or _sf(snapshot.get("raw_mu")),
            current_temp=_sf(observation.get("current_temp")),
            max_so_far=_sf(snapshot.get("max_so_far")),
            humidity=_sf(observation.get("humidity")),
            wind_speed_kt=_sf(observation.get("wind_speed_kt")),
            visibility_mi=_sf(observation.get("visibility_mi")),
            local_hour=int(local_hour),
            local_date=str(date_str),
            peak_status=str(snapshot.get("peak_status") or "before"),
            history_data=truth_history,
        )
        if not feature_map:
            continue
        samples.append(
            {
                "city": _normalized_city_key(city_name),
                "date": str(date_str),
                "target": float(target),
                "features": feature_map,
                "vector": _features_to_vector(feature_map),
                "history_count": int(meta.get("history_count") or 0),
                "deb_prediction": _sf(snapshot.get("deb_prediction")) or _sf(snapshot.get("raw_mu")),
                "forecasts": {
                    key: _sf(value)
                    for key, value in current_forecasts.items()
                    if _sf(value) is not None
                },
                "sample_source": "snapshot",
                "settlement_source": truth_row.get("settlement_source"),
                "settlement_station_code": truth_row.get("settlement_station_code"),
                "truth_version": truth_row.get("truth_version"),
                "truth_updated_by": truth_row.get("updated_by"),
                "truth_updated_at": truth_row.get("truth_updated_at"),
            }
        )
        excluded_keys.add((_normalized_city_key(city_name), str(date_str)))

    training_source = training_feature_history or runtime_history or {}
    for city_name, city_records in training_source.items():
        if not isinstance(city_records, dict):
            continue
        ordered_dates = sorted(city_records.keys())
        for date_str in ordered_dates:
            normalized_city = _normalized_city_key(city_name)
            if (normalized_city, str(date_str)) in excluded_keys:
                continue
            record = city_records.get(date_str)
            if not isinstance(record, dict):
                continue
            truth_row = ((truth_history.get(normalized_city) or {}).get(str(date_str)) or {})
            target = _sf(truth_row.get("actual_high"))
            if target is None:
                target = _sf(((runtime_history.get(normalized_city) or {}).get(str(date_str)) or {}).get("actual_high"))
            forecasts = record.get("forecasts") if isinstance(record.get("forecasts"), dict) else {}
            if target is None or not forecasts:
                continue

            feature_map, meta = build_runtime_feature_map(
                city_name=city_name,
                current_forecasts=forecasts,
                deb_prediction=_sf(record.get("deb_prediction")),
                current_temp=None,
                max_so_far=None,
                humidity=None,
                wind_speed_kt=None,
                visibility_mi=None,
                local_hour=12,
                local_date=str(date_str),
                peak_status="before",
                history_data=truth_history,
            )
            if not feature_map:
                continue

            snapshot = snapshots.get((_normalized_city_key(city_name), str(date_str))) or {}
            observation = snapshot.get("observation") if isinstance(snapshot.get("observation"), dict) else {}
            feature_map["max_so_far"] = _sf(snapshot.get("max_so_far"))
            feature_map["current_temp"] = _sf(observation.get("current_temp"))
            feature_map["humidity"] = _sf(observation.get("humidity"))
            feature_map["wind_speed_kt"] = _sf(observation.get("wind_speed_kt"))
            feature_map["visibility_mi"] = _sf(observation.get("visibility_mi"))
            local_hour = _sf(observation.get("local_hour"))
            if local_hour is not None:
                feature_map["local_hour"] = local_hour
            else:
                timestamp = _parse_timestamp(snapshot.get("timestamp"))
                if timestamp is not None:
                    feature_map["local_hour"] = float(timestamp.hour)
            peak_code = _peak_status_code(snapshot.get("peak_status"))
            if peak_code is not None:
                feature_map["peak_status_code"] = peak_code
            model_median, model_spread = _compute_model_summary(feature_map)
            feature_map["model_median"] = model_median
            feature_map["model_spread"] = model_spread

            samples.append(
                {
                    "city": _normalized_city_key(city_name),
                    "date": str(date_str),
                    "target": float(target),
                    "features": feature_map,
                    "vector": _features_to_vector(feature_map),
                    "history_count": int(meta.get("history_count") or 0),
                    "deb_prediction": _sf(record.get("deb_prediction")),
                    "forecasts": {
                        key: _sf(value)
                        for key, value in forecasts.items()
                        if _sf(value) is not None
                    },
                    "sample_source": "daily_record",
                    "settlement_source": truth_row.get("settlement_source"),
                    "settlement_station_code": truth_row.get("settlement_station_code"),
                    "truth_version": truth_row.get("truth_version"),
                    "truth_updated_by": truth_row.get("updated_by"),
                    "truth_updated_at": truth_row.get("truth_updated_at"),
                }
            )
    samples.sort(key=lambda row: (row["date"], row["city"]))
    return samples


def schema_payload(
    *,
    model_path: str,
    sample_count: int,
    train_count: int,
    validation_count: int,
    metrics: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "model_type": "LightGBMRegressor",
        "target": "actual_high",
        "horizon": "D0",
        "feature_names": FEATURE_NAMES,
        "base_model_columns": [column for _, column in BASE_MODEL_COLUMNS],
        "model_path": model_path,
        "sample_count": sample_count,
        "train_count": train_count,
        "validation_count": validation_count,
        "metrics": metrics,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
