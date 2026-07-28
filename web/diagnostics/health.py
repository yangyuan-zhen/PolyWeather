"""Health check and system status diagnostics for PolyWeather."""

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.data_collection.country_networks import provider_coverage_summary
from src.utils.metrics import build_metrics_summary, gauge_set


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _sqlite_health(account_db) -> Dict[str, Any]:
    try:
        from src.database.sqlite_connection import connect_sqlite
        with connect_sqlite(account_db.db_path, timeout=0.05) as conn:
            conn.execute("SELECT 1").fetchone()
        return {"ok": True, "db_path": account_db.db_path}
    except Exception as exc:
        return {"ok": False, "db_path": account_db.db_path, "error": str(exc)}


def _cache_summary(weather_collector, analysis_cache, cache_entries: int) -> Dict[str, Any]:
    from web.analysis_service import get_analysis_cache_stats

    open_meteo_forecast_entries = len(getattr(weather_collector, "_open_meteo_cache", {}) or {})
    open_meteo_ensemble_entries = len(getattr(weather_collector, "_ensemble_cache", {}) or {})
    open_meteo_multi_model_entries = len(
        getattr(weather_collector, "_multi_model_cache", {}) or {}
    )
    metar_entries = weather_collector.cache.store_size("metar") if hasattr(weather_collector, "cache") else 0
    taf_entries = len(getattr(weather_collector, "_taf_cache", {}) or {})
    settlement_entries = len(getattr(weather_collector, "_settlement_cache", {}) or {})

    gauge_set("polyweather_api_cache_entries", cache_entries)
    gauge_set("polyweather_open_meteo_forecast_cache_entries", open_meteo_forecast_entries)
    gauge_set("polyweather_open_meteo_ensemble_cache_entries", open_meteo_ensemble_entries)
    gauge_set(
        "polyweather_open_meteo_multi_model_cache_entries",
        open_meteo_multi_model_entries,
    )
    gauge_set("polyweather_metar_cache_entries", metar_entries)
    gauge_set("polyweather_taf_cache_entries", taf_entries)
    gauge_set("polyweather_settlement_cache_entries", settlement_entries)
    return {
        "api_cache_entries": cache_entries,
        "open_meteo_forecast_entries": open_meteo_forecast_entries,
        "open_meteo_ensemble_entries": open_meteo_ensemble_entries,
        "open_meteo_multi_model_entries": open_meteo_multi_model_entries,
        "metar_entries": metar_entries,
        "taf_entries": taf_entries,
        "settlement_entries": settlement_entries,
        "analysis": get_analysis_cache_stats(),
    }


def _feature_flags_summary(config: dict) -> Dict[str, Any]:
    from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
    from src.payments import PAYMENT_CHECKOUT
    from src.database.runtime_state import get_state_storage_mode

    _SUPABASE_AUTH_REQUIRED = _env_bool(
        "POLYWEATHER_AUTH_REQUIRED",
        SUPABASE_ENTITLEMENT.enabled,
    )
    _ENTITLEMENT_GUARD_ENABLED = _env_bool("POLYWEATHER_REQUIRE_ENTITLEMENT", False)

    return {
        "auth_enabled": bool(SUPABASE_ENTITLEMENT.enabled),
        "auth_required": bool(_SUPABASE_AUTH_REQUIRED),
        "entitlement_guard_enabled": bool(_ENTITLEMENT_GUARD_ENABLED),
        "payment_enabled": bool(getattr(PAYMENT_CHECKOUT, "enabled", False)),
        "state_storage_mode": get_state_storage_mode(),
    }


def _integration_summary(config: dict) -> Dict[str, Any]:
    from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT

    weather_cfg = config.get("weather", {}) if isinstance(config, dict) else {}
    return {
        "supabase_configured": bool(SUPABASE_ENTITLEMENT.configured),
        "telegram_bot_configured": bool(
            (config.get("telegram", {}) or {}).get("bot_token")
        ),
        "walletconnect_configured": bool(
            os.getenv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID")
        ),
        "weather_sources": {
            "openweather": bool(weather_cfg.get("openweather_api_key")),

            "visualcrossing": bool(weather_cfg.get("visualcrossing_api_key")),
        },
    }


def _probability_summary() -> Dict[str, Any]:
    return {
        "engine_mode": "legacy",
    }


def _read_json_file(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def _table_date_summary(conn, table_name: str) -> Dict[str, Any]:
    try:
        row = conn.execute(
            f"""
            SELECT COUNT(*) AS row_count,
                   COUNT(DISTINCT city) AS cities_count,
                   MIN(target_date) AS min_date,
                   MAX(target_date) AS max_date
            FROM {table_name}
            """
        ).fetchone()
    except Exception as exc:
        return {"ok": False, "error": str(exc), "row_count": 0, "cities_count": 0}

    max_date = row["max_date"]
    return {
        "ok": True,
        "row_count": int(row["row_count"] or 0),
        "cities_count": int(row["cities_count"] or 0),
        "min_date": row["min_date"],
        "max_date": max_date,
        "stale_days": _target_date_stale_days(max_date),
    }


def _target_date_stale_days(target_date: Optional[str]) -> Optional[int]:
    raw = str(target_date or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        return None
    return max(0, (datetime.now(timezone.utc).date() - parsed).days)


def _truth_source_counts(conn) -> Dict[str, int]:
    try:
        rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(settlement_source), ''), 'unknown') AS settlement_source,
                   COUNT(*) AS row_count
            FROM truth_records_store
            GROUP BY COALESCE(NULLIF(TRIM(settlement_source), ''), 'unknown')
            ORDER BY row_count DESC, settlement_source ASC
            """
        ).fetchall()
    except Exception:
        return {}
    return {str(row["settlement_source"]): int(row["row_count"] or 0) for row in rows}


def _truth_revisions_summary(conn) -> Dict[str, Any]:
    try:
        row = conn.execute(
            """
            SELECT COUNT(*) AS row_count,
                   MAX(updated_at) AS last_updated_at
            FROM truth_revisions_store
            """
        ).fetchone()
    except Exception as exc:
        return {"ok": False, "error": str(exc), "row_count": 0}
    return {
        "ok": True,
        "row_count": int(row["row_count"] or 0),
        "last_updated_at": row["last_updated_at"],
    }


def _city_coverage_summary(conn, city_registry) -> Dict[str, Any]:
    truth_rows = conn.execute(
        """
        SELECT city, COUNT(*) AS row_count, MIN(target_date) AS min_date, MAX(target_date) AS max_date
        FROM truth_records_store
        GROUP BY city
        """
    ).fetchall()
    feature_rows = conn.execute(
        """
        SELECT city, COUNT(*) AS row_count, MIN(target_date) AS min_date, MAX(target_date) AS max_date
        FROM training_feature_records_store
        GROUP BY city
        """
    ).fetchall()

    truth_index = {
        str(row["city"]): {
            "truth_rows": int(row["row_count"] or 0),
            "truth_min_date": row["min_date"],
            "truth_max_date": row["max_date"],
        }
        for row in truth_rows
    }
    feature_index = {
        str(row["city"]): {
            "feature_rows": int(row["row_count"] or 0),
            "feature_min_date": row["min_date"],
            "feature_max_date": row["max_date"],
        }
        for row in feature_rows
    }

    entries = []
    for city, meta in city_registry.items():
        truth_payload = truth_index.get(city, {})
        feature_payload = feature_index.get(city, {})
        entries.append(
            {
                "city": city,
                "name": str(meta.get("name") or city),
                "settlement_source": str(meta.get("settlement_source") or "metar"),
                "settlement_station_code": str(
                    meta.get("settlement_station_code") or meta.get("icao") or ""
                ),
                "truth_rows": int(truth_payload.get("truth_rows") or 0),
                "feature_rows": int(feature_payload.get("feature_rows") or 0),
                "truth_min_date": truth_payload.get("truth_min_date"),
                "truth_max_date": truth_payload.get("truth_max_date"),
                "feature_min_date": feature_payload.get("feature_min_date"),
                "feature_max_date": feature_payload.get("feature_max_date"),
            }
        )

    highlighted = [
        entry for entry in entries if entry["city"] in {"taipei", "shenzhen"}
    ]
    gaps = sorted(
        entries,
        key=lambda entry: (
            entry["feature_rows"] > 0,
            entry["truth_rows"] > 0,
            entry["truth_rows"],
            entry["feature_rows"],
            entry["city"],
        ),
    )[:10]
    return {
        "total_cities": len(entries),
        "with_truth_rows": sum(1 for entry in entries if entry["truth_rows"] > 0),
        "with_feature_rows": sum(1 for entry in entries if entry["feature_rows"] > 0),
        "entries": entries,
        "highlighted": highlighted,
        "top_gaps": gaps,
    }


def _model_city_coverage_summary(city_entries) -> Dict[str, Any]:
    rows = []
    for entry in city_entries or []:
        city = str(entry.get("city") or "").strip().lower()
        rows.append(
            {
                "city": city,
                "name": entry.get("name") or city,
                "settlement_source": entry.get("settlement_source"),
                "truth_rows": int(entry.get("truth_rows") or 0),
                "feature_rows": int(entry.get("feature_rows") or 0),
            }
        )

    weakest = sorted(
        rows,
        key=lambda row: (
            row["truth_rows"] > 0,
            row["truth_rows"],
            row["city"],
        ),
    )[:12]
    strongest = sorted(
        rows,
        key=lambda row: (
            -row["truth_rows"],
            row["city"],
        ),
    )[:8]
    return {
        "weakest": weakest,
        "strongest": strongest,
    }


def _training_data_summary(account_db, city_registry) -> Dict[str, Any]:
    from src.database.sqlite_connection import connect_sqlite
    import sqlite3

    db_path = account_db.db_path
    daily_records = {"ok": False, "row_count": 0, "cities_count": 0}
    truth_records = {"ok": False, "row_count": 0, "cities_count": 0}
    truth_revisions = {"ok": False, "row_count": 0}
    training_features = {"ok": False, "row_count": 0, "cities_count": 0}
    stale_threshold_days = max(
        0,
        int(os.getenv("POLYWEATHER_TRAINING_DATA_STALE_WARN_DAYS", "2") or "2"),
    )
    try:
        with connect_sqlite(db_path, row_factory=sqlite3.Row) as conn:
            daily_records = _table_date_summary(conn, "daily_records_store")
            truth_records = _table_date_summary(conn, "truth_records_store")
            if truth_records.get("ok"):
                truth_records["source_counts"] = _truth_source_counts(conn)
            truth_revisions = _truth_revisions_summary(conn)
            training_features = _table_date_summary(
                conn, "training_feature_records_store"
            )
            city_coverage = _city_coverage_summary(conn, city_registry)
    except Exception as exc:
        return {
            "db_path": db_path,
            "db_ok": False,
            "error": str(exc),
            "daily_records": daily_records,
            "truth_records": truth_records,
            "truth_revisions": truth_revisions,
            "training_features": training_features,
            "stale": True,
            "stale_threshold_days": stale_threshold_days,
            "city_coverage": {},
            "model_city_coverage": {},
        }

    stale_days = [
        value
        for value in (
            daily_records.get("stale_days"),
            truth_records.get("stale_days"),
            training_features.get("stale_days"),
        )
        if value is not None
    ]
    return {
        "db_path": db_path,
        "db_ok": True,
        "daily_records": daily_records,
        "truth_records": truth_records,
        "truth_revisions": truth_revisions,
        "training_features": training_features,
        "stale": any(int(value) > stale_threshold_days for value in stale_days)
        if stale_days
        else True,
        "stale_threshold_days": stale_threshold_days,
        "city_coverage": city_coverage,
        "model_city_coverage": _model_city_coverage_summary(
            city_coverage.get("entries") or [],
        ),
    }


def build_health_payload(account_db, cities_count: int) -> Dict[str, Any]:
    from src.database.runtime_state import get_state_storage_mode

    db = _sqlite_health(account_db)
    return {
        "status": "ok" if db.get("ok") else "degraded",
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "db": db,
        "state_storage_mode": get_state_storage_mode(),
        "cities_count": cities_count,
    }


def build_system_status_payload(
    account_db,
    config: dict,
    weather_collector,
    analysis_cache,
    cache_entries: int,
    cities_count: int,
    city_registry,
) -> Dict[str, Any]:
    from src.database.runtime_state import get_state_storage_mode

    return {
        "status": build_health_payload(account_db, cities_count)["status"],
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "state_storage_mode": get_state_storage_mode(),
        "db": _sqlite_health(account_db),
        "features": _feature_flags_summary(config),
        "integrations": _integration_summary(config),
        "cache": _cache_summary(weather_collector, analysis_cache, cache_entries),
        "metrics": build_metrics_summary(),
        "probability": _probability_summary(),
        "training_data": _training_data_summary(account_db, city_registry),
        "station_networks": provider_coverage_summary(),
        "cities_count": cities_count,
    }
