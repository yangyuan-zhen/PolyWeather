from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional, Sequence


TEMPERATURE_VARIABLE_CANDIDATES = (
    "temperature_2m",
    "2m_temperature",
    "t2m",
    "air_temperature_2m",
    "temperature",
)


def _mapping_keys(dataset: Any) -> list[str]:
    if isinstance(dataset, Mapping):
        return [str(key) for key in dataset.keys()]
    data_vars = getattr(dataset, "data_vars", None)
    if data_vars is not None:
        try:
            return [str(key) for key in data_vars.keys()]
        except Exception:
            return []
    return []


def select_temperature_variable(dataset: Any, preferred: Optional[str] = None) -> str:
    if preferred:
        keys = set(_mapping_keys(dataset))
        if preferred in keys:
            return preferred
        raise KeyError(f"WeatherNext2 temperature variable not found: {preferred}")

    keys = _mapping_keys(dataset)
    lowered = {key.lower(): key for key in keys}
    for candidate in TEMPERATURE_VARIABLE_CANDIDATES:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]

    for key in keys:
        normalized = key.lower().replace("-", "_")
        if "temperature" in normalized and ("2m" in normalized or "two_meter" in normalized):
            return key
    raise KeyError("WeatherNext2 2m temperature variable was not found")


def normalize_temperature_value(
    value: Any,
    units: str = "",
    *,
    use_fahrenheit: bool = False,
) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None

    unit = str(units or "").strip().lower()
    if unit in {"k", "kelvin"} or parsed > 150:
        celsius = parsed - 273.15
    elif unit in {"f", "fahrenheit", "degf", "degree_fahrenheit"}:
        celsius = (parsed - 32.0) * 5.0 / 9.0
    else:
        celsius = parsed

    if use_fahrenheit:
        return round(celsius * 9.0 / 5.0 + 32.0, 1)
    return round(celsius, 1)


def _get_dataset_value(dataset: Any, key: str) -> Any:
    if isinstance(dataset, Mapping):
        return dataset[key]
    return dataset[key]


def _as_list(values: Any) -> list[Any]:
    if hasattr(values, "values"):
        try:
            values = values.values
        except Exception:
            pass
    if hasattr(values, "tolist"):
        try:
            return values.tolist()
        except Exception:
            pass
    return list(values or [])


def _nearest_index(values: Sequence[Any], target: float) -> int:
    numeric_values = [float(value) for value in values]
    return min(range(len(numeric_values)), key=lambda idx: abs(numeric_values[idx] - target))


def _variable_units(dataset: Any, temp_var: str) -> str:
    if isinstance(dataset, Mapping):
        units = dataset.get("units")
        if isinstance(units, Mapping):
            return str(units.get(temp_var) or "")
        return ""
    variable = dataset[temp_var]
    attrs = getattr(variable, "attrs", {}) or {}
    return str(attrs.get("units") or attrs.get("unit") or "")


def _variable_values(dataset: Any, temp_var: str) -> Any:
    variable = _get_dataset_value(dataset, temp_var)
    if hasattr(variable, "values"):
        return variable.values
    return variable


def _index_nested(values: Any, indexes: Sequence[int]) -> Any:
    current = values
    for idx in indexes:
        current = current[idx]
    return current


def _dataset_dimension_values(dataset: Any, candidates: Sequence[str]) -> tuple[str, list[Any]]:
    keys = _mapping_keys(dataset)
    lowered = {key.lower(): key for key in keys}
    for candidate in candidates:
        key = lowered.get(candidate.lower())
        if key is not None:
            return key, _as_list(_get_dataset_value(dataset, key))

    coords = getattr(dataset, "coords", None)
    if coords is not None:
        for candidate in candidates:
            if candidate in coords:
                return candidate, _as_list(coords[candidate])
    raise KeyError(f"WeatherNext2 dimension not found: {candidates}")


def _parse_time(value: Any) -> str:
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or "").strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return str(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def batch_extract_all_cities_from_grid(
    dataset: Any,
    city_configs: Sequence[tuple[str, float, float, bool]],
    *,
    temp_var: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """Batch extract all cities by loading grid time-step by time-step.

    city_configs: list of (city_name, lat, lon, use_fahrenheit)
    Returns {city_name: extracted} where extracted contains member_hourly and utc_times.
    """
    selected_var = select_temperature_variable(dataset, temp_var)
    lats = list(dataset.coords["lat"].values)
    lons = list(dataset.coords["lon"].values)

    datetime_coord = dataset.coords.get("datetime")
    if datetime_coord is not None:
        utc_times = [str(v) for v in datetime_coord.values]
    else:
        utc_times = [str(v) for v in dataset.coords["time"].values]

    lat_idxs = [_nearest_index(lats, lat) for _, lat, _, _ in city_configs]
    lon_idxs = [_nearest_index(lons, lon) for _, _, lon, _ in city_configs]
    city_count = len(city_configs)
    num_samples = len(dataset.coords["sample"].values)
    num_times = len(utc_times)

    valid_temps: list[list[list[float]]] = [[[] for _ in range(city_count)] for _ in range(num_times)]

    for t in range(num_times):
        grid = dataset[selected_var].isel(time=t).values
        for ci, (lat_i, lon_i) in enumerate(zip(lat_idxs, lon_idxs)):
            for s in range(num_samples):
                val = grid[s, lat_i, lon_i]
                if val == val and val > 200:
                    valid_temps[t][ci].append(float(val))

    results: Dict[str, Dict[str, Any]] = {}
    for ci, (city_name, _, _, use_f) in enumerate(city_configs):
        member_hourly: Dict[str, list[Optional[float]]] = {}
        for s in range(num_samples):
            hourly: list[Optional[float]] = []
            for t in range(num_times):
                if s < len(valid_temps[t][ci]):
                    hourly.append(round(valid_temps[t][ci][s] - 273.15, 1))
                else:
                    hourly.append(None)
            member_hourly[f"member_{s:02d}"] = hourly
        results[city_name] = {
            "member_hourly": member_hourly,
            "utc_times": [_parse_time(v) for v in utc_times],
            "temp_var": selected_var,
            "units": "K",
        }
    return results


def extract_member_hourly_from_grid_dataset(
    dataset: Any,
    *,
    lat: float,
    lon: float,
    temp_var: Optional[str] = None,
    use_fahrenheit: bool = False,
) -> Dict[str, Any]:
    """Extract all member hourly temperatures for the nearest grid point."""
    selected_var = select_temperature_variable(dataset, temp_var or os.getenv("WEATHERNEXT2_TEMP_VAR") or None)
    lat_name, lat_values = _dataset_dimension_values(dataset, ("lat", "latitude"))
    lon_name, lon_values = _dataset_dimension_values(dataset, ("lon", "longitude"))
    member_name, member_values = _dataset_dimension_values(dataset, ("member", "sample", "realization", "ensemble_member"))
    time_name, _time_vals = _dataset_dimension_values(dataset, ("time", "valid_time"))
    if hasattr(dataset, "coords") and "datetime" in dataset.coords:
        utc_time_values = [str(v) for v in dataset.coords["datetime"].values]
    else:
        utc_time_values = _time_vals

    lat_idx = _nearest_index(lat_values, lat)
    lon_idx = _nearest_index(lon_values, lon)
    units = _variable_units(dataset, selected_var)

    if hasattr(dataset, "sel"):
        point = dataset[selected_var].sel(
            {lat_name: float(lat_values[lat_idx]), lon_name: float(lon_values[lon_idx])},
            method="nearest",
        )
        if hasattr(point, "values"):
            point_values = point.values
        else:
            point_values = point
        member_hourly: Dict[str, list[Optional[float]]] = {}
        for member_idx, member in enumerate(member_values):
            hourly = []
            for time_idx in range(len(utc_time_values)):
                val = _index_nested(point_values, (member_idx, time_idx))
                hourly.append(
                    normalize_temperature_value(val, units, use_fahrenheit=use_fahrenheit)
                )
            try:
                member_label = f"member_{int(member):02d}"
            except Exception:
                member_label = f"member_{member_idx:02d}"
            member_hourly[member_label] = hourly
    else:
        variable = _get_dataset_value(dataset, selected_var)
        dims = list(getattr(variable, "dims", []) or [member_name, time_name, lat_name, lon_name])
        values = _variable_values(dataset, selected_var)
        dim_indexes = {
            member_name: None,
            time_name: None,
            lat_name: lat_idx,
            lon_name: lon_idx,
        }
        member_hourly = {}
        for member_idx, member in enumerate(member_values):
            hourly = []
            for time_idx, _time_value in enumerate(utc_time_values):
                dim_indexes[member_name] = member_idx
                dim_indexes[time_name] = time_idx
                indexes = [int(dim_indexes[dim]) for dim in dims]
                hourly.append(
                    normalize_temperature_value(
                        _index_nested(values, indexes),
                        units,
                        use_fahrenheit=use_fahrenheit,
                    )
                )
            try:
                member_label = f"member_{int(member):02d}"
            except Exception:
                member_label = f"member_{member_idx:02d}"
            member_hourly[member_label] = hourly

    return {
        "temp_var": selected_var,
        "units": units,
        "lat_dim": lat_name,
        "lon_dim": lon_name,
        "member_dim": member_name,
        "time_dim": time_name,
        "nearest_lat": float(lat_values[lat_idx]),
        "nearest_lon": float(lon_values[lon_idx]),
        "utc_times": [_parse_time(value) for value in utc_time_values],
        "member_hourly": member_hourly,
    }


def _parse_gcs_uri(uri: str) -> tuple[str, str]:
    """Parse gs://bucket/path into (bucket_name, prefix_with_trailing_slash)."""
    if not uri.startswith("gs://"):
        raise ValueError(f"Not a GCS URI: {uri}")
    parts = uri[5:].split("/", 1)
    bucket_name = parts[0]
    prefix = (parts[1] + "/") if len(parts) > 1 else ""
    return bucket_name, prefix


def _resolve_latest_weathernext2_zarr_uri(base_uri: str) -> str:
    """Resolve the latest forecast predictions.zarr/ from a base GCS directory.

    Structure: base_uri/
      {time_period}/          e.g. 2025_to_present/
        {forecast_run}/       e.g. 20260721_18hr_01_preds/
          predictions.zarr/

    Optimized to check only the latest few runs (no iteration over 2000+).
    """
    try:
        from google.cloud import storage
    except ImportError:
        raise RuntimeError(
            "google-cloud-storage is required for GCS zarr discovery"
        )

    bucket_name, prefix = _parse_gcs_uri(base_uri)
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    def _list_prefixes(p: str) -> set[str]:
        result = bucket.list_blobs(delimiter="/", prefix=p)
        list(result)
        return result.prefixes or set()

    time_periods = _list_prefixes(prefix)
    if not time_periods:
        raise RuntimeError(f"No time period directories found in {base_uri}")
    latest_period = sorted(time_periods, reverse=True)[0]

    forecast_runs = sorted(_list_prefixes(latest_period), reverse=True)
    for run in forecast_runs[:10]:
        if run.rstrip("/").endswith("predictions.zarr"):
            return f"gs://{bucket_name}/{run}"
        preds = _list_prefixes(run)
        if f"{run}predictions.zarr/" in preds:
            return f"gs://{bucket_name}/{run}predictions.zarr/"

    raise RuntimeError(
        f"No predictions.zarr found in latest 10 runs under {latest_period}"
    )


def _is_explicit_zarr_uri(uri: str) -> bool:
    """Heuristic: if the URI doesn't end in .zarr/ it's a base directory that needs resolution."""
    stripped = uri.rstrip("/")
    return stripped.endswith(".zarr") or stripped.endswith("/predictions.zarr")


def open_weathernext2_zarr_dataset(uri: str):
    """Open a WeatherNext 2 Zarr dataset.

    If the URI doesn't point to an explicit ``.zarr`` store (e.g., a base GCS
    directory), the latest forecast sub-group is resolved automatically.
    """
    try:
        import xarray as xr  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on deployment extras
        raise RuntimeError("xarray is required for WeatherNext2 GCS/Zarr access") from exc

    storage_options = {}
    credentials = str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "") or "").strip()
    if credentials:
        storage_options["token"] = "google_default"

    if not _is_explicit_zarr_uri(uri):
        uri = _resolve_latest_weathernext2_zarr_uri(uri)

    def _open(uri: str) -> Any:
        try:
            return xr.open_zarr(
                uri,
                storage_options=storage_options or None,
                consolidated=True,
            )
        except Exception:
            return xr.open_zarr(
                uri,
                storage_options=storage_options or None,
                consolidated=False,
            )

    return _open(uri)
