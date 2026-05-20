"""
PolyWeather Web Core Context
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from loguru import logger

from src.utils.config_loader import load_config
from src.utils.config_validation import validate_runtime_env
from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.country_networks import provider_coverage_summary
from src.data_collection.city_risk_profiles import CITY_RISK_PROFILES  # noqa: F401
from src.data_collection.polymarket_readonly import PolymarketReadOnlyLayer
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT, extract_bearer_token
from src.utils.metrics import (
    build_metrics_summary,
    counter_inc,
    gauge_set,
    histogram_observe,
)
from src.database.db_manager import DBManager
from src.database.runtime_state import get_state_storage_mode
from src.payments import PAYMENT_CHECKOUT, PaymentCheckoutError  # noqa: F401
from src.data_collection.city_registry import CITY_REGISTRY

app = FastAPI(title="PolyWeather Map", version="1.0")

_cors_origins = os.getenv(
    "WEB_CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,https://polyweather-pro.vercel.app",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_config = load_config()
_config_validation = validate_runtime_env("web")
for _warning in _config_validation.warnings:
    logger.warning(f"[config:web] {_warning}")
if _config_validation.errors:
    raise RuntimeError(" | ".join(_config_validation.errors))
_weather = WeatherDataCollector(_config)
_market_layer = PolymarketReadOnlyLayer()
_account_db = DBManager()

CITIES: Dict[str, Dict[str, Any]] = {
    cid: {
        "lat": info["lat"],
        "lon": info["lon"],
        "f": info["use_fahrenheit"],
        "tz": info["tz_offset"],
        "settlement_source": str(info.get("settlement_source") or "metar").strip().lower() or "metar",
    }
    for cid, info in CITY_REGISTRY.items()
}

SETTLEMENT_SOURCE_LABELS: Dict[str, str] = {
    "metar": "METAR",
    "hko": "HKO",
    "cwa": "CWA",
    "noaa": "NOAA",
    "mgm": "MGM",
    "wunderground": "Wunderground",
}

_cache: Dict[str, Dict] = {}
CACHE_TTL = 300
CACHE_TTL_ANKARA = 60
CACHE_TTL_KOREAN_AMOS = 60
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@app.middleware("http")
async def _metrics_middleware(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000.0
        counter_inc(
            "polyweather_http_requests_total",
            method=request.method,
            path=request.url.path,
            status="500",
        )
        histogram_observe(
            "polyweather_http_request_duration_ms",
            duration_ms,
            method=request.method,
            path=request.url.path,
            status="500",
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000.0
    status_code = str(response.status_code)
    counter_inc(
        "polyweather_http_requests_total",
        method=request.method,
        path=request.url.path,
        status=status_code,
    )
    histogram_observe(
        "polyweather_http_request_duration_ms",
        duration_ms,
        method=request.method,
        path=request.url.path,
        status=status_code,
    )
    return response


@app.middleware("http")
async def _etag_middleware(request: Request, call_next):
    """Add ETag to GET /api/* responses; return 304 on If-None-Match hit."""
    response = await call_next(request)

    if request.method != "GET" or response.status_code != 200:
        return response

    path = request.url.path
    if not path.startswith("/api/") or path.endswith("/stream"):
        return response

    body = getattr(response, "body", None) or b""
    if not body:
        return response

    try:
        import hashlib
        etag = hashlib.md5(body).hexdigest()
    except Exception:
        return response

    etag_value = f'"{etag}"'
    if_none_match = request.headers.get("If-None-Match", "")
    if if_none_match == etag_value:
        from fastapi.responses import Response
        return Response(status_code=304, headers={"ETag": etag_value})

    response.headers["ETag"] = etag_value
    response.headers["Cache-Control"] = "private, max-age=30"
    return response

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


_ENTITLEMENT_GUARD_ENABLED = _env_bool("POLYWEATHER_REQUIRE_ENTITLEMENT", False)
_ENTITLEMENT_HEADER = "x-polyweather-entitlement"
_ENTITLEMENT_TOKEN = (os.getenv("POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN") or "").strip()
_FORWARDED_SUPABASE_USER_ID_HEADER = "x-polyweather-auth-user-id"
_FORWARDED_SUPABASE_EMAIL_HEADER = "x-polyweather-auth-email"
_SUPABASE_AUTH_REQUIRED = _env_bool(
    "POLYWEATHER_AUTH_REQUIRED",
    SUPABASE_ENTITLEMENT.enabled,
)
_OPS_ADMIN_EMAILS = {
    item.strip().lower()
    for item in str(os.getenv("POLYWEATHER_OPS_ADMIN_EMAILS") or "").split(",")
    if item.strip()
}


def _legacy_service_token_valid(request: Request) -> bool:
    token = request.headers.get(_ENTITLEMENT_HEADER)
    if not token:
        token = extract_bearer_token(request.headers.get("authorization"))
    return bool(_ENTITLEMENT_TOKEN and token == _ENTITLEMENT_TOKEN)


def _bind_optional_supabase_identity(request: Request) -> None:
    if not SUPABASE_ENTITLEMENT.configured:
        return
    access_token = extract_bearer_token(request.headers.get("authorization"))
    if not access_token:
        return
    identity = SUPABASE_ENTITLEMENT.get_identity(access_token)
    if not identity:
        return
    request.state.auth_user_id = identity.user_id
    request.state.auth_email = identity.email
    request.state.auth_points = identity.points
    request.state.auth_created_at = identity.created_at


def _resolve_auth_points(request: Request) -> int:
    raw_points = getattr(request.state, "auth_points", 0)
    try:
        points = max(0, int(raw_points or 0))
    except Exception:
        points = 0

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()

    if user_id:
        try:
            db_points = _account_db.get_points_by_supabase_user_id(user_id)
            if db_points > points:
                request.state.auth_points = db_points
                points = db_points
        except Exception as exc:
            logger.warning(f"auth points fallback failed user_id={user_id}: {exc}")

    if points <= 0:
        email = str(getattr(request.state, "auth_email", "") or "").strip().lower()
        if email:
            try:
                email_points = _account_db.get_points_by_supabase_email(email)
                if email_points > points:
                    request.state.auth_points = email_points
                    points = email_points
            except Exception as exc:
                logger.warning(f"auth points email fallback failed email={email}: {exc}")

    return points


def _resolve_weekly_profile(request: Request) -> Dict[str, Any]:
    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    if not user_id:
        return {"weekly_points": 0, "weekly_rank": None}
    try:
        profile = _account_db.get_weekly_profile_by_supabase_user_id(user_id)
        return {
            "weekly_points": int(profile.get("weekly_points") or 0),
            "weekly_rank": profile.get("weekly_rank"),
        }
    except Exception as exc:
        logger.warning(f"auth weekly profile fallback failed user_id={user_id}: {exc}")
        return {"weekly_points": 0, "weekly_rank": None}


def _assert_entitlement(request: Request) -> None:
    if SUPABASE_ENTITLEMENT.enabled:
        if _legacy_service_token_valid(request):
            return
        if not _SUPABASE_AUTH_REQUIRED:
            _bind_optional_supabase_identity(request)
            return
        if not SUPABASE_ENTITLEMENT.configured:
            raise HTTPException(
                status_code=503,
                detail="Supabase auth is enabled but SUPABASE_URL / SUPABASE_ANON_KEY is not configured",
            )

        access_token = extract_bearer_token(request.headers.get("authorization"))
        if not access_token:
            raise HTTPException(status_code=401, detail="Unauthorized")

        identity = SUPABASE_ENTITLEMENT.get_identity(access_token)
        if not identity:
            raise HTTPException(status_code=401, detail="Unauthorized")
        if not SUPABASE_ENTITLEMENT.has_active_subscription(identity.user_id):
            raise HTTPException(status_code=403, detail="Subscription required")

        request.state.auth_user_id = identity.user_id
        request.state.auth_email = identity.email
        return

    if not _ENTITLEMENT_GUARD_ENABLED:
        return

    if not _ENTITLEMENT_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Entitlement guard is enabled but backend token is not configured",
        )

    if not _legacy_service_token_valid(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _require_supabase_identity(request: Request) -> Dict[str, str]:
    if not SUPABASE_ENTITLEMENT.enabled:
        raise HTTPException(status_code=503, detail="payment requires POLYWEATHER_AUTH_ENABLED=true")
    if not SUPABASE_ENTITLEMENT.configured:
        raise HTTPException(status_code=503, detail="payment requires SUPABASE_URL and SUPABASE_ANON_KEY")

    state_user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    if state_user_id:
        state_email = str(getattr(request.state, "auth_email", "") or "").strip()
        return {"user_id": state_user_id, "email": state_email}

    token = extract_bearer_token(request.headers.get("authorization"))
    if token:
        identity = SUPABASE_ENTITLEMENT.get_identity(token)
        if identity:
            return {"user_id": identity.user_id, "email": identity.email}

    legacy_ok = _legacy_service_token_valid(request)
    if legacy_ok:
        forwarded_user_id = str(request.headers.get(_FORWARDED_SUPABASE_USER_ID_HEADER) or "").strip()
        if forwarded_user_id:
            forwarded_email = str(request.headers.get(_FORWARDED_SUPABASE_EMAIL_HEADER) or "").strip()
            return {"user_id": forwarded_user_id, "email": forwarded_email}

    logger.warning(
        "payment auth identity missing state_user={} auth_bearer={} legacy_ok={} forwarded_user={}"
        .format(
            bool(state_user_id),
            bool(token),
            bool(legacy_ok),
            bool(str(request.headers.get(_FORWARDED_SUPABASE_USER_ID_HEADER) or "").strip()),
        )
    )
    raise HTTPException(status_code=401, detail="Unauthorized")


def _require_ops_admin(request: Request) -> Dict[str, str]:
    is_entitlement = _legacy_service_token_valid(request)
    identity = _require_supabase_identity(request)
    if not _OPS_ADMIN_EMAILS:
        raise HTTPException(
            status_code=503,
            detail="ops admin is not configured; set POLYWEATHER_OPS_ADMIN_EMAILS",
        )
    email = str(identity.get("email") or "").strip().lower()
    if email and email in _OPS_ADMIN_EMAILS:
        return identity
    # If identity lacks an email (e.g. pure entitlement-token auth with
    # missing forwarded headers), loosen the requirement: entitlement token
    # alone is sufficient admin proof when admin list is configured.
    if is_entitlement:
        granted = {"user_id": "admin:entitlement", "email": next(iter(_OPS_ADMIN_EMAILS))}
        return granted
    raise HTTPException(status_code=403, detail="ops admin required")


class WalletChallengeRequest(BaseModel):
    address: str = Field(..., min_length=8)


class WalletVerifyRequest(BaseModel):
    address: str = Field(..., min_length=8)
    nonce: str = Field(..., min_length=6)
    signature: str = Field(..., min_length=20)


class WalletUnbindRequest(BaseModel):
    address: str = Field(..., min_length=8)


class CreatePaymentIntentRequest(BaseModel):
    plan_code: str = Field(default="pro_monthly", min_length=2)
    payment_mode: str = Field(default="strict")
    allowed_wallet: Optional[str] = None
    token_address: Optional[str] = None
    use_points: bool = False
    points_to_consume: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SubmitPaymentTxRequest(BaseModel):
    tx_hash: str = Field(..., min_length=10)
    from_address: Optional[str] = None


class ConfirmPaymentTxRequest(BaseModel):
    tx_hash: Optional[str] = None


class TelegramLoginRequest(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str = Field(..., min_length=10)


class TelegramBindTokenRequest(BaseModel):
    token: str = Field(..., min_length=8)


class AnalyticsEventRequest(BaseModel):
    event_type: str = Field(..., min_length=3, max_length=64)
    client_id: Optional[str] = Field(default=None, max_length=128)
    session_id: Optional[str] = Field(default=None, max_length=128)
    payload: Dict[str, Any] = Field(default_factory=dict)


class GrantPointsRequest(BaseModel):
    email: str = Field(..., min_length=3)
    points: int = Field(..., gt=0, le=100000)


def _sf(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _is_excluded_model_name(model_name: str) -> bool:
    return False


def _sqlite_health() -> Dict[str, Any]:
    try:
        with sqlite3.connect(_account_db.db_path) as conn:
            conn.execute("SELECT 1").fetchone()
        return {"ok": True, "db_path": _account_db.db_path}
    except Exception as exc:
        return {"ok": False, "db_path": _account_db.db_path, "error": str(exc)}


def _cache_summary() -> Dict[str, Any]:
    from web.analysis_service import get_analysis_cache_stats

    open_meteo_forecast_entries = len(getattr(_weather, "_open_meteo_cache", {}) or {})
    open_meteo_ensemble_entries = len(getattr(_weather, "_ensemble_cache", {}) or {})
    open_meteo_multi_model_entries = len(getattr(_weather, "_multi_model_cache", {}) or {})
    metar_entries = len(getattr(_weather, "_metar_cache", {}) or {})
    taf_entries = len(getattr(_weather, "_taf_cache", {}) or {})
    settlement_entries = len(getattr(_weather, "_settlement_cache", {}) or {})

    gauge_set("polyweather_api_cache_entries", len(_cache))
    gauge_set("polyweather_open_meteo_forecast_cache_entries", open_meteo_forecast_entries)
    gauge_set("polyweather_open_meteo_ensemble_cache_entries", open_meteo_ensemble_entries)
    gauge_set("polyweather_open_meteo_multi_model_cache_entries", open_meteo_multi_model_entries)
    gauge_set("polyweather_metar_cache_entries", metar_entries)
    gauge_set("polyweather_taf_cache_entries", taf_entries)
    gauge_set("polyweather_settlement_cache_entries", settlement_entries)
    return {
        "api_cache_entries": len(_cache),
        "open_meteo_forecast_entries": open_meteo_forecast_entries,
        "open_meteo_ensemble_entries": open_meteo_ensemble_entries,
        "open_meteo_multi_model_entries": open_meteo_multi_model_entries,
        "metar_entries": metar_entries,
        "taf_entries": taf_entries,
        "settlement_entries": settlement_entries,
        "analysis": get_analysis_cache_stats(),
    }


def _feature_flags_summary() -> Dict[str, Any]:
    return {
        "auth_enabled": bool(SUPABASE_ENTITLEMENT.enabled),
        "auth_required": bool(_SUPABASE_AUTH_REQUIRED),
        "entitlement_guard_enabled": bool(_ENTITLEMENT_GUARD_ENABLED),
        "payment_enabled": bool(getattr(PAYMENT_CHECKOUT, "enabled", False)),
        "state_storage_mode": get_state_storage_mode(),
    }


def _integration_summary() -> Dict[str, Any]:
    weather_cfg = _config.get("weather", {}) if isinstance(_config, dict) else {}
    return {
        "supabase_configured": bool(SUPABASE_ENTITLEMENT.configured),
        "telegram_bot_configured": bool((_config.get("telegram", {}) or {}).get("bot_token")),
        "walletconnect_configured": bool(os.getenv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID")),
        "weather_sources": {
            "openweather": bool(weather_cfg.get("openweather_api_key")),
            "wunderground": bool(weather_cfg.get("wunderground_api_key")),
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


def _table_date_summary(conn: sqlite3.Connection, table_name: str) -> Dict[str, Any]:
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

    return {
        "ok": True,
        "row_count": int(row["row_count"] or 0),
        "cities_count": int(row["cities_count"] or 0),
        "min_date": row["min_date"],
        "max_date": row["max_date"],
    }


def _truth_source_counts(conn: sqlite3.Connection) -> Dict[str, int]:
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


def _truth_revisions_summary(conn: sqlite3.Connection) -> Dict[str, Any]:
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


def _city_coverage_summary(conn: sqlite3.Connection) -> Dict[str, Any]:
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
    for city, meta in CITY_REGISTRY.items():
        truth_payload = truth_index.get(city, {})
        feature_payload = feature_index.get(city, {})
        entries.append(
            {
                "city": city,
                "name": str(meta.get("name") or city),
                "settlement_source": str(meta.get("settlement_source") or "metar"),
                "settlement_station_code": str(meta.get("settlement_station_code") or meta.get("icao") or ""),
                "truth_rows": int(truth_payload.get("truth_rows") or 0),
                "feature_rows": int(feature_payload.get("feature_rows") or 0),
                "truth_min_date": truth_payload.get("truth_min_date"),
                "truth_max_date": truth_payload.get("truth_max_date"),
                "feature_min_date": feature_payload.get("feature_min_date"),
                "feature_max_date": feature_payload.get("feature_max_date"),
            }
        )

    highlighted = [
        entry
        for entry in entries
        if entry["city"] in {"taipei", "shenzhen"}
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


def _model_city_coverage_summary(
    city_entries: Any,
) -> Dict[str, Any]:
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


def _training_data_summary() -> Dict[str, Any]:
    db_path = _account_db.db_path
    truth_records = {"ok": False, "row_count": 0, "cities_count": 0}
    truth_revisions = {"ok": False, "row_count": 0}
    training_features = {"ok": False, "row_count": 0, "cities_count": 0}
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            truth_records = _table_date_summary(conn, "truth_records_store")
            if truth_records.get("ok"):
                truth_records["source_counts"] = _truth_source_counts(conn)
            truth_revisions = _truth_revisions_summary(conn)
            training_features = _table_date_summary(conn, "training_feature_records_store")
            city_coverage = _city_coverage_summary(conn)
    except Exception as exc:
        return {
            "db_path": db_path,
            "db_ok": False,
            "error": str(exc),
            "truth_records": truth_records,
            "truth_revisions": truth_revisions,
            "training_features": training_features,
            "city_coverage": {},
            "model_city_coverage": {},
        }

    return {
        "db_path": db_path,
        "db_ok": True,
        "truth_records": truth_records,
        "truth_revisions": truth_revisions,
        "training_features": training_features,
        "city_coverage": city_coverage,
        "model_city_coverage": _model_city_coverage_summary(
            city_coverage.get("entries") or [],
        ),
    }


def build_health_payload() -> Dict[str, Any]:
    db = _sqlite_health()
    return {
        "status": "ok" if db.get("ok") else "degraded",
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "db": db,
        "state_storage_mode": get_state_storage_mode(),
        "cities_count": len(CITIES),
    }


def build_system_status_payload() -> Dict[str, Any]:
    return {
        "status": build_health_payload()["status"],
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "state_storage_mode": get_state_storage_mode(),
        "db": _sqlite_health(),
        "features": _feature_flags_summary(),
        "integrations": _integration_summary(),
        "cache": _cache_summary(),
        "metrics": build_metrics_summary(),
        "probability": _probability_summary(),
        "training_data": _training_data_summary(),
        "station_networks": provider_coverage_summary(),
        "cities_count": len(CITIES),
    }
