"""Observation source adapters with a normalized collector-facing output."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable

from src.data_collection.city_registry import CITY_REGISTRY


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
    "amos": "_attach_korean_amos_data",
    "madis_hfmetar": "_attach_madis_hfmetar_data",
    "hko_obs": "_attach_hko_obs_official_nearby",
    "cowin_obs": "_attach_cowin_official_nearby",
    "mgm": "_attach_turkish_mgm_data",
    "jma_amedas": "_attach_japan_official_nearby",
    "fmi": "_attach_fmi_official_nearby",
    "knmi": "_attach_knmi_official_nearby",
    "singapore_mss": "_attach_singapore_mss_data",
    "ims": "_attach_israel_ims_data",
    "ncm": "_attach_saudi_ncm_data",
    "aeroweb": "_attach_paris_aeroweb_data",
}

_NO_UNIT_ATTACH_SOURCES = {"singapore_mss", "ims", "ncm", "aeroweb"}

_TURKISH_MGM_STATION_CODES = {
    "ankara": "17128",
    "istanbul": "17058",
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


def _city_utc_offset_seconds(city: str) -> int:
    meta = CITY_REGISTRY.get(city) or {}
    try:
        return int(meta.get("tz_offset") or meta.get("utc_offset_seconds") or 0)
    except (TypeError, ValueError):
        return 0


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


def _enrich_mgm_results(results: dict[str, Any], city: str) -> None:
    mgm = results.get("mgm")
    if not isinstance(mgm, dict):
        return
    current = mgm.get("current") if isinstance(mgm.get("current"), dict) else {}
    station_code = str(
        mgm.get("station_code")
        or mgm.get("istNo")
        or _TURKISH_MGM_STATION_CODES.get(city)
        or ""
    ).strip()
    station_name = str(
        mgm.get("station_name")
        or current.get("station_name")
        or current.get("station_label")
        or ""
    ).strip()
    mgm.setdefault("source", "mgm")
    mgm.setdefault("source_label", "MGM")
    if station_code:
        mgm.setdefault("station_code", station_code)
    if station_name:
        mgm.setdefault("station_name", station_name)


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
    if not method_name and normalized_source not in {"cwa", "metar"}:
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="unsupported",
            error="unsupported observation source",
            records=(),
        )
    attach: Callable[..., Any] | None = getattr(weather, method_name, None) if method_name else None
    if method_name and not callable(attach):
        return ObservationSourceResult(
            source=normalized_source,
            city=normalized_city,
            status="unsupported",
            error=f"weather collector missing {method_name}",
            records=(),
        )

    results: dict[str, Any] = {}
    if normalized_source == "mgm":
        attach(
            results,
            normalized_city,
            include_mgm=True,
            include_nearby=True,
        )
        _enrich_mgm_results(results, normalized_city)
    elif normalized_source == "cwa":
        fetch_cwa = getattr(weather, "fetch_cwa_taipei_settlement_current", None)
        if not callable(fetch_cwa) or normalized_city != "taipei":
            return ObservationSourceResult(
                source=normalized_source,
                city=normalized_city,
                status="unsupported",
                error="weather collector missing fetch_cwa_taipei_settlement_current",
                records=(),
            )
        cwa_payload = fetch_cwa()
        if cwa_payload:
            results["cwa"] = cwa_payload
    elif normalized_source == "metar":
        fetch_metar = getattr(weather, "fetch_metar", None)
        if not callable(fetch_metar):
            return ObservationSourceResult(
                source=normalized_source,
                city=normalized_city,
                status="unsupported",
                error="weather collector missing fetch_metar",
                records=(),
            )
        metar_payload = fetch_metar(
            normalized_city,
            use_fahrenheit=bool(use_fahrenheit),
            utc_offset=_city_utc_offset_seconds(normalized_city),
        )
        if metar_payload:
            results["metar"] = metar_payload
    elif normalized_source in _NO_UNIT_ATTACH_SOURCES:
        attach(results, normalized_city)
    else:
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
