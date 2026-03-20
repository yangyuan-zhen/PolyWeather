from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict

from loguru import logger

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


def _is_pending_confirm_error(exc: PaymentCheckoutError) -> bool:
    detail = str(exc.detail or "").lower()
    if exc.status_code in {404, 408}:
        return True
    if exc.status_code == 409 and (
        "confirmations not enough" in detail or "tx indexed partially" in detail
    ):
        return True
    return False


def _short_hash(tx_hash: str) -> str:
    text = str(tx_hash or "")
    if len(text) < 18:
        return text
    return f"{text[:10]}...{text[-6:]}"


def _append_audit_event(event_type: str, payload: Dict[str, Any]) -> None:
    try:
        _DB.append_payment_audit_event(event_type, payload)
    except Exception as exc:
        logger.debug(f"payment confirm audit append failed: {exc}")


def _runner() -> None:
    enabled = _env_bool("POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED", True)
    if not enabled:
        logger.info("payment confirm loop disabled")
        return

    if not PAYMENT_CHECKOUT.enabled:
        logger.info("payment confirm loop skipped: payment service disabled")
        return

    interval_sec = _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC", 20, 5)
    batch_size = _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_BATCH_SIZE", 20, 1)
    batch_size = min(batch_size, 200)

    logger.info(
        "payment confirm loop started interval={}s batch={} chain_id={} confirmations={}",
        interval_sec,
        batch_size,
        PAYMENT_CHECKOUT.chain_id,
        PAYMENT_CHECKOUT.confirmations,
    )
    _append_audit_event(
        "confirm_loop_started",
        {
            "interval_sec": interval_sec,
            "batch_size": batch_size,
            "chain_id": PAYMENT_CHECKOUT.chain_id,
            "confirmations": PAYMENT_CHECKOUT.confirmations,
        },
    )

    while True:
        try:
            intents = PAYMENT_CHECKOUT.list_pending_confirm_intents(limit=batch_size)
            scanned = len(intents)
            confirmed = 0
            already_confirmed = 0
            pending = 0
            failed = 0

            for row in intents:
                intent_id = str(row.get("intent_id") or "").strip()
                user_id = str(row.get("user_id") or "").strip()
                tx_hash = str(row.get("tx_hash") or "").strip().lower()
                if not intent_id or not user_id or not tx_hash:
                    continue
                try:
                    result: Dict[str, Any] = PAYMENT_CHECKOUT.confirm_intent_tx(
                        user_id=user_id,
                        intent_id=intent_id,
                        tx_hash=tx_hash,
                    )
                    if bool(result.get("already_confirmed")):
                        already_confirmed += 1
                    else:
                        confirmed += 1
                        logger.info(
                            "payment auto-confirmed intent={} user={} tx={}",
                            intent_id,
                            user_id,
                            _short_hash(tx_hash),
                        )
                except PaymentCheckoutError as exc:
                    if _is_pending_confirm_error(exc):
                        pending += 1
                        continue
                    failed += 1
                    logger.warning(
                        "payment auto-confirm failed intent={} user={} tx={} status={} detail={}",
                        intent_id,
                        user_id,
                        _short_hash(tx_hash),
                        exc.status_code,
                        exc.detail,
                    )

            if scanned and (confirmed or already_confirmed or failed):
                cycle_summary = {
                    "scanned": scanned,
                    "confirmed": confirmed,
                    "already_confirmed": already_confirmed,
                    "pending": pending,
                    "failed": failed,
                }
                logger.info(
                    "payment confirm cycle scanned={} confirmed={} already={} pending={} failed={}",
                    scanned,
                    confirmed,
                    already_confirmed,
                    pending,
                    failed,
                )
                _append_audit_event("confirm_loop_cycle", cycle_summary)
        except Exception as exc:
            logger.warning(f"payment confirm cycle failed: {exc}")
            _append_audit_event("confirm_loop_error", {"error": str(exc)})
        time.sleep(interval_sec)


def start_payment_confirm_loop():
    thread = threading.Thread(
        target=_runner,
        daemon=True,
        name="payment-confirm-loop",
    )
    thread.start()
    return thread
