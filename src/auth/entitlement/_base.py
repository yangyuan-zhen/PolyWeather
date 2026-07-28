from __future__ import annotations

import os
from typing import Optional

SIGNUP_TRIAL_PLAN_CODE = "signup_trial_3d"
SIGNUP_TRIAL_SOURCE = "signup_trial"
SIGNUP_TRIAL_DAYS = 3

REFERRAL_REWARD_DAYS = 0
REFERRAL_MONTHLY_REWARD_LIMIT = 10
REFERRAL_MONTHLY_DAY_LIMIT = 30
REFERRAL_REWARD_POINTS = 3500
REFERRAL_MONTHLY_POINTS_LIMIT = REFERRAL_REWARD_POINTS * REFERRAL_MONTHLY_REWARD_LIMIT
REFERRAL_DISCOUNT_USDC = "9.9"
REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC = "20"


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip()
    if not raw:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip()
    if not raw:
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        return default


def extract_bearer_token(auth_header: Optional[str]) -> str:
    if not auth_header:
        return ""
    for prefix in ("Bearer ", "bearer "):
        if auth_header.startswith(prefix):
            token = auth_header[len(prefix) :].strip()
            if token:
                return token
    return ""
