from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger

from web.services.canonical_temperature import build_canonical_temperature


def parse_observation_epoch(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
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
    return int(dt.timestamp())


def _payload_latest_epoch(payload: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    values = [payload.get(key) for key in keys]
    parsed = [epoch for epoch in (parse_observation_epoch(value) for value in values) if epoch is not None]
    return max(parsed) if parsed else None


def _block_epoch(block: Any) -> Optional[int]:
    if not isinstance(block, dict):
        return None
    canonical_epoch = _payload_latest_epoch(
        block,
        (
            "observed_at",
            "observation_time",
            "obs_time",
        ),
    )
    if canonical_epoch is not None:
        return canonical_epoch
    return _payload_latest_epoch(
        block,
        (
            "observed_at_local",
            "observation_time_local",
        ),
    )


def _raw_amsc_epoch(row: dict[str, Any], raw_payload: dict[str, Any]) -> Optional[int]:
    payload_values = (
        raw_payload.get("observation_time"),
        raw_payload.get("observed_at"),
    )
    parsed = [
        epoch
        for epoch in (parse_observation_epoch(value) for value in payload_values)
        if epoch is not None
    ]
    if parsed:
        return max(parsed)
    return parse_observation_epoch(row.get("observed_at"))


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _amsc_payload_has_observation(raw_payload: dict[str, Any]) -> bool:
    temp = raw_payload.get("temp_c") if raw_payload.get("temp_c") is not None else raw_payload.get("temp")
    return _to_float(temp) is not None


def _latest_amsc_row(db: Any, city: str) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    getter = getattr(db, "get_latest_raw_observation", None)
    if not callable(getter):
        return None, None
    try:
        row = getter("amsc_awos", city)
    except Exception as exc:
        logger.debug("latest AMSC raw overlay read failed city={}: {}", city, exc)
        return None, None
    if not isinstance(row, dict):
        return None, None
    raw_payload = row.get("payload")
    if isinstance(raw_payload, dict) and raw_payload and _amsc_payload_has_observation(raw_payload):
        return row, raw_payload

    lister = getattr(db, "list_latest_raw_observations_for_city", None)
    if callable(lister):
        try:
            candidates = lister(city, limit=20)
        except Exception as exc:
            logger.debug("latest AMSC raw fallback list failed city={}: {}", city, exc)
            candidates = []
        for candidate in candidates if isinstance(candidates, list) else []:
            if not isinstance(candidate, dict):
                continue
            if str(candidate.get("source") or "").strip().lower() != "amsc_awos":
                continue
            candidate_payload = candidate.get("payload")
            if isinstance(candidate_payload, dict) and _amsc_payload_has_observation(candidate_payload):
                return candidate, candidate_payload

    return row, None


def _raw_observation_update(
    city: str,
    row: dict[str, Any],
    raw_payload: dict[str, Any],
) -> Optional[dict[str, Any]]:
    temp = _to_float(raw_payload.get("temp_c") if raw_payload.get("temp_c") is not None else raw_payload.get("temp"))
    if temp is None:
        return None
    observed_at = str(
        raw_payload.get("observation_time")
        or raw_payload.get("observed_at")
        or row.get("observed_at")
        or ""
    ).strip()
    observed_at_local = str(
        raw_payload.get("observation_time_local")
        or raw_payload.get("observed_at_local")
        or ""
    ).strip()
    source_label = str(raw_payload.get("source_label") or "AMSC AWOS").strip()
    station_code = str(raw_payload.get("icao") or row.get("station_code") or "").strip().upper() or None
    station_name = str(raw_payload.get("station_label") or row.get("station_name") or source_label).strip()
    freshness = {
        "freshness_status": "fresh",
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "source_code": "amsc_awos",
        "source_label": source_label,
    }
    return {
        "temp": round(temp, 1),
        "source_code": "amsc_awos",
        "source_label": source_label,
        "settlement_source": "amsc_awos",
        "settlement_source_label": source_label,
        "station_code": station_code,
        "station_name": station_name,
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "obs_time": observed_at or observed_at_local,
        "freshness": freshness,
        "observation_status": "live",
        "city": city,
    }


def _merge_observation_block(
    payload: dict[str, Any],
    key: str,
    update: dict[str, Any],
    raw_epoch: int,
) -> bool:
    current = payload.get(key)
    if not isinstance(current, dict):
        current = {}
    current_epoch = _block_epoch(current)
    if current_epoch is not None and current_epoch >= raw_epoch:
        return False
    merged = dict(current)
    merged.update(update)
    payload[key] = merged
    return True


def _runway_history_temp(point: dict[str, Any]) -> Optional[float]:
    for key in ("target_runway_max", "temp", "tdz_temp", "end_temp", "mid_temp"):
        temp = _to_float(point.get(key))
        if temp is not None:
            return temp
    return None


def _append_latest_amsc_runway_history(
    payload: dict[str, Any],
    row: dict[str, Any],
    raw_payload: dict[str, Any],
) -> bool:
    runway_obs = raw_payload.get("runway_obs")
    if not isinstance(runway_obs, dict):
        return False
    point_temperatures = runway_obs.get("point_temperatures")
    if not isinstance(point_temperatures, list) or not point_temperatures:
        return False
    observed_at = str(
        raw_payload.get("observation_time")
        or raw_payload.get("observed_at")
        or row.get("observed_at")
        or ""
    ).strip()
    if not observed_at:
        return False

    history = payload.get("runway_plate_history")
    if not isinstance(history, dict):
        history = {}
    else:
        history = deepcopy(history)

    use_fahrenheit = "F" in str(payload.get("temp_symbol") or "").upper()
    changed = False
    for point in point_temperatures:
        if not isinstance(point, dict):
            continue
        runway = str(point.get("runway") or "").strip().upper()
        temp = _runway_history_temp(point)
        if not runway or temp is None:
            continue
        if use_fahrenheit:
            temp = temp * 9.0 / 5.0 + 32.0
        entry = {
            "time": observed_at,
            "temp": round(float(temp), 1),
        }
        existing = history.get(runway)
        runway_history = list(existing) if isinstance(existing, list) else []
        replaced = False
        for index, current in enumerate(runway_history):
            if not isinstance(current, dict):
                continue
            current_time = str(
                current.get("time")
                or current.get("timestamp")
                or current.get("observed_at")
                or ""
            ).strip()
            if current_time == observed_at:
                if current != entry:
                    runway_history[index] = entry
                    changed = True
                replaced = True
                break
        if not replaced:
            runway_history.append(entry)
            changed = True
        history[runway] = runway_history

    if changed:
        payload["runway_plate_history"] = history
    return changed


def overlay_latest_amsc_observation(
    db: Any,
    city: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city or not isinstance(payload, dict) or not payload:
        return payload
    row, raw_payload = _latest_amsc_row(db, normalized_city)
    if not isinstance(row, dict) or not isinstance(raw_payload, dict):
        return payload
    raw_epoch = _raw_amsc_epoch(row, raw_payload)
    if raw_epoch is None:
        return payload
    update = _raw_observation_update(normalized_city, row, raw_payload)
    if not update:
        return payload

    next_payload = deepcopy(payload)
    changed = False
    amos = next_payload.get("amos")
    amos_epoch = _block_epoch(amos)
    if amos_epoch is None or raw_epoch > amos_epoch:
        next_payload["amos"] = dict(raw_payload)
        changed = True

    for key in ("current", "airport_primary", "airport_current"):
        changed = _merge_observation_block(next_payload, key, update, raw_epoch) or changed

    changed = _append_latest_amsc_runway_history(next_payload, row, raw_payload) or changed

    canonical = next_payload.get("canonical_temperature")
    canonical_epoch = _block_epoch(canonical)
    if canonical_epoch is None or raw_epoch > canonical_epoch:
        canonical_payload = build_canonical_temperature(
            normalized_city,
            {
                "name": normalized_city,
                "temp_symbol": next_payload.get("temp_symbol") or "\u00b0C",
                "updated_at": row.get("fetched_at"),
                "current": update,
            },
            fetched_at=str(row.get("fetched_at") or ""),
        )
        if canonical_payload:
            next_payload["canonical_temperature"] = canonical_payload
            changed = True

    return next_payload if changed else payload
