"""Canonical temperature selection from normalized raw observations."""

from __future__ import annotations

from typing import Any, Iterable, Optional

from src.data_collection.city_registry import CITY_REGISTRY
from web.services.analysis_utils import parse_utc_datetime
from web.services.canonical_temperature import build_canonical_temperature
from web.services.observation_freshness import build_observation_freshness
from web.realtime_patch_schema import normalize_observation_patch


_SETTLEMENT_SOURCE_ADAPTERS = {
    "hko": {"hko_obs", "cowin_obs"},
    "cwa": {"cwa"},
    "noaa": {"madis_hfmetar", "metar", "noaa"},
    "wunderground": {"amsc_awos", "amos", "madis_hfmetar", "metar", "wunderground"},
}

_SOURCE_WEIGHTS = {
    "amsc_awos": 720,
    "amos": 700,
    "hko_obs": 680,
    "cowin_obs": 660,
    "madis_hfmetar": 500,
    "metar": 460,
}

_FRESHNESS_WEIGHTS = {
    "fresh": 80,
    "expected_wait": 60,
    "delayed": 35,
    "unknown": 20,
    "stale": 5,
}


def _normalized_city(city: Any) -> str:
    return str(city or "").strip().lower()


def _normalized_source(source: Any) -> str:
    return str(source or "").strip().lower()


def _station_code(value: Any) -> str:
    return str(value or "").strip().upper()


def _source_label(row: dict[str, Any]) -> str:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    for source in (row, payload):
        for key in ("source_label", "label", "source_name"):
            value = str(source.get(key) or "").strip()
            if value:
                return value
    source = _normalized_source(row.get("source"))
    return source.replace("_", " ").upper() if source else "Observation"


def _observed_at_local(row: dict[str, Any]) -> str:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    for source in (row, payload):
        for key in ("observed_at_local", "observation_time_local", "obs_time_local"):
            value = str(source.get(key) or "").strip()
            if value:
                return value
    return ""


def _freshness(row: dict[str, Any]) -> dict[str, Any]:
    source = _normalized_source(row.get("source"))
    source_label = _source_label(row)
    fetched_at = str(row.get("fetched_at") or "").strip()
    return build_observation_freshness(
        source_code=source,
        source_label=source_label,
        observed_at=row.get("observed_at"),
        observed_at_local=_observed_at_local(row),
        ingested_at=fetched_at,
        now_utc=parse_utc_datetime(fetched_at),
    )


def _candidate_canonical(city: str, row: dict[str, Any]) -> Optional[dict[str, Any]]:
    value = row.get("value")
    if value is None or str(row.get("status") or "").strip().lower() != "ok":
        return None
    source = _normalized_source(row.get("source"))
    source_label = _source_label(row)
    observed_at = str(row.get("observed_at") or "").strip()
    observed_at_local = _observed_at_local(row)
    payload = {
        "name": city,
        "temp_symbol": "°F" if str(row.get("value_unit") or "").lower().startswith("f") else "°C",
        "updated_at": str(row.get("fetched_at") or ""),
        "current": {
            "temp": value,
            "source_code": source,
            "source_label": source_label,
            "settlement_source": source,
            "settlement_source_label": source_label,
            "station_code": row.get("station_code"),
            "station_name": row.get("station_name"),
            "observed_at": observed_at or None,
            "observed_at_local": observed_at_local or None,
            "obs_time": observed_at_local or observed_at,
            "freshness": _freshness(row),
            "observation_status": "live",
        },
    }
    return build_canonical_temperature(city, payload, fetched_at=str(row.get("fetched_at") or ""))


def _score(city: str, row: dict[str, Any], canonical: dict[str, Any]) -> tuple[int, float]:
    meta = CITY_REGISTRY.get(city) or {}
    station_code = _station_code(row.get("station_code"))
    settlement_station_code = _station_code(meta.get("settlement_station_code") or meta.get("icao"))
    settlement_source = _normalized_source(meta.get("settlement_source"))
    expected_sources = _SETTLEMENT_SOURCE_ADAPTERS.get(settlement_source, {settlement_source})
    station_name = str(row.get("station_name") or "").strip().lower()
    candidates = {
        str(candidate or "").strip().lower()
        for candidate in (meta.get("settlement_station_candidates") or [])
        if str(candidate or "").strip()
    }
    score = _SOURCE_WEIGHTS.get(_normalized_source(row.get("source")), 100)
    if _normalized_source(row.get("source")) in expected_sources:
        score += 300
    if settlement_station_code and station_code == settlement_station_code:
        score += 1000
    if candidates and station_name in candidates:
        score += 750
    score += _FRESHNESS_WEIGHTS.get(str(canonical.get("freshness_status") or ""), 0)
    try:
        updated_at_ts = float(row.get("updated_at_ts") or 0.0)
    except (TypeError, ValueError):
        updated_at_ts = 0.0
    return score, updated_at_ts


def build_canonical_temperature_from_observations(
    city: str,
    observations: Iterable[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    normalized_city = _normalized_city(city)
    candidates: list[tuple[tuple[int, float], dict[str, Any]]] = []
    for row in observations or []:
        if not isinstance(row, dict):
            continue
        canonical = _candidate_canonical(normalized_city, row)
        if not canonical:
            continue
        candidates.append((_score(normalized_city, row, canonical), canonical))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def build_realtime_event_from_canonical(canonical: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not isinstance(canonical, dict):
        return None
    try:
        value = float(canonical.get("value"))
    except (TypeError, ValueError):
        return None
    city = _normalized_city(canonical.get("city"))
    source = _normalized_source(canonical.get("source"))
    if not city or not source:
        return None
    unit = "fahrenheit" if str(canonical.get("temp_symbol") or "").upper().endswith("F") else "celsius"
    payload: dict[str, Any] = {
        "temp": value,
        "unit": unit,
    }
    station_code = str(canonical.get("station_code") or "").strip()
    if station_code:
        payload["station_code"] = station_code
    station_label = str(canonical.get("station_name") or canonical.get("source_label") or "").strip()
    if station_label:
        payload["station_label"] = station_label
    for key in ("freshness_status", "source_role"):
        text = str(canonical.get(key) or "").strip()
        if text:
            payload[key] = text
    for key in (
        "freshness_sec",
        "confidence",
        "max_so_far",
        "signed_gap",
        "gap_to_target",
        "touch_distance",
        "current_reference",
        "edge",
        "edge_percent",
        "deb_prediction",
    ):
        value_meta = canonical.get(key)
        if value_meta is not None and value_meta != "":
            payload[key] = value_meta
    return normalize_observation_patch(
        {
            "type": "city_observation_patch.v1",
            "city": city,
            "source": source,
            "obs_time": canonical.get("observed_at"),
            "payload": payload,
        }
    )


def refresh_canonical_temperature_from_latest(db: Any, city: str) -> Optional[dict[str, Any]]:
    getter = getattr(db, "list_latest_raw_observations_for_city", None)
    setter = getattr(db, "set_canonical_temperature", None)
    if not callable(getter) or not callable(setter):
        return None
    canonical = build_canonical_temperature_from_observations(city, getter(city))
    if not canonical:
        return None
    setter(city, canonical)
    return canonical
