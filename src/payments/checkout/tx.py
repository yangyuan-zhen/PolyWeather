from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests as requests_lib
from loguru import logger
from web3 import Web3

from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
from src.payments.chain_config import ERC20_TRANSFER_EVENT_ABI
from src.payments.checkout.models import PaymentCheckoutError, PaymentIntentRecord
from src.payments.checkout.intent import (
    _normalize_address,
    _now_utc,
    _to_iso,
    _units_to_decimal,
)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


class TxMixin:
    def validate_intent_tx(
        self,
        user_id: str,
        intent_id: str,
        tx_hash: str,
    ) -> Dict[str, Any]:
        """Pre-check a tx hash against an intent before submission.

        Returns a validation report with ``valid`` and per-field checks.
        Does NOT mutate any database state.
        """
        self._ensure_enabled()
        intent = self.get_intent(user_id, intent_id)
        return self._validate_loaded_intent_tx(intent, tx_hash)

    def _validate_loaded_intent_tx(
        self,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Dict[str, Any]:
        tx_hash_text = str(tx_hash or "").strip().lower()
        if not (tx_hash_text.startswith("0x") and len(tx_hash_text) == 66):
            return {
                "valid": False,
                "reason": "invalid_tx_hash_format",
                "checks": {"tx_hash_format": False},
            }
        if intent.status not in {"created", "submitted"}:
            return {
                "valid": False,
                "reason": f"intent status is {intent.status}, cannot validate",
                "checks": {"intent_status": intent.status},
            }
        now = _now_utc()
        try:
            expires_at = datetime.fromisoformat(intent.expires_at)
        except Exception:
            expires_at = now - timedelta(seconds=1)
        if expires_at <= now:
            return {
                "valid": False,
                "reason": "payment intent expired",
                "checks": {"intent_expired": True},
            }

        w3 = self._get_web3(chain_id=intent.chain_id)
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash_text)
        except Exception:
            try:
                w3 = self._get_web3(chain_id=intent.chain_id, force_refresh=True)
                receipt = w3.eth.get_transaction_receipt(tx_hash_text)
            except Exception:
                receipt = None

        if receipt is None:
            return {
                "valid": False,
                "reason": "tx_not_mined",
                "checks": {"tx_mined": False},
            }
        if int(receipt.get("status") or 0) != 1:
            return {
                "valid": False,
                "reason": "tx_reverted",
                "checks": {"tx_mined": True, "tx_status": "reverted"},
            }

        tx_to = _normalize_address(receipt.get("to") or "")
        is_direct = intent.payment_mode == "direct"

        checks: Dict[str, Any] = {
            "tx_mined": True,
            "tx_status": "success",
            "tx_to": tx_to,
            "block_number": int(receipt.get("blockNumber") or 0),
        }

        if is_direct:
            event_match = self._extract_direct_transfer_event(receipt, intent)
            if not event_match:
                return {
                    "valid": False,
                    "reason": "direct_transfer_not_found",
                    "detail": "ERC20 Transfer event not found on token contract. "
                    "Ensure you transferred the correct token to the receiver address.",
                    "checks": checks,
                }
            event_from = _normalize_address(event_match.get("from"))
            event_to = _normalize_address(event_match.get("to"))
            event_amount = int(event_match.get("amount_units") or 0)
            expected_receiver = intent.receiver_address
            expected_amount = int(intent.amount_units)

            receiver_match = event_to == expected_receiver
            amount_match = event_amount >= expected_amount
            sender_is_receiver = event_from == expected_receiver

            checks["event"] = "Transfer"
            checks["event_from"] = event_from
            checks["event_to"] = event_to
            checks["event_amount"] = str(event_amount)
            checks["expected_receiver"] = expected_receiver
            checks["expected_amount"] = str(expected_amount)
            checks["receiver_match"] = receiver_match
            checks["amount_match"] = amount_match
            checks["sender_is_receiver"] = sender_is_receiver

            if not receiver_match:
                return {
                    "valid": False,
                    "reason": "receiver_mismatch",
                    "detail": f"Transfer went to {event_to}, expected {expected_receiver}",
                    "checks": checks,
                }
            if sender_is_receiver:
                return {
                    "valid": False,
                    "reason": "direct_self_transfer",
                    "detail": "Transfer sender and receiver are both the payment receiver address.",
                    "checks": checks,
                }
            if not amount_match:
                return {
                    "valid": False,
                    "reason": "amount_insufficient",
                    "detail": f"Transfer amount {event_amount} is less than expected {expected_amount}",
                    "checks": checks,
                }
        else:
            event_match = self._extract_matching_event(receipt, intent)
            if not event_match:
                return {
                    "valid": False,
                    "reason": "order_paid_event_not_found",
                    "detail": "OrderPaid event not found. "
                    "Ensure the tx was sent to the correct receiver contract.",
                    "checks": checks,
                }
            event_payer = _normalize_address(event_match.get("payer"))
            event_order_id = str(event_match.get("order_id_hex") or "")
            event_plan_id = int(event_match.get("plan_id") or 0)
            event_amount = int(event_match.get("amount_units") or 0)
            event_token = _normalize_address(event_match.get("token_address") or "")

            order_match = event_order_id == intent.order_id_hex.lower()
            plan_match = event_plan_id == int(intent.plan_id)
            token_match = event_token == intent.token_address
            amount_match = event_amount == int(intent.amount_units)

            checks["event"] = "OrderPaid"
            checks["event_payer"] = event_payer
            checks["order_id_match"] = order_match
            checks["plan_id_match"] = plan_match
            checks["token_match"] = token_match
            checks["amount_match"] = amount_match
            checks["event_amount"] = str(event_amount)
            checks["expected_amount"] = str(intent.amount_units)

            if not all([order_match, plan_match, token_match, amount_match]):
                failures = []
                if not order_match:
                    failures.append(
                        f"order_id mismatch: got {event_order_id}, expected {intent.order_id_hex.lower()}"
                    )
                if not plan_match:
                    failures.append(
                        f"plan_id mismatch: got {event_plan_id}, expected {intent.plan_id}"
                    )
                if not token_match:
                    failures.append(
                        f"token mismatch: got {event_token}, expected {intent.token_address}"
                    )
                if not amount_match:
                    failures.append(
                        f"amount mismatch: got {event_amount}, expected {intent.amount_units}"
                    )
                return {
                    "valid": False,
                    "reason": "event_mismatch",
                    "detail": "; ".join(failures),
                    "checks": checks,
                }

        return {"valid": True, "checks": checks}

    def submit_intent_tx(
        self,
        user_id: str,
        intent_id: str,
        tx_hash: str,
        from_address: Optional[str],
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        intent = self.get_intent(user_id, intent_id)
        tx_hash_text = str(tx_hash or "").strip().lower()
        if intent.status == "confirmed":
            if (
                tx_hash_text
                and tx_hash_text != str(intent.tx_hash or "").strip().lower()
            ):
                self._record_duplicate_transaction(
                    intent=intent,
                    tx_hash=tx_hash_text,
                    from_address=from_address,
                    status="refund_required",
                    detail="submitted tx after order already paid",
                )
            raise PaymentCheckoutError(
                409,
                "该订单已支付，请勿重复付款；如已重复转账请联系客服处理退款",
            )
        if intent.status not in {"created", "submitted"}:
            raise PaymentCheckoutError(
                409, f"intent status is {intent.status}, cannot submit"
            )

        from_addr = _normalize_address(from_address)
        if not (tx_hash_text.startswith("0x") and len(tx_hash_text) == 66):
            raise PaymentCheckoutError(400, "invalid tx_hash")
        if not from_addr and intent.payment_mode != "direct":
            raise PaymentCheckoutError(400, "invalid from_address")
        self._ensure_tx_hash_unused(tx_hash_text, intent.intent_id)

        now = _now_utc()
        try:
            expires_at = datetime.fromisoformat(intent.expires_at)
        except Exception:
            expires_at = now - timedelta(seconds=1)
        if expires_at <= now:
            self._rest(
                "PATCH",
                "payment_intents",
                params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
                payload={"status": "expired", "updated_at": _to_iso(now)},
                prefer="return=minimal",
                allowed_status=[200],
            )
            raise PaymentCheckoutError(409, "payment intent expired")

        if intent.payment_mode == "direct":
            from_addr = None
        elif intent.payment_mode == "strict" and intent.allowed_wallet:
            if from_addr != intent.allowed_wallet:
                raise PaymentCheckoutError(
                    400,
                    f"strict mode requires allowed wallet {intent.allowed_wallet}",
                )
        else:
            self._require_user_wallet(user_id, from_addr)

        validation_pending_reasons = {
            "payment_tx_validation_failed",
            "tx_not_mined",
        }
        try:
            validation = self._validate_loaded_intent_tx(intent, tx_hash_text)
        except Exception as exc:
            if intent.payment_mode != "direct":
                raise PaymentCheckoutError(
                    400,
                    f"payment_tx_validation_failed: {exc}",
                ) from exc
            validation = {
                "valid": False,
                "reason": "payment_tx_validation_failed",
                "detail": str(exc),
            }
        if not bool(validation.get("valid")):
            reason = str(validation.get("reason") or "payment_tx_invalid").strip()
            detail = str(validation.get("detail") or reason).strip()
            message = reason if detail == reason else f"{reason}: {detail}"
            is_pending_direct_validation = (
                intent.payment_mode == "direct" and reason in validation_pending_reasons
            )
            if not is_pending_direct_validation:
                raise PaymentCheckoutError(400, message)

        now_iso = _to_iso(now)
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "submitted",
                "tx_hash": tx_hash_text,
                "updated_at": now_iso,
            },
            prefer="return=minimal",
            allowed_status=[200],
        )
        tx_payload = {
            "intent_id": intent.intent_id,
            "chain_id": int(intent.chain_id),
            "tx_hash": tx_hash_text,
            "from_address": from_addr,
            "to_address": intent.receiver_address,
            "payment_method": "direct" if intent.payment_mode == "direct" else "wallet",
            "status": "submitted",
            "updated_at": now_iso,
        }
        self._rest(
            "POST",
            "payment_transactions",
            params={"on_conflict": "tx_hash"},
            payload=tx_payload,
            prefer="resolution=merge-duplicates,return=minimal",
            allowed_status=[200, 201],
        )
        return {
            "intent_id": intent.intent_id,
            "status": "submitted",
            "tx_hash": tx_hash_text,
            "from_address": from_addr,
            "transaction": tx_payload,
        }

    def _wait_receipt(self, tx_hash: str, chain_id: Optional[int] = None) -> Any:
        import time as _time

        start = _now_utc()
        while (_now_utc() - start).total_seconds() < self.max_wait_sec:
            try:
                w3 = self._get_web3(chain_id=chain_id)
                receipt = w3.eth.get_transaction_receipt(tx_hash)
            except Exception:
                try:
                    w3 = self._get_web3(chain_id=chain_id, force_refresh=True)
                    receipt = w3.eth.get_transaction_receipt(tx_hash)
                except Exception:
                    receipt = None
            if receipt and receipt.get("blockNumber"):
                return receipt
            try:
                latest_w3 = self._get_web3(chain_id=chain_id)
                if not latest_w3.is_connected():
                    self._get_web3(chain_id=chain_id, force_refresh=True)
            except Exception:
                receipt = None
            _time.sleep(self.poll_interval_sec)
        raise PaymentCheckoutError(408, "tx receipt timeout")

    def _extract_matching_event(
        self, receipt: Any, intent: PaymentIntentRecord
    ) -> Optional[Dict[str, Any]]:
        contract = self._get_contract(intent.receiver_address, intent.chain_id)
        try:
            events = contract.events.OrderPaid().process_receipt(receipt)
        except Exception:
            events = []
        if not events:
            return None

        for ev in events:
            args = ev.get("args") if isinstance(ev, dict) else getattr(ev, "args", None)
            if not args:
                continue
            order_id_hex = str(Web3.to_hex(args.get("orderId"))).lower()
            payer = _normalize_address(args.get("payer"))
            plan_id = int(args.get("planId") or 0)
            token = _normalize_address(args.get("token"))
            amount = int(args.get("amount") or 0)
            if (
                order_id_hex == intent.order_id_hex.lower()
                and plan_id == int(intent.plan_id)
                and token == intent.token_address
                and amount == int(intent.amount_units)
            ):
                if intent.payment_mode == "strict" and intent.allowed_wallet:
                    if payer != intent.allowed_wallet:
                        continue
                return {
                    "order_id_hex": order_id_hex,
                    "payer": payer,
                    "plan_id": plan_id,
                    "token_address": token,
                    "amount_units": amount,
                }
        return None

    def _extract_direct_transfer_event(
        self, receipt: Any, intent: PaymentIntentRecord
    ) -> Optional[Dict[str, Any]]:
        expected_to = intent.receiver_address
        expected_amount = int(intent.amount_units)

        # Collect all token contracts to check: intent's token first,
        # then all other supported tokens (in case user transferred a
        # different token than selected in the UI).
        token_addresses: List[str] = []
        if intent.token_address:
            token_addresses.append(_normalize_address(intent.token_address))
        for token in self._tokens_for_chain(intent.chain_id):
            normalized = _normalize_address(token.address)
            if normalized and normalized not in token_addresses:
                token_addresses.append(normalized)

        for token_addr in token_addresses:
            try:
                token_contract = self._get_web3(chain_id=intent.chain_id).eth.contract(
                    address=Web3.to_checksum_address(token_addr),
                    abi=[ERC20_TRANSFER_EVENT_ABI],
                )
                events = token_contract.events.Transfer().process_receipt(receipt)
            except Exception:
                continue

            for ev in events:
                args = (
                    ev.get("args")
                    if isinstance(ev, dict)
                    else getattr(ev, "args", None)
                )
                if not args:
                    continue
                payer = _normalize_address(args.get("from"))
                receiver = _normalize_address(args.get("to"))
                amount = int(args.get("value") or 0)
                if receiver == expected_to and amount >= expected_amount:
                    token_meta = self._token_symbol_for(token_addr, intent.chain_id)
                    return {
                        "from": payer,
                        "to": receiver,
                        "token_address": token_addr,
                        "amount_units": amount,
                        "token_mismatch": (
                            token_addr != _normalize_address(intent.token_address)
                        ),
                        "token_symbol": token_meta,
                    }

        return None

    def _insert_payment_record(
        self,
        user_id: str,
        tx_hash: str,
        amount_units: int,
        token_address: str,
        payload: Dict[str, Any],
        chain_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        payment_chain_id = int(chain_id or self.default_chain_id or self.chain_id)
        token_decimals = self._token_decimals_for(token_address, payment_chain_id)
        amount_dec = _units_to_decimal(amount_units, token_decimals)
        currency = self._token_symbol_for(token_address, payment_chain_id)
        payment_payload = {
            "user_id": user_id,
            "amount": str(amount_dec),
            "currency": currency,
            "chain": self._chain_label_for(payment_chain_id),
            "tx_hash": tx_hash,
            "status": "confirmed",
            "raw_payload": payload,
            "updated_at": _to_iso(_now_utc()),
        }
        self._rest(
            "POST",
            "payments",
            params={"on_conflict": "tx_hash"},
            payload=payment_payload,
            prefer="resolution=merge-duplicates,return=minimal",
            allowed_status=[200, 201],
        )
        return payment_payload

    def _grant_subscription(
        self,
        user_id: str,
        plan_code: str,
        duration_days: int,
        tx_hash: str,
        payload: Dict[str, Any],
        source: str = "payment",
    ) -> Dict[str, Any]:
        now = _now_utc()
        latest_rows = self._rest(
            "GET",
            "subscriptions",
            params={
                "select": "starts_at,expires_at,plan_code,source",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "order": "expires_at.desc",
                "limit": "20",
            },
            allowed_status=[200],
        )
        starts = now
        current_subscription = None
        if isinstance(latest_rows, list):
            for row in latest_rows:
                if not isinstance(row, dict):
                    continue
                if self._subscription_row_is_trial(row):
                    continue
                try:
                    starts_at = datetime.fromisoformat(
                        str(row.get("starts_at") or "").replace("Z", "+00:00")
                    )
                    if starts_at.tzinfo is None:
                        starts_at = starts_at.replace(tzinfo=timezone.utc)
                    starts_at = starts_at.astimezone(timezone.utc)
                except Exception:
                    starts_at = None
                if starts_at is None or starts_at <= now:
                    current_subscription = row
                    break
        if isinstance(current_subscription, dict):
            try:
                latest_exp = datetime.fromisoformat(
                    str(current_subscription.get("expires_at") or "").replace(
                        "Z", "+00:00"
                    )
                )
                if latest_exp.tzinfo is None:
                    latest_exp = latest_exp.replace(tzinfo=timezone.utc)
                latest_exp = latest_exp.astimezone(timezone.utc)
                if latest_exp > starts:
                    starts = latest_exp
            except Exception:
                pass
        expires = starts + timedelta(days=max(1, duration_days))
        subscription_payload = {
            "user_id": user_id,
            "plan_code": plan_code,
            "status": "active",
            "starts_at": _to_iso(starts),
            "expires_at": _to_iso(expires),
            "source": str(source or "payment").strip() or "payment",
            "created_at": _to_iso(now),
            "updated_at": _to_iso(now),
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
                "user_id": user_id,
                "action": "subscription_granted",
                "reason": "payment_confirmed",
                "actor": "payment_contract_checkout",
                "payload": {"tx_hash": tx_hash, **payload},
                "created_at": _to_iso(now),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)
        return subscription_payload

    def _ensure_confirmed_subscription(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Optional[Dict[str, Any]]:
        latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
            user_id,
            respect_requirement=False,
        )
        if isinstance(
            latest_subscription, dict
        ) and not self._subscription_row_is_trial(latest_subscription):
            return latest_subscription

        plan = self._select_plan(intent.plan_code)
        return self._grant_subscription(
            user_id=user_id,
            plan_code=intent.plan_code,
            duration_days=plan["duration_days"],
            tx_hash=tx_hash,
            payload={
                "intent_id": intent.intent_id,
                "order_id_hex": intent.order_id_hex,
                "repaired_from_confirmed_intent": True,
            },
        )

    @staticmethod
    def _subscription_row_is_trial(row: Dict[str, Any]) -> bool:
        plan_code = str(row.get("plan_code") or "").strip().lower()
        source = str(row.get("source") or "").strip().lower()
        return "trial" in plan_code or "trial" in source

    def _settle_referral_reward_for_intent(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Dict[str, Any]:
        metadata = dict(intent.metadata or {})
        if not isinstance(metadata.get("referral_attribution"), dict):
            return {}
        try:
            result = SUPABASE_ENTITLEMENT.settle_referral_reward(
                referred_user_id=user_id,
                payment_intent_id=intent.intent_id,
                tx_hash=tx_hash,
            )
            return dict(result) if isinstance(result, dict) else {}
        except Exception as exc:
            logger.warning(
                "referral reward settlement failed user_id={} intent_id={}: {}",
                user_id,
                intent.intent_id,
                exc,
            )
            return {"awarded": False, "reason": "settlement_error"}

    def _ensure_confirm_side_effects(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
    ) -> Dict[str, Any]:
        payment_row = {}
        if tx_hash:
            payment_row = self._insert_payment_record(
                user_id=user_id,
                tx_hash=tx_hash,
                amount_units=int(intent.amount_units),
                token_address=intent.token_address,
                chain_id=intent.chain_id,
                payload={
                    "tx_hash": tx_hash,
                    "intent_id": intent.intent_id,
                    "order_id_hex": intent.order_id_hex,
                    "reconciled": True,
                },
            )
        subscription_row = self._ensure_confirmed_subscription(user_id, intent, tx_hash)
        referral_reward = self._settle_referral_reward_for_intent(
            user_id,
            intent,
            tx_hash,
        )
        return {
            "payment": payment_row,
            "subscription": subscription_row,
            "referral_reward": referral_reward,
        }

    def _attempt_confirm_repair(
        self,
        *,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
        reason: str,
        detail: str,
    ) -> Dict[str, Any]:
        self._db.append_payment_audit_event(
            "payment_confirm_repair_needed",
            {
                "user_id": user_id,
                "intent_id": intent.intent_id,
                "plan_code": intent.plan_code,
                "reason": str(reason or "").strip().lower(),
                "detail": str(detail or "").strip(),
                "tx_hash": str(tx_hash or "").strip().lower(),
            },
        )
        repaired = self._ensure_confirm_side_effects(user_id, intent, tx_hash)
        if repaired.get("payment") or repaired.get("subscription"):
            self._db.append_payment_audit_event(
                "payment_confirm_repaired",
                {
                    "user_id": user_id,
                    "intent_id": intent.intent_id,
                    "plan_code": intent.plan_code,
                    "tx_hash": str(tx_hash or "").strip().lower(),
                    "reason": str(reason or "").strip().lower(),
                },
            )
        return repaired

    def _mark_intent_failed(
        self,
        *,
        user_id: str,
        intent: PaymentIntentRecord,
        tx_hash: str,
        reason: str,
        detail: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        now_iso = _to_iso(_now_utc())
        metadata = dict(intent.metadata or {})
        metadata["confirm_failure"] = {
            "reason": str(reason or "").strip().lower(),
            "detail": str(detail or "").strip(),
            "tx_hash": str(tx_hash or "").strip().lower(),
            "at": now_iso,
            **(extra or {}),
        }
        self._rest(
            "PATCH",
            "payment_intents",
            params={"id": f"eq.{intent.intent_id}", "user_id": f"eq.{user_id}"},
            payload={
                "status": "failed",
                "metadata": metadata,
                "updated_at": now_iso,
            },
            prefer="return=minimal",
            allowed_status=[200],
        )
        if tx_hash:
            self._rest(
                "POST",
                "payment_transactions",
                params={"on_conflict": "tx_hash"},
                payload={
                    "intent_id": intent.intent_id,
                    "chain_id": int(intent.chain_id),
                    "tx_hash": str(tx_hash).strip().lower(),
                    "from_address": None,
                    "to_address": intent.receiver_address,
                    "status": "failed",
                    "updated_at": now_iso,
                },
                prefer="resolution=merge-duplicates,return=minimal",
                allowed_status=[200, 201],
            )
        self._db.append_payment_audit_event(
            "payment_intent_failed",
            {
                "intent_id": intent.intent_id,
                "user_id": user_id,
                "plan_code": intent.plan_code,
                "reason": str(reason or "").strip().lower(),
                "detail": str(detail or "").strip(),
                "tx_hash": str(tx_hash or "").strip().lower(),
                "receiver_expected": intent.receiver_address,
                **(extra or {}),
            },
        )

    def _notify_telegram(
        self, user_id: str, plan_code: str, amount_usdc: str, tx_hash: str
    ) -> None:
        if not self.notify_telegram:
            return
        token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        if not token:
            return
        user = self._db.get_user_by_supabase_user_id(user_id)
        if not isinstance(user, dict):
            return
        telegram_id = int(user.get("telegram_id") or 0)
        if telegram_id <= 0:
            return
        short_hash = (
            tx_hash[:10] + "..." + tx_hash[-8:] if len(tx_hash) > 20 else tx_hash
        )
        text = (
            "✅ PolyWeather 支付确认\n"
            f"用户: {user_id}\n"
            f"套餐: {plan_code}\n"
            f"金额: {amount_usdc} USDC\n"
            f"Tx: {short_hash}"
        )
        try:
            requests_lib.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": str(telegram_id),
                    "text": text,
                    "disable_web_page_preview": True,
                },
                timeout=8,
            )
        except Exception:
            return

    def confirm_intent_tx(
        self,
        user_id: str,
        intent_id: str,
        tx_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._ensure_enabled()
        intent = self.get_intent(user_id, intent_id)
        if intent.status == "confirmed":
            tx_hash_text = str(tx_hash or intent.tx_hash or "").strip().lower()
            repaired = self._ensure_confirm_side_effects(user_id, intent, tx_hash_text)
            refreshed = self.get_intent(user_id, intent_id)
            return {
                "intent": refreshed.__dict__,
                "already_confirmed": True,
                "payment": repaired.get("payment"),
                "subscription": repaired.get("subscription"),
                "referral_reward": repaired.get("referral_reward"),
            }
        if intent.status in {"cancelled", "expired"}:
            raise PaymentCheckoutError(409, f"intent status is {intent.status}")
        tx_hash_text = str(tx_hash or intent.tx_hash or "").strip().lower()
        if intent.status == "failed" and not tx_hash_text:
            raise PaymentCheckoutError(
                409, "intent status is failed and tx_hash is missing"
            )
        if not tx_hash_text:
            raise PaymentCheckoutError(400, "tx_hash required")
        if not (tx_hash_text.startswith("0x") and len(tx_hash_text) == 66):
            raise PaymentCheckoutError(400, "invalid tx_hash")
        self._ensure_tx_hash_unused(tx_hash_text, intent.intent_id)
        w3 = self._get_web3(chain_id=intent.chain_id)
        if not w3.is_connected():
            raise PaymentCheckoutError(503, "cannot connect payment rpc")
        if int(w3.eth.chain_id) != int(intent.chain_id):
            raise PaymentCheckoutError(503, "payment rpc chain mismatch")
        # Wait for receipt first to avoid transient RPC lag on eth_getTransaction.
        receipt = self._wait_receipt(tx_hash_text, chain_id=intent.chain_id)
        if int(receipt.get("status") or 0) != 1:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="tx_reverted",
                detail="tx reverted",
            )
            raise PaymentCheckoutError(400, "tx reverted")

        try:
            tx = w3.eth.get_transaction(tx_hash_text)
        except Exception:
            tx = None

        tx_get = getattr(tx, "get", None)
        tx_to_raw = tx_get("to") if callable(tx_get) else None
        tx_from_raw = tx_get("from") if callable(tx_get) else None
        tx_to = _normalize_address(tx_to_raw or receipt.get("to"))
        tx_from = _normalize_address(tx_from_raw or receipt.get("from"))
        if not tx_to or not tx_from:
            raise PaymentCheckoutError(409, "tx indexed partially; retry confirm")
        block_number = int(receipt.get("blockNumber") or 0)
        latest_block = int(w3.eth.block_number)
        confirmations = max(0, latest_block - block_number + 1) if block_number else 0
        required_confirmations = self._confirmations_for_chain(intent.chain_id)
        if confirmations < required_confirmations:
            raise PaymentCheckoutError(
                409,
                f"confirmations not enough: {confirmations}/{required_confirmations}",
            )
        is_direct = intent.payment_mode == "direct"
        if is_direct:
            event_match = self._extract_direct_transfer_event(receipt, intent)
            event_payer = (
                _normalize_address(event_match.get("from")) if event_match else None
            )
            effective_payer = event_payer or tx_from
            routed_via_delegate = False
        else:
            event_match = self._extract_matching_event(receipt, intent)
            event_payer = (
                _normalize_address(event_match.get("payer")) if event_match else None
            )
            effective_payer = event_payer or tx_from
            routed_via_delegate = bool(
                event_match and tx_to and tx_to != intent.receiver_address
            )
        if tx_to != intent.receiver_address and not event_match:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="receiver_mismatch",
                detail=f"tx to mismatch: got={tx_to} expected={intent.receiver_address}",
                extra={
                    "receiver_actual": tx_to,
                    "from_address": tx_from,
                },
            )
            raise PaymentCheckoutError(
                400,
                f"tx to mismatch: got={tx_to} expected={intent.receiver_address}",
            )
        if is_direct:
            pass
        elif intent.payment_mode == "strict" and intent.allowed_wallet:
            if effective_payer != intent.allowed_wallet:
                self._mark_intent_failed(
                    user_id=user_id,
                    intent=intent,
                    tx_hash=tx_hash_text,
                    reason="sender_mismatch",
                    detail=f"tx sender mismatch: got={effective_payer or tx_from} expected={intent.allowed_wallet}",
                    extra={
                        "from_address": tx_from,
                        "event_payer": event_payer,
                    },
                )
                raise PaymentCheckoutError(
                    400,
                    f"tx sender mismatch: got={effective_payer or tx_from} expected={intent.allowed_wallet}",
                )
        else:
            self._require_user_wallet(user_id, effective_payer)
        if is_direct and event_payer == intent.receiver_address:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="direct_self_transfer",
                detail="Transfer sender and receiver are both the payment receiver address.",
                extra={
                    "from_address": tx_from,
                    "event_payer": event_payer,
                    "receiver_actual": tx_to,
                },
            )
            raise PaymentCheckoutError(
                400,
                "direct_self_transfer: Transfer sender and receiver are both the payment receiver address.",
            )
        if not event_match:
            self._mark_intent_failed(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="direct_transfer_mismatch" if is_direct else "event_mismatch",
                detail=(
                    "ERC20 Transfer mismatch; ensure token transfer sends enough funds to receiver"
                    if is_direct
                    else "OrderPaid event mismatch; ensure contract emits OrderPaid(orderId,payer,planId,token,amount)"
                ),
                extra={"from_address": tx_from, "receiver_actual": tx_to},
            )
            raise PaymentCheckoutError(
                400,
                "ERC20 Transfer mismatch; ensure token transfer sends enough funds to receiver"
                if is_direct
                else "OrderPaid event mismatch; ensure contract emits OrderPaid(orderId,payer,planId,token,amount)",
            )
        points_result = self._consume_points_for_intent(user_id, intent)
        now_iso = _to_iso(_now_utc())
        confirmed_metadata = dict(intent.metadata or {})
        redemption_meta = confirmed_metadata.get("points_redemption")
        if isinstance(redemption_meta, dict):
            redemption_meta["consumed"] = bool(points_result.get("points_redeemed"))
            redemption_meta["consumed_points"] = int(
                points_result.get("points_redeemed") or 0
            )
            redemption_meta["points_after"] = points_result.get("points_after")
            redemption_meta["consumed_at"] = now_iso
            confirmed_metadata["points_redemption"] = redemption_meta
        if routed_via_delegate:
            confirmed_metadata["tx_envelope"] = {
                "outer_to": tx_to,
                "outer_from": tx_from,
                "event_payer": event_payer,
                "receiver_expected": intent.receiver_address,
                "matched_via_event": True,
            }
        confirm_rows = self._rest(
            "PATCH",
            "payment_intents",
            params={
                "select": "id",
                "id": f"eq.{intent.intent_id}",
                "user_id": f"eq.{user_id}",
                "status": "in.(created,submitted,failed)",
            },
            payload={
                "status": "confirmed",
                "tx_hash": tx_hash_text,
                "confirmed_at": now_iso,
                "metadata": confirmed_metadata,
                "updated_at": now_iso,
            },
            prefer="return=representation",
            allowed_status=[200],
        )
        if not isinstance(confirm_rows, list) or not confirm_rows:
            refreshed = self.get_intent(user_id, intent.intent_id)
            if refreshed.status == "confirmed":
                if tx_hash_text != str(refreshed.tx_hash or "").strip().lower():
                    self._record_duplicate_transaction(
                        intent=refreshed,
                        tx_hash=tx_hash_text,
                        from_address=tx_from,
                        to_address=tx_to,
                        status="refund_required",
                        detail="order was already confirmed by another transaction",
                    )
                repaired = self._ensure_confirm_side_effects(
                    user_id,
                    refreshed,
                    str(refreshed.tx_hash or tx_hash_text).strip().lower(),
                )
                return {
                    "intent": refreshed.__dict__,
                    "already_confirmed": True,
                    "duplicate_tx_hash": tx_hash_text,
                    "payment": repaired.get("payment"),
                    "subscription": repaired.get("subscription"),
                    "referral_reward": repaired.get("referral_reward"),
                }
            raise PaymentCheckoutError(
                409, f"intent status is {refreshed.status}, cannot confirm"
            )
        tx_payload = {
            "intent_id": intent.intent_id,
            "tx_hash": tx_hash_text,
            "chain_id": int(intent.chain_id),
            "from_address": tx_from,
            "to_address": tx_to,
            "block_number": block_number,
            "payment_method": "direct" if is_direct else "wallet",
            "status": "confirmed",
            "raw_receipt": json.loads(Web3.to_json(receipt)),
            "raw_tx": json.loads(Web3.to_json(tx)) if tx is not None else None,
            "updated_at": now_iso,
        }
        self._rest(
            "POST",
            "payment_transactions",
            params={"on_conflict": "tx_hash"},
            payload=tx_payload,
            prefer="resolution=merge-duplicates,return=minimal",
            allowed_status=[200, 201],
        )
        payload = {
            "tx_hash": tx_hash_text,
            "block_number": block_number,
            "confirmations": confirmations,
            "event": event_match,
            "points_redemption": points_result,
        }
        plan = self._select_plan(intent.plan_code)
        payment_row = {}
        subscription_row = {}
        referral_reward = {}
        try:
            payment_row = self._insert_payment_record(
                user_id=user_id,
                tx_hash=tx_hash_text,
                amount_units=intent.amount_units,
                token_address=intent.token_address,
                chain_id=intent.chain_id,
                payload=payload,
            )
            subscription_row = self._grant_subscription(
                user_id=user_id,
                plan_code=intent.plan_code,
                duration_days=plan["duration_days"],
                tx_hash=tx_hash_text,
                payload=payload,
            )
            intent.metadata = confirmed_metadata
            referral_reward = self._settle_referral_reward_for_intent(
                user_id,
                intent,
                tx_hash_text,
            )
        except PaymentCheckoutError as exc:
            repaired = self._attempt_confirm_repair(
                user_id=user_id,
                intent=intent,
                tx_hash=tx_hash_text,
                reason="side_effect_failure",
                detail=exc.detail,
            )
            payment_row = repaired.get("payment") or payment_row
            subscription_row = repaired.get("subscription") or subscription_row
            referral_reward = repaired.get("referral_reward") or referral_reward
            if not subscription_row:
                raise
        self._notify_telegram(
            user_id=user_id,
            plan_code=intent.plan_code,
            amount_usdc=intent.amount_usdc,
            tx_hash=tx_hash_text,
        )
        refreshed_payload = {
            field_name: getattr(intent, field_name)
            for field_name in PaymentIntentRecord.__dataclass_fields__
        }
        refreshed_payload.update(
            {
                "status": "confirmed",
                "tx_hash": tx_hash_text,
                "metadata": confirmed_metadata,
            }
        )
        refreshed = PaymentIntentRecord(**refreshed_payload)
        return {
            "intent": refreshed.__dict__,
            "transaction": tx_payload,
            "payment": payment_row,
            "subscription": subscription_row,
            "referral_reward": referral_reward,
            "points_redemption": points_result,
            "tx": payload,
        }

    def reconcile_latest_intent(self, user_id: str) -> Dict[str, Any]:
        self._ensure_enabled()
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": (
                    "id,user_id,plan_code,plan_id,chain_id,token_address,receiver_address,"
                    "amount_units,payment_mode,allowed_wallet,order_id_hex,status,expires_at,tx_hash,metadata"
                ),
                "user_id": f"eq.{user_id}",
                "status": "in.(created,submitted,confirmed,failed)",
                "order": "updated_at.desc",
                "limit": "5",
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            return {"ok": False, "reason": "intent_not_found"}

        attempts: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            intent = self._serialize_intent(row)
            status = str(intent.status or "").strip().lower()
            tx_hash_text = str(intent.tx_hash or "").strip().lower()
            try:
                if status in {"submitted", "failed"} and tx_hash_text:
                    result = self.confirm_intent_tx(
                        user_id, intent.intent_id, tx_hash_text
                    )
                    return {
                        "ok": True,
                        "action": "confirmed_submitted_intent"
                        if status == "submitted"
                        else "recovered_failed_intent",
                        **result,
                    }
                if status == "confirmed":
                    repaired = self._ensure_confirm_side_effects(
                        user_id, intent, tx_hash_text
                    )
                    return {
                        "ok": True,
                        "action": "reconciled_confirmed_intent",
                        "intent": intent.__dict__,
                        "payment": repaired.get("payment"),
                        "subscription": repaired.get("subscription"),
                    }
            except PaymentCheckoutError as exc:
                attempts.append(
                    {
                        "intent_id": intent.intent_id,
                        "status": status,
                        "status_code": exc.status_code,
                        "error": exc.detail,
                    }
                )

        latest_subscription = SUPABASE_ENTITLEMENT.get_latest_active_subscription(
            user_id,
            respect_requirement=False,
        )
        return {
            "ok": bool(latest_subscription),
            "action": "checked_without_repair",
            "subscription": latest_subscription,
            "attempts": attempts,
        }

    def reconcile_recent_intents(self, limit: int = 50) -> Dict[str, Any]:
        self._ensure_enabled()
        safe_limit = max(1, min(int(limit or 50), 200))
        rows = self._rest(
            "GET",
            "payment_intents",
            params={
                "select": "user_id",
                "status": "in.(submitted,confirmed)",
                "order": "updated_at.desc",
                "limit": str(safe_limit),
            },
            allowed_status=[200],
        )
        if not isinstance(rows, list) or not rows:
            return {"ok": True, "processed_users": 0, "repaired_users": 0}

        seen_users: set[str] = set()
        repaired_users = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            user_id = str(row.get("user_id") or "").strip()
            if not user_id or user_id in seen_users:
                continue
            seen_users.add(user_id)
            try:
                result = self.reconcile_latest_intent(user_id)
                if bool(result.get("ok")) and result.get("subscription"):
                    repaired_users += 1
            except PaymentCheckoutError:
                continue
            except Exception:
                continue

        return {
            "ok": True,
            "processed_users": len(seen_users),
            "repaired_users": repaired_users,
        }
