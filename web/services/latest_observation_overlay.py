from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger

from src.database.runtime_state import OfficialIntradayObservationRepository
from web.services.canonical_temperature import build_canonical_temperature

_TAIPEI_TZ = timezone(timedelta(hours=8))


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


def _parse_observation_datetime(value: Any) -> Optional[datetime]:
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
    return dt


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



def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _latest_airport_obs_log_row(
    db: Any,
    *,
    station_code: str,
    city: str,
    source_code: str,
    source_label: str,
    station_label: str,
    use_fahrenheit: bool,
) -> Optional[dict[str, Any]]:
    reader = getattr(db, "get_airport_obs_recent", None)
    if not callable(reader):
        return None
    try:
        rows = reader(station_code, minutes=180)
    except Exception as exc:
        logger.debug("latest airport obs log read failed city={} station={}: {}", city, station_code, exc)
        return None

    latest: Optional[tuple[int, dict[str, Any]]] = None
    normalized_city = str(city or "").strip().lower()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        row_city = str(row.get("city") or "").strip().lower()
        if row_city and normalized_city and row_city != normalized_city:
            continue
        temp_c = _to_float(row.get("temp_c") if row.get("temp_c") is not None else row.get("temp"))
        obs_time = str(row.get("obs_time") or row.get("observed_at") or "").strip()
        epoch = parse_observation_epoch(obs_time)
        if temp_c is None or not obs_time or epoch is None:
            continue
        if latest is None or epoch > latest[0]:
            latest = (epoch, row)

    if latest is None:
        return None
    row = latest[1]
    temp = _to_float(row.get("temp_c") if row.get("temp_c") is not None else row.get("temp"))
    obs_time = str(row.get("obs_time") or row.get("observed_at") or "").strip()
    if temp is None or not obs_time:
        return None
    if use_fahrenheit:
        temp = temp * 9 / 5 + 32
    return {
        "station_label": station_label,
        "temp": round(float(temp), 1),
        "icao": station_code,
        "source": source_code,
        "source_label": source_label,
        "obs_time": obs_time,
    }


def _latest_jma_row(
    weather: Any,
    city: str,
    use_fahrenheit: bool,
    db: Any = None,
) -> Optional[dict[str, Any]]:
    airport_obs_row = _latest_airport_obs_log_row(
        db,
        station_code="44166",
        city=city,
        source_code="jma_amedas",
        source_label="JMA",
        station_label="\u7fbd\u7530 10\u5206\u5b9e\u51b5 (JMA)",
        use_fahrenheit=use_fahrenheit,
    )
    if airport_obs_row:
        return airport_obs_row

    fetcher = getattr(weather, "fetch_jma_amedas_official_nearby", None)
    if callable(fetcher):
        try:
            rows = fetcher(city, use_fahrenheit=use_fahrenheit)
        except Exception as exc:
            logger.debug("latest JMA overlay read failed city={}: {}", city, exc)
            rows = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            if _to_float(row.get("temp")) is not None and row.get("obs_time"):
                return row

    current_fetcher = getattr(weather, "fetch_jma_amedas_current", None)
    if callable(current_fetcher):
        try:
            current = current_fetcher(city, use_fahrenheit=use_fahrenheit)
        except Exception as exc:
            logger.debug("latest JMA current overlay read failed city={}: {}", city, exc)
            return None
        if isinstance(current, dict):
            temp = _to_float((current.get("current") or {}).get("temp"))
            obs_time = current.get("obs_time")
            if temp is not None and obs_time:
                return {
                    "station_label": current.get("station_name"),
                    "temp": temp,
                    "icao": current.get("station_code"),
                    "source": "jma",
                    "source_label": "JMA",
                    "obs_time": obs_time,
                }
    return None


def _jma_observation_update(
    city: str,
    row: dict[str, Any],
    obs_time: str,
    temp: float,
) -> dict[str, Any]:
    source_label = str(row.get("source_label") or "JMA").strip() or "JMA"
    station_code = str(row.get("icao") or row.get("istNo") or "").strip() or None
    station_name = str(row.get("station_label") or row.get("name") or source_label).strip()
    freshness = {
        "freshness_status": "fresh",
        "observed_at": obs_time,
        "source_code": "jma_amedas",
        "source_label": source_label,
    }
    return {
        "temp": round(float(temp), 1),
        "source_code": "jma_amedas",
        "source_label": source_label,
        "station_code": station_code,
        "station_name": station_name,
        "station_label": station_name,
        "observed_at": obs_time,
        "observation_time": obs_time,
        "obs_time": obs_time,
        "freshness": freshness,
        "observation_status": "live",
        "city": city,
    }


def _observation_today_point(
    local_time: str,
    obs_time: str,
    temp: float,
    *,
    source_code: str,
    source_label: str,
) -> dict[str, Any]:
    return {
        "time": local_time,
        "temp": round(float(temp), 1),
        "obs_time": obs_time,
        "source_code": source_code,
        "source_label": source_label,
    }


def _jma_today_point(local_time: str, obs_time: str, temp: float) -> dict[str, Any]:
    return _observation_today_point(
        local_time,
        obs_time,
        temp,
        source_code="jma_amedas",
        source_label="JMA",
    )


def _replace_or_append_today_point(
    rows: Any,
    point: dict[str, Any],
    *,
    replace_all: bool,
) -> list[dict[str, Any]]:
    if replace_all:
        return [point]
    next_rows: list[dict[str, Any]] = []
    replaced = False
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        current_time = str(row.get("time") or "").strip()
        current_obs_time = str(row.get("obs_time") or row.get("observed_at") or "").strip()
        if current_time == point["time"] or current_obs_time == point["obs_time"]:
            next_rows.append(point)
            replaced = True
        else:
            next_rows.append(dict(row))
    if not replaced:
        next_rows.append(point)
    return next_rows


def _sync_jma_today_series(
    payload: dict[str, Any],
    point: dict[str, Any],
    *,
    replace_all: bool,
) -> None:
    _sync_today_series_points(payload, [point], replace_all=replace_all)


def _sync_today_series_points(
    payload: dict[str, Any],
    points: list[dict[str, Any]],
    *,
    replace_all: bool,
) -> None:
    clean_points = [dict(point) for point in points if isinstance(point, dict)]
    if not clean_points:
        return
    if replace_all:
        rows = clean_points
    else:
        rows = payload.get("metar_today_obs")
        for point in clean_points:
            rows = _replace_or_append_today_point(
                rows,
                point,
                replace_all=False,
            )
    payload["metar_today_obs"] = rows
    payload["airport_primary_today_obs"] = rows
    official = payload.get("official")
    if not isinstance(official, dict):
        official = {}
    official["airport_primary_today_obs"] = rows
    payload["official"] = official

    timeseries = payload.get("timeseries")
    if not isinstance(timeseries, dict):
        timeseries = {}
    timeseries["metar_today_obs"] = rows
    for key in ("metar_recent_obs", "settlement_today_obs"):
        if replace_all and key in timeseries:
            timeseries[key] = []
    payload["timeseries"] = timeseries
    if replace_all:
        for key in ("metar_recent_obs", "settlement_today_obs"):
            if key in payload:
                payload[key] = []


def overlay_latest_jma_amedas_observation(
    weather: Any,
    city: str,
    payload: dict[str, Any],
    db: Any = None,
) -> dict[str, Any]:
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city or not isinstance(payload, dict) or not payload:
        return payload
    if normalized_city != "tokyo":
        return payload

    use_fahrenheit = "F" in str(payload.get("temp_symbol") or "").upper()
    row = _latest_jma_row(weather, normalized_city, use_fahrenheit, db=db)
    if not isinstance(row, dict):
        return payload

    temp = _to_float(row.get("temp"))
    obs_time = str(row.get("obs_time") or "").strip()
    if temp is None or not obs_time:
        return payload

    raw_epoch = parse_observation_epoch(obs_time)
    local_dt = _parse_observation_datetime(obs_time)
    if raw_epoch is None or local_dt is None:
        return payload
    existing_epochs = [
        epoch
        for epoch in (
            _block_epoch(payload.get("current")),
            _block_epoch(payload.get("airport_primary")),
            _block_epoch(payload.get("airport_current")),
            _block_epoch(payload.get("canonical_temperature")),
        )
        if epoch is not None
    ]
    if existing_epochs and max(existing_epochs) >= raw_epoch:
        return payload

    update = _jma_observation_update(normalized_city, row, obs_time, temp)
    next_payload = deepcopy(payload)
    changed = False
    for key in ("current", "airport_primary", "airport_current"):
        changed = _merge_observation_block(next_payload, key, update, raw_epoch) or changed

    canonical = next_payload.get("canonical_temperature")
    canonical_epoch = _block_epoch(canonical)
    if canonical_epoch is None or raw_epoch > canonical_epoch:
        canonical_payload = build_canonical_temperature(
            normalized_city,
            {
                "name": normalized_city,
                "temp_symbol": next_payload.get("temp_symbol") or "\u00b0C",
                "updated_at": obs_time,
                "current": update,
            },
            fetched_at=obs_time,
        )
        if canonical_payload:
            next_payload["canonical_temperature"] = canonical_payload
            changed = True

    local_date = local_dt.date().isoformat()
    local_time = local_dt.strftime("%H:%M")
    previous_local_date = str(next_payload.get("local_date") or "")
    if next_payload.get("local_date") != local_date:
        next_payload["local_date"] = local_date
        changed = True
    if next_payload.get("local_time") != local_time:
        next_payload["local_time"] = local_time
        changed = True

    overview = next_payload.get("overview")
    if not isinstance(overview, dict):
        overview = {}
    next_overview = dict(overview)
    overview_updates = {
        "local_date": local_date,
        "local_time": local_time,
        "current_temp": round(float(temp), 1),
        "airport_primary": update,
    }
    for key, value in overview_updates.items():
        if next_overview.get(key) != value:
            next_overview[key] = value
            changed = True
    next_payload["overview"] = next_overview

    replace_today_series = bool(previous_local_date and previous_local_date != local_date)
    _sync_jma_today_series(
        next_payload,
        _jma_today_point(local_time, obs_time, temp),
        replace_all=replace_today_series,
    )
    changed = True

    return next_payload if changed else payload


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _raw_source_observation_update(
    city: str,
    row: dict[str, Any],
    raw_payload: dict[str, Any],
    *,
    source_code: str,
    default_label: str,
    temp_keys: tuple[str, ...] = ("temp", "temp_c"),
    observed_at_keys: tuple[str, ...] = ("observation_time", "obs_time", "observed_at"),
) -> Optional[dict[str, Any]]:
    temp = None
    for key in temp_keys:
        temp = _to_float(raw_payload.get(key))
        if temp is not None:
            break
    if temp is None:
        return None

    observed_at = _first_text(
        *(raw_payload.get(key) for key in observed_at_keys),
        row.get("observed_at"),
    )
    observed_at_local = _first_text(
        raw_payload.get("observation_time_local"),
        raw_payload.get("observed_at_local"),
        row.get("observed_at_local"),
    )
    normalized_source = str(source_code or raw_payload.get("source") or "").strip().lower()
    source_label = _first_text(raw_payload.get("source_label"), default_label, normalized_source.upper())
    station_code = _first_text(
        raw_payload.get("icao"),
        raw_payload.get("station_code"),
        raw_payload.get("istNo"),
        row.get("station_code"),
    )
    station_name = _first_text(
        raw_payload.get("station_label"),
        raw_payload.get("station_name"),
        raw_payload.get("name"),
        row.get("station_name"),
        source_label,
    )
    freshness = {
        "freshness_status": "fresh",
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "source_code": normalized_source,
        "source_label": source_label,
    }
    update = {
        "temp": round(temp, 1),
        "source_code": normalized_source,
        "source_label": source_label,
        "station_code": station_code or None,
        "station_name": station_name,
        "observed_at": observed_at or None,
        "observed_at_local": observed_at_local or None,
        "obs_time": observed_at or observed_at_local,
        "freshness": freshness,
        "observation_status": "live",
        "city": city,
    }
    if normalized_source:
        update["settlement_source"] = normalized_source
        update["settlement_source_label"] = source_label
    return update


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


# ═══════════════════════════════════════════════════════════════════════════════
# CWA (Central Weather Administration — Taipei)
# ═══════════════════════════════════════════════════════════════════════════════


def _latest_cwa_data_from_airport_obs_log(db: Any, city: str, use_fahrenheit: bool) -> Optional[dict[str, Any]]:
    row = _latest_airport_obs_log_row(
        db,
        station_code="466920",
        city=city,
        source_code="cwa",
        source_label="CWA",
        station_label="\u81fa\u5317",
        use_fahrenheit=use_fahrenheit,
    )
    if not row:
        return None
    return {
        "source": "cwa",
        "source_label": "CWA",
        "station_code": row.get("icao") or "466920",
        "station_name": row.get("station_label") or "\u81fa\u5317",
        "observation_time": row.get("obs_time"),
        "current": {
            "temp": row.get("temp"),
        },
        "unit": "fahrenheit" if use_fahrenheit else "celsius",
    }


def _latest_cwa_data_from_official_intraday_history(use_fahrenheit: bool) -> Optional[dict[str, Any]]:
    try:
        local_now = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=8)))
        target_date = local_now.strftime("%Y-%m-%d")
        points = OfficialIntradayObservationRepository().load_points(
            source_code="cwa",
            station_code="466920",
            target_date=target_date,
        )
    except Exception as exc:
        logger.debug("latest CWA official intraday history read failed: {}", exc)
        return None

    latest: Optional[dict[str, Any]] = None
    latest_epoch: Optional[int] = None
    for point in points if isinstance(points, list) else []:
        if not isinstance(point, dict):
            continue
        time_text = str(point.get("time") or "").strip()
        temp = _to_float(point.get("temp"))
        if len(time_text) != 5 or ":" not in time_text or temp is None:
            continue
        obs_time = f"{target_date}T{time_text}:00+08:00"
        epoch = parse_observation_epoch(obs_time)
        if epoch is None:
            continue
        if latest_epoch is None or epoch > latest_epoch:
            latest_epoch = epoch
            latest = {
                "source": "cwa",
                "source_label": "CWA",
                "station_code": "466920",
                "station_name": "\u81fa\u5317",
                "observation_time": obs_time,
                "current": {
                    "temp": round(float(temp) * 9 / 5 + 32, 1) if use_fahrenheit else round(float(temp), 1),
                },
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
            }
    return latest


def _newer_cwa_payload(left: Optional[dict[str, Any]], right: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(left, dict):
        return right if isinstance(right, dict) else None
    if not isinstance(right, dict):
        return left
    left_epoch = parse_observation_epoch(left.get("observation_time"))
    right_epoch = parse_observation_epoch(right.get("observation_time"))
    if right_epoch is not None and (left_epoch is None or right_epoch > left_epoch):
        return right
    return left


def _taipei_local_today() -> str:
    return datetime.now(timezone.utc).astimezone(_TAIPEI_TZ).strftime("%Y-%m-%d")


def _taipei_local_datetime(value: Any) -> Optional[datetime]:
    dt = _parse_observation_datetime(value)
    if dt is None:
        return None
    return dt.astimezone(_TAIPEI_TZ)


def _is_taipei_today_observation(value: Any, target_date: str) -> bool:
    local_dt = _taipei_local_datetime(value)
    return bool(local_dt and local_dt.date().isoformat() == target_date)


def _latest_taipei_metar_from_airport_obs_log(
    db: Any,
    use_fahrenheit: bool,
    *,
    target_date: str,
) -> Optional[dict[str, Any]]:
    latest: Optional[dict[str, Any]] = None
    for station_code, station_name in (
        ("RCSS", "Taipei Songshan METAR"),
        ("RCTP", "Taipei Taoyuan METAR"),
    ):
        row = _latest_airport_obs_log_row(
            db,
            station_code=station_code,
            city="taipei",
            source_code="metar",
            source_label="METAR",
            station_label=station_name,
            use_fahrenheit=use_fahrenheit,
        )
        if not row or not _is_taipei_today_observation(row.get("obs_time"), target_date):
            continue
        candidate = {
            "source": "metar",
            "source_label": "METAR",
            "station_code": row.get("icao") or station_code,
            "station_name": row.get("station_label") or station_name,
            "observation_time": row.get("obs_time"),
            "current": {
                "temp": row.get("temp"),
            },
            "unit": "fahrenheit" if use_fahrenheit else "celsius",
        }
        latest = _newer_cwa_payload(latest, candidate)
    return latest


def _call_taipei_metar_fetcher(weather: Any, use_fahrenheit: bool) -> Optional[dict[str, Any]]:
    fetcher = getattr(weather, "fetch_metar", None)
    if not callable(fetcher):
        return None
    try:
        return fetcher("taipei", use_fahrenheit=use_fahrenheit, utc_offset=28800)
    except TypeError:
        try:
            return fetcher("taipei", use_fahrenheit=use_fahrenheit)
        except TypeError:
            return fetcher("taipei")
    except Exception as exc:
        logger.debug("latest Taipei METAR fallback fetch failed: {}", exc)
        return None


def _latest_taipei_metar_from_fetcher(
    weather: Any,
    use_fahrenheit: bool,
    *,
    target_date: str,
) -> Optional[dict[str, Any]]:
    metar = _call_taipei_metar_fetcher(weather, use_fahrenheit)
    if not isinstance(metar, dict) or metar.get("stale_for_today") is True:
        return None
    obs_time = str(metar.get("observation_time") or "").strip()
    if not obs_time or not _is_taipei_today_observation(obs_time, target_date):
        return None
    current = metar.get("current") if isinstance(metar.get("current"), dict) else {}
    temp = _to_float(current.get("temp"))
    if temp is None:
        return None
    return {
        "source": "metar",
        "source_label": "METAR",
        "station_code": str(metar.get("icao") or metar.get("station_code") or "RCSS").strip(),
        "station_name": str(metar.get("station_name") or "Taipei Songshan METAR").strip(),
        "observation_time": obs_time,
        "current": {
            "temp": round(float(temp), 1),
            "max_temp_so_far": _to_float(current.get("max_temp_so_far")),
            "max_temp_time": current.get("max_temp_time"),
            "humidity": current.get("humidity"),
            "wind_speed_kt": current.get("wind_speed_kt"),
            "wind_dir": current.get("wind_dir"),
            "raw_metar": current.get("raw_metar"),
            "visibility_mi": current.get("visibility_mi"),
            "wx_desc": current.get("wx_desc"),
        },
        "today_obs": metar.get("today_obs") or [],
        "unit": "fahrenheit" if use_fahrenheit else "celsius",
    }


def _latest_taipei_metar_fallback(
    weather: Any,
    db: Any,
    use_fahrenheit: bool,
    *,
    target_date: str,
) -> Optional[dict[str, Any]]:
    latest = _latest_taipei_metar_from_airport_obs_log(
        db,
        use_fahrenheit,
        target_date=target_date,
    )
    latest = _newer_cwa_payload(
        latest,
        _latest_taipei_metar_from_fetcher(weather, use_fahrenheit, target_date=target_date),
    )
    return latest


def _normalized_today_points(
    rows: Any,
    latest_point: dict[str, Any],
    *,
    source_code: str,
    source_label: str,
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(point: dict[str, Any]) -> None:
        time_key = str(point.get("time") or "")
        obs_key = str(point.get("obs_time") or "")
        if not time_key and not obs_key:
            return
        for index, existing in enumerate(points):
            existing_time = str(existing.get("time") or "")
            existing_obs = str(existing.get("obs_time") or "")
            if existing_time == time_key and (not existing_obs or not obs_key or existing_obs == obs_key):
                if obs_key and not existing_obs:
                    points[index] = point
                return
        key = (time_key, obs_key)
        if key in seen:
            return
        seen.add(key)
        points.append(point)

    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict):
            time_text = str(row.get("time") or "").strip()
            temp = _to_float(row.get("temp"))
            obs_time = str(row.get("obs_time") or row.get("observed_at") or "").strip()
        elif isinstance(row, (list, tuple)) and len(row) >= 2:
            time_text = str(row[0] or "").strip()
            temp = _to_float(row[1])
            obs_time = ""
        else:
            continue
        if not time_text or temp is None:
            continue
        point = {
            "time": time_text,
            "temp": round(float(temp), 1),
            "source_code": source_code,
            "source_label": source_label,
        }
        if obs_time:
            point["obs_time"] = obs_time
        add(point)
    add(dict(latest_point))
    return points


def overlay_latest_cwa_observation(weather, city, payload, db=None):
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if normalized_city != "taipei" or not isinstance(payload, dict) or not payload:
        return payload

    use_fahrenheit = "F" in str(payload.get("temp_symbol") or "").upper()
    target_date = _taipei_local_today()
    cwa_data = _latest_cwa_data_from_airport_obs_log(db, normalized_city, use_fahrenheit)
    cwa_data = _newer_cwa_payload(cwa_data, _latest_cwa_data_from_official_intraday_history(use_fahrenheit))

    fetcher = getattr(weather, "fetch_cwa_taipei_settlement_current", None)
    if not callable(fetcher) and not cwa_data:
        return payload
    if callable(fetcher):
        try:
            cwa_data = _newer_cwa_payload(cwa_data, fetcher())
        except Exception as exc:
            logger.debug("latest CWA overlay fetch failed: {}", exc)
    if isinstance(cwa_data, dict) and not _is_taipei_today_observation(
        cwa_data.get("observation_time"),
        target_date,
    ):
        cwa_epoch = parse_observation_epoch(cwa_data.get("observation_time"))
        existing_epochs = [
            epoch
            for epoch in (
                _block_epoch(payload.get("current")),
                _block_epoch(payload.get("airport_primary")),
                _block_epoch(payload.get("airport_current")),
            )
            if epoch is not None
        ]
        latest_existing_epoch = max(existing_epochs) if existing_epochs else None
        if cwa_epoch is None or (latest_existing_epoch is not None and cwa_epoch <= latest_existing_epoch):
            cwa_data = None
    if not isinstance(cwa_data, dict):
        cwa_data = _latest_taipei_metar_fallback(
            weather,
            db,
            use_fahrenheit,
            target_date=target_date,
        )
    if not isinstance(cwa_data, dict):
        return payload

    temp = _to_float((cwa_data.get("current") or {}).get("temp"))
    obs_time = str(cwa_data.get("observation_time") or "").strip()
    if temp is None or not obs_time:
        return payload

    raw_epoch = parse_observation_epoch(obs_time)
    local_dt = _taipei_local_datetime(obs_time)
    if raw_epoch is None or local_dt is None:
        return payload
    existing_epochs = [
        epoch
        for epoch in (
            _block_epoch(payload.get("current")),
            _block_epoch(payload.get("airport_primary")),
            _block_epoch(payload.get("airport_current")),
        )
        if epoch is not None
    ]
    if existing_epochs and max(existing_epochs) > raw_epoch:
        return payload

    source_code = str(cwa_data.get("source") or "cwa").strip().lower() or "cwa"
    source_label = str(cwa_data.get("source_label") or ("METAR" if source_code == "metar" else "CWA")).strip()
    source_label = source_label or ("METAR" if source_code == "metar" else "CWA")
    current = cwa_data.get("current") if isinstance(cwa_data.get("current"), dict) else {}
    max_so_far = _to_float(current.get("max_temp_so_far") if current else None)
    update = {
        "temp": round(float(temp), 1),
        "source_code": source_code,
        "source_label": source_label,
        "settlement_source": source_code,
        "settlement_source_label": source_label,
        "station_code": str(cwa_data.get("station_code") or ("RCSS" if source_code == "metar" else "466920")).strip(),
        "station_name": str(cwa_data.get("station_name") or ("Taipei Songshan METAR" if source_code == "metar" else "\u81fa\u5317")).strip(),
        "observed_at": obs_time,
        "observation_time": obs_time,
        "obs_time": obs_time,
        "observation_status": "live",
        "city": normalized_city,
    }
    if max_so_far is not None:
        update["max_so_far"] = round(float(max_so_far), 1)
        update["max_temp_so_far"] = round(float(max_so_far), 1)

    next_payload = deepcopy(payload)
    changed = False

    for key in ("current", "airport_primary", "airport_current"):
        changed = _merge_observation_block(next_payload, key, update, raw_epoch) or changed

    canonical = next_payload.get("canonical_temperature")
    canonical_epoch = _block_epoch(canonical)
    if canonical_epoch is None or raw_epoch > canonical_epoch:
        canonical_payload = build_canonical_temperature(
            normalized_city,
            {
                "name": normalized_city,
                "temp_symbol": next_payload.get("temp_symbol") or "\u00b0C",
                "updated_at": obs_time,
                "current": update,
            },
            fetched_at=obs_time,
        )
        if canonical_payload:
            next_payload["canonical_temperature"] = canonical_payload
            changed = True

    local_date = local_dt.date().isoformat()
    local_time = local_dt.strftime("%H:%M")
    previous_local_date = str(next_payload.get("local_date") or "")
    if next_payload.get("local_date") != local_date:
        next_payload["local_date"] = local_date
        changed = True
    if next_payload.get("local_time") != local_time:
        next_payload["local_time"] = local_time
        changed = True

    overview = next_payload.get("overview")
    if not isinstance(overview, dict):
        overview = {}
    next_overview = dict(overview)
    overview_updates = {
        "local_date": local_date,
        "local_time": local_time,
        "current_temp": round(float(temp), 1),
        "airport_primary": update,
        "settlement_source": source_code,
        "settlement_source_label": source_label,
    }
    for key, value in overview_updates.items():
        if next_overview.get(key) != value:
            next_overview[key] = value
            changed = True
    next_payload["overview"] = next_overview

    replace_today_series = bool(previous_local_date and previous_local_date != local_date)
    latest_point = _observation_today_point(
        local_time,
        obs_time,
        temp,
        source_code=source_code,
        source_label=source_label,
    )
    today_points = _normalized_today_points(
        cwa_data.get("today_obs"),
        latest_point,
        source_code=source_code,
        source_label=source_label,
    )
    _sync_today_series_points(
        next_payload,
        today_points,
        replace_all=replace_today_series,
    )
    changed = True

    return next_payload if changed else payload
# ═══════════════════════════════════════════════════════════════════════════════


def _latest_amos_row(db: Any, city: str) -> tuple:
    getter = getattr(db, "get_latest_raw_observation", None)
    if not callable(getter):
        return None, None
    try:
        row = getter("amos", city)
    except Exception as exc:
        logger.debug("latest AMOS raw overlay read failed city={}: {}", city, exc)
        return None, None
    if not isinstance(row, dict):
        return None, None
    raw_payload = row.get("payload")
    if isinstance(raw_payload, dict) and raw_payload and raw_payload.get("temp") is not None:
        return row, raw_payload
    return None, None


def _raw_amos_epoch(row, raw_payload):
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


def overlay_latest_amos_observation(db, city, payload):
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city or not isinstance(payload, dict) or not payload:
        return payload
    row, raw_payload = _latest_amos_row(db, normalized_city)
    if not isinstance(row, dict) or not isinstance(raw_payload, dict):
        return payload
    raw_epoch = _raw_amos_epoch(row, raw_payload)
    if raw_epoch is None:
        return payload
    update = _raw_source_observation_update(
        normalized_city,
        row,
        raw_payload,
        source_code="amos",
        default_label="AMOS",
    )
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


# ═══════════════════════════════════════════════════════════════════════════════
# HKO (Hong Kong Observatory — Hong Kong, Shenzhen)
# ═══════════════════════════════════════════════════════════════════════════════


def _latest_hko_row(db, city):
    getter = getattr(db, "get_latest_raw_observation", None)
    if not callable(getter):
        return None, None
    try:
        row = getter("hko_obs", city)
    except Exception as exc:
        logger.debug("latest HKO raw overlay read failed city={}: {}", city, exc)
        return None, None
    if not isinstance(row, dict):
        return None, None
    raw_payload = row.get("payload")
    if isinstance(raw_payload, dict) and raw_payload:
        temp = raw_payload.get("temp")
        if temp is not None:
            return row, raw_payload
    return None, None


def _raw_hko_epoch(row, raw_payload):
    payload_values = (raw_payload.get("obs_time"),)
    parsed = [
        epoch
        for epoch in (parse_observation_epoch(value) for value in payload_values)
        if epoch is not None
    ]
    if parsed:
        return max(parsed)
    return parse_observation_epoch(row.get("observed_at"))


def overlay_latest_hko_observation(db, city, payload):
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city or not isinstance(payload, dict) or not payload:
        return payload
    row, raw_payload = _latest_hko_row(db, normalized_city)
    if not isinstance(row, dict) or not isinstance(raw_payload, dict):
        return payload
    raw_epoch = _raw_hko_epoch(row, raw_payload)
    if raw_epoch is None:
        return payload
    update = _raw_source_observation_update(
        normalized_city,
        row,
        raw_payload,
        source_code="hko_obs",
        default_label="HKO",
        observed_at_keys=("obs_time", "observation_time", "observed_at"),
    )
    if not update:
        return payload

    next_payload = deepcopy(payload)
    changed = False

    for key in ("current", "airport_primary", "airport_current"):
        changed = _merge_observation_block(next_payload, key, update, raw_epoch) or changed

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
# ═══════════════════════════════════════════════════════════════════════════════


def _latest_mgm_row(db, city):
    getter = getattr(db, "get_latest_raw_observation", None)
    if not callable(getter):
        return None, None
    try:
        row = getter("mgm", city)
    except Exception as exc:
        logger.debug("latest MGM raw overlay read failed city={}: {}", city, exc)
        return None, None
    if not isinstance(row, dict):
        return None, None
    raw_payload = row.get("payload")
    if isinstance(raw_payload, dict) and raw_payload:
        temp = raw_payload.get("temp")
        if temp is not None:
            return row, raw_payload
    return None, None


def _raw_mgm_epoch(row, raw_payload):
    payload_values = (
        raw_payload.get("obs_time"),
    )
    parsed = [
        epoch
        for epoch in (parse_observation_epoch(value) for value in payload_values)
        if epoch is not None
    ]
    if parsed:
        return max(parsed)
    return parse_observation_epoch(row.get("observed_at"))


def overlay_latest_mgm_observation(db, city, payload):
    normalized_city = str(city or payload.get("name") or payload.get("city") or "").strip().lower()
    if not normalized_city or not isinstance(payload, dict) or not payload:
        return payload
    row, raw_payload = _latest_mgm_row(db, normalized_city)
    if not isinstance(row, dict) or not isinstance(raw_payload, dict):
        return payload
    raw_epoch = _raw_mgm_epoch(row, raw_payload)
    if raw_epoch is None:
        return payload
    update = _raw_source_observation_update(
        normalized_city,
        row,
        raw_payload,
        source_code="mgm",
        default_label="MGM",
        observed_at_keys=("obs_time", "observation_time", "observed_at"),
    )
    if not update:
        return payload

    next_payload = deepcopy(payload)
    changed = False

    for key in ("current", "airport_primary", "airport_current"):
        changed = _merge_observation_block(next_payload, key, update, raw_epoch) or changed

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
