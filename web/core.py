"""
PolyWeather Web Core Context
"""

import os
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from loguru import logger

from src.utils.config_loader import load_config
from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.city_risk_profiles import CITY_RISK_PROFILES  # noqa: F401
from src.data_collection.polymarket_readonly import PolymarketReadOnlyLayer
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT, extract_bearer_token
from src.database.db_manager import DBManager
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
    "mgm": "MGM",
}

_cache: Dict[str, Dict] = {}
CACHE_TTL = 300
CACHE_TTL_ANKARA = 60


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


def _resolve_auth_points(request: Request) -> int:
    raw_points = getattr(request.state, "auth_points", 0)
    try:
        points = max(0, int(raw_points or 0))
    except Exception:
        points = 0
    if points > 0:
        return points

    user_id = str(getattr(request.state, "auth_user_id", "") or "").strip()
    if not user_id:
        return points
    try:
        db_points = _account_db.get_points_by_supabase_user_id(user_id)
        if db_points > points:
            request.state.auth_points = db_points
            return db_points
    except Exception as exc:
        logger.warning(f"auth points fallback failed user_id={user_id}: {exc}")
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
    from_address: str = Field(..., min_length=8)


class ConfirmPaymentTxRequest(BaseModel):
    tx_hash: Optional[str] = None


def _sf(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _is_excluded_model_name(model_name: str) -> bool:
    normalized = str(model_name or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "")
    return "meteoblue" in normalized
