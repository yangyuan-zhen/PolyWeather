from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
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

    def invalidate_subscription_cache(self, user_id: str) -> None:
        key = str(user_id or "").strip()
        if not key:
            return
        with self._sub_cache_lock:
            self._sub_cache.pop(key, None)
        with self._latest_subscription_cache_lock:
            self._latest_subscription_cache.pop(key, None)
        with self._active_subscription_bool_cache_lock:
            self._active_subscription_bool_cache.pop(key, None)
        with self._active_subscriptions_cache_lock:
            self._active_subscriptions_cache.clear()

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.anon_key)

    def _user_endpoint(self) -> str:
        return f"{self.supabase_url}/auth/v1/user"

    def _subscription_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/subscriptions"

    def _entitlement_events_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/entitlement_events"

    def _profiles_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/profiles"

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
                return identity if isinstance(identity, SupabaseIdentity) else None

        if not self.configured:
            return None

        try:
            response = requests.get(
                self._user_endpoint(),
                headers=self._request_headers_for_user(access_token),
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                if response.status_code in {401, 403}:
                    with self._identity_cache_lock:
                        self._identity_cache[access_token] = {
                            "identity": None,
                            "ts": now_ts,
                        }
                return None
            data = response.json() if response.content else {}
            user_id = str(data.get("id") or "").strip()
            if not user_id:
                with self._identity_cache_lock:
                    self._identity_cache[access_token] = {
                        "identity": None,
                        "ts": now_ts,
                    }
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
        with self._active_subscription_bool_cache_lock:
            cached_bool = self._active_subscription_bool_cache.get(user_id)
            if (
                cached_bool
                and now_ts - float(cached_bool.get("ts") or 0) < self.sub_cache_ttl_sec
                and cached_bool.get("active") is False
            ):
                return None

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "plan_code,source,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "starts_at": f"lte.{now_iso}",
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
                row = None
                rows: List[Dict[str, object]] = []
            else:
                data = response.json() if response.content else []
                rows = [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
                row = rows[0] if rows else None

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

    def _query_active_subscription_rows(
        self,
        user_id: str,
        bypass_cache: bool = False,
    ) -> List[Dict[str, object]]:
        if not user_id:
            return []
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return []

        now_ts = time.time()
        if not bypass_cache:
            with self._sub_cache_lock:
                cached = self._sub_cache.get(user_id)
                if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                    rows = cached.get("rows")
                    if isinstance(rows, list):
                        return [row for row in rows if isinstance(row, dict)]

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "plan_code,source,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "100",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscription rows query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                rows: List[Dict[str, object]] = []
            else:
                data = response.json() if response.content else []
                rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

            current_row = self._pick_latest_current_subscription(rows, now=now)
            with self._sub_cache_lock:
                self._sub_cache[user_id] = {
                    "active": bool(current_row),
                    "row": current_row,
                    "rows": rows,
                    "ts": now_ts,
                }
            return rows
        except Exception as exc:
            logger.warning(f"supabase active subscription rows query error user_id={user_id}: {exc}")
            return []

    def _query_latest_subscription_any_status(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        if not user_id or not self.service_role_key:
            return None
        now_ts = time.time()
        with self._latest_subscription_cache_lock:
            cached = self._latest_subscription_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                row = cached.get("row")
                return row if isinstance(row, dict) else None
        try:
            params = {
                "select": "plan_code,starts_at,expires_at",
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
            result = row if isinstance(row, dict) else None
            with self._latest_subscription_cache_lock:
                self._latest_subscription_cache[user_id] = {
                    "row": result,
                    "ts": now_ts,
                }
            return result
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

    def _query_active_subscription(self, user_id: str) -> bool:
        if not user_id:
            return False
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return False

        now_ts = time.time()
        with self._sub_cache_lock:
            cached_detail = self._sub_cache.get(user_id)
            if cached_detail and now_ts - float(cached_detail.get("ts") or 0) < self.sub_cache_ttl_sec:
                rows = cached_detail.get("rows")
                if isinstance(rows, list):
                    return self._pick_latest_current_subscription(
                        [row for row in rows if isinstance(row, dict)]
                    ) is not None
                if "row" in cached_detail:
                    return isinstance(cached_detail.get("row"), dict)

        with self._active_subscription_bool_cache_lock:
            cached = self._active_subscription_bool_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                return bool(cached.get("active"))

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "starts_at": f"lte.{now_iso}",
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
                    "supabase active subscription bool query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                active = False
            else:
                data = response.json() if response.content else []
                rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
                active = bool(rows)

            with self._active_subscription_bool_cache_lock:
                self._active_subscription_bool_cache[user_id] = {
                    "active": bool(active),
                    "ts": now_ts,
                }
            return bool(active)
        except Exception as exc:
            logger.warning(f"supabase active subscription bool query error user_id={user_id}: {exc}")
            return False

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

    def get_subscription_window(
        self,
        user_id: str,
        respect_requirement: bool = True,
        bypass_cache: bool = False,
    ) -> Dict[str, object]:
        if respect_requirement and not self.require_subscription:
            return {}
        rows = self._query_active_subscription_rows(user_id, bypass_cache=bypass_cache)
        return self._subscription_window_from_rows(rows)

    def _subscription_window_from_rows(
        self,
        rows: List[Dict[str, object]],
    ) -> Dict[str, object]:
        if not rows:
            return {}
        now = datetime.now(timezone.utc)
        current = self._pick_latest_current_subscription(rows, now=now)
        total_expiry: Optional[datetime] = None
        current_expiry: Optional[datetime] = None
        if isinstance(current, dict):
            current_expiry = self._parse_iso_datetime(str(current.get("expires_at") or ""))

        queued_count = 0
        for row in rows:
            exp = self._parse_iso_datetime(str(row.get("expires_at") or ""))
            if exp is not None and (total_expiry is None or exp > total_expiry):
                total_expiry = exp
            if current_expiry is not None:
                starts = self._parse_iso_datetime(str(row.get("starts_at") or ""))
                if starts is not None and starts >= current_expiry and row is not current:
                    queued_count += 1

        queued_days = 0
        if total_expiry is not None and current_expiry is not None and total_expiry > current_expiry:
            queued_days = max(
                0,
                int(round((total_expiry - current_expiry).total_seconds() / 86_400)),
            )

        return {
            "current": current,
            "current_expires_at": current.get("expires_at") if isinstance(current, dict) else None,
            "current_starts_at": current.get("starts_at") if isinstance(current, dict) else None,
            "total_expires_at": total_expiry.isoformat() if total_expiry else None,
            "queued_days": queued_days,
            "queued_count": queued_count,
            "rows": rows,
        }

    def list_subscription_windows(
        self,
        user_ids: List[str],
        bypass_cache: bool = False,
    ) -> Dict[str, Dict[str, object]]:
        keys: List[str] = []
        for item in user_ids or []:
            key = str(item or "").strip().lower()
            if key and key not in keys:
                keys.append(key)
        if not keys:
            return {}

        out: Dict[str, Dict[str, object]] = {}
        if not bypass_cache:
            missing: List[str] = []
            now_ts = time.time()
            with self._sub_cache_lock:
                for key in keys:
                    cached = self._sub_cache.get(key)
                    if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                        rows = cached.get("rows")
                        if isinstance(rows, list):
                            out[key] = self._subscription_window_from_rows(
                                [row for row in rows if isinstance(row, dict)]
                            )
                            continue
                    missing.append(key)
            keys = missing
            if not keys:
                return out

        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return out

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,source,starts_at,expires_at",
                "user_id": f"in.({','.join(keys)})",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "user_id.asc,expires_at.desc",
                "limit": str(max(1, min(len(keys) * 20, 1000))),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase subscription window batch query failed users={} status={}",
                    len(keys),
                    response.status_code,
                )
                return out

            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            grouped: Dict[str, List[Dict[str, object]]] = {key: [] for key in keys}
            for row in rows:
                key = str(row.get("user_id") or "").strip().lower()
                if key in grouped:
                    grouped[key].append(row)

            now_ts = time.time()
            with self._sub_cache_lock:
                for key, user_rows in grouped.items():
                    current_row = self._pick_latest_current_subscription(user_rows, now=now)
                    self._sub_cache[key] = {
                        "active": bool(current_row),
                        "row": current_row,
                        "rows": user_rows,
                        "ts": now_ts,
                    }
                    out[key] = self._subscription_window_from_rows(user_rows)
            return out
        except Exception as exc:
            logger.warning(f"supabase subscription window batch query error users={len(keys)}: {exc}")
            return out

    def list_active_subscription_windows(self, limit: int = 200) -> Dict[str, object]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return {"subscriptions": [], "windows": {}}
        safe_limit = max(1, min(int(limit or 200), 1000))
        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,source,starts_at,expires_at",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "user_id.asc,expires_at.desc",
                "limit": str(max(1, min(safe_limit * 20, 5000))),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscription window query failed status={}",
                    response.status_code,
                )
                return {"subscriptions": [], "windows": {}}
            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            grouped: Dict[str, List[Dict[str, object]]] = {}
            for row in rows:
                key = str(row.get("user_id") or "").strip().lower()
                if key:
                    grouped.setdefault(key, []).append(row)

            windows: Dict[str, Dict[str, object]] = {}
            current_rows: List[Dict[str, object]] = []
            now_ts = time.time()
            with self._sub_cache_lock:
                for key, user_rows in grouped.items():
                    current_row = self._pick_latest_current_subscription(user_rows, now=now)
                    self._sub_cache[key] = {
                        "active": bool(current_row),
                        "row": current_row,
                        "rows": user_rows,
                        "ts": now_ts,
                    }
                    windows[key] = self._subscription_window_from_rows(user_rows)
                    if isinstance(current_row, dict):
                        current_rows.append(current_row)
            current_rows.sort(key=lambda row: str(row.get("expires_at") or ""))
            current_rows = current_rows[:safe_limit]
            with self._active_subscriptions_cache_lock:
                self._active_subscriptions_cache[str(safe_limit)] = {
                    "rows": current_rows,
                    "ts": now_ts,
                }
            return {"subscriptions": current_rows, "windows": windows}
        except Exception as exc:
            logger.warning(f"supabase active subscription window query error: {exc}")
            return {"subscriptions": [], "windows": {}}

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
        safe_limit = max(1, min(int(limit or 200), 1000))
        cache_key = str(safe_limit)
        now_ts = time.time()
        with self._active_subscriptions_cache_lock:
            cached = self._active_subscriptions_cache.get(cache_key)
            if isinstance(cached, dict) and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                rows = cached.get("rows")
                if isinstance(rows, list):
                    return [row for row in rows if isinstance(row, dict)]
        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,starts_at,expires_at",
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
            rows = [
                row
                for row in data
                if isinstance(row, dict) and self._is_subscription_started(row, now=now)
            ]
            with self._active_subscriptions_cache_lock:
                self._active_subscriptions_cache[cache_key] = {
                    "rows": rows,
                    "ts": now_ts,
                }
            return rows
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
        now_ts = time.time()
        missing_keys: List[str] = []
        with self._auth_users_cache_lock:
            for key in keys:
                cached = self._auth_users_cache.get(key)
                if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                    user = cached.get("user")
                    if isinstance(user, dict):
                        out[key] = dict(user)
                        continue
                missing_keys.append(key)
        keys = missing_keys
        if not keys:
            return out

        profile_users = self._get_profile_users(keys)
        if profile_users:
            self._remember_auth_users(profile_users)
            out.update(profile_users)
        keys = [key for key in keys if key not in out]
        if not keys:
            return out

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
                self._remember_auth_users({user_id: out[user_id]})
            except Exception as exc:
                logger.warning(f"supabase admin user query error user_id={user_id}: {exc}")
        return out

    def _remember_auth_users(self, users: Dict[str, Dict[str, object]]) -> None:
        if not users:
            return
        now_ts = time.time()
        with self._auth_users_cache_lock:
            for raw_key, user in users.items():
                key = str(raw_key or "").strip().lower()
                if key and isinstance(user, dict):
                    self._auth_users_cache[key] = {
                        "user": dict(user),
                        "ts": now_ts,
                    }
            if len(self._auth_users_cache) > 4096:
                oldest_keys = sorted(
                    self._auth_users_cache,
                    key=lambda key: float(
                        self._auth_users_cache[key].get("ts") or 0.0
                    ),
                )
                for key in oldest_keys[: len(self._auth_users_cache) - 4096]:
                    self._auth_users_cache.pop(key, None)

    def _get_profile_users(self, user_ids: List[str]) -> Dict[str, Dict[str, object]]:
        if not user_ids or not self.service_role_key:
            return {}
        try:
            response = requests.get(
                self._profiles_endpoint(),
                headers=self._request_headers_for_service_role(),
                params={
                    "select": "id,email,created_at",
                    "id": f"in.({','.join(user_ids)})",
                    "limit": str(max(1, min(len(user_ids), 1000))),
                },
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase profile users batch query failed users={} status={}",
                    len(user_ids),
                    response.status_code,
                )
                return {}
            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            out: Dict[str, Dict[str, object]] = {}
            for row in rows:
                user_id = str(row.get("id") or "").strip().lower()
                if not user_id:
                    continue
                out[user_id] = {
                    "email": str(row.get("email") or "").strip(),
                    "created_at": row.get("created_at"),
                }
            return out
        except Exception as exc:
            logger.warning(f"supabase profile users batch query error users={len(user_ids)}: {exc}")
            return {}


SUPABASE_ENTITLEMENT = SupabaseEntitlementService()
