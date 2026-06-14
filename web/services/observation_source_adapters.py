"""Observation source adapters with a normalized collector-facing output."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable


@dataclass(frozen=True)
class ObservationRecord:
    source: str
    city: str
    value: float
    observed_at: str
    observed_at_local: str
    station_code: str
    station_name: str
    runway: str
    value_unit: str
    source_label: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class ObservationSourceResult:
    source: str
    city: str
    status: str
    error: str
    records: tuple[ObservationRecord, ...]


_ATTACH_METHODS: dict[str, str] = {
    "amsc_awos": "_attach_china_amsc_awos_data",
    "amos": "_attach_korean_amos_data",
    "madis_hfmetar": "_attach_madis_hfmetar_data",
    "hko_obs": "_attach_hko_obs_official_nearby",
    "cowin_obs": "_attach_cowin_official_nearby",
}


def _normalize_source(source: Any) -> str:
    return str(source or "").strip().lower()


def _normalize_city(city: Any) -> str:
    return str(city or "").strip().lower()


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(row: dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def _observation_value(row: dict[str, Any]) -> float | None:
    for key in ("temp_c", "temperature_c", "temp", "value"):
        value = _float_or_none(row.get(key))
        if value is not None:
            return value
    current = row.get("current")
    if isinstance(current, dict):
        return _float_or_none(current.get("temp"))
    return None


def _iter_result_rows(results: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for value in (results or {}).values():
        if isinstance(value, dict):
            yield value
            continue
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    yield item


def _record_from_row(
    *,
    source: str,
    city: str,
    row: dict[str, Any],
) -> ObservationRecord | None:
    value = _observation_value(row)
    if value is None:
        return None
    record_source = _normalize_source(row.get("source") or row.get("source_code") or source)
    return ObservationRecord(
        source=record_source or source,
        city=city,
        value=value,
        observed_at=_text(row, ("observation_time", "observed_at", "obs_time", "time_utc", "time")),
        observed_at_local=_text(
            row,
            ("observation_time_local", "observed_at_local", "obs_time_local", "local_time"),
        ),
        station_code=_text(row, ("station_code", "icao", "istNo", "station_id", "code")).upper(),
        station_name=_text(row, ("station_name", "station_label", "name")),
        runway=_text(row, ("runway",)).upper(),
        value_unit=str(row.get("unit") or row.get("temp_unit") or "c").strip().lower(),
        source_label=_text(row, ("source_label", "label", "source_name"))
        or (record_source or source).replace("_", " ").upper(),
        payload=dict(row),
    )


def collect_observation_source(
    weather: Any,
    source: Any,
    city: Any,
    *,
    use_fahrenheit: bool,
) -> ObservationSourceResult:
    normalized_source = _normalize_source(source)
    normalized_city = _normalize_city(city)
    method_name = _ATTACH_METHODS.get(normalized_source)
    if not method_name:
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="unsupported",
            error="unsupported observation source",
            records=(),
        )
    attach: Callable[[dict[str, Any], str, bool], Any] | None = getattr(weather, method_name, None)
    if not callable(attach):
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="unsupported",
            error=f"weather collector missing {method_name}",
            records=(),
        )

    results: dict[str, Any] = {}
    attach(results, normalized_city, bool(use_fahrenheit))
    if not results:
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="no_results",
            error="source returned no observation rows",
            records=(),
        )

    records = tuple(
        record
        for record in (
            _record_from_row(source=normalized_source, city=normalized_city, row=row)
            for row in _iter_result_rows(results)
        )
        if record is not None
    )
    if not records:
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="parse_error",
            error="source response had no usable temperature",
            records=(),
        )
    return ObservationSourceResult(
        source=normalized_source,
        city=normalized_city,
        status="ok",
        error="",
        records=records,
    )
