from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from loguru import logger

from ._base import (
    SIGNUP_TRIAL_DAYS,
    SIGNUP_TRIAL_PLAN_CODE,
    SIGNUP_TRIAL_SOURCE,
    _env_bool,
)

class TrialMixin:
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
            try:
                result = self._rpc(
                    "claim_signup_trial",
                    {
                        "p_user_id": user_key,
                        "p_email": normalized_email,
                        "p_telegram_user_id": telegram_user_id,
                        "p_wallet_addresses": wallet_addresses,
                    },
                    allowed_status=[200],
                )
                if isinstance(result, dict):
                    self.invalidate_subscription_cache(user_key)
                    return result
                if isinstance(result, list) and result and isinstance(result[0], dict):
                    self.invalidate_subscription_cache(user_key)
                    return result[0]
            except Exception as rpc_exc:
                if not self._looks_like_missing_rpc(rpc_exc):
                    raise
                logger.warning(
                    "signup trial rpc missing; falling back to legacy grant user_id={}: {}",
                    user_key,
                    rpc_exc,
                )
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
                if self._trial_claim_exists(
                    user_id=user_key,
                    email=normalized_email,
                    telegram_user_id=telegram_user_id,
                    wallet_addresses=wallet_addresses,
                ):
                    return {"created": False, "reason": "already_claimed"}
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
