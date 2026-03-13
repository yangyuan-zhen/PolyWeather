#!/usr/bin/env python3
"""
Admin utility: reconcile a payment transaction to a user subscription.

Usage:
  docker compose exec -T polyweather python scripts/reconcile_payment_tx.py \
    --user-id <supabase_user_id> --tx-hash <0x...>

Optional emergency fallback (manual grant if no matching intent):
  docker compose exec -T polyweather python scripts/reconcile_payment_tx.py \
    --user-id <supabase_user_id> --tx-hash <0x...> --manual-grant
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional

from web3 import Web3

from src.payments.contract_checkout import PAYMENT_CHECKOUT, PaymentCheckoutError


def _list_recent_intents(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    rows = PAYMENT_CHECKOUT._rest(
        "GET",
        "payment_intents",
        params={
            "select": (
                "id,user_id,plan_code,status,tx_hash,order_id_hex,"
                "amount_units,token_address,created_at,updated_at"
            ),
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        allowed_status=[200],
    )
    return rows if isinstance(rows, list) else []


def _find_intent_by_tx(user_id: str, tx_hash: str) -> Optional[Dict[str, Any]]:
    rows = _list_recent_intents(user_id, limit=50)
    tx_norm = str(tx_hash or "").strip().lower()
    for row in rows:
        if str(row.get("tx_hash") or "").strip().lower() == tx_norm:
            return row
    return None


def _find_intent_by_order_id(user_id: str, order_id_hex: str) -> Optional[Dict[str, Any]]:
    rows = PAYMENT_CHECKOUT._rest(
        "GET",
        "payment_intents",
        params={
            "select": (
                "id,user_id,plan_code,status,tx_hash,order_id_hex,"
                "amount_units,token_address,created_at,updated_at"
            ),
            "user_id": f"eq.{user_id}",
            "order_id_hex": f"eq.{order_id_hex.lower()}",
            "order": "created_at.desc",
            "limit": "5",
        },
        allowed_status=[200],
    )
    return rows[0] if isinstance(rows, list) and rows else None


def _decode_pay_call(tx_hash: str) -> Optional[Dict[str, Any]]:
    w3 = PAYMENT_CHECKOUT._get_web3()
    if not w3.is_connected():
        raise RuntimeError("payment rpc not connected")

    tx = w3.eth.get_transaction(tx_hash)
    receiver = PAYMENT_CHECKOUT.receiver_contract
    if str(tx.get("to") or "").lower() != str(receiver or "").lower():
        return {
            "is_pay_call": False,
            "reason": f"tx.to={tx.get('to')} (expected checkout contract {receiver})",
        }

    contract = PAYMENT_CHECKOUT._get_contract(receiver)
    fn, args = contract.decode_function_input(tx["input"])
    if str(getattr(fn, "fn_name", "")) != "pay":
        return {
            "is_pay_call": False,
            "reason": f"contract call is {getattr(fn, 'fn_name', '')}, not pay",
        }

    return {
        "is_pay_call": True,
        "order_id_hex": Web3.to_hex(args["orderId"]).lower(),
        "plan_id": int(args["planId"]),
        "amount_units": int(args["amount"]),
        "token_address": Web3.to_checksum_address(args["token"]).lower(),
        "from_address": str(tx.get("from") or "").lower(),
        "to_address": str(tx.get("to") or "").lower(),
    }


def _print_json(label: str, payload: Any) -> None:
    print(f"{label}: {json.dumps(payload, ensure_ascii=False, default=str)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True, help="Supabase user id")
    parser.add_argument("--tx-hash", required=True, help="0x transaction hash")
    parser.add_argument(
        "--manual-grant",
        action="store_true",
        help="Emergency: grant monthly subscription when no matching intent",
    )
    args = parser.parse_args()

    user_id = str(args.user_id).strip()
    tx_hash = str(args.tx_hash).strip().lower()
    if not (tx_hash.startswith("0x") and len(tx_hash) == 66):
        print("ERROR: invalid --tx-hash")
        return 2

    print("=== reconcile payment tx ===")
    print("user_id:", user_id)
    print("tx_hash:", tx_hash)

    target_intent = _find_intent_by_tx(user_id, tx_hash)
    if target_intent:
        _print_json("intent_matched_by_tx", target_intent)
    else:
        print("intent_matched_by_tx: null")

    decode_info: Optional[Dict[str, Any]] = None
    if not target_intent:
        try:
            decode_info = _decode_pay_call(tx_hash)
            _print_json("tx_decode", decode_info)
        except Exception as exc:
            print(f"tx_decode_error: {exc}")

        if decode_info and decode_info.get("is_pay_call"):
            order_id_hex = str(decode_info.get("order_id_hex") or "").lower()
            if order_id_hex:
                target_intent = _find_intent_by_order_id(user_id, order_id_hex)
                if target_intent:
                    _print_json("intent_matched_by_order_id", target_intent)

    if target_intent:
        intent_id = str(target_intent.get("id") or "")
        try:
            result = PAYMENT_CHECKOUT.confirm_intent_tx(
                user_id=user_id,
                intent_id=intent_id,
                tx_hash=tx_hash,
            )
            _print_json("confirm_result", result.get("intent", {}))
            _print_json("subscription", result.get("subscription", {}))
            _print_json("points_redemption", result.get("points_redemption", {}))
            print("DONE: confirmed")
            return 0
        except PaymentCheckoutError as exc:
            print(f"confirm_error: status={exc.status_code} detail={exc.detail}")
            return 1

    print("NO_MATCHING_INTENT: cannot auto-confirm this tx for this user.")
    print("Likely reasons:")
    print("- tx is a direct token transfer (not checkout contract pay())")
    print("- tx belongs to another account's intent")
    print("- tx hash typo / wrong chain")

    recent = _list_recent_intents(user_id, limit=5)
    _print_json("recent_intents", recent)

    if not args.manual_grant:
        print("ABORTED: use --manual-grant only if you verified payment manually.")
        return 1

    print("manual_grant: enabled, creating emergency monthly subscription...")
    try:
        plan = PAYMENT_CHECKOUT._select_plan("pro_monthly")
        payload = {
            "manual_grant": True,
            "reason": "operator_reconcile_no_intent",
            "tx_hash": tx_hash,
        }
        sub = PAYMENT_CHECKOUT._grant_subscription(
            user_id=user_id,
            plan_code=plan["plan_code"],
            duration_days=int(plan["duration_days"]),
            tx_hash=tx_hash,
            payload=payload,
        )
        _print_json("manual_subscription", sub)
        print("DONE: manual grant created")
        return 0
    except Exception as exc:
        print(f"manual_grant_error: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

