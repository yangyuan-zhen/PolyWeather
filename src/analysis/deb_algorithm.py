import os
import json
from datetime import datetime, timedelta
from typing import Optional
import requests
from src.analysis.settlement_rounding import apply_city_settlement
from loguru import logger
from src.database.runtime_state import (
    DailyRecordRepository,
    STATE_STORAGE_SQLITE,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
    get_state_storage_mode,
)

# Cross-platform file locking
import sys
if sys.platform == "win32":
    import msvcrt

    def _lock_sh(f):
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)

    def _lock_ex(f):
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock(f):
        try:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
else:
    import fcntl

    def _lock_sh(f):
        fcntl.flock(f, fcntl.LOCK_SH)

    def _lock_ex(f):
        fcntl.flock(f, fcntl.LOCK_EX)

    def _unlock(f):
        fcntl.flock(f, fcntl.LOCK_UN)

# Simple memory cache to avoid blasting the disk if queried 10 times a minute
_history_cache = {}
_history_mtime = 0
_daily_record_repo = DailyRecordRepository()
_training_feature_repo = TrainingFeatureRecordRepository()
_truth_record_repo = TruthRecordRepository()
_TRUTH_VERSION = "v1"


def _sf(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _is_excluded_model_name(model_name: str) -> bool:
    normalized = str(model_name or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "")
    return "meteoblue" in normalized


def _normalize_deb_model_name(model_name: str) -> str:
    return (
        str(model_name or "")
        .strip()
        .lower()
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace("/", "")
    )


def _deb_model_family(model_name: str) -> str:
    normalized = _normalize_deb_model_name(model_name)
    if normalized in {"icon", "iconeu", "icond2"}:
        return "dwd_icon"
    if normalized in {"gem", "gdps", "rdps", "hrdps"}:
        return "eccc_gem"
    if normalized in {"ecmwfaifs", "aifs"}:
        return "ecmwf_aifs"
    if normalized in {"ecmwf"}:
        return "ecmwf_ifs"
    return normalized or str(model_name or "").strip()


def _deb_model_priority(model_name: str) -> int:
    normalized = _normalize_deb_model_name(model_name)
    return {
        "icond2": 40,
        "iconeu": 30,
        "icon": 20,
        "hrdps": 40,
        "rdps": 35,
        "gdps": 30,
        "gem": 20,
        "ecmwfaifs": 30,
        "ecmwf": 30,
        "gfs": 30,
        "jma": 30,
        "mgm": 45,
        "nws": 45,
        "hko": 45,
        "lgbm": 50,
        "openmeteo": 15,
    }.get(normalized, 10)


def _collapse_forecasts_for_deb(current_forecasts):
    """
    Avoid counting the same modelling family multiple times in DEB.
    Regional/high-resolution variants replace their global family member when present.
    """
    collapsed = {}
    representatives = {}
    for model_name, value in (current_forecasts or {}).items():
        if value is None or _is_excluded_model_name(model_name):
            continue
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        family = _deb_model_family(model_name)
        current_rep = representatives.get(family)
        priority = _deb_model_priority(model_name)
        if current_rep is None or priority > current_rep["priority"]:
            representatives[family] = {
                "name": model_name,
                "priority": priority,
                "value": numeric,
            }

    for rep in representatives.values():
        collapsed[rep["name"]] = rep["value"]
    return collapsed


def load_history(filepath):
    global _history_cache, _history_mtime
    mode = get_state_storage_mode()

    if mode == STATE_STORAGE_SQLITE:
        try:
            data = _daily_record_repo.load_all()
            _history_cache = data
            return data
        except Exception as e:
            logger.error(f"Error loading daily records from sqlite, fallback to file: {e}")

    if not os.path.exists(filepath):
        if mode == STATE_STORAGE_SQLITE:
            try:
                data = _daily_record_repo.load_all()
                _history_cache = data
                return data
            except Exception:
                return {}
        return {}

    try:
        current_mtime = os.path.getmtime(filepath)
        if current_mtime == _history_mtime and _history_cache:
            return _history_cache

        with open(filepath, "r", encoding="utf-8") as f:
            # We don't strictly need a lock for reading in Python if the write is atomic,
            # but using one prevents reading half-written JSONs.
            _lock_sh(f)
            data = json.load(f)
            _unlock(f)

            _history_cache = data
            _history_mtime = current_mtime
            return data
    except Exception as e:
        print(f"Error loading history: {e}")
        return _history_cache if _history_cache else {}


def save_history(filepath, data):
    global _history_cache, _history_mtime
    _history_cache = data
    mode = get_state_storage_mode()

    if mode == STATE_STORAGE_SQLITE:
        try:
            _daily_record_repo.replace_all(data)
        except Exception as e:
            logger.error(f"Error saving daily records to sqlite: {e}")
            return

    if mode == STATE_STORAGE_SQLITE:
        return
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            _lock_ex(f)
            json.dump(data, f, ensure_ascii=False, indent=2)
            _unlock(f)
        _history_mtime = os.path.getmtime(filepath)
    except Exception as e:
        print(f"Error saving history: {e}")


def _parse_metar_row_time(row):
    """Parse METAR row timestamp from aviationweather API payload."""
    candidates = [
        row.get("reportTime"),
        row.get("receiptTime"),
        row.get("observation_time"),
    ]
    for raw in candidates:
        if not raw:
            continue
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except Exception:
            continue
    obs_epoch = row.get("obsTime")
    if obs_epoch is not None:
        try:
            return datetime.utcfromtimestamp(int(obs_epoch))
        except Exception:
            pass
    return None


def _get_history_file_path():
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    return os.path.join(project_root, "data", "daily_records.json")


def _resolve_city_history_context(city_name: str):
    from src.data_collection.city_registry import CITY_REGISTRY, ALIASES

    city_key = str(city_name or "").strip().lower()
    city_key = ALIASES.get(city_key, city_key)
    city_meta = CITY_REGISTRY.get(city_key)
    if not isinstance(city_meta, dict):
        return None, None
    return city_key, city_meta


def _truth_meta_for_city(city_meta: dict) -> dict:
    if not isinstance(city_meta, dict):
        city_meta = {}
    return {
        "settlement_source": str(city_meta.get("settlement_source") or "metar").strip().lower(),
        "settlement_station_code": str(city_meta.get("settlement_station_code") or city_meta.get("icao") or "").strip().upper() or None,
        "settlement_station_label": str(
            city_meta.get("settlement_station_label")
            or city_meta.get("airport_name")
            or city_meta.get("name")
            or ""
        ).strip()
        or None,
    }


def _persist_truth_record(
    city_name: str,
    date_str: str,
    actual_high: float,
    *,
    city_meta: Optional[dict] = None,
    updated_by: str,
    reason: str,
    source_payload: Optional[dict] = None,
    is_final: bool = True,
) -> None:
    city_key, resolved_meta = _resolve_city_history_context(city_name)
    meta = city_meta if isinstance(city_meta, dict) else resolved_meta
    if not city_key or not isinstance(meta, dict):
        return
    truth_meta = _truth_meta_for_city(meta)
    _truth_record_repo.upsert_truth(
        city=city_key,
        target_date=date_str,
        actual_high=float(actual_high),
        settlement_source=truth_meta["settlement_source"],
        settlement_station_code=truth_meta["settlement_station_code"],
        settlement_station_label=truth_meta["settlement_station_label"],
        truth_version=_TRUTH_VERSION,
        updated_by=updated_by,
        source_payload=source_payload,
        is_final=is_final,
        reason=reason,
    )


def _persist_training_feature_record(
    city_name: str,
    date_str: str,
    *,
    forecasts: Optional[dict],
    deb_prediction: Optional[float],
    mu: Optional[float],
    probability_features: Optional[dict],
    probabilities: Optional[list],
    shadow_probabilities: Optional[list],
    probability_calibration: Optional[dict],
) -> None:
    city_key, _ = _resolve_city_history_context(city_name)
    if not city_key:
        return
    payload = {
        "forecasts": forecasts or {},
        "deb_prediction": deb_prediction,
        "mu": mu,
        "probability_features": probability_features or {},
        "prob_snapshot": probabilities or [],
        "shadow_prob_snapshot": shadow_probabilities or [],
        "probability_calibration": probability_calibration or {},
    }
    _training_feature_repo.upsert_record(city_key, date_str, payload)


def _parse_hko_ryes_max_temp(payload):
    if not isinstance(payload, dict):
        return None
    for key, value in payload.items():
        if not str(key or "").endswith("MaxTemp"):
            continue
        parsed = _sf(value)
        if parsed is not None:
            return parsed
    return None


def _parse_noaa_timeseries_stamp(raw_value):
    try:
        return datetime.strptime(str(raw_value), "%Y-%m-%dT%H:%M:%S%z")
    except Exception:
        return None


def _noaa_round_temp(value):
    if value is None:
        return None
    try:
        return int(float(value) + 0.5)
    except Exception:
        return None


def _reconcile_recent_metar_actual_highs(city_name: str, lookback_days: int = 7):
    """
    Reconcile recent `actual_high` values using historical METAR data from
    aviationweather.gov to fix stale/wrong daily records.
    """
    try:
        city_key, city_meta = _resolve_city_history_context(city_name)
        if not city_key or not isinstance(city_meta, dict):
            return {"ok": False, "reason": "unknown_city", "updated": 0}

        icao = str(city_meta.get("icao") or "").strip().upper()
        if not icao:
            return {"ok": False, "reason": "missing_icao", "updated": 0}

        tz_offset = int(city_meta.get("tz_offset") or 0)
        use_fahrenheit = bool(city_meta.get("use_fahrenheit"))

        history_file = _get_history_file_path()
        data = load_history(history_file)
        city_data = data.get(city_key) or {}
        if not isinstance(city_data, dict) or not city_data:
            return {"ok": True, "reason": "no_city_history", "updated": 0}

        local_now = datetime.utcnow() + timedelta(seconds=tz_offset)
        local_today = local_now.strftime("%Y-%m-%d")
        cutoff = (local_now - timedelta(days=max(lookback_days, 1) + 1)).strftime(
            "%Y-%m-%d"
        )
        target_dates = sorted(
            d for d in city_data.keys() if isinstance(d, str) and cutoff <= d < local_today
        )
        if not target_dates:
            return {"ok": True, "reason": "no_target_dates", "updated": 0}

        try:
            min_target = datetime.strptime(target_dates[0], "%Y-%m-%d")
            span_hours = int((local_now - min_target).total_seconds() / 3600) + 12
        except Exception:
            span_hours = (lookback_days + 3) * 24
        span_hours = max(72, min(240, span_hours))

        url = (
            f"https://aviationweather.gov/api/data/metar"
            f"?ids={icao}&format=json&hours={span_hours}"
        )
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        rows = resp.json() or []
        if not isinstance(rows, list):
            rows = []

        daily_max_c = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            temp = row.get("temp")
            if temp is None:
                continue
            obs_dt = _parse_metar_row_time(row)
            if obs_dt is None:
                continue
            local_dt = obs_dt + timedelta(seconds=tz_offset)
            d = local_dt.strftime("%Y-%m-%d")
            if d < cutoff or d >= local_today:
                continue
            try:
                t = float(temp)
            except Exception:
                continue
            prev = daily_max_c.get(d)
            if prev is None or t > prev:
                daily_max_c[d] = t

        updated = 0
        for d in target_dates:
            t_c = daily_max_c.get(d)
            if t_c is None:
                continue
            corrected = round(t_c * 9 / 5 + 32, 1) if use_fahrenheit else round(t_c, 1)
            _persist_truth_record(
                city_key,
                d,
                corrected,
                city_meta=city_meta,
                updated_by="backfill:metar_history",
                reason="reconcile_recent_actual_highs",
                source_payload={"icao": icao, "actual_high": corrected, "source": "metar"},
            )
            rec = city_data.get(d) or {}
            old = rec.get("actual_high")
            try:
                old_val = float(old) if old is not None else None
            except Exception:
                old_val = None
            if old_val is None or abs(old_val - corrected) >= 0.1:
                rec["actual_high"] = corrected
                city_data[d] = rec
                updated += 1

        if updated > 0:
            data[city_key] = city_data
            save_history(history_file, data)

        return {
            "ok": True,
            "updated": updated,
            "scanned_dates": len(target_dates),
            "metar_rows": len(rows),
            "icao": icao,
            "source": "metar",
        }
    except Exception as e:
        return {"ok": False, "reason": str(e), "updated": 0}


def _reconcile_recent_hko_actual_highs(city_name: str, lookback_days: int = 14):
    """
    Reconcile recent `actual_high` values using HKO's RYES daily summary endpoint.
    This covers HKO-settled cities such as Hong Kong and Shek Kong.
    """
    try:
        city_key, city_meta = _resolve_city_history_context(city_name)
        if not city_key or not isinstance(city_meta, dict):
            return {"ok": False, "reason": "unknown_city", "updated": 0}

        station_code = str(city_meta.get("settlement_station_code") or "").strip().upper()
        if not station_code:
            return {"ok": False, "reason": "missing_station_code", "updated": 0}

        tz_offset = int(city_meta.get("tz_offset") or 0)
        use_fahrenheit = bool(city_meta.get("use_fahrenheit"))
        history_file = _get_history_file_path()
        data = load_history(history_file)
        city_data = data.get(city_key) or {}
        if not isinstance(city_data, dict) or not city_data:
            return {"ok": True, "reason": "no_city_history", "updated": 0}

        local_now = datetime.utcnow() + timedelta(seconds=tz_offset)
        local_today = local_now.strftime("%Y-%m-%d")
        cutoff = (local_now - timedelta(days=max(lookback_days, 1) + 1)).strftime(
            "%Y-%m-%d"
        )
        target_dates = sorted(
            d for d in city_data.keys() if isinstance(d, str) and cutoff <= d < local_today
        )
        if not target_dates:
            return {"ok": True, "reason": "no_target_dates", "updated": 0}

        updated = 0
        scanned_dates = 0
        base_url = "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php"

        for date_str in target_dates:
            date_token = date_str.replace("-", "")
            try:
                resp = requests.get(
                    base_url,
                    params={
                        "dataType": "RYES",
                        "date": date_token,
                        "lang": "en",
                        "station": station_code,
                    },
                    timeout=12,
                )
                resp.raise_for_status()
                payload = resp.json() if resp.content else {}
            except Exception:
                continue

            scanned_dates += 1
            max_temp_c = _parse_hko_ryes_max_temp(payload)
            if max_temp_c is None:
                continue

            corrected = (
                round(max_temp_c * 9 / 5 + 32, 1)
                if use_fahrenheit
                else round(max_temp_c, 1)
            )
            _persist_truth_record(
                city_key,
                date_str,
                corrected,
                city_meta=city_meta,
                updated_by="backfill:hko_history",
                reason="reconcile_recent_actual_highs",
                source_payload={
                    "station_code": station_code,
                    "actual_high": corrected,
                    "source": "hko",
                },
            )
            rec = city_data.get(date_str) or {}
            old = rec.get("actual_high")
            try:
                old_val = float(old) if old is not None else None
            except Exception:
                old_val = None

            if old_val is None or abs(old_val - corrected) >= 0.1:
                rec["actual_high"] = corrected
                city_data[date_str] = rec
                updated += 1

        if updated > 0:
            data[city_key] = city_data
            save_history(history_file, data)

        return {
            "ok": True,
            "updated": updated,
            "scanned_dates": scanned_dates,
            "station_code": station_code,
            "source": "hko",
        }
    except Exception as e:
        return {"ok": False, "reason": str(e), "updated": 0}


def _reconcile_recent_noaa_actual_highs(city_name: str, lookback_days: int = 14):
    """
    Reconcile recent `actual_high` values using NOAA weather.gov timeseries data.
    The settlement rule uses the highest rounded whole-degree Celsius Temp reading
    once the date is finalized.
    """
    try:
        city_key, city_meta = _resolve_city_history_context(city_name)
        if not city_key or not isinstance(city_meta, dict):
            return {"ok": False, "reason": "unknown_city", "updated": 0}

        station_code = str(city_meta.get("settlement_station_code") or "").strip().upper()
        if not station_code:
            return {"ok": False, "reason": "missing_station_code", "updated": 0}

        tz_offset = int(city_meta.get("tz_offset") or 0)
        use_fahrenheit = bool(city_meta.get("use_fahrenheit"))
        history_file = _get_history_file_path()
        data = load_history(history_file)
        city_data = data.get(city_key) or {}
        if not isinstance(city_data, dict) or not city_data:
            return {"ok": True, "reason": "no_city_history", "updated": 0}

        local_now = datetime.utcnow() + timedelta(seconds=tz_offset)
        local_today = local_now.strftime("%Y-%m-%d")
        cutoff = (local_now - timedelta(days=max(lookback_days, 1) + 1)).strftime(
            "%Y-%m-%d"
        )
        target_dates = sorted(
            d for d in city_data.keys() if isinstance(d, str) and cutoff <= d < local_today
        )
        if not target_dates:
            return {"ok": True, "reason": "no_target_dates", "updated": 0}

        recent_minutes = max(4320, min(28800, (lookback_days + 3) * 1440))
        response = requests.get(
            "https://api.synopticdata.com/v2/stations/timeseries",
            params={
                "STID": station_code,
                "showemptystations": 1,
                "recent": recent_minutes,
                "complete": 1,
                "token": "7c76618b66c74aee913bdbae4b448bdd",
                "obtimezone": "local",
            },
            headers={
                "Referer": f"https://www.weather.gov/wrh/timeseries?site={station_code}",
                "Origin": "https://www.weather.gov",
                "User-Agent": "Mozilla/5.0",
            },
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        stations = payload.get("STATION") or []
        station = stations[0] if isinstance(stations, list) and stations else None
        if not isinstance(station, dict):
            return {"ok": True, "reason": "no_station_payload", "updated": 0}

        obs = station.get("OBSERVATIONS") or {}
        stamps = obs.get("date_time") or []
        temps = obs.get("air_temp_set_1") or []
        if not isinstance(stamps, list) or not isinstance(temps, list):
            return {"ok": True, "reason": "missing_observations", "updated": 0}

        daily_max = {}
        scanned_rows = 0
        for idx, stamp in enumerate(stamps):
            rounded_temp = _noaa_round_temp(temps[idx] if idx < len(temps) else None)
            if rounded_temp is None:
                continue
            dt = _parse_noaa_timeseries_stamp(stamp)
            if dt is None:
                continue
            date_key = dt.date().strftime("%Y-%m-%d")
            if date_key < cutoff or date_key >= local_today:
                continue
            scanned_rows += 1
            prev = daily_max.get(date_key)
            if prev is None or rounded_temp > prev:
                daily_max[date_key] = rounded_temp

        updated = 0
        for date_key in target_dates:
            corrected = daily_max.get(date_key)
            if corrected is None:
                continue
            next_value = (
                round((corrected - 32) * 5 / 9, 1)
                if use_fahrenheit
                else int(corrected)
            )
            _persist_truth_record(
                city_key,
                date_key,
                next_value,
                city_meta=city_meta,
                updated_by="backfill:noaa_history",
                reason="reconcile_recent_actual_highs",
                source_payload={
                    "station_code": station_code,
                    "actual_high": next_value,
                    "source": "noaa",
                },
            )
            rec = city_data.get(date_key) or {}
            old = rec.get("actual_high")
            try:
                old_val = float(old) if old is not None else None
            except Exception:
                old_val = None
            if old_val is None or abs(old_val - next_value) >= 0.1:
                rec["actual_high"] = next_value
                city_data[date_key] = rec
                updated += 1

        if updated > 0:
            data[city_key] = city_data
            save_history(history_file, data)

        return {
            "ok": True,
            "updated": updated,
            "scanned_dates": len(target_dates),
            "rows": scanned_rows,
            "station_code": station_code,
            "source": "noaa",
        }
    except Exception as e:
        return {"ok": False, "reason": str(e), "updated": 0}


def _reconcile_recent_wunderground_actual_highs(city_name: str, lookback_days: int = 14):
    return {
        "ok": True,
        "reason": "wunderground_crawler_removed",
        "updated": 0,
        "scanned_dates": 0,
        "source": "wunderground",
    }


def reconcile_recent_actual_highs(city_name: str, lookback_days: int = 7):
    """
    Reconcile recent `actual_high` values using the city's official settlement source.
    """
    city_key, city_meta = _resolve_city_history_context(city_name)
    if not city_key or not isinstance(city_meta, dict):
        return {"ok": False, "reason": "unknown_city", "updated": 0}

    settlement_source = str(city_meta.get("settlement_source") or "metar").strip().lower()
    if settlement_source == "hko":
        return _reconcile_recent_hko_actual_highs(city_key, lookback_days=lookback_days)
    if settlement_source == "noaa":
        return _reconcile_recent_noaa_actual_highs(city_key, lookback_days=lookback_days)
    if settlement_source == "wunderground":
        return _reconcile_recent_wunderground_actual_highs(city_key, lookback_days=lookback_days)
    return _reconcile_recent_metar_actual_highs(city_key, lookback_days=lookback_days)


def bootstrap_recent_daily_history_if_missing(city_name: str, lookback_days: int = 14):
    """
    For supported settlement cities added after launch, ensure recent daily_records
    rows exist so the history page can show recent actual highs without requiring
    a one-off backfill script.
    """
    try:
        city_key, city_meta = _resolve_city_history_context(city_name)
        if not city_key or not isinstance(city_meta, dict):
            return {"ok": False, "reason": "unknown_city", "seeded": 0, "updated": 0}

        settlement_source = str(city_meta.get("settlement_source") or "metar").strip().lower()
        if settlement_source not in {"metar", "hko", "noaa"}:
            return {"ok": True, "reason": "unsupported_settlement_source", "seeded": 0, "updated": 0}

        icao = str(city_meta.get("icao") or "").strip().upper()
        station_code = str(city_meta.get("settlement_station_code") or "").strip().upper()
        if settlement_source == "metar" and not icao:
            return {"ok": False, "reason": "missing_icao", "seeded": 0, "updated": 0}
        if settlement_source in {"hko", "noaa"} and not station_code:
            return {"ok": False, "reason": "missing_station_code", "seeded": 0, "updated": 0}

        tz_offset = int(city_meta.get("tz_offset") or 0)
        local_now = datetime.utcnow() + timedelta(seconds=tz_offset)
        local_today = local_now.date()

        history_file = _get_history_file_path()
        data = load_history(history_file)
        city_rows = data.get(city_key)
        if not isinstance(city_rows, dict):
            city_rows = {}
            data[city_key] = city_rows

        seeded = 0
        for offset in range(max(lookback_days, 1), 0, -1):
            day = (local_today - timedelta(days=offset)).strftime("%Y-%m-%d")
            if day not in city_rows:
                city_rows[day] = {}
                seeded += 1

        if seeded > 0:
            save_history(history_file, data)

        reconcile_result = reconcile_recent_actual_highs(city_key, lookback_days=lookback_days)
        result = {
            "ok": True,
            "reason": "bootstrapped" if seeded > 0 else "already_seeded",
            "seeded": seeded,
            "updated": int(reconcile_result.get("updated") or 0),
            "settlement_source": settlement_source,
        }
        if icao:
            result["icao"] = icao
        if station_code:
            result["station_code"] = station_code
        return result
    except Exception as e:
        return {"ok": False, "reason": str(e), "seeded": 0, "updated": 0}


def update_daily_record(
    city_name,
    date_str,
    forecasts,
    actual_high,
    deb_prediction=None,
    mu=None,
    probabilities=None,
    probability_features=None,
    shadow_probabilities=None,
    calibration_summary=None,
):
    """
    保存/更新某城市某天的各个模型预报与最终实测值
    forecasts: dict, 例如 {"ECMWF": 28.5, "GFS": 30.0, ...}
    actual_high: float, 最终实测最高温
    deb_prediction: float, DEB 融合预测值（用于准确率追踪）
    mu: float, 概率引擎中心值（用于 μ MAE 追踪）
    probabilities: list[dict], 概率分布快照（用于 Brier Score 校准）
        例如 [{"value": 25, "probability": 0.8}, {"value": 26, "probability": 0.2}]
    """
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    history_file = os.path.join(project_root, "data", "daily_records.json")

    mode = get_state_storage_mode()
    data = load_history(history_file)
    if city_name not in data:
        data[city_name] = {}

    if date_str not in data[city_name]:
        data[city_name][date_str] = {}

    # 统一过滤已弃用模型，避免历史/展示残留。
    # 对同一天的多次刷新，保留历史上已经拿到的模型值，避免某次上游短暂缺失
    # 把已有 forecast 整体覆盖成更稀疏的新字典，导致历史图断线。
    next_forecasts = {
        k: v for k, v in (forecasts or {}).items() if not _is_excluded_model_name(k)
    }

    compact_probs = None
    if probabilities is not None:
        # Store compact: [{"v": 25, "p": 0.8}, ...]
        compact_probs = [
            {"v": p["value"], "p": p["probability"]}
            for p in probabilities[:4]
        ]
    compact_features = None
    if isinstance(probability_features, dict) and probability_features:
        compact_features = {
            "raw_mu": _sf(probability_features.get("raw_mu")),
            "raw_sigma": _sf(probability_features.get("raw_sigma")),
            "deb_prediction": _sf(probability_features.get("deb_prediction")),
            "ens_median": _sf(probability_features.get("ens_median")),
            "ensemble_spread": _sf(probability_features.get("ensemble_spread")),
            "max_so_far": _sf(probability_features.get("max_so_far")),
            "max_so_far_gap": _sf(probability_features.get("max_so_far_gap")),
            "peak_status": probability_features.get("peak_status"),
        }
    compact_shadow_probs = None
    if shadow_probabilities is not None:
        compact_shadow_probs = [
            {"v": p["value"], "p": p["probability"]}
            for p in shadow_probabilities[:4]
        ]
    compact_calibration = None
    if isinstance(calibration_summary, dict) and calibration_summary:
        compact_calibration = {
            "mode": calibration_summary.get("mode"),
            "engine": calibration_summary.get("engine"),
            "version": calibration_summary.get("calibration_version"),
            "source": calibration_summary.get("calibration_source"),
            "raw_mu": _sf(calibration_summary.get("raw_mu")),
            "raw_sigma": _sf(calibration_summary.get("raw_sigma")),
            "calibrated_mu": _sf(calibration_summary.get("calibrated_mu")),
            "calibrated_sigma": _sf(calibration_summary.get("calibrated_sigma")),
        }

    # 避免无意义的频繁磁盘写入
    existing = data[city_name][date_str]
    old_actual = existing.get("actual_high")
    old_deb = existing.get("deb_prediction")
    old_mu = existing.get("mu")
    old_probs = existing.get("prob_snapshot")
    old_shadow_probs = existing.get("shadow_prob_snapshot")
    old_forecasts = existing.get("forecasts") if isinstance(existing.get("forecasts"), dict) else {}
    merged_forecasts = dict(old_forecasts)
    for model_name, model_value in next_forecasts.items():
        if model_value is not None:
            merged_forecasts[model_name] = model_value
        elif model_name not in merged_forecasts:
            merged_forecasts[model_name] = model_value
    next_mu = round(mu, 2) if mu is not None else None
    if (
        old_actual == actual_high
        and old_forecasts == merged_forecasts
        and (deb_prediction is None or old_deb == deb_prediction)
        and (mu is None or old_mu == next_mu)
        and (compact_probs is None or old_probs == compact_probs)
        and (
            compact_shadow_probs is None
            or old_shadow_probs == compact_shadow_probs
        )
        and (
            compact_features is None
            or existing.get("probability_features") == compact_features
        )
        and (
            compact_calibration is None
            or existing.get("probability_calibration") == compact_calibration
        )
    ):
        return

    # actual_high 应该是日内最高温，理论上不应下降；防止异常写入覆盖已确认高值
    if old_actual is not None and actual_high is not None:
        try:
            actual_high = max(float(old_actual), float(actual_high))
        except Exception:
            pass

    existing["forecasts"] = merged_forecasts
    existing["actual_high"] = actual_high
    if deb_prediction is not None:
        existing["deb_prediction"] = deb_prediction
    if mu is not None:
        existing["mu"] = next_mu
    if probabilities is not None:
        existing["prob_snapshot"] = compact_probs
    if compact_features is not None:
        existing["probability_features"] = compact_features
    if shadow_probabilities is not None:
        existing["shadow_prob_snapshot"] = compact_shadow_probs
    if compact_calibration is not None:
        existing["probability_calibration"] = compact_calibration

    if actual_high is not None:
        try:
            _persist_truth_record(
                city_name,
                date_str,
                float(actual_high),
                updated_by="runtime:update_daily_record",
                reason="update_daily_record",
                source_payload={
                    "actual_high": actual_high,
                    "deb_prediction": deb_prediction,
                    "mu": next_mu,
                },
            )
        except Exception as e:
            logger.error(f"Error persisting truth record city={city_name} date={date_str}: {e}")
    try:
        _persist_training_feature_record(
            city_name,
            date_str,
            forecasts=merged_forecasts,
            deb_prediction=existing.get("deb_prediction"),
            mu=existing.get("mu"),
            probability_features=existing.get("probability_features"),
            probabilities=existing.get("prob_snapshot"),
            shadow_probabilities=existing.get("shadow_prob_snapshot"),
            probability_calibration=existing.get("probability_calibration"),
        )
    except Exception as e:
        logger.error(f"Error persisting training feature record city={city_name} date={date_str}: {e}")

    # 自动清理：训练特征需要更长窗口，保留最近 180 天的记录
    cutoff = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
    for city in list(data.keys()):
        old_dates = [d for d in data[city] if d < cutoff]
        for d in old_dates:
            del data[city][d]

    if mode == STATE_STORAGE_SQLITE:
        try:
            _daily_record_repo.upsert_record(city_name, date_str, existing)
            cutoff = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
            _daily_record_repo.delete_older_than(cutoff)
        except Exception as e:
            logger.error(f"Error upserting daily record to sqlite city={city_name} date={date_str}: {e}")
            raise

    if mode != STATE_STORAGE_SQLITE:
        save_history(history_file, data)


def calculate_dynamic_weights(city_name, current_forecasts, lookback_days=7):
    """
    计算动态权重融合 (Dynamic Ensemble Blending, DEB)
    根据过去 N 天各模型的 Mean Absolute Error (MAE) 计算倒数权重
    返回: blended_high (融合预报值), weights_info (权重展示字符串)
    """
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    history_file = os.path.join(project_root, "data", "daily_records.json")
    data = load_history(history_file)

    raw_forecast_count = len(
        [
            v
            for k, v in (current_forecasts or {}).items()
            if v is not None and not _is_excluded_model_name(k)
        ]
    )
    current_forecasts = _collapse_forecasts_for_deb(current_forecasts)
    dedup_note = "家族去重" if raw_forecast_count > len(current_forecasts) else ""

    if city_name not in data or not data[city_name]:
        # 没有历史数据，返回简单的平均/中位数
        valid_vals = [v for v in current_forecasts.values() if v is not None]
        if not valid_vals:
            return None, "暂无模型数据"
        avg = sum(valid_vals) / len(valid_vals)
        note = "等权平均(历史数据不足)"
        if dedup_note:
            note = f"{note} | {dedup_note}"
        return round(avg, 1), note

    # 获取过去 lookback_days 天的有 actual_high 的记录
    city_data = data[city_name]
    sorted_dates = sorted(city_data.keys(), reverse=True)

    # 我们只用真正结清（或者有比较准确最高温）的历史来算误差
    # 这边简化：凡是有 actual_high 的都算进去
    errors = {model: [] for model in current_forecasts.keys()}

    days_used = 0
    for date_str in sorted_dates:
        # 跳过今天，今天还没出最终结果
        if date_str == datetime.now().strftime("%Y-%m-%d"):
            continue

        record = city_data[date_str]
        actual = record.get("actual_high")
        past_forecasts = record.get("forecasts", {})

        if actual is None:
            continue

        for model in current_forecasts.keys():
            if model in past_forecasts and past_forecasts[model] is not None:
                try:
                    pv = float(past_forecasts[model])
                    av = float(actual)
                except (TypeError, ValueError):
                    continue
                errors[model].append(abs(pv - av))

        days_used += 1
        if days_used >= lookback_days:
            break

    # 如果有效历史天数 < 2 天，还是使用等权
    if days_used < 2:
        valid_vals = [v for v in current_forecasts.values() if v is not None]
        if not valid_vals:
            return None, f"暂无有效模型数据(由于仅{days_used}天历史)"
        avg = sum(valid_vals) / len(valid_vals)
        note = f"等权平均(由于仅{days_used}天历史)"
        if dedup_note:
            note = f"{note} | {dedup_note}"
        return round(avg, 1), note

    # 计算 MAE
    maes = {}
    for model, err_list in errors.items():
        if err_list:
            maes[model] = sum(err_list) / len(err_list)
        else:
            # 如果某个新模型没有历史数据，给它一个平均误差
            maes[model] = 2.0

    # 计算权重（用 MAE 的倒数，误差越小权重越大；加 0.1 防止除以0）
    inverse_errors = {
        m: 1.0 / (mae + 0.1)
        for m, mae in maes.items()
        if current_forecasts.get(m) is not None
    }

    total_inv = sum(inverse_errors.values())
    if total_inv == 0:
        return None, "权重计算异常"

    weights = {m: inv / total_inv for m, inv in inverse_errors.items()}

    # 计算加权最高温
    blended_high = 0.0
    for m in weights.keys():
        blended_high += current_forecasts[m] * weights[m]

    # 格式化权重信息，挑选前权重最高的2-3个模型展示
    sorted_models = sorted(weights.items(), key=lambda x: x[1], reverse=True)
    weight_str_parts = []
    for m, w in sorted_models[:3]:
        weight_str_parts.append(f"{m}({w * 100:.0f}%,MAE:{maes[m]:.1f}°)")
    if dedup_note:
        weight_str_parts.append(dedup_note)

    return round(blended_high, 1), " | ".join(weight_str_parts)


def get_deb_accuracy(city_name):
    """
    计算 DEB 融合预测的历史准确率
    返回: (hit_rate, mae, total_days, details_str) 或 None
    - hit_rate: WU 结算命中率 (DEB 四舍五入 == 实测四舍五入)
    - mae: 平均绝对误差
    - total_days: 有效天数
    - details_str: 格式化的展示字符串
    """
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    history_file = os.path.join(project_root, "data", "daily_records.json")
    data = load_history(history_file)

    if city_name not in data:
        return None

    city_data = data[city_name]
    today_str = datetime.now().strftime("%Y-%m-%d")

    hits = 0
    total = 0
    errors = []

    for date_str in sorted(city_data.keys()):
        if date_str == today_str:
            continue  # 跳过今天，还没结算
        record = city_data[date_str]
        deb_pred = record.get("deb_prediction")
        actual = record.get("actual_high")

        if deb_pred is None or actual is None:
            continue

        try:
            deb_pred = float(deb_pred)
            actual = float(actual)
        except Exception:
            continue

        total += 1
        deb_wu = apply_city_settlement(city_name, deb_pred)
        actual_wu = apply_city_settlement(city_name, actual)
        if deb_wu == actual_wu:
            hits += 1
        errors.append(abs(deb_pred - actual))

    if total == 0:
        return None

    hit_rate = hits / total * 100
    mae = sum(errors) / len(errors)

    details_str = (
        f"过去{total}天 WU命中 {hits}/{total} ({hit_rate:.0f}%) | MAE: {mae:.1f}°"
    )

    return hit_rate, mae, total, details_str


def get_mu_accuracy(city_name):
    """
    评估概率引擎 μ 的历史准确性
    返回: (mu_mae, mu_hit_rate, brier_score, total_days, details_str) 或 None

    - mu_mae: μ 与实际最高温的平均绝对误差
    - mu_hit_rate: round(μ) 命中 WU 结算值的比率
    - brier_score: 概率分布的 Brier Score (越低越好)
      对于每天，取概率最高的预测值，计算 (p - outcome)² 的平均值
    - total_days: 有效统计天数
    """
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    history_file = os.path.join(project_root, "data", "daily_records.json")
    data = load_history(history_file)

    if city_name not in data:
        return None

    city_data = data[city_name]
    today_str = datetime.now().strftime("%Y-%m-%d")

    mu_errors = []
    mu_hits = 0
    brier_scores = []
    total = 0

    for date_str in sorted(city_data.keys()):
        if date_str == today_str:
            continue
        record = city_data[date_str]
        actual = record.get("actual_high")
        mu_val = record.get("mu")

        if actual is None or mu_val is None:
            continue

        try:
            actual = float(actual)
            mu_val = float(mu_val)
        except Exception:
            continue

        total += 1
        mu_errors.append(abs(mu_val - actual))
        if apply_city_settlement(city_name, mu_val) == apply_city_settlement(city_name, actual):
            mu_hits += 1

        # Brier Score from probability snapshot
        prob_snap = record.get("prob_snapshot", [])
        if prob_snap:
            actual_wu = apply_city_settlement(city_name, actual)
            bs = 0.0
            for entry in prob_snap:
                predicted_p = entry.get("p", 0)
                outcome = 1.0 if entry.get("v") == actual_wu else 0.0
                bs += (predicted_p - outcome) ** 2
            brier_scores.append(bs)

    if total == 0:
        return None

    mu_mae = sum(mu_errors) / len(mu_errors)
    mu_hr = mu_hits / total * 100
    avg_brier = sum(brier_scores) / len(brier_scores) if brier_scores else None

    details_parts = [
        f"μ准确率: 过去{total}天",
        f"WU命中 {mu_hits}/{total} ({mu_hr:.0f}%)",
        f"MAE: {mu_mae:.1f}°",
    ]
    if avg_brier is not None:
        details_parts.append(f"Brier: {avg_brier:.3f}")

    return mu_mae, mu_hr, avg_brier, total, " | ".join(details_parts)
