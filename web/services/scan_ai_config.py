"""Scan terminal and AI configuration constants.

Extracted from scan_terminal_service.py to keep the module leaner.
Re-exported from the original module for backward compatibility.
"""

from __future__ import annotations

import os
import threading
from typing import Any, Dict, Optional

from src.utils.refresh_policy import SCAN_ROWS_REFRESH_SEC


_SCAN_CITY_AI_CACHE_LOCK = threading.Lock()
_SCAN_CITY_AI_CACHE: Dict[str, Dict[str, Any]] = {}


def _env_int(
    name: str,
    default: int,
    *,
    min_value: int,
    max_value: Optional[int] = None,
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = int(default)
    value = max(int(min_value), value)
    if max_value is not None:
        value = min(int(max_value), value)
    return value


SCAN_TERMINAL_PAYLOAD_TTL_SEC = min(
    SCAN_ROWS_REFRESH_SEC,
    max(10, int(os.getenv("POLYWEATHER_SCAN_TERMINAL_PAYLOAD_TTL_SEC", str(SCAN_ROWS_REFRESH_SEC)))),
)
SCAN_TERMINAL_BUILD_TIMEOUT_SEC = max(
    8,
    int(os.getenv("POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC", "120")),
)
SCAN_TERMINAL_MAX_WORKERS = _env_int(
    "POLYWEATHER_SCAN_TERMINAL_MAX_WORKERS",
    8,
    min_value=1,
    max_value=12,
)
DEFAULT_SCAN_AI_MODEL = "mimo-v2.5-pro"
DEFAULT_SCAN_AI_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
SCAN_AI_API_KEY_ENV_HINT = (
    "POLYWEATHER_SCAN_AI_API_KEY "
    "(or POLYWEATHER_MIMO_API_KEY / POLYWEATHER_DEEPSEEK_API_KEY)"
)


def _env_str(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name) or "").strip()
        if value:
            return value
    return str(default).strip()


def _scan_ai_api_key() -> str:
    return _env_str(
        "POLYWEATHER_SCAN_AI_API_KEY",
        "POLYWEATHER_MIMO_API_KEY",
        "POLYWEATHER_DEEPSEEK_API_KEY",
    )


def _infer_scan_ai_provider(base_url: str, model: str) -> str:
    text = f"{base_url} {model}".lower()
    if "xiaomimimo" in text or "mimo" in text:
        return "mimo"
    if "deepseek" in text:
        return "deepseek"
    return "openai-compatible"


def _scan_ai_provider_label(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized == "mimo":
        return "MiMo"
    if normalized == "deepseek":
        return "DeepSeek"
    return "AI provider"


SCAN_AI_MODEL = _env_str("POLYWEATHER_SCAN_AI_MODEL", default=DEFAULT_SCAN_AI_MODEL)
SCAN_CITY_AI_MODEL = _env_str(
    "POLYWEATHER_SCAN_CITY_AI_MODEL",
    "POLYWEATHER_SCAN_AI_MODEL",
    default=SCAN_AI_MODEL or DEFAULT_SCAN_AI_MODEL,
)
SCAN_AI_BASE_URL = _env_str(
    "POLYWEATHER_SCAN_AI_BASE_URL",
    "POLYWEATHER_MIMO_BASE_URL",
    "POLYWEATHER_DEEPSEEK_BASE_URL",
    default=DEFAULT_SCAN_AI_BASE_URL,
).rstrip("/")
SCAN_AI_PROVIDER = _env_str(
    "POLYWEATHER_SCAN_AI_PROVIDER",
    default=_infer_scan_ai_provider(SCAN_AI_BASE_URL, SCAN_CITY_AI_MODEL),
)
SCAN_AI_PROVIDER_LABEL = _env_str(
    "POLYWEATHER_SCAN_AI_PROVIDER_LABEL",
    default=_scan_ai_provider_label(SCAN_AI_PROVIDER),
)
SCAN_AI_ENABLED = str(
    os.getenv("POLYWEATHER_SCAN_AI_ENABLED") or "false"
).strip().lower() in {"1", "true", "yes", "on"}
SCAN_AI_TIMEOUT_SEC = _env_int(
    "POLYWEATHER_SCAN_AI_TIMEOUT_SEC",
    40,
    min_value=10,
    max_value=120,
)
SCAN_CITY_AI_TIMEOUT_SEC = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_TIMEOUT_SEC",
    30,
    min_value=10,
    max_value=120,
)
SCAN_CITY_AI_RETRY_ON_STREAM_PARSE_ERROR = str(
    os.getenv("POLYWEATHER_SCAN_CITY_AI_RETRY_ON_STREAM_PARSE_ERROR") or "false"
).strip().lower() in {"1", "true", "yes", "on"}
SCAN_AI_CACHE_TTL_SEC = max(
    30,
    int(os.getenv("POLYWEATHER_SCAN_AI_CACHE_TTL_SEC", "3600")),
)
SCAN_AI_MAX_ROWS = _env_int("POLYWEATHER_SCAN_AI_MAX_ROWS", 40, min_value=1)
SCAN_AI_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_AI_MAX_TOKENS",
    3200,
    min_value=600,
    max_value=64000,
)
SCAN_CITY_AI_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_MAX_TOKENS",
    800,
    min_value=400,
    max_value=64000,
)
SCAN_CITY_AI_STREAM_MAX_TOKENS = _env_int(
    "POLYWEATHER_SCAN_CITY_AI_STREAM_MAX_TOKENS",
    min(SCAN_CITY_AI_MAX_TOKENS, 800),
    min_value=400,
    max_value=64000,
)
