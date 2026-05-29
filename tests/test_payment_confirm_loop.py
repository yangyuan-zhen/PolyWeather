from __future__ import annotations

import pytest

from src.payments import confirm_loop


class _StopLoop(Exception):
    pass


class _FakeCheckout:
    enabled = True
    chain_id = 137
    confirmations = 2

    def __init__(self, batches):
        self._batches = list(batches)
        self.confirmed = []

    def list_pending_confirm_intents(self, limit):
        if not self._batches:
            return []
        return self._batches.pop(0)

    def confirm_intent_tx(self, *, user_id, intent_id, tx_hash):
        self.confirmed.append(
            {"user_id": user_id, "intent_id": intent_id, "tx_hash": tx_hash}
        )
        return {"already_confirmed": True}


def _run_until_sleep_count(monkeypatch, checkout, sleep_count):
    sleeps = []

    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED", "true")

    def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= sleep_count:
            raise _StopLoop

    monkeypatch.setattr(confirm_loop, "PAYMENT_CHECKOUT", checkout)
    monkeypatch.setattr(confirm_loop, "_append_audit_event", lambda *_args: None)
    monkeypatch.setattr(confirm_loop.time, "sleep", fake_sleep)

    with pytest.raises(_StopLoop):
        confirm_loop._runner()

    return sleeps


def test_confirm_loop_uses_idle_interval_after_repeated_empty_cycles(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC", "20")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_INTERVAL_SEC", "300")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_AFTER_EMPTY_CYCLES", "2")

    sleeps = _run_until_sleep_count(
        monkeypatch,
        _FakeCheckout(batches=[[], []]),
        sleep_count=2,
    )

    assert sleeps == [20, 300]


def test_confirm_loop_returns_to_active_interval_when_intent_is_found(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC", "20")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_INTERVAL_SEC", "300")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_AFTER_EMPTY_CYCLES", "1")
    checkout = _FakeCheckout(
        batches=[
            [],
            [
                {
                    "intent_id": "intent-1",
                    "user_id": "user-1",
                    "tx_hash": "0x" + "a" * 64,
                }
            ],
        ]
    )

    sleeps = _run_until_sleep_count(monkeypatch, checkout, sleep_count=2)

    assert sleeps == [300, 20]
    assert checkout.confirmed == [
        {
            "intent_id": "intent-1",
            "user_id": "user-1",
            "tx_hash": "0x" + "a" * 64,
        }
    ]
