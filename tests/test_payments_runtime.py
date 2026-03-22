from src.database.db_manager import DBManager
from src.payments.contract_checkout import (
    PaymentCheckoutError,
    PaymentContractCheckoutService,
    PaymentIntentRecord,
)


def test_payment_runtime_state_and_audit_event_roundtrip(tmp_path):
    db_path = tmp_path / "payments.db"
    db = DBManager(str(db_path))

    db.set_payment_runtime_state("payment_event_loop", {"last_scanned_block": 123})
    db.append_payment_audit_event("event_loop_cycle", {"blocks": 10, "events": 2})

    state = db.get_payment_runtime_state("payment_event_loop")
    events = db.list_payment_audit_events(limit=10)

    assert state == {"last_scanned_block": 123}
    assert events
    assert events[0]["event_type"] == "event_loop_cycle"
    assert events[0]["payload"]["events"] == 2


def test_payment_checkout_parses_multiple_rpc_urls(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_RPC_URLS",
        "https://rpc-1.example,https://rpc-2.example",
    )
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))

    service = PaymentContractCheckoutService()
    status = service.get_rpc_runtime_status()

    assert service.rpc_urls == ["https://rpc-1.example", "https://rpc-2.example"]
    assert status["configured_rpc_count"] == 2
    assert status["all_rpc_urls"][0] == "https://rpc-1.example"


def test_confirm_intent_tx_repairs_confirmed_intent(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))

    service = PaymentContractCheckoutService()
    intent = PaymentIntentRecord(
        intent_id="intent-1",
        order_id_hex="0x" + "1" * 64,
        plan_code="pro_monthly",
        plan_id=101,
        chain_id=137,
        amount_units=5000000,
        amount_usdc="5",
        token_address="0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        token_decimals=6,
        token_symbol="USDC.e",
        receiver_address="0xed2f13aa5ff033c58fb436e178451cd07f693f32",
        status="confirmed",
        payment_mode="strict",
        allowed_wallet="0x1111111111111111111111111111111111111111",
        expires_at="2099-01-01T00:00:00+00:00",
        tx_hash="0x" + "2" * 64,
        metadata={},
    )

    monkeypatch.setattr(service, "get_intent", lambda user_id, intent_id: intent)
    monkeypatch.setattr(
        service,
        "_ensure_confirm_side_effects",
        lambda user_id, local_intent, tx_hash: {
            "payment": {"tx_hash": tx_hash},
            "subscription": {"plan_code": local_intent.plan_code},
        },
    )

    result = service.confirm_intent_tx("user-1", "intent-1")

    assert result["already_confirmed"] is True
    assert result["payment"]["tx_hash"] == intent.tx_hash
    assert result["subscription"]["plan_code"] == "pro_monthly"


def test_reconcile_latest_intent_confirms_submitted_first(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))

    service = PaymentContractCheckoutService()
    monkeypatch.setattr(
        service,
        "_rest",
        lambda method, table, **kwargs: [
            {
                "id": "intent-1",
                "plan_code": "pro_monthly",
                "plan_id": 101,
                "chain_id": 137,
                "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "receiver_address": "0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32",
                "amount_units": "5000000",
                "payment_mode": "strict",
                "allowed_wallet": "0x1111111111111111111111111111111111111111",
                "order_id_hex": "0x" + "1" * 64,
                "status": "submitted",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "tx_hash": "0x" + "2" * 64,
                "metadata": {},
            }
        ],
    )
    monkeypatch.setattr(
        service,
        "confirm_intent_tx",
        lambda user_id, intent_id, tx_hash=None: {
            "intent": {"intent_id": intent_id},
            "already_confirmed": False,
        },
    )

    result = service.reconcile_latest_intent("user-1")

    assert result["ok"] is True
    assert result["action"] == "confirmed_submitted_intent"


def test_confirm_intent_tx_repairs_side_effect_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))

    service = PaymentContractCheckoutService()
    submitted_intent = PaymentIntentRecord(
        intent_id="intent-2",
        order_id_hex="0x" + "1" * 64,
        plan_code="pro_monthly",
        plan_id=101,
        chain_id=137,
        amount_units=5000000,
        amount_usdc="5",
        token_address="0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        token_decimals=6,
        token_symbol="USDC.e",
        receiver_address="0xed2f13aa5ff033c58fb436e178451cd07f693f32",
        status="submitted",
        payment_mode="strict",
        allowed_wallet="0x1111111111111111111111111111111111111111",
        expires_at="2099-01-01T00:00:00+00:00",
        tx_hash="0x" + "2" * 64,
        metadata={},
    )
    confirmed_intent = PaymentIntentRecord(**{**submitted_intent.__dict__, "status": "confirmed"})
    intents = [submitted_intent, confirmed_intent]
    monkeypatch.setattr(
        service,
        "get_intent",
        lambda user_id, intent_id: intents.pop(0) if intents else confirmed_intent,
    )

    class _Eth:
        chain_id = 137
        block_number = 20

        @staticmethod
        def get_transaction(_tx_hash):
            return {
                "to": "0xed2f13aa5ff033c58fb436e178451cd07f693f32",
                "from": "0x1111111111111111111111111111111111111111",
            }

    class _Web3:
        eth = _Eth()

        @staticmethod
        def is_connected():
            return True

    monkeypatch.setattr(service, "_get_web3", lambda: _Web3())
    monkeypatch.setattr(
        service,
        "_wait_receipt",
        lambda _tx_hash: {
            "status": 1,
            "to": "0xed2f13aa5ff033c58fb436e178451cd07f693f32",
            "from": "0x1111111111111111111111111111111111111111",
            "blockNumber": 10,
        },
    )
    monkeypatch.setattr(service, "_extract_matching_event", lambda receipt, intent: {"ok": True})
    monkeypatch.setattr(service, "_consume_points_for_intent", lambda user_id, intent: {"applied": False})
    monkeypatch.setattr(service, "_select_plan", lambda plan_code: {"duration_days": 30})
    monkeypatch.setattr(service, "_insert_payment_record", lambda **kwargs: {"tx_hash": kwargs["tx_hash"]})
    monkeypatch.setattr(
        service,
        "_grant_subscription",
        lambda **kwargs: (_ for _ in ()).throw(PaymentCheckoutError(502, "subscription insert failed")),
    )
    monkeypatch.setattr(
        service,
        "_ensure_confirm_side_effects",
        lambda user_id, local_intent, tx_hash: {
            "payment": {"tx_hash": tx_hash},
            "subscription": {"plan_code": local_intent.plan_code, "status": "active"},
        },
    )
    monkeypatch.setattr(service, "_notify_telegram", lambda **kwargs: None)

    def _fake_rest(method, table, **kwargs):
        if method == "PATCH" and table == "payment_intents":
            return [{"id": "intent-2", "status": "confirmed"}]
        if method == "POST" and table == "payment_transactions":
            return [{"tx_hash": "0x" + "2" * 64, "status": "confirmed"}]
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.confirm_intent_tx("user-1", "intent-2")

    assert result["subscription"]["status"] == "active"
    assert any(
        event["event_type"] == "payment_confirm_repaired"
        for event in service._db.list_payment_audit_events(limit=10)
    )


def test_reconcile_recent_intents_dedupes_users(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))

    service = PaymentContractCheckoutService()
    monkeypatch.setattr(
        service,
        "_rest",
        lambda method, table, **kwargs: [
            {"id": "a", "user_id": "user-1", "status": "confirmed", "updated_at": "2026-03-22T01:00:00+00:00"},
            {"id": "b", "user_id": "user-1", "status": "submitted", "updated_at": "2026-03-22T00:59:00+00:00"},
            {"id": "c", "user_id": "user-2", "status": "submitted", "updated_at": "2026-03-22T00:58:00+00:00"},
        ],
    )
    seen = []
    monkeypatch.setattr(
        service,
        "reconcile_latest_intent",
        lambda user_id: seen.append(user_id) or {"ok": True, "subscription": {"user_id": user_id}},
    )

    result = service.reconcile_recent_intents(limit=10)

    assert result["processed_users"] == 2
    assert result["repaired_users"] == 2
    assert seen == ["user-1", "user-2"]
