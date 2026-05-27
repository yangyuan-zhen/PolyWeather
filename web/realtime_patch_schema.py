"""Versioned realtime observation patch normalization."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from src.data_collection.city_time import (
    city_local_datetime,
    get_city_timezone_name,
    get_city_utc_offset_seconds,
)


SCHEMA_TYPE = "city_observation_patch"
SCHEMA_VERSION = 1
EVENT_TYPE = "city_observation_patch.v1"
SOURCE_CADENCE_SECONDS = {
    "amos": 60,
    "amsc_awos": 60,
    "cowin_obs": 60,
    "hko_obs": 600,
    "singapore_mss": 60,
    "madis_hfmetar": 300,
    "jma_amedas": 600,
    "fmi": 600,
    "knmi": 600,
    "mgm": 300,
    "ims": 600,
    "ncm": 600,
    "aeroweb": 900,
    "cwa": 600,
    "metar": 1800,
}


class PatchValidationError(ValueError):
    """Raised when a collector patch cannot become a replayable observation event."""


def _normalize_city(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_source(value: Any) -> str:
    source = str(value or "").strip().lower()
    return source or "weather"


def _finite_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return round(number, 2)


def _first_number(*values: Any) -> Optional[float]:
    for value in values:
        number = _finite_number(value)
        if number is not None:
            return number
    return None


def _format_utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _normalize_observation_time_contract(city: str, source: str, obs_time: Optional[str]) -> Dict[str, Any]:
    parsed = _parse_datetime(obs_time)
    if parsed is None:
        contract: Dict[str, Any] = {}
        tz_name = get_city_timezone_name(city)
        if tz_name:
            contract["city_timezone"] = tz_name
        cadence = SOURCE_CADENCE_SECONDS.get(source)
        if cadence is not None:
            contract["source_cadence_sec"] = cadence
        return contract

    if parsed.tzinfo is None:
        offset = get_city_utc_offset_seconds(city, parsed.replace(tzinfo=timezone.utc))
        local_dt = parsed.replace(tzinfo=timezone(timedelta(seconds=offset)))
        observed_utc = (parsed - timedelta(seconds=offset)).replace(tzinfo=timezone.utc)
    else:
        observed_utc = parsed.astimezone(timezone.utc)
        local_dt = city_local_datetime(city, observed_utc)
        offset = int(local_dt.utcoffset().total_seconds()) if local_dt.utcoffset() else 0

    contract = {
        "observed_at_utc": _format_utc_iso(observed_utc),
        "observed_at_local": local_dt.replace(microsecond=0).isoformat(),
        "city_local_date": local_dt.strftime("%Y-%m-%d"),
        "city_utc_offset_seconds": offset,
    }
    tz_name = get_city_timezone_name(city)
    if tz_name:
        contract["city_timezone"] = tz_name
    cadence = SOURCE_CADENCE_SECONDS.get(source)
    if cadence is not None:
        contract["source_cadence_sec"] = cadence
    return contract


def _iter_runway_points(raw_points: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(raw_points, list):
        for item in raw_points:
            if isinstance(item, dict):
                yield item


def _normalize_runway_points(raw_points: Any) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for raw in _iter_runway_points(raw_points):
        runway = str(raw.get("runway") or raw.get("rwy") or "").strip().upper()
        temp = _first_number(
            raw.get("temp"),
            raw.get("target_runway_max"),
            raw.get("tdz_temp"),
            raw.get("mid_temp"),
            raw.get("end_temp"),
        )
        if not runway and temp is None:
            continue

        point: Dict[str, Any] = {}
        if runway:
            point["runway"] = runway
        if temp is not None:
            point["temp"] = temp
        for key in ("tdz_temp", "mid_temp", "end_temp", "target_runway_max"):
            value = _finite_number(raw.get(key))
            if value is not None:
                point[key] = value
        if isinstance(raw.get("is_settlement"), bool):
            point["is_settlement"] = raw["is_settlement"]
        if point:
            points.append(point)
    return points


def _legacy_changes(patch: Dict[str, Any]) -> Dict[str, Any]:
    changes = patch.get("changes")
    return changes if isinstance(changes, dict) else {}


def _payload_from_legacy(changes: Dict[str, Any]) -> Dict[str, Any]:
    amos = changes.get("amos") if isinstance(changes.get("amos"), dict) else {}
    runway_obs = amos.get("runway_obs") if isinstance(amos.get("runway_obs"), dict) else {}

    payload: Dict[str, Any] = {}
    temp = _finite_number(changes.get("temp"))
    if temp is not None:
        payload["temp"] = temp
    max_so_far = _first_number(changes.get("max_so_far"), changes.get("current_max_so_far"))
    if max_so_far is not None:
        payload["max_so_far"] = max_so_far

    station_code = str(
        changes.get("station_code")
        or changes.get("icao")
        or amos.get("icao")
        or ""
    ).strip().upper()
    if station_code:
        payload["station_code"] = station_code

    station_label = str(
        changes.get("station_label")
        or amos.get("station_label")
        or amos.get("station_name")
        or ""
    ).strip()
    if station_label:
        payload["station_label"] = station_label

    series_key = str(changes.get("series_key") or "").strip()
    if series_key:
        payload["series_key"] = series_key
    payload["unit"] = str(changes.get("unit") or "celsius").strip().lower() or "celsius"

    raw_runway_points = changes.get("runway_points")
    if raw_runway_points is None:
        raw_runway_points = runway_obs.get("point_temperatures")
    runway_points = _normalize_runway_points(raw_runway_points)
    if runway_points:
        payload["runway_points"] = runway_points

    hourly = changes.get("hourly")
    if isinstance(hourly, dict):
        payload["hourly"] = hourly

    return payload


def _payload_from_v1(raw_payload: Any) -> Dict[str, Any]:
    if not isinstance(raw_payload, dict):
        return {}

    payload: Dict[str, Any] = {}
    temp = _finite_number(raw_payload.get("temp"))
    if temp is not None:
        payload["temp"] = temp
    max_so_far = _finite_number(raw_payload.get("max_so_far"))
    if max_so_far is not None:
        payload["max_so_far"] = max_so_far

    for key in ("station_code", "station_label", "series_key", "unit"):
        value = raw_payload.get(key)
        if isinstance(value, str) and value.strip():
            payload[key] = value.strip()
    if "unit" not in payload:
        payload["unit"] = "celsius"

    runway_points = _normalize_runway_points(raw_payload.get("runway_points"))
    if runway_points:
        payload["runway_points"] = runway_points
    if isinstance(raw_payload.get("hourly"), dict):
        payload["hourly"] = raw_payload["hourly"]
    return payload


def _has_observation(payload: Dict[str, Any]) -> bool:
    return any(
        key in payload
        for key in ("temp", "max_so_far", "runway_points", "hourly")
    )


def normalize_observation_patch(patch: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(patch, dict):
        raise PatchValidationError("patch must be an object")

    if patch.get("type") == EVENT_TYPE:
        city = _normalize_city(patch.get("city"))
        source = _normalize_source(patch.get("source"))
        obs_time = str(patch.get("obs_time") or "").strip() or None
        payload = _payload_from_v1(patch.get("payload"))
    else:
        changes = _legacy_changes(patch)
        city = _normalize_city(patch.get("city"))
        source = _normalize_source(changes.get("source") or patch.get("source"))
        obs_time = str(changes.get("obs_time") or patch.get("obs_time") or "").strip() or None
        payload = _payload_from_legacy(changes)

    if not city:
        raise PatchValidationError("city is required")
    if not _has_observation(payload):
        raise PatchValidationError("patch must include temperature, max, runway, or hourly data")

    time_contract = _normalize_observation_time_contract(city, source, obs_time)
    if time_contract:
        payload = {
            **payload,
            **{
                key: value
                for key, value in time_contract.items()
                if key in {
                    "observed_at_utc",
                    "observed_at_local",
                    "city_local_date",
                    "city_utc_offset_seconds",
                    "city_timezone",
                    "source_cadence_sec",
                }
            },
        }
        obs_time = str(time_contract.get("observed_at_utc") or obs_time or "").strip() or None

    return {
        "type": EVENT_TYPE,
        "schema_type": SCHEMA_TYPE,
        "schema_version": SCHEMA_VERSION,
        "city": city,
        "source": source,
        "obs_time": obs_time,
        **time_contract,
        "ts": int(time.time() * 1000),
        "payload": payload,
    }
