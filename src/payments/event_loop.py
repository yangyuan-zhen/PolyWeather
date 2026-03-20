from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from web3 import Web3

from src.database.db_manager import DBManager
from src.payments import PAYMENT_CHECKOUT, PaymentCheckoutError

_DB = DBManager()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, min_value: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return max(min_value, value)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text).lower()


def _checksum_address(address: Any) -> str:
    text = str(address or "").strip()
    if not text or not Web3.is_address(text):
        return ""
    return Web3.to_checksum_address(text)


def _to_hex(value: Any) -> str:
    try:
        return str(Web3.to_hex(value or b"")).lower()
    except Exception:
        return ""


def _state_file() -> str:
    custom = str(
        os.getenv("POLYWEATHER_PAYMENT_EVENT_LOOP_STATE_PATH") or ""
    ).strip()
    if custom:
        return custom
    runtime_dir = str(os.getenv("POLYWEATHER_RUNTIME_DATA_DIR") or "").strip()
    if runtime_dir:
        return os.path.join(runtime_dir, "payment_event_loop_state.json")
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "data", "payment_event_loop_state.json")


def _load_state(path: str) -> Dict[str, Any]:
    db_state = _DB.get_payment_runtime_state("payment_event_loop")
    if isinstance(db_state, dict) and db_state:
        return db_state
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return raw if isinstance(raw, dict) else {}
    except Exception as exc:
        logger.warning(f"payment event loop state load failed: {exc}")
        return {}


def _save_state(path: str, state: Dict[str, Any]) -> None:
    _DB.set_payment_runtime_state("payment_event_loop", state)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _append_audit_event(event_type: str, payload: Dict[str, Any]) -> None:
    try:
        _DB.append_payment_audit_event(event_type, payload)
    except Exception as exc:
        logger.debug(f"payment event audit append failed: {exc}")


def _is_pending_confirm_error(exc: PaymentCheckoutError) -> bool:
    detail = str(exc.detail or "").lower()
    if exc.status_code in {404, 408, 502, 503}:
        return True
    if exc.status_code == 409 and (
        "confirmations not enough" in detail or "tx indexed partially" in detail
    ):
        return True
    return False


def _is_nonfatal_submit_error(exc: PaymentCheckoutError) -> bool:
    detail = str(exc.detail or "").lower()
    if exc.status_code in {502, 503, 408}:
        return True
    if exc.status_code == 409 and (
        "intent status is submitted" in detail
        or "intent status is confirmed" in detail
        or "cannot submit" in detail
    ):
        return True
    return False


def _decode_order_paid_log(log_item: Any) -> Optional[Dict[str, Any]]:
    log_get = getattr(log_item, "get", None)
    if not callable(log_get):
        return None
    address = _normalize_address(log_get("address"))
    if not address:
        return None
    try:
        contract = PAYMENT_CHECKOUT._get_contract(address)  # noqa: SLF001
        event_obj = contract.events.OrderPaid().process_log(log_item)
    except Exception:
        return None

    event_get = getattr(event_obj, "get", None)
    args = event_get("args") if callable(event_get) else getattr(event_obj, "args", None)
    if not args:
        return None
    args_get = getattr(args, "get", None)
    if not callable(args_get):
        return None

    order_id_hex = _to_hex(args_get("orderId"))
    payer = _normalize_address(args_get("payer"))
    token = _normalize_address(args_get("token"))
    plan_id = int(args_get("planId") or 0)
    amount_units = int(args_get("amount") or 0)
    tx_hash = _to_hex(log_get("transactionHash"))
    block_number = int(log_get("blockNumber") or 0)
    log_index = int(log_get("logIndex") or 0)

    if not (order_id_hex and payer and token and tx_hash and plan_id > 0 and amount_units > 0):
        return None
    return {
        "order_id_hex": order_id_hex,
        "payer": payer,
        "plan_id": plan_id,
        "token_address": token,
        "amount_units": amount_units,
        "receiver_contract": address,
        "tx_hash": tx_hash,
        "block_number": block_number,
        "log_index": log_index,
    }


def _event_key(event_row: Dict[str, Any]) -> str:
    return f"{event_row.get('tx_hash')}:{int(event_row.get('log_index') or 0)}"


def _select_matching_intents(
    intents: List[Dict[str, Any]],
    event_row: Dict[str, Any],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in intents:
        if not isinstance(row, dict):
            continue
        if int(row.get("plan_id") or 0) != int(event_row.get("plan_id") or 0):
            continue
        if _normalize_address(row.get("token_address")) != _normalize_address(
            event_row.get("token_address")
        ):
            continue
        if int(row.get("amount_units") or 0) != int(event_row.get("amount_units") or 0):
            continue
        out.append(row)
    if out:
        return out
    return intents


def _runner() -> None:
    enabled = _env_bool("POLYWEATHER_PAYMENT_EVENT_LOOP_ENABLED", True)
    if not enabled:
        logger.info("payment event loop disabled")
        return
    if not PAYMENT_CHECKOUT.enabled:
        logger.info("payment event loop skipped: payment service disabled")
        return

    interval_sec = _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_INTERVAL_SEC", 20, 5)
    lookback_blocks = _env_int(
        "POLYWEATHER_PAYMENT_EVENT_LOOP_START_LOOKBACK_BLOCKS", 5000, 500
    )
    step_blocks = _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_STEP_BLOCKS", 2000, 100)
    step_blocks = min(step_blocks, 49999)
    max_events = _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_MAX_EVENTS_PER_CYCLE", 200, 10)
    state_path = _state_file()

    receiver_contract_set: set[str] = set()
    for token in PAYMENT_CHECKOUT.supported_tokens.values():
        checksum_addr = _checksum_address(token.receiver_contract)
        if checksum_addr:
            receiver_contract_set.add(checksum_addr)
    receiver_contracts = sorted(receiver_contract_set)
    if not receiver_contracts:
        logger.warning("payment event loop skipped: no receiver contract configured")
        return

    topic0 = str(PAYMENT_CHECKOUT._event_topic or "").strip().lower()  # noqa: SLF001
    if topic0 and not topic0.startswith("0x"):
        topic0 = f"0x{topic0}"
    if not topic0:
        topic0 = (
            "0x"
            + Web3.keccak(
                text="OrderPaid(bytes32,address,uint256,address,uint256)"
            ).hex().lower().replace("0x", "")
        )

    logger.info(
        "payment event loop started interval={}s lookback={} step={} max_events={} "
        "contracts={} chain_id={}",
        interval_sec,
        lookback_blocks,
        step_blocks,
        max_events,
        len(receiver_contracts),
        PAYMENT_CHECKOUT.chain_id,
    )
    _append_audit_event(
        "event_loop_started",
        {
            "interval_sec": interval_sec,
            "lookback_blocks": lookback_blocks,
            "step_blocks": step_blocks,
            "max_events": max_events,
            "receiver_contracts": receiver_contracts,
            "chain_id": PAYMENT_CHECKOUT.chain_id,
        },
    )

    while True:
        cycle_started = time.time()
        try:
            w3 = PAYMENT_CHECKOUT._get_web3()  # noqa: SLF001
            if not w3.is_connected():
                logger.warning("payment event loop skipped: rpc not connected")
                time.sleep(interval_sec)
                continue
            if int(w3.eth.chain_id) != int(PAYMENT_CHECKOUT.chain_id):
                logger.warning(
                    "payment event loop skipped: chain mismatch rpc={} expected={}",
                    int(w3.eth.chain_id),
                    int(PAYMENT_CHECKOUT.chain_id),
                )
                time.sleep(interval_sec)
                continue

            latest_block = int(w3.eth.block_number)
            safe_latest = latest_block - max(0, int(PAYMENT_CHECKOUT.confirmations) - 1)
            if safe_latest <= 0:
                time.sleep(interval_sec)
                continue

            state = _load_state(state_path)
            last_scanned = int(state.get("last_scanned_block") or 0)
            start_block = (
                last_scanned + 1
                if last_scanned > 0
                else max(0, safe_latest - lookback_blocks + 1)
            )
            if start_block > safe_latest:
                time.sleep(interval_sec)
                continue

            scanned_blocks = 0
            scanned_events = 0
            matched_intents = 0
            submitted = 0
            confirmed = 0
            already = 0
            pending = 0
            failed = 0
            ignored = 0
            seen_events: set[str] = set()
            cursor = start_block

            while cursor <= safe_latest and scanned_events < max_events:
                to_block = min(cursor + step_blocks - 1, safe_latest)
                params: Dict[str, Any] = {
                    "fromBlock": cursor,
                    "toBlock": to_block,
                    "topics": [topic0],
                }
                params["address"] = (
                    receiver_contracts
                    if len(receiver_contracts) > 1
                    else receiver_contracts[0]
                )

                logs = w3.eth.get_logs(params)
                scanned_blocks += max(0, to_block - cursor + 1)
                state["last_scanned_block"] = to_block
                state["updated_at"] = _now_iso()
                _save_state(state_path, state)

                if logs:
                    for log_item in logs:
                        event_row = _decode_order_paid_log(log_item)
                        if not event_row:
                            continue
                        event_key = _event_key(event_row)
                        if event_key in seen_events:
                            continue
                        seen_events.add(event_key)
                        scanned_events += 1

                        intents = PAYMENT_CHECKOUT.list_open_intents_by_order_id(
                            event_row["order_id_hex"],
                            limit=10,
                        )
                        if not intents:
                            ignored += 1
                            if scanned_events >= max_events:
                                break
                            continue

                        candidates = _select_matching_intents(intents, event_row)
                        for row in candidates:
                            status = str(row.get("status") or "").strip().lower()
                            if status == "confirmed":
                                already += 1
                                continue

                            user_id = str(row.get("user_id") or "").strip()
                            intent_id = str(row.get("intent_id") or "").strip()
                            if not user_id or not intent_id:
                                continue
                            matched_intents += 1

                            if status == "created" or not str(row.get("tx_hash") or "").strip():
                                try:
                                    PAYMENT_CHECKOUT.submit_intent_tx(
                                        user_id=user_id,
                                        intent_id=intent_id,
                                        tx_hash=event_row["tx_hash"],
                                        from_address=event_row["payer"],
                                    )
                                    submitted += 1
                                except PaymentCheckoutError as exc:
                                    if not _is_nonfatal_submit_error(exc):
                                        failed += 1
                                        logger.warning(
                                            "payment event submit failed intent={} user={} tx={} status={} detail={}",
                                            intent_id,
                                            user_id,
                                            event_row["tx_hash"],
                                            exc.status_code,
                                            exc.detail,
                                        )
                                        continue

                            try:
                                result = PAYMENT_CHECKOUT.confirm_intent_tx(
                                    user_id=user_id,
                                    intent_id=intent_id,
                                    tx_hash=event_row["tx_hash"],
                                )
                                if bool(result.get("already_confirmed")):
                                    already += 1
                                else:
                                    confirmed += 1
                                    logger.info(
                                        "payment event-confirmed intent={} user={} tx={} block={}",
                                        intent_id,
                                        user_id,
                                        event_row["tx_hash"],
                                        int(event_row.get("block_number") or 0),
                                    )
                            except PaymentCheckoutError as exc:
                                if _is_pending_confirm_error(exc):
                                    pending += 1
                                    continue
                                failed += 1
                                logger.warning(
                                    "payment event confirm failed intent={} user={} tx={} status={} detail={}",
                                    intent_id,
                                    user_id,
                                    event_row["tx_hash"],
                                    exc.status_code,
                                    exc.detail,
                                )

                        if scanned_events >= max_events:
                            break

                cursor = to_block + 1

            if scanned_blocks > 0:
                cycle_summary = {
                    "blocks": scanned_blocks,
                    "events": scanned_events,
                    "matched": matched_intents,
                    "submitted": submitted,
                    "confirmed": confirmed,
                    "already": already,
                    "pending": pending,
                    "failed": failed,
                    "ignored": ignored,
                    "last_scanned_block": int(state.get("last_scanned_block") or 0),
                }
                logger.info(
                    "payment event cycle blocks={} events={} matched={} submitted={} "
                    "confirmed={} already={} pending={} failed={} ignored={}",
                    scanned_blocks,
                    scanned_events,
                    matched_intents,
                    submitted,
                    confirmed,
                    already,
                    pending,
                    failed,
                    ignored,
                )
                _append_audit_event("event_loop_cycle", cycle_summary)
        except Exception as exc:
            logger.warning(f"payment event cycle failed: {exc}")
            _append_audit_event("event_loop_error", {"error": str(exc)})

        elapsed = time.time() - cycle_started
        time.sleep(max(0.0, interval_sec - elapsed))


def start_payment_event_loop() -> threading.Thread:
    thread = threading.Thread(
        target=_runner,
        daemon=True,
        name="payment-event-loop",
    )
    thread.start()
    return thread
