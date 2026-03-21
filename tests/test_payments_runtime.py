from src.database.db_manager import DBManager
from src.payments.contract_checkout import (
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
