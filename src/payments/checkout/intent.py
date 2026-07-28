from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from web3 import Web3

from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
from src.auth.telegram_group_pricing import TelegramGroupPricing
from src.payments.chain_config import REFERRAL_FIRST_MONTH_DISCOUNT_USDC
from src.payments.checkout.models import PaymentCheckoutError, PaymentIntentRecord
from src.payments.checkout.admin import _format_decimal


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


def _normalize_order_id_hex(order_id_hex: Any) -> str:
    text = str(order_id_hex or "").strip().lower()
    if not text:
        return ""
    if not text.startswith("0x"):
        text = f"0x{text}"
    if len(text) != 66:
        return ""
    try:
        int(text[2:], 16)
    except Exception:
        return ""
    return text


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _decimal_to_units(amount: Decimal, decimals: int) -> int:
    q = Decimal(10) ** Decimal(max(0, int(decimals)))
    normalized = (amount * q).quantize(Decimal("1"))
    return int(normalized)


def _units_to_decimal(units: int, decimals: int) -> Decimal:
    q = Decimal(10) ** Decimal(max(0, int(decimals)))
    return Decimal(int(units)) / q


class IntentMixin:
    def _select_plan(self, plan_code: str) -> Dict[str, Any]:
        code = str(plan_code or "").strip().lower() or "pro_monthly"
        row = self.plan_catalog.get(code)
        if not row:
            available = ", ".join(sorted(self.plan_catalog.keys()))
            raise PaymentCheckoutError(
                400, f"unknown plan_code={code}; available={available}"
            )
        amount_dec = _parse_decimal(row.get("amount_usdc"), Decimal("0"))
        if amount_dec <= 0:
            raise PaymentCheckoutError(500, f"invalid plan amount for {code}")
        return {
            "plan_code": code,
            "plan_id": int(row.get("plan_id") or 0),
            "duration_days": int(row.get("duration_days") or 0),
            "amount_usdc": _format_decimal(amount_dec),
            "amount_usdc_decimal": amount_dec,
        }

    def _apply_telegram_group_pricing(
        self,
        user_id: str,
        plan: Dict[str, Any],
    ) -> Dict[str, Any]:
        out = dict(plan)
        if str(out.get("plan_code") or "").strip().lower() != "pro_monthly":
            return out
        pricing = TelegramGroupPricing()
        if not pricing.configured:
            return out
        telegram_id = None
        try:
            user = self._db.get_user_by_supabase_user_id(user_id)
            if isinstance(user, dict):
                telegram_id = int(user.get("telegram_id") or 0) or None
        except Exception:
            telegram_id = None
        price_payload = pricing.resolve_price_for_telegram_id(telegram_id)
        if not bool(price_payload.get("is_private_group_member")):
            return out
        amount_dec = _parse_decimal(
            price_payload.get("amount_usdc"), out["amount_usdc_decimal"]
        )
        if amount_dec <= 0:
            return out
        out["amount_usdc"] = _format_decimal(amount_dec)
        out["amount_usdc_decimal"] = amount_dec
        out["telegram_pricing"] = price_payload
        return out

    def _get_pending_referral_attribution(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            row = SUPABASE_ENTITLEMENT.get_pending_referral_attribution(user_id)
            return dict(row) if isinstance(row, dict) else None
        except Exception:
            return None

    def _has_prior_paid_subscription(self, user_id: str) -> bool:
        try:
            return bool(SUPABASE_ENTITLEMENT.has_paid_subscription(user_id))
        except Exception:
            return False

    def _apply_referral_pricing(
        self,
        user_id: str,
        plan: Dict[str, Any],
    ) -> Dict[str, Any]:
        out = dict(plan)
        attribution = self._get_pending_referral_attribution(user_id)
        if not attribution or self._has_prior_paid_subscription(user_id):
            return out

        out["referral_attribution"] = {
            "id": attribution.get("id"),
            "code": str(attribution.get("code") or "").strip().upper(),
            "referrer_user_id": str(attribution.get("referrer_user_id") or "").strip(),
            "referred_user_id": user_id,
        }
        if str(out.get("plan_code") or "").strip().lower() != "pro_monthly":
            return out

        base_amount = _parse_decimal(out.get("amount_usdc_decimal"), Decimal("0"))
        discount = min(REFERRAL_FIRST_MONTH_DISCOUNT_USDC, base_amount)
        discounted = base_amount - discount
        if discount <= 0 or discounted <= 0:
            return out

        out["amount_before_discount_usdc_decimal"] = base_amount
        out["amount_usdc_decimal"] = discounted
        out["amount_usdc"] = _format_decimal(discounted)
        out["referral_discount"] = {
            "discount_usdc": _format_decimal(discount),
            "amount_before_discount_usdc": _format_decimal(base_amount),
            "amount_after_discount_usdc": _format_decimal(discounted),
            "reason": "first_month_referral",
        }
        return out

    def _build_tx_payload(self, intent: PaymentIntentRecord) -> Dict[str, Any]:
        contract = self._get_contract(intent.receiver_address, intent.chain_id)
        tx_data = contract.encode_abi(
            "pay",
            args=[
                intent.order_id_hex,
                int(intent.plan_id),
                int(intent.amount_units),
                Web3.to_checksum_address(intent.token_address),
            ],
        )
        return {
            "chain_id": int(intent.chain_id),
            "to": Web3.to_checksum_address(intent.receiver_address),
            "data": tx_data,
            "value": "0x0",
            "order_id_hex": intent.order_id_hex,
            "amount_units": str(intent.amount_units),
            "amount_usdc": intent.amount_usdc,
            "token_address": Web3.to_checksum_address(intent.token_address),
            "token_symbol": intent.token_symbol,
            "token_decimals": int(intent.token_decimals),
        }

    def create_intent(
        self,
        user_id: str,
        plan_code: str,
        payment_mode: str = "strict",
        allowed_wallet: Optional[str] = None,
        token_address: Optional[str] = None,
        chain_id: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
        use_points: bool = False,
        points_to_consume: Optional[int] = None,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        selected_plan = self._select_plan(plan_code)
        if self.telegram_payment_pricing_enabled:
            selected_plan = self._apply_telegram_group_pricing(user_id, selected_plan)
        plan = self._apply_referral_pricing(user_id, selected_plan)
        selected_token = self._resolve_supported_token(token_address, chain_id)
        selected_chain_id = int(selected_token.chain_id)
        mode = str(payment_mode or "strict").strip().lower()
        if mode == "manual":
            mode = "direct"
        if mode not in {"strict", "flex", "direct"}:
            raise PaymentCheckoutError(
                400, "payment_mode must be strict, flex, or direct"
            )
        if mode == "direct" and not selected_token.supports_direct_transfer:
            raise PaymentCheckoutError(
                400,
                f"{selected_token.chain_name} {selected_token.symbol} does not support direct transfer",
            )
        if mode != "direct" and not selected_token.supports_contract_checkout:
            raise PaymentCheckoutError(
                400,
                f"{selected_token.chain_name} {selected_token.symbol} supports manual transfer only",
            )
        bound_wallets = [] if mode == "direct" else self.list_wallets(user_id)
        if mode != "direct" and not bound_wallets:
            raise PaymentCheckoutError(403, "bind wallet first")
        target_wallet = _normalize_address(allowed_wallet or "")
        if mode == "direct":
            target_wallet = ""
        elif mode == "strict":
            if target_wallet:
                self._require_user_wallet(user_id, target_wallet)
            else:
                primary = next(
                    (w for w in bound_wallets if w.is_primary and w.status == "active"),
                    None,
                )
                target_wallet = primary.address if primary else bound_wallets[0].address
        elif target_wallet:
            self._require_user_wallet(user_id, target_wallet)
        plan_amount_usdc = plan["amount_usdc_decimal"]
        amount_before_discount_usdc = plan.get(
            "amount_before_discount_usdc_decimal",
            plan_amount_usdc,
        )
        referral_discount_applied = isinstance(plan.get("referral_discount"), dict)
        redemption = self._build_points_redemption(
            user_id=user_id,
            plan_code=str(plan.get("plan_code") or plan_code),
            plan_amount_usdc=plan_amount_usdc,
            use_points=bool(use_points) and not referral_discount_applied,
            requested_points_to_consume=points_to_consume,
        )
        final_amount_usdc = redemption["pay_amount_usdc"]
        amount_units = _decimal_to_units(
            final_amount_usdc, int(selected_token.decimals)
        )
        if amount_units <= 0:
            raise PaymentCheckoutError(400, "invalid final payment amount")
        combined_metadata = dict(metadata or {})
        combined_metadata["token_code"] = str(selected_token.code)
        combined_metadata["token_symbol"] = str(selected_token.symbol)
        combined_metadata["chain_id"] = selected_chain_id
        combined_metadata["chain_code"] = selected_token.chain_code
        combined_metadata["chain_name"] = selected_token.chain_name
        if isinstance(plan.get("telegram_pricing"), dict):
            combined_metadata["telegram_pricing"] = plan["telegram_pricing"]
        if isinstance(plan.get("referral_attribution"), dict):
            combined_metadata["referral_attribution"] = plan["referral_attribution"]
        if isinstance(plan.get("referral_discount"), dict):
            combined_metadata["referral_discount"] = plan["referral_discount"]
        receiver_address = (
            selected_token.direct_receiver_address
            if mode == "direct"
            else selected_token.receiver_contract
        )
        combined_metadata["amount_before_discount_usdc"] = _format_decimal(
            amount_before_discount_usdc
        )
        combined_metadata["amount_after_discount_usdc"] = _format_decimal(
            final_amount_usdc
        )
        combined_metadata["points_redemption"] = {
            "enabled": bool(redemption.get("enabled")),
            "applied": bool(redemption.get("applied")),
            "points_per_usdc": int(
                redemption.get("points_per_usdc") or self.points_per_usdc
            ),
            "max_discount_usdc": int(
                redemption.get("max_discount_usdc")
                or self._points_max_discount_for_plan(str(plan.get("plan_code") or plan_code))
            ),
            "points_source": str(
                redemption.get("points_source") or "supabase_metadata"
            ),
            "points_balance_snapshot": int(
                redemption.get("points_balance_snapshot") or 0
            ),
            "points_to_consume": int(redemption.get("points_to_consume") or 0),
            "discount_usdc": str(redemption.get("discount_usdc") or "0"),
        }
        order_id_hex = "0x" + secrets.token_hex(32)
        now = _now_utc()
        expires_at = now + timedelta(seconds=self.intent_ttl_sec)
        intent_payload = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "plan_code": plan["plan_code"],
            "plan_id": plan["plan_id"],
            "chain_id": selected_chain_id,
            "token_address": selected_token.address,
            "receiver_address": receiver_address,
            "amount_units": str(amount_units),
            "payment_mode": mode,
            "allowed_wallet": target_wallet or None,
            "order_id_hex": order_id_hex,
            "status": "created",
            "expires_at": _to_iso(expires_at),
            "metadata": combined_metadata,
            "created_at": _to_iso(now),
            "updated_at": _to_iso(now),
        }
        self._rest(
            "POST",
            "payment_intents",
            payload=intent_payload,
            prefer="return=minimal",
            allowed_status=[201],
        )
        intent = self._serialize_intent(intent_payload)
        response = {
            "intent": intent.__dict__,
            "tx_payload": None if mode == "direct" else self._build_tx_payload(intent),
            "plan": {
                "plan_code": plan["plan_code"],
                "plan_id": plan["plan_id"],
                "duration_days": plan["duration_days"],
                "amount_before_discount_usdc": _format_decimal(
                    amount_before_discount_usdc
                ),
                "amount_after_discount_usdc": _format_decimal(final_amount_usdc),
            },
            "token": {
                "code": selected_token.code,
                "symbol": selected_token.symbol,
                "name": selected_token.name,
                "address": selected_token.address,
                "decimals": int(selected_token.decimals),
            },
            "points_redemption": {
                "applied": bool(redemption.get("applied")),
                "points_source": str(
                    redemption.get("points_source") or "supabase_metadata"
                ),
                "points_to_consume": int(redemption.get("points_to_consume") or 0),
                "discount_usdc": str(redemption.get("discount_usdc") or "0"),
                "points_balance_snapshot": int(
                    redemption.get("points_balance_snapshot") or 0
                ),
            },
        }
        if mode == "direct":
            response["direct_payment"] = {
                "chain_id": selected_chain_id,
                "chain": selected_token.chain_code,
                "chain_name": selected_token.chain_name,
                "token_symbol": intent.token_symbol,
                "token_address": intent.token_address,
                "token_decimals": int(intent.token_decimals),
                "receiver_address": intent.receiver_address,
                "amount_units": str(intent.amount_units),
                "amount_usdc": intent.amount_usdc,
                "intent_id": intent.intent_id,
                "expires_at": intent.expires_at,
                "explorer_tx_url": selected_token.explorer_tx_url
                or self._explorer_tx_url_for(selected_chain_id),
            }
        return response

    def get_intent(self, user_id: str, intent_id: str) -> PaymentIntentRecord:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,plan_code,plan_id,chain_id,token_address,receiver_address,"
                    "amount_units,payment_mode,allowed_wallet,order_id_hex,status,expires_at,tx_hash,metadata"
                ),
                "id": f"eq.{intent_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            raise PaymentCheckoutError(404, "payment intent not found")
        intent = self._serialize_intent(rows[0])
        setattr(intent, "user_id", user_id)
        return intent

    def list_pending_confirm_intents(self, limit: int = 20) -> List[Dict[str, Any]]:
        """
        List submitted intents that already have tx_hash and need background confirm.
        """
        self._ensure_enabled()
        safe_limit = max(1, min(int(limit or 20), 200))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": "id,user_id,tx_hash,chain_id",
                "status": "eq.submitted",
                "tx_hash": "not.is.null",
                "order": "updated_at.asc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent_id = str(row.get("id") or "").strip()
            user_id = str(row.get("user_id") or "").strip()
            tx_hash = str(row.get("tx_hash") or "").strip().lower()
            if not intent_id or not user_id or not tx_hash:
                continue
            out.append(
                {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "tx_hash": tx_hash,
                    "chain_id": int(row.get("chain_id") or self.chain_id),
                }
            )
        return out

    def list_open_intents_by_order_id(
        self,
        order_id_hex: str,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Find intents by on-chain order id for event-driven reconciliation.
        Includes created/submitted intents; confirmed intents are returned too for idempotent skip.
        """
        self._ensure_enabled()
        normalized_order = _normalize_order_id_hex(order_id_hex)
        if not normalized_order:
            return []
        safe_limit = max(1, min(int(limit or 10), 50))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,status,tx_hash,plan_id,token_address,amount_units"
                ),
                "order_id_hex": f"eq.{normalized_order}",
                "status": "in.(created,submitted,confirmed)",
                "order": "created_at.desc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return []

        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent_id = str(row.get("id") or "").strip()
            user_id = str(row.get("user_id") or "").strip()
            status = str(row.get("status") or "").strip().lower()
            if not intent_id or not user_id or not status:
                continue
            out.append(
                {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "status": status,
                    "tx_hash": str(row.get("tx_hash") or "").strip().lower(),
                    "plan_id": int(row.get("plan_id") or 0),
                    "token_address": _normalize_address(row.get("token_address")),
                    "amount_units": int(row.get("amount_units") or 0),
                }
            )
        return out

    def _ensure_tx_hash_unused(self, tx_hash: str, intent_id: str) -> None:
        tx_hash_text = str(tx_hash or "").strip().lower()
        if not tx_hash_text:
            return
        rows = self._rest(
            "GET",
            "payment_transactions",
            params={
                "select": "intent_id",
                "tx_hash": f"eq.{tx_hash_text}",
                "limit": "5",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list):
            return
        for row in rows:
            if not isinstance(row, dict):
                continue
            existing_intent = str(row.get("intent_id") or "").strip()
            if existing_intent and existing_intent != str(intent_id):
                raise PaymentCheckoutError(
                    409, "tx_hash already used by another payment intent"
                )
        intent_rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": "id",
                "tx_hash": f"eq.{tx_hash_text}",
                "limit": "5",
            },
            allowed_status=[200],
        )
        if not isinstance(intent_rows, list):
            return
        for row in intent_rows:
            if not isinstance(row, dict):
                continue
            existing_intent = str(row.get("id") or "").strip()
            if existing_intent and existing_intent != str(intent_id):
                raise PaymentCheckoutError(
                    409, "tx_hash already used by another payment intent"
                )

    def _record_duplicate_transaction(
        self,
        *,
        intent: PaymentIntentRecord,
        tx_hash: str,
        from_address: Optional[str] = None,
        to_address: Optional[str] = None,
        status: str = "duplicate",
        detail: str = "payment intent already confirmed",
    ) -> Dict[str, Any]:
        tx_hash_text = str(tx_hash or "").strip().lower()
        if not tx_hash_text:
            return {}
        now_iso = _to_iso(_now_utc())
        try:
            self._rest(
                "POST",
                "payment_transactions",
                params={"on_conflict": "tx_hash"},
                payload={
                    "intent_id": intent.intent_id,
                    "chain_id": int(intent.chain_id),
                    "tx_hash": tx_hash_text,
                    "from_address": _normalize_address(from_address) or None,
                    "to_address": _normalize_address(to_address)
                    or intent.receiver_address,
                    "payment_method": "direct"
                    if intent.payment_mode == "direct"
                    else "wallet",
                    "status": status,
                    "raw_receipt": {},
                    "raw_tx": {
                        "duplicate_of_intent_id": intent.intent_id,
                        "duplicate_reason": detail,
                    },
                    "updated_at": now_iso,
                },
                prefer="resolution=merge-duplicates,return=minimal",
                allowed_status=[200, 201],
            )
            if str(status or "").strip().lower() == "refund_required":
                self._db.append_payment_audit_event(
                    "payment_refund_required",
                    {
                        "reason": "refund_required",
                        "detail": detail,
                        "intent_id": intent.intent_id,
                        "user_id": getattr(intent, "user_id", "") or "",
                        "tx_hash": tx_hash_text,
                        "chain_id": int(intent.chain_id),
                        "from_address": _normalize_address(from_address) or "",
                        "receiver_expected": intent.receiver_address,
                    },
                )
            return {}
        except Exception:
            return {}

    def _serialize_intent(self, row: Dict[str, Any]) -> PaymentIntentRecord:
        chain_id = int(row.get("chain_id") or self.chain_id)
        token_address = _normalize_address(
            row.get("token_address") or self.token_address
        )
        token_decimals = self._token_decimals_for(token_address, chain_id)
        amount_units = int(_parse_decimal(row.get("amount_units"), Decimal("0")))
        amount_display = _units_to_decimal(amount_units, token_decimals)
        return PaymentIntentRecord(
            intent_id=str(row.get("id")),
            order_id_hex=str(row.get("order_id_hex")),
            plan_code=str(row.get("plan_code")),
            plan_id=int(row.get("plan_id") or 0),
            chain_id=chain_id,
            amount_units=amount_units,
            amount_usdc=_format_decimal(amount_display),
            token_address=token_address,
            token_decimals=token_decimals,
            token_symbol=self._token_symbol_for(token_address, chain_id),
            receiver_address=_normalize_address(
                row.get("receiver_address") or self.receiver_contract
            ),
            status=str(row.get("status") or "created"),
            payment_mode=str(row.get("payment_mode") or "strict"),
            allowed_wallet=_normalize_address(row.get("allowed_wallet") or "") or None,
            expires_at=str(row.get("expires_at")),
            tx_hash=str(row.get("tx_hash") or "") or None,
            metadata=dict(row.get("metadata") or {})
            if isinstance(row.get("metadata"), dict)
            else {},
        )
