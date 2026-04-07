from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

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
    points: int = 0
    created_at: Optional[str] = None


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
        self.signup_trial_enabled = _env_bool(
            "POLYWEATHER_SIGNUP_TRIAL_ENABLED",
            True,
        )
        self.signup_trial_days = max(
            0,
            _env_int("POLYWEATHER_SIGNUP_TRIAL_DAYS", 3),
        )
        self.signup_trial_plan_code = str(
            os.getenv("POLYWEATHER_SIGNUP_TRIAL_PLAN_CODE") or "signup_trial_3d"
        ).strip() or "signup_trial_3d"
        self.signup_trial_source = str(
            os.getenv("POLYWEATHER_SIGNUP_TRIAL_SOURCE") or "signup_trial"
        ).strip() or "signup_trial"

        self._identity_cache: Dict[str, Dict[str, object]] = {}
        self._identity_cache_lock = threading.Lock()
        self._sub_cache: Dict[str, Dict[str, object]] = {}
        self._sub_cache_lock = threading.Lock()
        self._trial_locks: Dict[str, threading.Lock] = {}
        self._trial_locks_guard = threading.Lock()

    def invalidate_subscription_cache(self, user_id: str) -> None:
        key = str(user_id or "").strip()
        if not key:
            return
        with self._sub_cache_lock:
            self._sub_cache.pop(key, None)

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.anon_key)

    def _user_endpoint(self) -> str:
        return f"{self.supabase_url}/auth/v1/user"

    def _subscription_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/subscriptions"

    def _entitlement_events_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/entitlement_events"

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

    def _admin_user_endpoint(self, user_id: str) -> str:
        return f"{self.supabase_url}/auth/v1/admin/users/{user_id}"

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
            
            # Extract points from user_metadata
            metadata = data.get("user_metadata") or {}
            points = int(metadata.get("points") or metadata.get("total_points") or 0)

            identity = SupabaseIdentity(
                user_id=user_id,
                email=str(data.get("email") or "").strip(),
                points=points,
                created_at=str(data.get("created_at") or "").strip() or None,
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
        except Exception as exc:
            logger.warning(f"supabase auth user check failed: {exc}")
            return None

    def _query_latest_active_subscription(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        if not user_id:
            return None
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return None

        now_ts = time.time()
        with self._sub_cache_lock:
            cached = self._sub_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                row = cached.get("row")
                if isinstance(row, dict):
                    return row
                return None

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "id,user_id,status,plan_code,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "20",
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
                row = None
            else:
                data = response.json() if response.content else []
                row = self._pick_latest_current_subscription(data, now=now)

            with self._sub_cache_lock:
                self._sub_cache[user_id] = {
                    "active": bool(row),
                    "row": row,
                    "ts": now_ts,
                }
            return row
        except Exception as exc:
            logger.warning(f"supabase subscription query error user_id={user_id}: {exc}")
            return None

    def _query_latest_subscription_any_status(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        if not user_id or not self.service_role_key:
            return None
        try:
            params = {
                "select": "id,user_id,status,plan_code,starts_at,expires_at,source,created_at,updated_at",
                "user_id": f"eq.{user_id}",
                "order": "created_at.desc",
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
                    "supabase subscription history query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                return None
            data = response.json() if response.content else []
            row = data[0] if isinstance(data, list) and data else None
            return row if isinstance(row, dict) else None
        except Exception as exc:
            logger.warning(f"supabase subscription history query error user_id={user_id}: {exc}")
            return None

    @staticmethod
    def _parse_iso_datetime(raw: Optional[str]) -> Optional[datetime]:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _is_subscription_started(
        self,
        row: Optional[Dict[str, object]],
        *,
        now: Optional[datetime] = None,
    ) -> bool:
        if not isinstance(row, dict):
            return False
        starts_at = self._parse_iso_datetime(str(row.get("starts_at") or ""))
        if starts_at is None:
            return True
        current = now or datetime.now(timezone.utc)
        return starts_at <= current

    def _pick_latest_current_subscription(
        self,
        rows: object,
        *,
        now: Optional[datetime] = None,
    ) -> Optional[Dict[str, object]]:
        if not isinstance(rows, list):
            return None
        current = now or datetime.now(timezone.utc)
        for row in rows:
            if isinstance(row, dict) and self._is_subscription_started(row, now=current):
                return row
        return None

    def _get_trial_lock(self, user_id: str) -> threading.Lock:
        key = str(user_id or "").strip()
        with self._trial_locks_guard:
            lock = self._trial_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._trial_locks[key] = lock
            return lock

    def _emit_signup_trial_event(
        self,
        *,
        user_id: str,
        starts_at: datetime,
        expires_at: datetime,
    ) -> None:
        if not self.service_role_key:
            return
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            requests.post(
                self._entitlement_events_endpoint(),
                headers={
                    **self._request_headers_for_service_role(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "user_id": user_id,
                    "action": "subscription_granted",
                    "reason": "signup_trial",
                    "detail": f"{self.signup_trial_days}d signup trial granted",
                    "payload": {
                        "plan_code": self.signup_trial_plan_code,
                        "source": self.signup_trial_source,
                        "starts_at": starts_at.isoformat(),
                        "expires_at": expires_at.isoformat(),
                    },
                    "created_at": now_iso,
                },
                timeout=self.timeout_sec,
            )
        except Exception as exc:
            logger.warning(f"supabase signup trial event insert failed user_id={user_id}: {exc}")

    def ensure_signup_trial(
        self,
        user_id: str,
        *,
        created_at: Optional[str] = None,
    ) -> Optional[Dict[str, object]]:
        normalized_user_id = str(user_id or "").strip()
        if not normalized_user_id:
            return None
        if (
            not self.signup_trial_enabled
            or self.signup_trial_days <= 0
            or not self.service_role_key
        ):
            return None

        lock = self._get_trial_lock(normalized_user_id)
        with lock:
            existing_active = self._query_latest_active_subscription(normalized_user_id)
            if isinstance(existing_active, dict):
                return existing_active

            existing_any = self._query_latest_subscription_any_status(normalized_user_id)
            if isinstance(existing_any, dict):
                return None

            starts_at = self._parse_iso_datetime(created_at)
            if starts_at is None:
                admin_users = self.get_auth_users([normalized_user_id])
                starts_at = self._parse_iso_datetime(
                    str((admin_users.get(normalized_user_id) or {}).get("created_at") or "")
                )
            if starts_at is None:
                return None

            expires_at = starts_at + timedelta(days=self.signup_trial_days)
            now = datetime.now(timezone.utc)
            if expires_at <= now:
                return None

            payload = {
                "user_id": normalized_user_id,
                "plan_code": self.signup_trial_plan_code,
                "status": "active",
                "starts_at": starts_at.isoformat(),
                "expires_at": expires_at.isoformat(),
                "source": self.signup_trial_source,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
            try:
                response = requests.post(
                    self._subscription_endpoint(),
                    headers={
                        **self._request_headers_for_service_role(),
                        "Content-Type": "application/json",
                        "Prefer": "return=representation",
                    },
                    json=payload,
                    timeout=self.timeout_sec,
                )
                if response.status_code not in (200, 201):
                    logger.warning(
                        "supabase signup trial insert failed user_id={} status={}",
                        normalized_user_id,
                        response.status_code,
                    )
                    return self._query_latest_active_subscription(normalized_user_id)
                rows = response.json() if response.content else []
                row = rows[0] if isinstance(rows, list) and rows else None
                self.invalidate_subscription_cache(normalized_user_id)
                self._emit_signup_trial_event(
                    user_id=normalized_user_id,
                    starts_at=starts_at,
                    expires_at=expires_at,
                )
                if isinstance(row, dict):
                    return row
                return self._query_latest_active_subscription(normalized_user_id)
            except Exception as exc:
                logger.warning(f"supabase signup trial insert error user_id={normalized_user_id}: {exc}")
                return self._query_latest_active_subscription(normalized_user_id)

    def _query_active_subscription(self, user_id: str) -> bool:
        return self._query_latest_active_subscription(user_id) is not None

    def get_latest_active_subscription(
        self,
        user_id: str,
        respect_requirement: bool = True,
    ) -> Optional[Dict[str, object]]:
        if respect_requirement and not self.require_subscription:
            return None
        return self._query_latest_active_subscription(user_id)

    def get_latest_subscription_any_status(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        return self._query_latest_subscription_any_status(user_id)

    def has_active_subscription(
        self,
        user_id: str,
        respect_requirement: bool = True,
    ) -> bool:
        if respect_requirement and not self.require_subscription:
            return True
        return self._query_active_subscription(user_id)

    def list_active_subscriptions(self, limit: int = 200) -> List[Dict[str, object]]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return []
        try:
            now = datetime.now(timezone.utc)
            safe_limit = max(1, min(int(limit or 200), 1000))
            now_iso = now.isoformat()
            params = {
                "select": "id,user_id,status,plan_code,starts_at,expires_at",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.asc",
                "limit": str(safe_limit),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscriptions query failed status={}",
                    response.status_code,
                )
                return []
            data = response.json() if response.content else []
            if not isinstance(data, list):
                return []
            return [
                row
                for row in data
                if isinstance(row, dict) and self._is_subscription_started(row, now=now)
            ]
        except Exception as exc:
            logger.warning(f"supabase active subscriptions query error: {exc}")
            return []

    def get_auth_users(self, user_ids: List[str]) -> Dict[str, Dict[str, object]]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return {}

        keys = []
        for item in user_ids or []:
            key = str(item or "").strip().lower()
            if key and key not in keys:
                keys.append(key)
        if not keys:
            return {}

        out: Dict[str, Dict[str, object]] = {}
        for user_id in keys:
            try:
                response = requests.get(
                    self._admin_user_endpoint(user_id),
                    headers=self._request_headers_for_service_role(),
                    timeout=self.timeout_sec,
                )
                if response.status_code != 200:
                    logger.warning(
                        "supabase admin user query failed user_id={} status={}",
                        user_id,
                        response.status_code,
                    )
                    continue
                raw = response.json() if response.content else {}
                payload = raw.get("user") if isinstance(raw, dict) and isinstance(raw.get("user"), dict) else raw
                if not isinstance(payload, dict):
                    continue
                out[user_id] = {
                    "email": str(payload.get("email") or "").strip(),
                    "created_at": payload.get("created_at"),
                }
            except Exception as exc:
                logger.warning(f"supabase admin user query error user_id={user_id}: {exc}")
        return out


SUPABASE_ENTITLEMENT = SupabaseEntitlementService()
