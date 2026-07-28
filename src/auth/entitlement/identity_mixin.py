from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import time
from typing import Any, Dict, List, Optional

import requests
from loguru import logger

from src.database.db_manager import DBManager


@dataclass
class SupabaseIdentity:
    user_id: str
    email: str
    points: int = 0
    created_at: Optional[str] = None


class IdentityMixin:
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

    def _service_rest_headers(self, prefer: Optional[str] = None) -> Dict[str, str]:
        headers = self._request_headers_for_service_role()
        headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _rest(
        self,
        method: str,
        table: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Any] = None,
        prefer: Optional[str] = None,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        if not self.supabase_url or not self.service_role_key:
            raise RuntimeError("supabase service role is not configured")
        status_ok = allowed_status or [200, 201, 204]
        response = requests.request(
            method=method.upper(),
            url=f"{self.supabase_url}/rest/v1/{table}",
            headers=self._service_rest_headers(prefer=prefer),
            params=params,
            json=payload,
            timeout=self.timeout_sec,
        )
        if response.status_code not in status_ok:
            detail = response.text[:350] if response.text else response.reason
            raise RuntimeError(
                f"supabase {method.upper()} {table} failed: "
                f"{response.status_code} {detail}"
            )
        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return None

    def _rpc(
        self,
        name: str,
        payload: Optional[Any] = None,
        *,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        return self._rest(
            "POST",
            f"rpc/{name}",
            payload=payload or {},
            allowed_status=allowed_status or [200],
        )

    @staticmethod
    def _looks_like_missing_rpc(exc: Exception) -> bool:
        text = str(exc).lower()
        return (
            "pgrst202" in text
            or "could not find the function" in text
            or "function public.claim_signup_trial" in text
            or "schema cache" in text
            or "404" in text
        )

    @staticmethod
    def _extract_points_from_metadata(metadata: Optional[Dict[str, object]]) -> int:
        if not isinstance(metadata, dict):
            return 0
        for key in ("points", "total_points"):
            raw = metadata.get(key)
            if raw is None:
                continue
            try:
                return max(0, int(raw))
            except Exception:
                continue
        return 0

    @staticmethod
    def _to_iso(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat()

    @staticmethod
    def _normalize_email(value: Optional[str]) -> str:
        return str(value or "").strip().lower()

    @staticmethod
    def _is_trial_subscription_row(row: Optional[Dict[str, object]]) -> bool:
        if not isinstance(row, dict):
            return False
        plan_code = str(row.get("plan_code") or "").strip().lower()
        source = str(row.get("source") or "").strip().lower()
        return "trial" in plan_code or "trial" in source

    @staticmethod
    def _is_paid_subscription_row(row: Optional[Dict[str, object]]) -> bool:
        if not isinstance(row, dict):
            return False
        if IdentityMixin._is_trial_subscription_row(row):
            return False
        source = str(row.get("source") or "").strip().lower()
        if "referral_reward" in source:
            return False
        return "payment" in source or source in {"payment_contract", "payment_manual"}

    def _telegram_user_id_for(self, user_id: str) -> Optional[int]:
        try:
            linked = DBManager().get_user_by_supabase_user_id(user_id)
            if not isinstance(linked, dict):
                return None
            telegram_id = int(linked.get("telegram_id") or 0)
            return telegram_id or None
        except Exception:
            return None

    def _active_wallet_addresses_for(self, user_id: str) -> List[str]:
        try:
            rows = self._rest(
                "GET",
                "user_wallets",
                params={
                    "select": "address",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.active",
                    "limit": "50",
                },
                allowed_status=[200],
            )
        except Exception:
            return []
        out: List[str] = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                address = str(row.get("address") or "").strip().lower()
                if address and address not in out:
                    out.append(address)
        return out

    @staticmethod
    def _event_payload(row: Dict[str, object]) -> Dict[str, object]:
        payload = row.get("payload") if isinstance(row, dict) else None
        return dict(payload) if isinstance(payload, dict) else {}

    def _fetch_entitlement_events(
        self,
        *,
        user_id: Optional[str] = None,
        action: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 1000,
    ) -> List[Dict[str, object]]:
        params: Dict[str, Any] = {
            "select": "id,user_id,action,payload,created_at",
            "order": "created_at.desc",
            "limit": str(max(1, min(int(limit or 1000), 5000))),
        }
        if user_id:
            params["user_id"] = f"eq.{user_id}"
        if action:
            params["action"] = action
        if since is not None:
            params["created_at"] = f"gte.{self._to_iso(since)}"
        rows = self._rest(
            "GET",
            "entitlement_events",
            params=params,
            allowed_status=[200],
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

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
