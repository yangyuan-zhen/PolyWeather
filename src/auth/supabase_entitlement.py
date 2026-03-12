from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional

import requests
from loguru import logger


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def extract_bearer_token(auth_header: Optional[str]) -> str:
    if not auth_header:
        return ""
    parts = str(auth_header).strip().split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


@dataclass
class SupabaseIdentity:
    user_id: str
    email: str


class SupabaseEntitlementService:
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

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.anon_key)

    def _user_endpoint(self) -> str:
        return f"{self.supabase_url}/auth/v1/user"

    def _subscription_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/subscriptions"

    def _request_headers_for_user(self, access_token: str) -> Dict[str, str]:
        return {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

    def _request_headers_for_service_role(self) -> Dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Accept": "application/json",
        }

    def get_identity(self, access_token: str) -> Optional[SupabaseIdentity]:
        if not access_token:
            return None

        now_ts = time.time()
        with self._identity_cache_lock:
            cached = self._identity_cache.get(access_token)
            if cached and now_ts - float(cached.get("ts") or 0) < self.cache_ttl_sec:
                identity = cached.get("identity")
                if isinstance(identity, SupabaseIdentity):
                    return identity

        if not self.configured:
            return None

        try:
            response = requests.get(
                self._user_endpoint(),
                headers=self._request_headers_for_user(access_token),
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                return None
            data = response.json() if response.content else {}
            user_id = str(data.get("id") or "").strip()
            if not user_id:
                return None
            identity = SupabaseIdentity(
                user_id=user_id,
                email=str(data.get("email") or "").strip(),
            )
            with self._identity_cache_lock:
                self._identity_cache[access_token] = {
                    "identity": identity,
                    "ts": now_ts,
                }
            return identity
        except Exception as exc:
            logger.warning(f"supabase auth user check failed: {exc}")
            return None

    def _query_active_subscription(self, user_id: str) -> bool:
        if not user_id:
            return False
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return False

        now_ts = time.time()
        with self._sub_cache_lock:
            cached = self._sub_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                return bool(cached.get("active"))

        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            params = {
                "select": "id,user_id,status,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "1",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase subscription query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                active = False
            else:
                data = response.json() if response.content else []
                active = isinstance(data, list) and len(data) > 0

            with self._sub_cache_lock:
                self._sub_cache[user_id] = {
                    "active": active,
                    "ts": now_ts,
                }
            return active
        except Exception as exc:
            logger.warning(f"supabase subscription query error user_id={user_id}: {exc}")
            return False

    def has_active_subscription(
        self,
        user_id: str,
        respect_requirement: bool = True,
    ) -> bool:
        if respect_requirement and not self.require_subscription:
            return True
        return self._query_active_subscription(user_id)


SUPABASE_ENTITLEMENT = SupabaseEntitlementService()
