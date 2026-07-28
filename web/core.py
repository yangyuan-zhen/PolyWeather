"""
PolyWeather Web Core Context

Holds module-level singletons (app, config, weather collector, DB manager, cache)
and re-exports symbols from domain-specific modules for backward compatibility.
"""

import os
import threading
from collections import OrderedDict
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from src.utils.config_loader import load_config
from src.utils.config_validation import validate_runtime_env
from src.data_collection.weather_sources import WeatherDataCollector
from src.database.db_manager import DBManager
from src.data_collection.city_registry import CITY_REGISTRY

# ---------------------------------------------------------------------------
# FastAPI app singleton
# ---------------------------------------------------------------------------
app = FastAPI(title="PolyWeather Map", version="1.0")

_cors_origins = os.getenv(
    "WEB_CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,https://polyweather.top,https://www.polyweather.top,https://api.polyweather.top",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Core singletons (must remain module-level for backward compat)
# ---------------------------------------------------------------------------
_config = load_config()
_config_validation = validate_runtime_env("web")
for _warning in _config_validation.warnings:
    logger.warning(f"[config:web] {_warning}")
if _config_validation.errors:
    raise RuntimeError(" | ".join(_config_validation.errors))
_weather = WeatherDataCollector(_config)
_account_db = DBManager()

CITIES: Dict[str, Dict[str, Any]] = {
    cid: {
        "lat": info["lat"],
        "lon": info["lon"],
        "f": info["use_fahrenheit"],
        "tz": info["tz_offset"],
        "settlement_source": str(info.get("settlement_source") or "metar")
        .strip()
        .lower()
        or "metar",
    }
    for cid, info in CITY_REGISTRY.items()
}

SETTLEMENT_SOURCE_LABELS: Dict[str, str] = {
    "metar": "METAR",
    "hko": "HKO",
    "noaa": "NOAA",
    "mgm": "MGM",
    "wunderground": "Wunderground",
}

# ---------------------------------------------------------------------------
# LRUDict — simple size-bounded cache
# ---------------------------------------------------------------------------
class LRUDict:
    """Size-bounded ordered dict that evicts oldest entries on overflow."""

    def __init__(self, maxsize: int = 256) -> None:
        self._maxsize = max(1, int(maxsize))
        self._data: OrderedDict[str, Dict] = OrderedDict()

    def get(self, key: str) -> Optional[Dict]:
        return self._data.get(key)

    def __setitem__(self, key: str, value: Dict) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        while len(self._data) > self._maxsize:
            self._data.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)


_CACHE_MAXSIZE = int(os.getenv("POLYWEATHER_ANALYSIS_CACHE_MAXSIZE", "256"))
_cache: LRUDict = LRUDict(maxsize=_CACHE_MAXSIZE)
_CACHE_LOCK = threading.Lock()
CACHE_TTL = 300
CACHE_TTL_ANKARA = 60
CACHE_TTL_KOREAN_AMOS = 60
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Middleware — imported from web.middleware.http
# ---------------------------------------------------------------------------
from web.middleware.http import metrics_middleware as _metrics_middleware  # noqa: E402
from web.middleware.http import etag_middleware as _etag_middleware  # noqa: E402

app.middleware("http")(_metrics_middleware)
app.middleware("http")(_etag_middleware)

# Re-export middleware for external consumers
metrics_middleware = _metrics_middleware
etag_middleware = _etag_middleware

# ---------------------------------------------------------------------------
# Schemas — re-exported from web.schemas
# ---------------------------------------------------------------------------
from web.schemas.auth import (  # noqa: E402, F401
    AnalyticsEventRequest,
    FeedbackRewardRequest,
    GrantPointsRequest,
    ReferralApplyRequest,
    TelegramBindTokenRequest,
    TelegramLoginRequest,
    UserFeedbackRequest,
)
from web.schemas.payments import (  # noqa: E402, F401
    ConfirmPaymentTxRequest,
    CreatePaymentIntentRequest,
    SubmitPaymentTxRequest,
    ValidatePaymentTxRequest,
    WalletBindRequest,
    WalletChallengeRequest,
    WalletUnbindRequest,
    WalletVerifyRequest,
)

# ---------------------------------------------------------------------------
# Auth guards — imported from web.auth.guards, wrappers for account_db
# ---------------------------------------------------------------------------
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT  # noqa: E402

import web.auth.guards as _auth_guards  # noqa: E402

# Auth config flags — defined directly here so tests can monkeypatch web.core
_SUPABASE_AUTH_REQUIRED = _auth_guards._env_bool(
    "POLYWEATHER_AUTH_REQUIRED",
    SUPABASE_ENTITLEMENT.enabled,
)
_ENTITLEMENT_GUARD_ENABLED = _auth_guards._env_bool("POLYWEATHER_REQUIRE_ENTITLEMENT", False)
_ENTITLEMENT_TOKEN = (os.getenv("POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN") or "").strip()


def _legacy_service_token_valid(request):
    return _auth_guards._legacy_service_token_valid(request)


def _bind_forwarded_supabase_identity(request):
    return _auth_guards._bind_forwarded_supabase_identity(request)


def _bind_optional_supabase_identity(request):
    return _auth_guards._bind_optional_supabase_identity(request)


def _resolve_auth_points(request):
    return _auth_guards._resolve_auth_points(request, account_db=_account_db)


def _resolve_weekly_profile(request):
    return _auth_guards._resolve_weekly_profile(request, account_db=_account_db)


def _assert_entitlement(request):
    return _auth_guards._assert_entitlement(request)


def _require_supabase_identity(request):
    return _auth_guards._require_supabase_identity(request)


def _require_ops_admin(request):
    return _auth_guards._require_ops_admin(request)


# ---------------------------------------------------------------------------
# Diagnostics — re-exported from web.diagnostics.health
# ---------------------------------------------------------------------------
from web.diagnostics.health import (  # noqa: E402
    build_health_payload as _build_health_payload_raw,
    build_system_status_payload as _build_system_status_payload_raw,
)


def build_health_payload():
    return _build_health_payload_raw(_account_db, len(CITIES))


def build_system_status_payload():
    return _build_system_status_payload_raw(
        _account_db, _config, _weather, _cache, len(_cache), len(CITIES), CITY_REGISTRY
    )


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def _sf(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _is_excluded_model_name(model_name: str) -> bool:
    return False


# ---------------------------------------------------------------------------
# Compatibility re-exports — symbols that were accessible via web.core
# in the old monolithic module, re-exported for backward compatibility.
# ---------------------------------------------------------------------------
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402, F401
from src.data_collection.city_risk_profiles import CITY_RISK_PROFILES  # noqa: E402, F401
from src.payments import PAYMENT_CHECKOUT, PaymentCheckoutError  # noqa: E402, F401
from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT  # noqa: E402, F401
