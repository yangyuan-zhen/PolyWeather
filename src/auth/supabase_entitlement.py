from __future__ import annotations

import os
import secrets
import hashlib
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from loguru import logger

from src.database.db_manager import DBManager

SIGNUP_TRIAL_PLAN_CODE = "signup_trial_3d"
SIGNUP_TRIAL_SOURCE = "signup_trial"
SIGNUP_TRIAL_DAYS = 3

REFERRAL_REWARD_DAYS = 3
REFERRAL_MONTHLY_REWARD_LIMIT = 10
REFERRAL_MONTHLY_DAY_LIMIT = 30
REFERRAL_DISCOUNT_USDC = "3"
REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC = "26.9"


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

    def _admin_user_endpoint(self, user_id: str) -> str:
        return f"{self.supabase_url}/auth/v1/admin/users/{user_id}"

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
        if SupabaseEntitlementService._is_trial_subscription_row(row):
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

    def _trial_claim_exists_in_events(
        self,
        *,
        user_id: str,
        email: str,
        telegram_user_id: Optional[int],
        wallet_addresses: List[str],
    ) -> bool:
        try:
            rows = self._fetch_entitlement_events(
                action="eq.signup_trial_claimed",
                limit=2000,
            )
        except Exception:
            return False
        wallet_set = {
            str(address or "").strip().lower()
            for address in wallet_addresses
            if str(address or "").strip()
        }
        for row in rows:
            payload = self._event_payload(row)
            if str(row.get("user_id") or payload.get("user_id") or "").strip() == user_id:
                return True
            if email and str(payload.get("email") or "").strip().lower() == email:
                return True
            if telegram_user_id and str(payload.get("telegram_user_id") or "") == str(telegram_user_id):
                return True
            event_wallets = payload.get("wallet_addresses")
            if isinstance(event_wallets, list):
                event_wallet_set = {
                    str(address or "").strip().lower()
                    for address in event_wallets
                    if str(address or "").strip()
                }
                if wallet_set and wallet_set.intersection(event_wallet_set):
                    return True
        return False

    def _record_signup_trial_claim_event(
        self,
        *,
        user_id: str,
        email: str,
        telegram_user_id: Optional[int],
        wallet_addresses: List[str],
        claimed_at: datetime,
    ) -> None:
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": user_id,
                "action": "signup_trial_claimed",
                "reason": "trial_dedupe",
                "actor": "supabase_auth",
                "payload": {
                    "user_id": user_id,
                    "email": email,
                    "telegram_user_id": telegram_user_id,
                    "wallet_addresses": wallet_addresses,
                    "claimed_at": self._to_iso(claimed_at),
                    "storage": "entitlement_events",
                },
                "created_at": self._to_iso(claimed_at),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )

    def _trial_claim_exists(
        self,
        *,
        user_id: str,
        email: str,
        telegram_user_id: Optional[int],
        wallet_addresses: List[str],
    ) -> bool:
        checks = [f"user_id.eq.{user_id}"]
        if email:
            checks.append(f"email.eq.{email}")
        if telegram_user_id:
            checks.append(f"telegram_user_id.eq.{telegram_user_id}")
        try:
            rows = self._rest(
                "GET",
                "trial_claims",
                params={
                    "select": "id",
                    "or": f"({','.join(checks)})",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(rows, list) and rows:
                return True
        except Exception:
            return self._trial_claim_exists_in_events(
                user_id=user_id,
                email=email,
                telegram_user_id=telegram_user_id,
                wallet_addresses=wallet_addresses,
            )

        if not wallet_addresses:
            return False
        try:
            wallet_rows = self._rest(
                "GET",
                "trial_claim_wallets",
                params={
                    "select": "id",
                    "wallet_address": f"in.({','.join(wallet_addresses)})",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            return bool(isinstance(wallet_rows, list) and wallet_rows)
        except Exception:
            return False

    def ensure_signup_trial(self, user_id: str, email: Optional[str] = None) -> Dict[str, object]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return {"created": False, "reason": "missing_user_id"}
        if not _env_bool("POLYWEATHER_SIGNUP_TRIAL_ENABLED", True):
            return {"created": False, "reason": "disabled"}
        if not self.supabase_url or not self.service_role_key:
            return {"created": False, "reason": "supabase_not_configured"}

        normalized_email = self._normalize_email(email)
        try:
            telegram_user_id = self._telegram_user_id_for(user_key)
            wallet_addresses = self._active_wallet_addresses_for(user_key)
            if self._trial_claim_exists(
                user_id=user_key,
                email=normalized_email,
                telegram_user_id=telegram_user_id,
                wallet_addresses=wallet_addresses,
            ):
                return {"created": False, "reason": "already_claimed"}

            now = datetime.now(timezone.utc)
            expires = now + timedelta(days=SIGNUP_TRIAL_DAYS)
            claim_payload = {
                "user_id": user_key,
                "email": normalized_email,
                "telegram_user_id": telegram_user_id,
                "primary_wallet_address": wallet_addresses[0] if wallet_addresses else None,
                "claimed_at": self._to_iso(now),
                "metadata": {"wallet_addresses": wallet_addresses},
            }
            claim_id = None
            try:
                claim_rows = self._rest(
                    "POST",
                    "trial_claims",
                    payload=claim_payload,
                    prefer="return=representation",
                    allowed_status=[200, 201],
                )
                if isinstance(claim_rows, list) and claim_rows and isinstance(claim_rows[0], dict):
                    claim_id = claim_rows[0].get("id")
            except Exception:
                self._record_signup_trial_claim_event(
                    user_id=user_key,
                    email=normalized_email,
                    telegram_user_id=telegram_user_id,
                    wallet_addresses=wallet_addresses,
                    claimed_at=now,
                )
            if wallet_addresses and claim_id is not None:
                try:
                    self._rest(
                        "POST",
                        "trial_claim_wallets",
                        payload=[
                            {
                                "trial_claim_id": claim_id,
                                "wallet_address": address,
                                "created_at": self._to_iso(now),
                            }
                            for address in wallet_addresses
                        ],
                        prefer="return=minimal",
                        allowed_status=[201],
                    )
                except Exception:
                    self._record_signup_trial_claim_event(
                        user_id=user_key,
                        email=normalized_email,
                        telegram_user_id=telegram_user_id,
                        wallet_addresses=wallet_addresses,
                        claimed_at=now,
                    )

            subscription_payload = {
                "user_id": user_key,
                "plan_code": SIGNUP_TRIAL_PLAN_CODE,
                "status": "active",
                "starts_at": self._to_iso(now),
                "expires_at": self._to_iso(expires),
                "source": SIGNUP_TRIAL_SOURCE,
                "created_at": self._to_iso(now),
                "updated_at": self._to_iso(now),
            }
            self._rest(
                "POST",
                "subscriptions",
                payload=subscription_payload,
                prefer="return=minimal",
                allowed_status=[201],
            )
            self._rest(
                "POST",
                "entitlement_events",
                payload={
                    "user_id": user_key,
                    "action": "signup_trial_granted",
                    "reason": "first_auth",
                    "actor": "supabase_auth",
                    "payload": {
                        "plan_code": SIGNUP_TRIAL_PLAN_CODE,
                        "expires_at": self._to_iso(expires),
                    },
                    "created_at": self._to_iso(now),
                },
                prefer="return=minimal",
                allowed_status=[201],
            )
            self.invalidate_subscription_cache(user_key)
            return {
                "created": True,
                "plan_code": SIGNUP_TRIAL_PLAN_CODE,
                "expires_at": self._to_iso(expires),
            }
        except Exception as exc:
            logger.warning("signup trial grant failed user_id={}: {}", user_key, exc)
            return {"created": False, "reason": "error"}

    def has_paid_subscription(self, user_id: str) -> bool:
        user_key = str(user_id or "").strip()
        if not user_key:
            return False
        try:
            rows = self._rest(
                "GET",
                "subscriptions",
                params={
                    "select": "plan_code,source,status,starts_at,expires_at",
                    "user_id": f"eq.{user_key}",
                    "limit": "100",
                },
                allowed_status=[200],
            )
        except Exception:
            return False
        if not isinstance(rows, list):
            return False
        return any(self._is_paid_subscription_row(row) for row in rows if isinstance(row, dict))

    @staticmethod
    def _normalize_referral_code(value: Optional[str]) -> str:
        return "".join(str(value or "").strip().upper().split())

    @staticmethod
    def _fallback_referral_code_for(user_id: str) -> str:
        digest = hashlib.sha256(
            f"polyweather-referral-v1:{user_id}".encode("utf-8")
        ).hexdigest()
        return f"PW{digest[:8].upper()}"

    def _find_referrer_by_fallback_code(self, code: str) -> Optional[str]:
        normalized_code = self._normalize_referral_code(code)
        try:
            rows = self._rest(
                "GET",
                "profiles",
                params={
                    "select": "id",
                    "order": "created_at.asc",
                    "limit": "5000",
                },
                allowed_status=[200],
            )
        except Exception:
            return None
        if not isinstance(rows, list):
            return None
        for row in rows:
            if not isinstance(row, dict):
                continue
            candidate = str(row.get("id") or "").strip()
            if candidate and self._fallback_referral_code_for(candidate) == normalized_code:
                return candidate
        return None

    def _find_referrer_for_referral_code(self, code: str) -> Optional[str]:
        normalized_code = self._normalize_referral_code(code)
        try:
            rows = self._rest(
                "GET",
                "referral_codes",
                params={
                    "select": "user_id,code,status",
                    "code": f"eq.{normalized_code}",
                    "status": "eq.active",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                referrer_user_id = str(rows[0].get("user_id") or "").strip()
                if referrer_user_id:
                    return referrer_user_id
        except Exception:
            pass
        return self._find_referrer_by_fallback_code(normalized_code)

    def ensure_referral_code(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key or not self.service_role_key:
            return None
        try:
            rows = self._rest(
                "GET",
                "referral_codes",
                params={
                    "select": "code,status,created_at",
                    "user_id": f"eq.{user_key}",
                    "status": "eq.active",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                return rows[0]
            now = datetime.now(timezone.utc)
            for _ in range(5):
                code = f"PW{secrets.token_hex(4).upper()}"
                try:
                    created = self._rest(
                        "POST",
                        "referral_codes",
                        payload={
                            "user_id": user_key,
                            "code": code,
                            "status": "active",
                            "created_at": self._to_iso(now),
                            "updated_at": self._to_iso(now),
                        },
                        prefer="return=representation",
                        allowed_status=[200, 201],
                    )
                    if isinstance(created, list) and created and isinstance(created[0], dict):
                        return created[0]
                    return {"code": code, "status": "active"}
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("referral code ensure failed user_id={}: {}", user_key, exc)
        return {
            "code": self._fallback_referral_code_for(user_key),
            "status": "active",
            "storage": "derived",
        }

    def _get_event_referral_attribution(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return None
        try:
            rows = self._fetch_entitlement_events(
                user_id=user_key,
                action="in.(referral_attribution_created,referral_attribution_converted,referral_attribution_capped)",
                limit=50,
            )
        except Exception:
            return None
        for row in rows:
            action = str(row.get("action") or "").strip()
            payload = self._event_payload(row)
            if str(payload.get("referred_user_id") or row.get("user_id") or "").strip() != user_key:
                continue
            if action in {"referral_attribution_converted", "referral_attribution_capped"}:
                return None
            if action == "referral_attribution_created":
                return {
                    "id": payload.get("id") or row.get("id"),
                    "code": str(payload.get("code") or "").strip().upper(),
                    "referrer_user_id": str(payload.get("referrer_user_id") or "").strip(),
                    "referred_user_id": user_key,
                    "status": "pending",
                    "created_at": row.get("created_at"),
                    "_storage": "entitlement_events",
                }
        return None

    def _record_referral_attribution_event(
        self,
        *,
        referrer_user_id: str,
        referred_user_id: str,
        code: str,
        created_at: datetime,
    ) -> Dict[str, object]:
        attribution = {
            "id": f"event:{referred_user_id}:{self._normalize_referral_code(code)}",
            "code": self._normalize_referral_code(code),
            "referrer_user_id": referrer_user_id,
            "referred_user_id": referred_user_id,
            "status": "pending",
            "created_at": self._to_iso(created_at),
            "_storage": "entitlement_events",
        }
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": referred_user_id,
                "action": "referral_attribution_created",
                "reason": "invite_code",
                "actor": "account_center",
                "payload": attribution,
                "created_at": self._to_iso(created_at),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        return attribution

    def get_pending_referral_attribution(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return None
        try:
            rows = self._rest(
                "GET",
                "referral_attributions",
                params={
                    "select": "id,code,referrer_user_id,referred_user_id,status,created_at",
                    "referred_user_id": f"eq.{user_key}",
                    "status": "eq.pending",
                    "order": "created_at.desc",
                    "limit": "1",
                },
                allowed_status=[200],
            )
        except Exception:
            return self._get_event_referral_attribution(user_key)
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return rows[0]
        return self._get_event_referral_attribution(user_key)

    def _current_month_reward_rows(self, referrer_user_id: str) -> List[Dict[str, object]]:
        month_start = datetime.now(timezone.utc).replace(
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        try:
            rows = self._rest(
                "GET",
                "referral_rewards",
                params={
                    "select": "id,reward_days,created_at",
                    "referrer_user_id": f"eq.{referrer_user_id}",
                    "created_at": f"gte.{self._to_iso(month_start)}",
                    "limit": "100",
                },
                allowed_status=[200],
            )
        except Exception:
            return self._current_month_reward_event_rows(referrer_user_id, month_start)
        table_rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
        if table_rows:
            return table_rows
        return self._current_month_reward_event_rows(referrer_user_id, month_start)

    def _current_month_reward_event_rows(
        self,
        referrer_user_id: str,
        month_start: datetime,
    ) -> List[Dict[str, object]]:
        try:
            rows = self._fetch_entitlement_events(
                user_id=referrer_user_id,
                action="eq.referral_reward_granted",
                since=month_start,
                limit=100,
            )
        except Exception:
            return []
        out: List[Dict[str, object]] = []
        for row in rows:
            payload = self._event_payload(row)
            out.append(
                {
                    "id": row.get("id"),
                    "reward_days": int(payload.get("reward_days") or REFERRAL_REWARD_DAYS),
                    "created_at": row.get("created_at"),
                    "_storage": "entitlement_events",
                }
            )
        return out

    def get_referral_summary(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key or not self.service_role_key:
            return None
        try:
            code_row = self.ensure_referral_code(user_key) or {}
            pending = self.get_pending_referral_attribution(user_key)
            rewards = self._current_month_reward_rows(user_key)
            reward_count = len(rewards)
            reward_days = sum(int(row.get("reward_days") or 0) for row in rewards)
            return {
                "code": str(code_row.get("code") or ""),
                "discount_usdc": REFERRAL_DISCOUNT_USDC,
                "discounted_monthly_amount_usdc": REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC,
                "reward_days": REFERRAL_REWARD_DAYS,
                "monthly_reward_limit": REFERRAL_MONTHLY_REWARD_LIMIT,
                "monthly_reward_days_limit": REFERRAL_MONTHLY_DAY_LIMIT,
                "monthly_reward_count": reward_count,
                "monthly_reward_days": min(reward_days, REFERRAL_MONTHLY_DAY_LIMIT),
                "applied_code": str(pending.get("code") or "") if isinstance(pending, dict) else "",
                "attribution_status": str(pending.get("status") or "") if isinstance(pending, dict) else "",
            }
        except Exception as exc:
            logger.warning("referral summary failed user_id={}: {}", user_key, exc)
            return None

    def apply_referral_code(self, user_id: str, code: str) -> Dict[str, object]:
        user_key = str(user_id or "").strip()
        normalized_code = self._normalize_referral_code(code)
        if not user_key:
            raise ValueError("user_id required")
        if len(normalized_code) < 3:
            raise ValueError("invalid referral code")
        if self.has_paid_subscription(user_key):
            raise ValueError("referral code can only be used before first paid subscription")

        referrer_user_id = self._find_referrer_for_referral_code(normalized_code)
        if not referrer_user_id:
            raise ValueError("referral code not found")
        if not referrer_user_id or referrer_user_id == user_key:
            raise ValueError("cannot use your own referral code")

        existing = self.get_pending_referral_attribution(user_key)
        if isinstance(existing, dict):
            return {
                "ok": True,
                "already_applied": True,
                "referral": self.get_referral_summary(user_key),
            }

        now = datetime.now(timezone.utc)
        try:
            self._rest(
                "POST",
                "referral_attributions",
                payload={
                    "referrer_user_id": referrer_user_id,
                    "referred_user_id": user_key,
                    "code": normalized_code,
                    "status": "pending",
                    "created_at": self._to_iso(now),
                    "updated_at": self._to_iso(now),
                },
                prefer="return=minimal",
                allowed_status=[201],
            )
        except Exception:
            self._record_referral_attribution_event(
                referrer_user_id=referrer_user_id,
                referred_user_id=user_key,
                code=normalized_code,
                created_at=now,
            )
        return {
            "ok": True,
            "already_applied": False,
            "referral": self.get_referral_summary(user_key),
        }

    def _subscription_extension_start(self, user_id: str) -> datetime:
        now = datetime.now(timezone.utc)
        try:
            rows = self._rest(
                "GET",
                "subscriptions",
                params={
                    "select": "starts_at,expires_at,plan_code,source",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.active",
                    "expires_at": f"gt.{self._to_iso(now)}",
                    "order": "expires_at.desc",
                    "limit": "20",
                },
                allowed_status=[200],
            )
        except Exception:
            return now
        starts = now
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict) or self._is_trial_subscription_row(row):
                    continue
                exp = self._parse_iso_datetime(str(row.get("expires_at") or ""))
                starts_at = self._parse_iso_datetime(str(row.get("starts_at") or ""))
                if exp and (starts_at is None or starts_at <= now) and exp > starts:
                    starts = exp
                    break
        return starts

    def _record_referral_resolution_event(
        self,
        *,
        action: str,
        referrer_user_id: str,
        referred_user_id: str,
        attribution: Dict[str, object],
        payment_intent_id: str,
        tx_hash: str,
        created_at: datetime,
        reward_days: int = 0,
    ) -> None:
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": referrer_user_id if action == "referral_reward_granted" else referred_user_id,
                "action": action,
                "reason": "referred_user_paid",
                "actor": "payment_contract_checkout",
                "payload": {
                    "attribution_id": attribution.get("id"),
                    "code": attribution.get("code"),
                    "referrer_user_id": referrer_user_id,
                    "referred_user_id": referred_user_id,
                    "payment_intent_id": payment_intent_id,
                    "tx_hash": tx_hash,
                    "reward_days": reward_days,
                    "storage": "entitlement_events",
                },
                "created_at": self._to_iso(created_at),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )

    def _settle_referral_reward_with_events(
        self,
        *,
        attribution: Dict[str, object],
        referrer_user_id: str,
        referred_user_id: str,
        payment_intent_id: str,
        tx_hash: str,
        now: datetime,
        monthly_rewards: List[Dict[str, object]],
    ) -> Dict[str, object]:
        if len(monthly_rewards) >= REFERRAL_MONTHLY_REWARD_LIMIT:
            self._record_referral_resolution_event(
                action="referral_attribution_capped",
                referrer_user_id=referrer_user_id,
                referred_user_id=referred_user_id,
                attribution=attribution,
                payment_intent_id=payment_intent_id,
                tx_hash=tx_hash,
                created_at=now,
            )
            return {"awarded": False, "reason": "monthly_cap_reached"}

        starts = self._subscription_extension_start(referrer_user_id)
        expires = starts + timedelta(days=REFERRAL_REWARD_DAYS)
        subscription_payload = {
            "user_id": referrer_user_id,
            "plan_code": "pro_monthly",
            "status": "active",
            "starts_at": self._to_iso(starts),
            "expires_at": self._to_iso(expires),
            "source": "referral_reward",
            "created_at": self._to_iso(now),
            "updated_at": self._to_iso(now),
        }
        self._rest(
            "POST",
            "subscriptions",
            payload=subscription_payload,
            prefer="return=minimal",
            allowed_status=[201],
        )
        self._record_referral_resolution_event(
            action="referral_reward_granted",
            referrer_user_id=referrer_user_id,
            referred_user_id=referred_user_id,
            attribution=attribution,
            payment_intent_id=payment_intent_id,
            tx_hash=tx_hash,
            created_at=now,
            reward_days=REFERRAL_REWARD_DAYS,
        )
        self._record_referral_resolution_event(
            action="referral_attribution_converted",
            referrer_user_id=referrer_user_id,
            referred_user_id=referred_user_id,
            attribution=attribution,
            payment_intent_id=payment_intent_id,
            tx_hash=tx_hash,
            created_at=now,
            reward_days=REFERRAL_REWARD_DAYS,
        )
        self.invalidate_subscription_cache(referrer_user_id)
        return {
            "awarded": True,
            "reward_days": REFERRAL_REWARD_DAYS,
            "referrer_user_id": referrer_user_id,
            "subscription": subscription_payload,
            "storage": "entitlement_events",
        }

    def settle_referral_reward(
        self,
        *,
        referred_user_id: str,
        payment_intent_id: str,
        tx_hash: str,
    ) -> Dict[str, object]:
        referred_key = str(referred_user_id or "").strip()
        attribution = self.get_pending_referral_attribution(referred_key)
        if not isinstance(attribution, dict):
            return {"awarded": False, "reason": "no_pending_referral"}
        referrer_key = str(attribution.get("referrer_user_id") or "").strip()
        if not referrer_key or referrer_key == referred_key:
            return {"awarded": False, "reason": "invalid_referrer"}

        now = datetime.now(timezone.utc)
        monthly_rewards = self._current_month_reward_rows(referrer_key)
        if str(attribution.get("_storage") or "") == "entitlement_events":
            return self._settle_referral_reward_with_events(
                attribution=attribution,
                referrer_user_id=referrer_key,
                referred_user_id=referred_key,
                payment_intent_id=payment_intent_id,
                tx_hash=tx_hash,
                now=now,
                monthly_rewards=monthly_rewards,
            )
        if len(monthly_rewards) >= REFERRAL_MONTHLY_REWARD_LIMIT:
            self._rest(
                "PATCH",
                "referral_attributions",
                params={"id": f"eq.{attribution.get('id')}"},
                payload={
                    "status": "capped",
                    "updated_at": self._to_iso(now),
                    "converted_payment_intent_id": payment_intent_id,
                    "converted_tx_hash": tx_hash,
                },
                prefer="return=minimal",
                allowed_status=[204],
            )
            return {"awarded": False, "reason": "monthly_cap_reached"}

        starts = self._subscription_extension_start(referrer_key)
        expires = starts + timedelta(days=REFERRAL_REWARD_DAYS)
        subscription_payload = {
            "user_id": referrer_key,
            "plan_code": "pro_monthly",
            "status": "active",
            "starts_at": self._to_iso(starts),
            "expires_at": self._to_iso(expires),
            "source": "referral_reward",
            "created_at": self._to_iso(now),
            "updated_at": self._to_iso(now),
        }
        self._rest(
            "POST",
            "subscriptions",
            payload=subscription_payload,
            prefer="return=minimal",
            allowed_status=[201],
        )
        self._rest(
            "POST",
            "referral_rewards",
            payload={
                "referral_attribution_id": attribution.get("id"),
                "referrer_user_id": referrer_key,
                "referred_user_id": referred_key,
                "payment_intent_id": payment_intent_id,
                "tx_hash": tx_hash,
                "reward_days": REFERRAL_REWARD_DAYS,
                "created_at": self._to_iso(now),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        self._rest(
            "PATCH",
            "referral_attributions",
            params={"id": f"eq.{attribution.get('id')}"},
            payload={
                "status": "converted",
                "converted_payment_intent_id": payment_intent_id,
                "converted_tx_hash": tx_hash,
                "converted_at": self._to_iso(now),
                "updated_at": self._to_iso(now),
            },
            prefer="return=minimal",
            allowed_status=[204],
        )
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": referrer_key,
                "action": "referral_reward_granted",
                "reason": "referred_user_paid",
                "actor": "payment_contract_checkout",
                "payload": {
                    "referred_user_id": referred_key,
                    "payment_intent_id": payment_intent_id,
                    "tx_hash": tx_hash,
                    "reward_days": REFERRAL_REWARD_DAYS,
                },
                "created_at": self._to_iso(now),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        self.invalidate_subscription_cache(referrer_key)
        return {
            "awarded": True,
            "reward_days": REFERRAL_REWARD_DAYS,
            "referrer_user_id": referrer_key,
            "subscription": subscription_payload,
        }

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
