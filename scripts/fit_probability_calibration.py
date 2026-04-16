import argparse
import json
import os
import sys
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.probability_calibration import (  # noqa: E402
    DEFAULT_CALIBRATION_FILE,
    default_calibration_payload,
    fit_calibration,
)
from src.analysis.deb_algorithm import load_history  # noqa: E402
from src.database.runtime_state import (  # noqa: E402
    DailyRecordRepository,
    ProbabilitySnapshotRepository,
    STATE_STORAGE_FILE,
    STATE_STORAGE_SQLITE,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
    get_state_storage_mode,
)


def _sf(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _load_json_if_exists(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def _legacy_training_samples_path():
    return os.path.join(
        PROJECT_ROOT,
        "artifacts",
        "probability_calibration",
        "training_samples.json",
    )


def _legacy_history_path():
    return os.path.join(PROJECT_ROOT, "data", "daily_records.json")


def _legacy_snapshot_path():
    return os.path.join(PROJECT_ROOT, "data", "probability_training_snapshots.jsonl")


def _default_history_arg():
    return _legacy_history_path() if get_state_storage_mode() == STATE_STORAGE_FILE else None


def _default_snapshot_arg():
    return _legacy_snapshot_path() if get_state_storage_mode() == STATE_STORAGE_FILE else None


def _load_history_with_fallback(path):
    if not path:
        if get_state_storage_mode() == STATE_STORAGE_SQLITE:
            return DailyRecordRepository().load_all()
        return {}
    data = _load_json_if_exists(path)
    if data:
        return data
    return load_history(path)


def _load_truth_history():
    if get_state_storage_mode() != STATE_STORAGE_SQLITE:
        return {}
    try:
        return TruthRecordRepository().load_all()
    except Exception:
        return {}


def _load_training_feature_history():
    if get_state_storage_mode() != STATE_STORAGE_SQLITE:
        return {}
    try:
        return TrainingFeatureRecordRepository().load_all()
    except Exception:
        return {}


def _load_snapshot_rows(path):
    if get_state_storage_mode() == STATE_STORAGE_SQLITE:
        return ProbabilitySnapshotRepository().load_all_rows()
    rows = []
    if not path or not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
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


def _load_legacy_training_samples(path=None):
    payload = _load_json_if_exists(path or _legacy_training_samples_path())
    rows = payload.get("samples") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _actual_high_for(history, truth_history, settlement_history, city, date_str):
    city_rows = (history or {}).get(city) or {}
    record = city_rows.get(date_str) or {}
    actual_high = _sf(record.get("actual_high")) if isinstance(record, dict) else None
    truth_record = ((truth_history.get(city) or {}).get(date_str) or {})
    if actual_high is None and isinstance(truth_record, dict):
        actual_high = _sf(truth_record.get("actual_high"))
    filled = False
    if actual_high is None:
        actual_high = _sf(((settlement_history.get(city) or {}).get(date_str) or {}).get("max_temp"))
        filled = actual_high is not None
    metadata = {
        "settlement_source": truth_record.get("settlement_source"),
        "settlement_station_code": truth_record.get("settlement_station_code"),
        "truth_version": truth_record.get("truth_version"),
        "truth_updated_by": truth_record.get("updated_by"),
        "truth_updated_at": truth_record.get("truth_updated_at"),
    }
    return actual_high, filled, metadata


def _extract_snapshot_samples(history, truth_history=None, snapshot_rows=None, settlement_history=None):
    samples = []
    filled_actual_from_history = 0
    today = datetime.utcnow().strftime("%Y-%m-%d")
    settlement_history = settlement_history or {}

    for row in snapshot_rows or []:
        city = str(row.get("city") or "").strip().lower()
        date_str = str(row.get("date") or "").strip()
        if not city or not date_str or date_str == today:
            continue

        actual_high, filled, truth_meta = _actual_high_for(
            history,
            truth_history or {},
            settlement_history,
            city,
            date_str,
        )
        if actual_high is None:
            continue
        if filled:
            filled_actual_from_history += 1

        raw_mu = _sf(row.get("raw_mu"))
        raw_sigma = _sf(row.get("raw_sigma"))
        deb_prediction = _sf(row.get("deb_prediction"))
        ensemble = row.get("ensemble") or {}
        if not isinstance(ensemble, dict):
            ensemble = {}
        ens_median = _sf(ensemble.get("median"))
        ensemble_spread = None
        ens_p10 = _sf(ensemble.get("p10"))
        ens_p90 = _sf(ensemble.get("p90"))
        if ens_p10 is not None and ens_p90 is not None and ens_p90 >= ens_p10:
            ensemble_spread = max(0.1, (ens_p90 - ens_p10) / 2.56)
        multi_model = row.get("multi_model") or {}
        if not isinstance(multi_model, dict):
            multi_model = {}
        forecast_values = [val for val in (_sf(v) for v in multi_model.values()) if val is not None]
        forecast_values.sort()
        if ensemble_spread is None:
            if len(forecast_values) >= 2:
                ensemble_spread = max(0.6, (forecast_values[-1] - forecast_values[0]) / 2.0)
            elif raw_sigma is not None:
                ensemble_spread = raw_sigma
            else:
                ensemble_spread = 1.0
        if raw_sigma is None:
            raw_sigma = ensemble_spread

        peak_status = str(row.get("peak_status") or "before").strip().lower()
        peak_flag = 0.0
        if peak_status == "in_window":
            peak_flag = 0.5
        elif peak_status == "past":
            peak_flag = 1.0

        max_so_far = _sf(row.get("max_so_far"))
        max_so_far_gap = None
        if deb_prediction is not None and max_so_far is not None:
            max_so_far_gap = deb_prediction - max_so_far

        if raw_mu is None:
            continue

        samples.append(
            {
                "city": city,
                "date": date_str,
                "timestamp": row.get("timestamp"),
                "actual_high": actual_high,
                "raw_mu": raw_mu,
                "raw_sigma": raw_sigma or 1.0,
                "deb_prediction": deb_prediction,
                "ens_median": ens_median if ens_median is not None else raw_mu,
                "ensemble_spread": ensemble_spread,
                "max_so_far_gap": max_so_far_gap,
                "peak_flag": peak_flag,
                "sample_source": "snapshot",
                **truth_meta,
            }
        )

    return samples, filled_actual_from_history


def _extract_daily_record_samples(
    history,
    training_feature_history=None,
    truth_history=None,
    settlement_history=None,
    excluded_keys=None,
):
    samples = []
    filled_actual_from_history = 0
    today = datetime.utcnow().strftime("%Y-%m-%d")
    settlement_history = settlement_history or {}
    excluded_keys = excluded_keys or set()
    for city, city_rows in (history or {}).items():
        if not isinstance(city_rows, dict):
            continue
        city_settlement = settlement_history.get(city) or {}
        for date_str, record in city_rows.items():
            if date_str == today or not isinstance(record, dict):
                continue
            if (city, date_str) in excluded_keys:
                continue
            actual_high = _sf(record.get("actual_high"))
            truth_meta = ((truth_history or {}).get(city) or {}).get(date_str) or {}
            if actual_high is None:
                actual_high = _sf(truth_meta.get("actual_high"))
            if actual_high is None:
                actual_high = _sf((city_settlement.get(date_str) or {}).get("max_temp"))
                if actual_high is not None:
                    filled_actual_from_history += 1
            feature_record = ((training_feature_history or {}).get(city) or {}).get(date_str) or {}
            source_record = feature_record if isinstance(feature_record, dict) and feature_record else record
            deb_prediction = _sf(source_record.get("deb_prediction"))
            raw_mu = _sf(source_record.get("mu")) or deb_prediction
            forecasts = source_record.get("forecasts") or {}
            if not isinstance(forecasts, dict):
                forecasts = {}
            forecast_values = [val for val in (_sf(v) for v in forecasts.values()) if val is not None]
            forecast_values.sort()
            forecast_median = (
                forecast_values[len(forecast_values) // 2] if forecast_values else None
            )
            feature_snapshot = source_record.get("probability_features") or {}
            if not isinstance(feature_snapshot, dict):
                feature_snapshot = {}

            ens_median = _sf(feature_snapshot.get("ens_median")) or forecast_median or raw_mu
            ensemble_spread = _sf(feature_snapshot.get("ensemble_spread"))
            if ensemble_spread is None:
                if len(forecast_values) >= 2:
                    ensemble_spread = max(0.6, (forecast_values[-1] - forecast_values[0]) / 2.0)
                else:
                    ensemble_spread = 1.0
            raw_sigma = _sf(feature_snapshot.get("raw_sigma")) or ensemble_spread or 1.0
            peak_status = str(feature_snapshot.get("peak_status") or "before").strip().lower()
            peak_flag = 0.0
            if peak_status == "in_window":
                peak_flag = 0.5
            elif peak_status == "past":
                peak_flag = 1.0

            if actual_high is None or raw_mu is None:
                continue

            max_so_far = _sf(feature_snapshot.get("max_so_far"))
            max_so_far_gap = _sf(feature_snapshot.get("max_so_far_gap"))
            if max_so_far_gap is None and max_so_far is not None and deb_prediction is not None:
                max_so_far_gap = deb_prediction - max_so_far

            samples.append(
                {
                    "city": city,
                    "date": date_str,
                    "actual_high": actual_high,
                    "raw_mu": raw_mu,
                    "raw_sigma": raw_sigma,
                    "deb_prediction": deb_prediction,
                    "ens_median": ens_median,
                    "ensemble_spread": ensemble_spread,
                    "max_so_far_gap": max_so_far_gap,
                    "peak_flag": peak_flag,
                    "sample_source": "daily_record",
                    "settlement_source": truth_meta.get("settlement_source"),
                    "settlement_station_code": truth_meta.get("settlement_station_code"),
                    "truth_version": truth_meta.get("truth_version"),
                    "truth_updated_by": truth_meta.get("updated_by"),
                    "truth_updated_at": truth_meta.get("truth_updated_at"),
                }
            )
    return samples, filled_actual_from_history


def _extract_samples(history, training_feature_history=None, truth_history=None, settlement_history=None, snapshot_rows=None):
    snapshot_samples, snapshot_filled = _extract_snapshot_samples(
        history,
        truth_history=truth_history,
        snapshot_rows=snapshot_rows or [],
        settlement_history=settlement_history,
    )
    excluded_keys = {
        (sample["city"], sample["date"])
        for sample in snapshot_samples
    }
    daily_samples, daily_filled = _extract_daily_record_samples(
        history,
        training_feature_history=training_feature_history,
        truth_history=truth_history,
        settlement_history=settlement_history,
        excluded_keys=excluded_keys,
    )
    return snapshot_samples + daily_samples, snapshot_filled + daily_filled


def merge_samples_with_legacy_archive(samples, legacy_samples=None):
    merged = []
    seen = set()
    for sample in samples or []:
        if not isinstance(sample, dict):
            continue
        key = (
            str(sample.get("city") or "").strip().lower(),
            str(sample.get("date") or "").strip(),
            str(sample.get("sample_source") or "").strip().lower(),
        )
        if not key[0] or not key[1]:
            continue
        if key in seen:
            continue
        merged.append(sample)
        seen.add(key)
    for sample in legacy_samples or []:
        if not isinstance(sample, dict):
            continue
        key = (
            str(sample.get("city") or "").strip().lower(),
            str(sample.get("date") or "").strip(),
            str(sample.get("sample_source") or "").strip().lower(),
        )
        if not key[0] or not key[1]:
            continue
        if key in seen:
            continue
        merged.append(sample)
        seen.add(key)
    return merged


def main():
    parser = argparse.ArgumentParser(description="Fit PolyWeather probability calibration parameters.")
    parser.add_argument(
        "--history-file",
        default=_default_history_arg(),
        help="Optional legacy daily_records.json path. In sqlite mode this defaults to the runtime database.",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_CALIBRATION_FILE,
        help="Output JSON file for fitted calibration parameters.",
    )
    parser.add_argument(
        "--settlement-history",
        default=os.path.join(
            PROJECT_ROOT,
            "artifacts",
            "probability_calibration",
            "settlement_history.json",
        ),
        help="Optional daily settlement history JSON built from historical CSV files.",
    )
    parser.add_argument(
        "--snapshot-file",
        default=_default_snapshot_arg(),
        help="Optional legacy JSONL snapshot archive path. In sqlite mode this defaults to the runtime database.",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="Optional explicit calibration version.",
    )
    args = parser.parse_args()

    history = _load_history_with_fallback(args.history_file)
    training_feature_history = _load_training_feature_history()
    truth_history = _load_truth_history()
    settlement_history = _load_json_if_exists(args.settlement_history)
    snapshot_rows = _load_snapshot_rows(args.snapshot_file)
    legacy_training_samples = _load_legacy_training_samples()
    samples, filled_actual_from_history = _extract_samples(
        history,
        training_feature_history=training_feature_history,
        truth_history=truth_history,
        settlement_history=settlement_history,
        snapshot_rows=snapshot_rows,
    )
    samples = merge_samples_with_legacy_archive(samples, legacy_training_samples)
    calibration = fit_calibration(samples, version=args.version)
    if not samples:
        calibration = default_calibration_payload(
            version=args.version,
            reason="no_samples",
        )
    calibration.setdefault("metrics", {})
    calibration["metrics"]["filled_actual_from_history"] = filled_actual_from_history
    calibration["metrics"]["settlement_history_city_count"] = len(settlement_history)
    calibration["metrics"]["legacy_archive_samples"] = len(legacy_training_samples)
    try:
        calibration["source"] = os.path.relpath(args.output, PROJECT_ROOT)
    except ValueError:
        calibration["source"] = os.path.abspath(args.output)

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(calibration, fh, ensure_ascii=False, indent=2)

    print(
        "saved calibration to {path} with {count} samples".format(
            path=args.output,
            count=calibration.get("metrics", {}).get("sample_count", 0),
        )
    )


if __name__ == "__main__":
    main()
