from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.data_collection.city_time import city_local_datetime, get_city_utc_offset_seconds
from src.database.db_manager import DBManager

_CACHE_DB = DBManager()

_SOURCE_LABELS = {
    "hko_obs": "HKO",
    "mgm": "MGM",
    "jma_amedas": "JMA",
    "metar": "METAR",
    "madis_hfmetar": "NOAA MADIS",
}

_PREFERRED_SOURCES = (
    "hko_obs",
    "mgm",
    "jma_amedas",
    "madis_hfmetar",
    "metar",
)


def _normalize_city(value: Any) -> str:
    text = str(value or "").strip().lower()
    compact = text.replace(" ", "")
    city = ALIASES.get(text, ALIASES.get(compact, text))
    if not city or city not in CITY_REGISTRY:
        raise HTTPException(status_code=404, detail="Unknown city")
    return city


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(text, fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _epoch(value: Any) -> int:
    dt = _parse_datetime(value)
    if dt is None:
        return 0
    return int(dt.timestamp())


def _row_observed_at(row: dict[str, Any], payload: dict[str, Any]) -> str:
    return _first_text(
        payload.get("observation_time"),
        payload.get("obs_time"),
        payload.get("observed_at"),
        row.get("observed_at"),
        payload.get("observation_time_local"),
        payload.get("observed_at_local"),
        row.get("fetched_at"),
    )


def _row_temp(row: dict[str, Any], payload: dict[str, Any]) -> Optional[float]:
    for key in ("temp", "temp_c", "temperature_c", "temperature", "value"):
        temp = _to_float(payload.get(key))
        if temp is not None:
            return temp
    return _to_float(row.get("value"))


def _source_code(row: dict[str, Any], payload: dict[str, Any]) -> str:
    return str(row.get("source") or payload.get("source") or "").strip().lower()


def _station_code(row: dict[str, Any], payload: dict[str, Any]) -> str:
    return _first_text(
        payload.get("icao"),
        payload.get("station_code"),
        payload.get("istNo"),
        row.get("station_code"),
    ).upper()


def _station_name(row: dict[str, Any], payload: dict[str, Any], source_label: str) -> str:
    return _first_text(
        payload.get("station_label"),
        payload.get("station_name"),
        payload.get("name"),
        row.get("station_name"),
        source_label,
    )


def _source_label(source: str, payload: dict[str, Any]) -> str:
    return _first_text(payload.get("source_label"), _SOURCE_LABELS.get(source), source.upper())


def _candidate_score(city: str, row: dict[str, Any], payload: dict[str, Any]) -> tuple[int, int, int]:
    meta = CITY_REGISTRY.get(city) or {}
    station = _station_code(row, payload)
    settlement = str(meta.get("settlement_station_code") or "").strip().upper()
    icao = str(meta.get("icao") or "").strip().upper()
    station_priority = 0
    if settlement and station == settlement:
        station_priority = 2
    elif icao and station == icao:
        station_priority = 1
    source = _source_code(row, payload)
    try:
        source_priority = len(_PREFERRED_SOURCES) - _PREFERRED_SOURCES.index(source)
    except ValueError:
        source_priority = 0
    observed = _row_observed_at(row, payload)
    return station_priority, _epoch(observed), source_priority


def _valid_raw_rows(db: Any, city: str) -> list[tuple[tuple[int, int, int], dict[str, Any], dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    lister = getattr(db, "list_latest_raw_observations_for_city", None)
    if callable(lister):
        try:
            listed = lister(city, limit=100)
        except Exception:
            listed = []
        if isinstance(listed, list):
            rows.extend([row for row in listed if isinstance(row, dict)])

    if not rows:
        getter = getattr(db, "get_latest_raw_observation", None)
        if callable(getter):
            for source in _PREFERRED_SOURCES:
                try:
                    row = getter(source, city)
                except Exception:
                    row = None
                if isinstance(row, dict):
                    rows.append(row)

    candidates: list[tuple[tuple[int, int, int], dict[str, Any], dict[str, Any]]] = []
    for row in rows:
        payload = row.get("payload")
        if not isinstance(payload, dict):
            payload = {}
        if _row_temp(row, payload) is None:
            continue
        candidates.append((_candidate_score(city, row, payload), row, payload))
    return candidates


def _airport_log_candidate(db: Any, city: str) -> Optional[dict[str, Any]]:
    meta = CITY_REGISTRY.get(city) or {}
    station_codes = [
        str(meta.get("settlement_station_code") or "").strip().upper(),
        str(meta.get("icao") or "").strip().upper(),
    ]
    reader = getattr(db, "get_airport_obs_recent", None)
    if not callable(reader):
        return None

    latest: Optional[tuple[int, dict[str, Any]]] = None
    for station_code in [code for index, code in enumerate(station_codes) if code and code not in station_codes[:index]]:
        try:
            rows = reader(station_code, minutes=180)
        except Exception:
            rows = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            temp = _to_float(row.get("temp_c") if row.get("temp_c") is not None else row.get("temp"))
            obs_time = _first_text(row.get("obs_time"), row.get("observed_at"))
            if temp is None or not obs_time:
                continue
            score = _epoch(obs_time)
            if latest is None or score > latest[0]:
                latest = (
                    score,
                    {
                        "source": "metar",
                        "source_label": "METAR",
                        "station_code": station_code,
                        "station_name": str(meta.get("airport_name") or station_code),
                        "temp": round(float(temp), 1),
                        "obs_time": obs_time,
                        "observed_at": obs_time,
                    },
                )
    return latest[1] if latest else None


def _canonical_candidate(db: Any, city: str) -> Optional[dict[str, Any]]:
    getter = getattr(db, "get_canonical_temperature", None)
    if not callable(getter):
        return None
    try:
        row = getter(city)
    except Exception:
        return None
    if not isinstance(row, dict):
        return None
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else row
    temp = _to_float(row.get("value") if row.get("value") is not None else payload.get("value"))
    if temp is None:
        return None
    return {
        "source": str(row.get("source") or payload.get("source") or "canonical").strip().lower(),
        "source_label": _first_text(row.get("source_label"), payload.get("source_label"), "Canonical"),
        "station_code": _first_text(row.get("station_code"), payload.get("station_code")),
        "station_name": _first_text(row.get("station_name"), payload.get("station_name")),
        "temp": round(float(temp), 1),
        "obs_time": _first_text(
            row.get("observed_at"),
            payload.get("observed_at"),
            row.get("updated_at"),
            payload.get("fetched_at"),
        ),
        "observed_at": _first_text(row.get("observed_at"), payload.get("observed_at")),
    }


def _local_context(city: str, obs_time: str) -> tuple[str, str, int]:
    dt = _parse_datetime(obs_time)
    if dt is None:
        local = city_local_datetime(city)
    else:
        local = city_local_datetime(city, dt.astimezone(timezone.utc))
    return local.date().isoformat(), local.strftime("%H:%M"), get_city_utc_offset_seconds(city, local)


def _observation_block(
    *,
    city: str,
    source: str,
    source_label: str,
    station_code: str,
    station_name: str,
    temp: float,
    obs_time: str,
    observed_at_local: str = "",
) -> dict[str, Any]:
    freshness = {
        "freshness_status": "fresh",
        "observed_at": obs_time or None,
        "observed_at_local": observed_at_local or None,
        "source_code": source,
        "source_label": source_label,
    }
    return {
        "city": city,
        "temp": round(float(temp), 1),
        "source_code": source,
        "source_label": source_label,
        "settlement_source": source,
        "settlement_source_label": source_label,
        "station_code": station_code or None,
        "station_name": station_name or source_label,
        "observed_at": obs_time or None,
        "observed_at_local": observed_at_local or None,
        "obs_time": obs_time or observed_at_local,
        "freshness": freshness,
        "observation_status": "live",
    }


def _payload_from_raw(city: str, row: dict[str, Any], raw_payload: dict[str, Any]) -> dict[str, Any]:
    temp = _row_temp(row, raw_payload)
    if temp is None:
        raise HTTPException(status_code=404, detail="No live observation")
    source = _source_code(row, raw_payload) or "raw_observation"
    label = _source_label(source, raw_payload)
    obs_time = _row_observed_at(row, raw_payload)
    observed_at_local = _first_text(
        raw_payload.get("observation_time_local"),
        raw_payload.get("observed_at_local"),
    )
    local_date, local_time, offset_seconds = _local_context(city, obs_time)
    current = _observation_block(
        city=city,
        source=source,
        source_label=label,
        station_code=_station_code(row, raw_payload),
        station_name=_station_name(row, raw_payload, label),
        temp=temp,
        obs_time=obs_time,
        observed_at_local=observed_at_local,
    )
    metar_point = {
        "time": local_time,
        "temp": round(float(temp), 1),
        "obs_time": obs_time,
        "source_code": source,
        "source_label": label,
    }
    return {
        "city": city,
        "name": city,
        "display_name": str((CITY_REGISTRY.get(city) or {}).get("name") or city),
        "source": "live_observation",
        "local_date": local_date,
        "local_time": local_time,
        "utc_offset_seconds": offset_seconds,
        "updated_at": obs_time or row.get("fetched_at"),
        "current": current,
        "airport_current": dict(current),
        "airport_primary": dict(current),
        "raw_observation": {
            "source": source,
            "station_code": _station_code(row, raw_payload) or None,
            "observed_at": obs_time or None,
            "fetched_at": row.get("fetched_at") or None,
        },
        "metar_today_obs": [metar_point],
        "timeseries": {"metar_today_obs": [metar_point]},
        "observation_status": "live",
    }


def _payload_from_block(city: str, block: dict[str, Any]) -> dict[str, Any]:
    temp = _to_float(block.get("temp"))
    if temp is None:
        raise HTTPException(status_code=404, detail="No live observation")
    obs_time = _first_text(block.get("obs_time"), block.get("observed_at"))
    local_date, local_time, offset_seconds = _local_context(city, obs_time)
    source = str(block.get("source") or block.get("source_code") or "observation").strip().lower()
    label = _first_text(block.get("source_label"), _SOURCE_LABELS.get(source), source.upper())
    current = _observation_block(
        city=city,
        source=source,
        source_label=label,
        station_code=str(block.get("station_code") or "").strip().upper(),
        station_name=str(block.get("station_name") or label).strip(),
        temp=temp,
        obs_time=obs_time,
    )
    metar_point = {
        "time": local_time,
        "temp": round(float(temp), 1),
        "obs_time": obs_time,
        "source_code": source,
        "source_label": label,
    }
    return {
        "city": city,
        "name": city,
        "display_name": str((CITY_REGISTRY.get(city) or {}).get("name") or city),
        "source": "live_observation",
        "local_date": local_date,
        "local_time": local_time,
        "utc_offset_seconds": offset_seconds,
        "updated_at": obs_time,
        "current": current,
        "airport_current": dict(current),
        "airport_primary": dict(current),
        "metar_today_obs": [metar_point],
        "timeseries": {"metar_today_obs": [metar_point]},
        "observation_status": "live",
    }


def get_city_observation_payload(name: str) -> dict[str, Any]:
    city = _normalize_city(name)
    candidates = _valid_raw_rows(_CACHE_DB, city)
    if candidates:
        _, row, raw_payload = max(candidates, key=lambda item: item[0])
        return _payload_from_raw(city, row, raw_payload)

    airport_log = _airport_log_candidate(_CACHE_DB, city)
    if airport_log:
        return _payload_from_block(city, airport_log)

    canonical = _canonical_candidate(_CACHE_DB, city)
    if canonical:
        return _payload_from_block(city, canonical)

    raise HTTPException(status_code=404, detail="No live observation")
