from __future__ import annotations
import os
import threading
import requests  # noqa: F401 — used by test monkeypatches via entitlement_module.requests
from typing import Dict

from src.auth.entitlement import (  # noqa: F401 — re-exports for backward compat
    SIGNUP_TRIAL_DAYS,
    SIGNUP_TRIAL_PLAN_CODE,
    SIGNUP_TRIAL_SOURCE,
    REFERRAL_DISCOUNT_USDC,
    REFERRAL_MONTHLY_DAY_LIMIT,
    REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC,
    REFERRAL_MONTHLY_POINTS_LIMIT,
    REFERRAL_MONTHLY_REWARD_LIMIT,
    REFERRAL_REWARD_DAYS,
    REFERRAL_REWARD_POINTS,
    AdminMixin,
    IdentityMixin,
    ReferralMixin,
    SubscriptionMixin,
    SupabaseIdentity,
    TrialMixin,
    _env_bool,
    _env_int,
    extract_bearer_token,
)


class SupabaseEntitlementService(
    ReferralMixin, SubscriptionMixin, TrialMixin,
    AdminMixin, IdentityMixin,
):
    """
    Supabase-backed authentication and entitlement checks.

    - Auth validation: /auth/v1/user with user access token.
    - Entitlement check: /rest/v1/subscriptions with service role key.
    """

    def __init__(self):
        self.enabled = _env_bool("POLYWEATHER_AUTH_ENABLED", False)
        self.require_subscription = _env_bool(
            "POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION",
            False,
        )
        self.supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        self.anon_key = str(os.getenv("SUPABASE_ANON_KEY") or "").strip()
        self.service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        self.timeout_sec = max(3, _env_int("SUPABASE_HTTP_TIMEOUT_SEC", 8))
        self.cache_ttl_sec = max(5, _env_int("SUPABASE_AUTH_CACHE_TTL_SEC", 30))
        self.sub_cache_ttl_sec = max(5, _env_int("SUPABASE_SUB_CACHE_TTL_SEC", 60))
        self._identity_cache: Dict[str, Dict[str, object]] = {}
        self._identity_cache_lock = threading.Lock()
        self._sub_cache: Dict[str, Dict[str, object]] = {}
        self._sub_cache_lock = threading.Lock()
        self._latest_subscription_cache: Dict[str, Dict[str, object]] = {}
        self._latest_subscription_cache_lock = threading.Lock()
        self._active_subscription_bool_cache: Dict[str, Dict[str, object]] = {}
        self._active_subscription_bool_cache_lock = threading.Lock()
        self._active_subscriptions_cache: Dict[str, object] = {}
        self._active_subscriptions_cache_lock = threading.Lock()
        self._auth_users_cache: Dict[str, Dict[str, object]] = {}
        self._auth_users_cache_lock = threading.Lock()


SUPABASE_ENTITLEMENT = SupabaseEntitlementService()
