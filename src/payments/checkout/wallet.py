from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

from src.payments.checkout.models import PaymentCheckoutError, WalletBindingRecord


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


class WalletMixin:
    def list_wallets(self, user_id: str) -> List[WalletBindingRecord]:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "chain_id,address,is_primary,verified_at",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "order": "is_primary.desc,verified_at.desc",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []
        out: List[WalletBindingRecord] = []
        for row in rows:
            out.append(
                WalletBindingRecord(
                    chain_id=int(row.get("chain_id") or self.chain_id),
                    address=_normalize_address(row.get("address") or ""),
                    status="active",
                    is_primary=bool(row.get("is_primary")),
                    verified_at=row.get("verified_at"),
                )
            )
        return out

    def _require_user_wallet(self, user_id: str, address: str) -> Dict[str, Any]:
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "status",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(403, "wallet not bound to current user")
        row = rows[0]
        if str(row.get("status") or "active") != "active":
            raise PaymentCheckoutError(403, "wallet is not active")
        return row

    def create_wallet_challenge(self, user_id: str, address: str) -> Dict[str, Any]:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        now = _now_utc()
        expires = now + timedelta(seconds=self.challenge_ttl_sec)
        nonce = secrets.token_urlsafe(24)
        message = (
            "PolyWeather Wallet Binding\n"
            f"User: {user_id}\n"
            f"Address: {normalized}\n"
            f"ChainId: {self.chain_id}\n"
            f"Nonce: {nonce}\n"
            f"IssuedAt: {_to_iso(now)}\n"
            f"ExpiresAt: {_to_iso(expires)}"
        )
        self._rest(
            "POST",
            "wallet_link_challenges",
            payload={
                "user_id": user_id,
                "chain_id": self.chain_id,
                "address": normalized,
                "nonce": nonce,
                "message": message,
                "expires_at": _to_iso(expires),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        return {
            "address": normalized,
            "chain_id": self.chain_id,
            "nonce": nonce,
            "message": message,
            "expires_at": _to_iso(expires),
        }

    def verify_wallet_binding(
        self,
        user_id: str,
        address: str,
        nonce: str,
        signature: str,
    ) -> WalletBindingRecord:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        nonce_text = str(nonce or "").strip()
        signature_text = str(signature or "").strip()
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")
        if not nonce_text:
            raise PaymentCheckoutError(400, "nonce required")
        if not signature_text:
            raise PaymentCheckoutError(400, "signature required")

        challenge_rows = self._rest(
            "GET",
            "wallet_link_challenges",
            params={
                "select": "id,message,expires_at",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "nonce": f"eq.{nonce_text}",
                "consumed_at": "is.null",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(challenge_rows, list) or not challenge_rows:
            raise PaymentCheckoutError(
                400, "wallet challenge not found or already used"
            )

        challenge = challenge_rows[0]
        try:
            expires_at = datetime.fromisoformat(str(challenge.get("expires_at")))
        except Exception:
            expires_at = _now_utc() - timedelta(seconds=1)
        if expires_at <= _now_utc():
            raise PaymentCheckoutError(400, "wallet challenge expired")

        message = str(challenge.get("message") or "")
        if not message:
            raise PaymentCheckoutError(400, "wallet challenge message invalid")

        try:
            recovered = Account.recover_message(
                encode_defunct(text=message), signature=signature_text
            )
        except Exception:
            raise PaymentCheckoutError(400, "invalid wallet signature")
        if _normalize_address(recovered) != normalized:
            raise PaymentCheckoutError(400, "signature does not match target wallet")

        existing = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "user_id,status",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if isinstance(existing, list) and existing:
            owner_id = str(existing[0].get("user_id") or "")
            if (
                owner_id
                and owner_id != user_id
                and str(existing[0].get("status")) == "active"
            ):
                raise PaymentCheckoutError(
                    409, "wallet already bound by another account"
                )

        has_primary = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "is_primary": "eq.true",
                "limit": "1",
            },
            allowed_status=[200],
        )
        should_primary = not (isinstance(has_primary, list) and len(has_primary) > 0)
        now_iso = _to_iso(_now_utc())
        self._rest(
            "POST",
            "user_wallets",
            params={"on_conflict": "chain_id,address"},
            payload={
                "user_id": user_id,
                "chain_id": self.chain_id,
                "address": normalized,
                "status": "active",
                "is_primary": should_primary,
                "verified_at": now_iso,
                "updated_at": now_iso,
            },
            prefer="resolution=merge-duplicates,return=minimal",
            allowed_status=[200, 201],
        )
        self._rest(
            "PATCH",
            "wallet_link_challenges",
            params={"id": f"eq.{challenge.get('id')}"},
            payload={"consumed_at": now_iso},
            prefer="return=minimal",
            allowed_status=[200],
        )
        return WalletBindingRecord(
            chain_id=self.chain_id,
            address=normalized,
            status="active",
            is_primary=should_primary,
            verified_at=now_iso,
        )

    def unbind_wallet(self, user_id: str, address: str) -> Dict[str, Any]:
        self._ensure_enabled()
        normalized = _normalize_address(address)
        if not normalized:
            raise PaymentCheckoutError(400, "invalid wallet address")

        # Must be an active wallet owned by current user.
        self._require_user_wallet(user_id, normalized)

        now_iso = _to_iso(_now_utc())
        self._rest(
            "PATCH",
            "user_wallets",
            params={
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "address": f"eq.{normalized}",
            },
            payload={
                "status": "revoked",
                "is_primary": False,
                "updated_at": now_iso,
            },
            prefer="return=minimal",
            allowed_status=[200],
        )

        # Ensure there is still an active primary wallet after unbind.
        active_primary_rows = self._rest(
            "GET",
            "user_wallets",
            params={
                "select": "id,address",
                "user_id": f"eq.{user_id}",
                "chain_id": f"eq.{self.chain_id}",
                "status": "eq.active",
                "is_primary": "eq.true",
                "limit": "1",
            },
            allowed_status=[200],
        )

        new_primary = ""
        if isinstance(active_primary_rows, list) and active_primary_rows:
            new_primary = _normalize_address(
                active_primary_rows[0].get("address") or ""
            )
        else:
            active_wallet_rows = self._rest(
                "GET",
                "user_wallets",
                params={
                    "select": "id,address",
                    "user_id": f"eq.{user_id}",
                    "chain_id": f"eq.{self.chain_id}",
                    "status": "eq.active",
                    "order": "verified_at.desc,updated_at.desc",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(active_wallet_rows, list) and active_wallet_rows:
                candidate = active_wallet_rows[0]
                candidate_id = candidate.get("id")
                candidate_addr = _normalize_address(candidate.get("address") or "")
                if candidate_id and candidate_addr:
                    self._rest(
                        "PATCH",
                        "user_wallets",
                        params={"id": f"eq.{candidate_id}"},
                        payload={"is_primary": True, "updated_at": now_iso},
                        prefer="return=minimal",
                        allowed_status=[200],
                    )
                    new_primary = candidate_addr

        return {
            "address": normalized,
            "unbound": True,
            "new_primary": new_primary or None,
        }
