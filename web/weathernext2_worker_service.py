"""Offline WeatherNext 2 fetch and calibration worker service."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Sequence

from loguru import logger

from src.analysis.weathernext2_calibration import train_lightgbm_quantile_calibrator
from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.weathernext2_fetcher import (
    batch_extract_all_cities_from_grid,
    extract_member_hourly_from_grid_dataset,
    open_weathernext2_zarr_dataset,
)
from src.data_collection.weathernext2_sources import (
    WEATHERNEXT2_GCS_ZARR_URI,
    build_city_local_daily_highs_from_hourly,
    build_weathernext2_city_probability,
)
from src.database.runtime_state import (
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
)


CityFetcher = Callable[[str, Mapping[str, Any], str], Optional[Mapping[str, Any]]]


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


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


def _city_target_date(city_meta: Mapping[str, Any]) -> str:
    offset_seconds = int(city_meta.get("tz_offset") or 0)
    now_utc = datetime.now(timezone.utc).timestamp()
    return datetime.fromtimestamp(now_utc + offset_seconds, tz=timezone.utc).date().isoformat()


def _safe_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _dataset_source_run(dataset: Any) -> Optional[str]:
    attrs = getattr(dataset, "attrs", None)
    if isinstance(attrs, Mapping):
        for key in ("source_run", "forecast_reference_time", "init_time", "run_time"):
            value = attrs.get(key)
            if value:
                return str(value)
    for key in ("init_time", "forecast_reference_time", "time"):
        try:
            values = dataset[key].values
        except Exception:
            try:
                values = dataset[key]
            except Exception:
                continue
        try:
            first = values[-1]
        except Exception:
            first = values
        if first is not None:
            return str(first)
    return None


def _default_city_fetcher(dataset: Any, temp_var: Optional[str]) -> CityFetcher:
    source_run = _dataset_source_run(dataset)

    def fetch(city: str, meta: Mapping[str, Any], target_date: str) -> Optional[Mapping[str, Any]]:
        lat = _safe_float(meta.get("lat"))
        lon = _safe_float(meta.get("lon"))
        if lat is None or lon is None:
            return None
        use_fahrenheit = bool(meta.get("use_fahrenheit") or meta.get("f"))
        extracted = extract_member_hourly_from_grid_dataset(
            dataset,
            lat=lat,
            lon=lon,
            temp_var=temp_var,
            use_fahrenheit=use_fahrenheit,
        )
        member_highs = build_city_local_daily_highs_from_hourly(
            extracted["member_hourly"],
            extracted["utc_times"],
            int(meta.get("tz_offset") or 0),
            target_date,
        )
        if not member_highs:
            return None
        payload = build_weathernext2_city_probability(
            city=city,
            member_highs=member_highs,
            temp_symbol="°F" if use_fahrenheit else "°C",
            target_date=target_date,
            source_run=source_run,
        )
        payload["fetch_metadata"] = {
            "backend": "gcs_zarr",
            "temp_var": extracted.get("temp_var"),
            "units": extracted.get("units"),
            "nearest_lat": extracted.get("nearest_lat"),
            "nearest_lon": extracted.get("nearest_lon"),
            "requested_lat": lat,
            "requested_lon": lon,
        }
        return payload

    return fetch


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _flatten_training_records_for_weathernext2(
    *,
    feature_repo: Optional[TrainingFeatureRecordRepository] = None,
    truth_repo: Optional[TruthRecordRepository] = None,
) -> list[Dict[str, Any]]:
    features = (feature_repo or TrainingFeatureRecordRepository()).load_all()
    truth = (truth_repo or TruthRecordRepository()).load_all()
    rows: list[Dict[str, Any]] = []
    for city, by_date in features.items():
        city_truth = truth.get(city, {})
        for target_date, payload in by_date.items():
            if not isinstance(payload, dict):
                continue
            actual = payload.get("actual_high")
            if actual is None and isinstance(city_truth.get(target_date), dict):
                actual = city_truth[target_date].get("actual_high")
            if actual is None:
                continue
            row = dict(payload)
            row["city"] = city
            row["target_date"] = target_date
            row["actual_high_c"] = actual
            if "deb_prediction_c" not in row and row.get("deb_prediction") is not None:
                row["deb_prediction_c"] = row.get("deb_prediction")
            if "weathernext2" not in row and isinstance(row.get("weather_data"), dict):
                wn2 = row["weather_data"].get("weathernext2")
                if isinstance(wn2, dict):
                    row["weathernext2"] = wn2
            rows.append(row)
    return rows


def _build_payload_from_extracted(
    city: str,
    extracted: Dict[str, Any],
    target_date: str,
    source_run: Optional[str],
    *,
    use_fahrenheit: bool = False,
    tz_offset_seconds: int = 0,
) -> Optional[Mapping[str, Any]]:
    member_highs = build_city_local_daily_highs_from_hourly(
        extracted["member_hourly"],
        extracted["utc_times"],
        tz_offset_seconds,
        target_date,
    )
    if not member_highs:
        return None
    payload = build_weathernext2_city_probability(
        city=city,
        member_highs=member_highs,
        temp_symbol="°F" if use_fahrenheit else "°C",
        target_date=target_date,
        source_run=source_run,
    )
    payload["fetch_metadata"] = {
        "backend": "gcs_zarr",
        "temp_var": extracted.get("temp_var"),
        "units": extracted.get("units"),
        "requested_lat": None,
        "requested_lon": None,
    }
    return payload


def run_weathernext2_cycle(
    *,
    city_registry: Optional[Mapping[str, Mapping[str, Any]]] = None,
    cities: Optional[Iterable[str]] = None,
    output_path: Optional[str] = None,
    model_dir: Optional[str] = None,
    fetcher: Optional[CityFetcher] = None,
    dataset: Any = None,
    feature_repo: Optional[TrainingFeatureRecordRepository] = None,
    truth_repo: Optional[TruthRecordRepository] = None,
    min_global_samples: Optional[int] = None,
    min_city_samples: Optional[int] = None,
) -> Dict[str, Any]:
    registry = city_registry or CITY_REGISTRY
    data_root = Path(os.getenv("WEATHERNEXT2_DATA_ROOT", "/app/data/weathernext2"))
    out_path = Path(output_path or os.getenv("WEATHERNEXT2_CITY_HIGHS_PATH", "") or data_root / "weathernext2_city_highs.json")
    calibrator_dir = Path(model_dir or os.getenv("WEATHERNEXT2_MODEL_DIR", "/app/data/models/weathernext2_calibrator"))
    selected = _selected_city_names(registry, cities)
    backend = str(os.getenv("WEATHERNEXT2_BACKEND", "gcs_zarr") or "gcs_zarr").strip().lower()

    generated_at = datetime.now(timezone.utc).isoformat()
    opened_dataset = dataset
    temp_var = str(os.getenv("WEATHERNEXT2_TEMP_VAR", "") or "").strip() or None
    source_run: Optional[str] = None
    pre_extracted: Optional[Dict[str, Dict[str, Any]]] = None

    if fetcher is not None:
        pass
    elif opened_dataset is not None:
        source_run = _dataset_source_run(opened_dataset)
        city_configs: list[tuple[str, float, float, bool]] = []
        for city in selected:
            meta = registry.get(city) or {}
            lat = _safe_float(meta.get("lat"))
            lon = _safe_float(meta.get("lon"))
            if lat is not None and lon is not None:
                use_f = bool(meta.get("use_fahrenheit") or meta.get("f"))
                city_configs.append((city, lat, lon, use_f))
        if city_configs:
            pre_extracted = batch_extract_all_cities_from_grid(
                opened_dataset, city_configs, temp_var=temp_var,
            )
    else:
        if backend != "gcs_zarr":
            return {"ok": False, "status": "skipped", "reason": "unsupported_backend", "backend": backend}
        uri = os.getenv("WEATHERNEXT2_GCS_ZARR_URI", WEATHERNEXT2_GCS_ZARR_URI)
        opened_dataset = open_weathernext2_zarr_dataset(uri)
        source_run = _dataset_source_run(opened_dataset)
        city_configs = []
        for city in selected:
            meta = registry.get(city) or {}
            lat = _safe_float(meta.get("lat"))
            lon = _safe_float(meta.get("lon"))
            if lat is not None and lon is not None:
                use_f = bool(meta.get("use_fahrenheit") or meta.get("f"))
                city_configs.append((city, lat, lon, use_f))
        if city_configs:
            pre_extracted = batch_extract_all_cities_from_grid(
                opened_dataset, city_configs, temp_var=temp_var,
            )

    city_payloads: Dict[str, Dict[str, Any]] = {}
    failed = 0
    items = []
    for city in selected:
        meta = registry.get(city) or {}
        target_date = _city_target_date(meta)
        try:
            if pre_extracted is not None and city in pre_extracted:
                use_f = bool(meta.get("use_fahrenheit") or meta.get("f"))
                tz_off = int(meta.get("tz_offset") or 0)
                payload = _build_payload_from_extracted(
                    city, pre_extracted[city], target_date, source_run,
                    use_fahrenheit=use_f, tz_offset_seconds=tz_off,
                )
            elif fetcher is not None:
                payload = fetcher(city, meta, target_date)
            else:
                payload = None
            if not isinstance(payload, Mapping):
                items.append({"city": city, "ok": True, "status": "empty", "target_date": target_date})
                continue
            city_payloads[city] = dict(payload)
            items.append({"city": city, "ok": True, "status": "written", "target_date": target_date})
        except Exception as exc:
            failed += 1
            logger.warning("WeatherNext2 city fetch failed city={}: {}", city, exc)
            items.append({"city": city, "ok": False, "status": "failed", "target_date": target_date, "error": str(exc)})

    training_rows = _flatten_training_records_for_weathernext2(
        feature_repo=feature_repo,
        truth_repo=truth_repo,
    )
    calibration = train_lightgbm_quantile_calibrator(
        training_rows,
        model_dir=calibrator_dir,
        min_global_samples=min_global_samples
        if min_global_samples is not None
        else _env_int("WEATHERNEXT2_MIN_GLOBAL_SAMPLES", 150),
        min_city_samples=min_city_samples
        if min_city_samples is not None
        else _env_int("WEATHERNEXT2_MIN_CITY_SAMPLES", 5),
    )

    if not city_payloads:
        return {
            "ok": failed == 0,
            "status": "no_city_payloads",
            "backend": backend,
            "generated_at": generated_at,
            "city_count": 0,
            "failed": failed,
            "items": items,
            "calibration": calibration,
            "output_path": str(out_path),
        }

    artifact = {
        "schema_version": 1,
        "source": "weathernext2",
        "backend": backend,
        "gcs_zarr_uri": os.getenv("WEATHERNEXT2_GCS_ZARR_URI", WEATHERNEXT2_GCS_ZARR_URI),
        "generated_at": generated_at,
        "city_count": len(city_payloads),
        "cities": city_payloads,
        "fetch_metadata": {
            "selected_city_count": len(selected),
            "failed": failed,
        },
        "calibration_training": calibration,
    }
    _atomic_write_json(out_path, artifact)

    return {
        "ok": failed == 0,
        "status": "written",
        "backend": backend,
        "generated_at": generated_at,
        "city_count": len(city_payloads),
        "failed": failed,
        "items": items,
        "calibration": calibration,
        "output_path": str(out_path),
    }
