from src.database.db_manager import DBManager
from src.payments.contract_checkout import PaymentContractCheckoutService


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
