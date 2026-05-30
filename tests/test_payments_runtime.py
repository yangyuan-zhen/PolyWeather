from datetime import datetime, timedelta, timezone

from src.database.db_manager import DBManager
from src.payments.contract_checkout import (
    PaymentCheckoutError,
    PaymentContractCheckoutService,
    PaymentIntentRecord,
)


def _payment_env(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))
    monkeypatch.delenv("POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS", raising=False)


def test_wallet_challenge_insert_uses_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.create_wallet_challenge(
        "user-1",
        "0x1111111111111111111111111111111111111111",
    )

    assert result["address"] == "0x1111111111111111111111111111111111111111"
    assert calls[0]["table"] == "wallet_link_challenges"
    assert calls[0]["prefer"] == "return=minimal"


def test_entitlement_event_insert_uses_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "subscriptions":
            return []
        if method == "POST" and table == "subscriptions":
            return [kwargs.get("payload") or {}]
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    service._grant_subscription(
        user_id="user-1",
        plan_code="pro_monthly",
        duration_days=30,
        tx_hash="0x" + "1" * 64,
        payload={"kind": "test"},
    )

    entitlement_event = next(call for call in calls if call["table"] == "entitlement_events")
    assert entitlement_event["prefer"] == "return=minimal"


def test_subscription_insert_uses_minimal_return_and_local_payload(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "subscriptions":
            return []
        if method == "POST" and table == "subscriptions":
            return []
        if method == "POST" and table == "entitlement_events":
            return []
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service._grant_subscription(
        user_id="user-1",
        plan_code="pro_monthly",
        duration_days=30,
        tx_hash="0x" + "1" * 64,
        payload={"kind": "test"},
    )

    subscription_write = next(
        call for call in calls if call["method"] == "POST" and call["table"] == "subscriptions"
    )
    assert subscription_write["prefer"] == "return=minimal"
    assert result == subscription_write["payload"]
    assert result["user_id"] == "user-1"
    assert result["plan_code"] == "pro_monthly"
    assert result["status"] == "active"


def test_wallet_binding_writes_use_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    address = "0x1111111111111111111111111111111111111111"
    calls = []

    monkeypatch.setattr(
        "src.payments.contract_checkout.Account.recover_message",
        lambda *args, **kwargs: address,
    )

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "wallet_link_challenges":
            return [
                {
                    "id": "challenge-1",
                    "user_id": "user-1",
                    "address": address,
                    "nonce": "nonce-1",
                    "message": "message",
                    "expires_at": "2099-01-01T00:00:00+00:00",
                    "consumed_at": None,
                }
            ]
        if method == "GET" and table == "user_wallets":
            return []
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.verify_wallet_binding("user-1", address, "nonce-1", "0xsig")

    assert result.address == address
    writes = [call for call in calls if call["method"] in {"POST", "PATCH"}]
    assert writes[0]["table"] == "user_wallets"
    assert writes[0]["prefer"] == "resolution=merge-duplicates,return=minimal"
    assert writes[1]["table"] == "wallet_link_challenges"
    assert writes[1]["prefer"] == "return=minimal"


def test_require_user_wallet_selects_only_status(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return [{"status": "active"}]

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service._require_user_wallet(
        "user-1",
        "0x1111111111111111111111111111111111111111",
    )

    assert result == {"status": "active"}
    assert calls[0]["params"]["select"] == "status"


def test_list_wallets_omits_status_from_active_wallet_query(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return [
            {
                "chain_id": 137,
                "address": "0x1111111111111111111111111111111111111111",
                "is_primary": True,
                "verified_at": "2099-01-01T00:00:00+00:00",
            }
        ]

    monkeypatch.setattr(service, "_rest", _fake_rest)

    wallets = service.list_wallets("user-1")

    assert calls[0]["params"]["select"] == "chain_id,address,is_primary,verified_at"
    assert wallets[0].status == "active"


def test_wallet_binding_existing_lookup_selects_only_owner_status(
    monkeypatch,
    tmp_path,
):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    address = "0x1111111111111111111111111111111111111111"
    calls = []

    monkeypatch.setattr(
        "src.payments.contract_checkout.Account.recover_message",
        lambda *args, **kwargs: address,
    )

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "wallet_link_challenges":
            return [
                {
                    "id": "challenge-1",
                    "user_id": "user-1",
                    "address": address,
                    "nonce": "nonce-1",
                    "message": "message",
                    "expires_at": "2099-01-01T00:00:00+00:00",
                    "consumed_at": None,
                }
            ]
        if method == "GET" and table == "user_wallets":
            return []
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    service.verify_wallet_binding("user-1", address, "nonce-1", "0xsig")

    existing_lookup = [
        call
        for call in calls
        if call["method"] == "GET"
        and call["table"] == "user_wallets"
        and "address" in call["params"]
    ][0]
    assert existing_lookup["params"]["select"] == "user_id,status"

    challenge_lookup = [
        call
        for call in calls
        if call["method"] == "GET"
        and call["table"] == "wallet_link_challenges"
    ][0]
    assert challenge_lookup["params"]["select"] == "id,message,expires_at"
    assert "order" not in challenge_lookup["params"]


def test_wallet_unbind_writes_use_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    monkeypatch.setattr(service, "_require_user_wallet", lambda *args, **kwargs: {})

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "user_wallets" and kwargs["params"].get("is_primary") == "eq.true":
            return []
        if method == "GET" and table == "user_wallets":
            return [{"id": "wallet-2", "address": "0x2222222222222222222222222222222222222222"}]
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.unbind_wallet("user-1", "0x1111111111111111111111111111111111111111")

    assert result["new_primary"] == "0x2222222222222222222222222222222222222222"
    writes = [call for call in calls if call["method"] == "PATCH"]
    assert [call["prefer"] for call in writes] == ["return=minimal", "return=minimal"]


def test_submit_intent_status_patch_uses_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    monkeypatch.setattr(
        service,
        "get_intent",
        lambda user_id, intent_id: service._serialize_intent(
            {
                "id": intent_id,
                "plan_code": "pro_monthly",
                "plan_id": 101,
                "chain_id": 137,
                "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "receiver_address": "0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32",
                "amount_units": "5000000",
                "payment_mode": "direct",
                "allowed_wallet": None,
                "order_id_hex": "0x" + "1" * 64,
                "status": "created",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "tx_hash": None,
                "metadata": {},
            }
        ),
    )
    monkeypatch.setattr(
        service,
        "_validate_loaded_intent_tx",
        lambda *args, **kwargs: {"valid": True, "checks": {"tx_mined": True}},
    )

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "payment_transactions":
            return []
        if method == "POST" and table == "payment_transactions":
            return []
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.submit_intent_tx("user-1", "intent-1", "0x" + "2" * 64, "")

    assert result["status"] == "submitted"
    intent_patch = next(call for call in calls if call["method"] == "PATCH")
    assert intent_patch["table"] == "payment_intents"
    assert intent_patch["prefer"] == "return=minimal"
    transaction_write = next(
        call
        for call in calls
        if call["method"] == "POST" and call["table"] == "payment_transactions"
    )
    assert transaction_write["prefer"] == "resolution=merge-duplicates,return=minimal"
    assert result["transaction"]["tx_hash"] == "0x" + "2" * 64


def test_submit_intent_tx_reuses_loaded_intent_for_validation(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    intent = service._serialize_intent(
        {
            "id": "intent-1",
            "plan_code": "pro_monthly",
            "plan_id": 101,
            "chain_id": 137,
            "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "receiver_address": "0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32",
            "amount_units": "5000000",
            "payment_mode": "direct",
            "allowed_wallet": None,
            "order_id_hex": "0x" + "1" * 64,
            "status": "created",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "tx_hash": None,
            "metadata": {},
        }
    )
    calls = {"get_intent": 0}
    rest_calls = []

    class _FakeEth:
        def get_transaction_receipt(self, tx_hash):
            return {"status": 1, "to": intent.receiver_address, "blockNumber": 123}

    class _FakeWeb3:
        eth = _FakeEth()

    def _fake_get_intent(user_id, intent_id):
        calls["get_intent"] += 1
        return intent

    def _fake_rest(method, table, **kwargs):
        rest_calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table == "payment_transactions":
            return []
        if method == "POST" and table == "payment_transactions":
            return [kwargs["payload"]]
        return []

    monkeypatch.setattr(service, "get_intent", _fake_get_intent)
    monkeypatch.setattr(service, "_get_web3", lambda *args, **kwargs: _FakeWeb3())
    monkeypatch.setattr(
        service,
        "_extract_direct_transfer_event",
        lambda receipt, loaded_intent: {
            "from": "0x2222222222222222222222222222222222222222",
            "to": loaded_intent.receiver_address,
            "amount_units": int(loaded_intent.amount_units),
        },
    )
    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.submit_intent_tx("user-1", "intent-1", "0x" + "2" * 64, "")

    assert result["status"] == "submitted"
    assert calls["get_intent"] == 1
    assert [call["table"] for call in rest_calls].count("payment_transactions") == 2


def test_failed_intent_writes_use_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []
    intent = PaymentIntentRecord(
        intent_id="intent-1",
        order_id_hex="0x" + "1" * 64,
        plan_code="pro_monthly",
        plan_id=101,
        chain_id=137,
        amount_units=5_000_000,
        amount_usdc="5",
        token_address="0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        token_decimals=6,
        token_symbol="USDC",
        receiver_address="0xed2f13aa5ff033c58fb436e178451cd07f693f32",
        status="submitted",
        payment_mode="direct",
        allowed_wallet=None,
        expires_at="2099-01-01T00:00:00+00:00",
        tx_hash=None,
        metadata={},
    )

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    service._mark_intent_failed(
        user_id="user-1",
        intent=intent,
        tx_hash="0x" + "3" * 64,
        reason="test_failure",
        detail="test",
    )

    assert calls[0]["table"] == "payment_intents"
    assert calls[0]["prefer"] == "return=minimal"
    assert calls[1]["table"] == "payment_transactions"
    assert calls[1]["prefer"] == "resolution=merge-duplicates,return=minimal"


def test_duplicate_transaction_write_uses_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []
    intent = PaymentIntentRecord(
        intent_id="intent-1",
        order_id_hex="0x" + "1" * 64,
        plan_code="pro_monthly",
        plan_id=101,
        chain_id=137,
        amount_units=5_000_000,
        amount_usdc="5",
        token_address="0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        token_decimals=6,
        token_symbol="USDC",
        receiver_address="0xed2f13aa5ff033c58fb436e178451cd07f693f32",
        status="confirmed",
        payment_mode="direct",
        allowed_wallet=None,
        expires_at="2099-01-01T00:00:00+00:00",
        tx_hash="0x" + "2" * 64,
        metadata={},
    )

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service._record_duplicate_transaction(
        intent=intent,
        tx_hash="0x" + "3" * 64,
        from_address="0x2222222222222222222222222222222222222222",
        status="refund_required",
    )

    assert result == {}
    assert calls[0]["table"] == "payment_transactions"
    assert calls[0]["prefer"] == "resolution=merge-duplicates,return=minimal"


def test_payment_record_upsert_uses_minimal_return(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service._insert_payment_record(
        user_id="user-1",
        tx_hash="0x" + "4" * 64,
        amount_units=5_000_000,
        token_address="0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        chain_id=137,
        payload={"kind": "test"},
    )

    assert calls[0]["table"] == "payments"
    assert calls[0]["prefer"] == "resolution=merge-duplicates,return=minimal"
    assert result["tx_hash"] == "0x" + "4" * 64
    assert result["status"] == "confirmed"
    assert result["amount"] == "5"


def test_create_intent_insert_uses_minimal_return_and_local_payload(
    monkeypatch, tmp_path
):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "POST" and table == "payment_intents":
            return []
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.create_intent(
        "00000000-0000-0000-0000-000000000001",
        "pro_monthly",
        payment_mode="direct",
    )

    intent_write = calls[0]
    payload = intent_write["payload"]
    assert intent_write["prefer"] == "return=minimal"
    assert payload["id"] == result["intent"]["intent_id"]
    assert payload["order_id_hex"] == result["intent"]["order_id_hex"]
    assert result["intent"]["status"] == "created"
    assert result["direct_payment"]["amount_units"] == str(payload["amount_units"])


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


def test_paid_subscription_replaces_active_trial_immediately(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    now = datetime.now(timezone.utc)
    trial_expires = now + timedelta(days=2)
    inserted = []

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "subscriptions":
            return [
                {
                    "id": "trial-1",
                    "expires_at": trial_expires.isoformat(),
                    "status": "active",
                    "plan_code": "signup_trial_3d",
                    "source": "signup_trial",
                    "starts_at": (now - timedelta(days=1)).isoformat(),
                }
            ]
        if method == "POST" and table == "subscriptions":
            inserted.append(kwargs["payload"])
            return [kwargs["payload"]]
        if method == "POST" and table == "entitlement_events":
            return [kwargs["payload"]]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    row = service._grant_subscription(
        user_id="user-1",
        plan_code="pro_monthly",
        duration_days=30,
        tx_hash="0x" + "7" * 64,
        payload={},
    )

    starts_at = datetime.fromisoformat(str(row["starts_at"]))
    expires_at = datetime.fromisoformat(str(row["expires_at"]))
    assert starts_at.date() == datetime.now(timezone.utc).date()
    assert expires_at == starts_at + timedelta(days=30)


def test_confirm_side_effect_repair_does_not_treat_trial_as_paid(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    intent = PaymentIntentRecord(
        intent_id="intent-trial-repair",
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
        tx_hash="0x" + "8" * 64,
        metadata={},
    )
    trial_row = {"plan_code": "signup_trial_3d", "source": "signup_trial"}
    granted = []

    monkeypatch.setattr(
        "src.payments.contract_checkout.SUPABASE_ENTITLEMENT.get_latest_active_subscription",
        lambda user_id, respect_requirement=False: trial_row,
    )
    monkeypatch.setattr(
        "src.payments.contract_checkout.SUPABASE_ENTITLEMENT.invalidate_subscription_cache",
        lambda user_id: None,
    )
    monkeypatch.setattr(service, "_select_plan", lambda plan_code: {"duration_days": 30})
    monkeypatch.setattr(
        service,
        "_grant_subscription",
        lambda **kwargs: granted.append(kwargs)
        or {"plan_code": kwargs["plan_code"], "status": "active"},
    )

    result = service._ensure_confirmed_subscription("user-1", intent, intent.tx_hash or "")

    assert result["plan_code"] == "pro_monthly"
    assert granted


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


def test_reconcile_latest_intent_reuses_confirmed_row_after_repair(monkeypatch, tmp_path):
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
                "status": "confirmed",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "tx_hash": "0x" + "2" * 64,
                "metadata": {},
            }
        ],
    )
    monkeypatch.setattr(
        service,
        "get_intent",
        lambda user_id, intent_id: (_ for _ in ()).throw(
            AssertionError("confirmed repair should reuse loaded row")
        ),
    )
    monkeypatch.setattr(
        service,
        "_ensure_confirm_side_effects",
        lambda user_id, local_intent, tx_hash: {
            "payment": {"tx_hash": tx_hash},
            "subscription": {"plan_code": local_intent.plan_code},
        },
    )

    result = service.reconcile_latest_intent("user-1")

    assert result["ok"] is True
    assert result["action"] == "reconciled_confirmed_intent"
    assert result["intent"]["intent_id"] == "intent-1"


def test_reconcile_latest_intent_without_candidates_does_not_clear_subscription_cache(
    monkeypatch,
    tmp_path,
):
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
                "id": "intent-created",
                "plan_code": "pro_monthly",
                "plan_id": 101,
                "chain_id": 137,
                "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "receiver_address": "0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32",
                "amount_units": "5000000",
                "payment_mode": "strict",
                "allowed_wallet": "0x1111111111111111111111111111111111111111",
                "order_id_hex": "0x" + "1" * 64,
                "status": "created",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "tx_hash": None,
                "metadata": {},
            }
        ],
    )

    invalidations = []
    monkeypatch.setattr(
        "src.payments.contract_checkout.SUPABASE_ENTITLEMENT.invalidate_subscription_cache",
        lambda user_id: invalidations.append(user_id),
    )
    monkeypatch.setattr(
        "src.payments.contract_checkout.SUPABASE_ENTITLEMENT.get_latest_active_subscription",
        lambda user_id, respect_requirement=False: {
            "plan_code": "pro_monthly",
            "expires_at": "2099-01-01T00:00:00+00:00",
        },
    )

    result = service.reconcile_latest_intent("user-1")

    assert result["ok"] is True
    assert result["action"] == "checked_without_repair"
    assert invalidations == []


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

    monkeypatch.setattr(service, "_get_web3", lambda *args, **kwargs: _Web3())
    monkeypatch.setattr(
        service,
        "_wait_receipt",
        lambda _tx_hash, *args, **kwargs: {
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


def test_reconcile_recent_intents_selects_only_user_ids(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return [{"user_id": "user-1"}, {"user_id": "user-1"}, {"user_id": "user-2"}]

    seen = []
    monkeypatch.setattr(service, "_rest", _fake_rest)
    monkeypatch.setattr(
        service,
        "reconcile_latest_intent",
        lambda user_id: seen.append(user_id) or {"ok": True, "subscription": {"user_id": user_id}},
    )

    result = service.reconcile_recent_intents(limit=10)

    assert calls[0]["params"]["select"] == "user_id"
    assert seen == ["user-1", "user-2"]
    assert result["processed_users"] == 2


def test_pending_confirm_intents_selects_only_confirm_loop_fields(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return [
            {
                "id": "intent-1",
                "user_id": "user-1",
                "chain_id": 137,
                "tx_hash": "0x" + "2" * 64,
            }
        ]

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.list_pending_confirm_intents(limit=20)

    assert result == [
        {
            "intent_id": "intent-1",
            "user_id": "user-1",
            "chain_id": 137,
            "tx_hash": "0x" + "2" * 64,
        }
    ]
    assert calls[0]["params"]["select"] == "id,user_id,tx_hash,chain_id"


def test_open_intents_by_order_id_selects_only_event_loop_fields(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        return [
            {
                "id": "intent-1",
                "user_id": "user-1",
                "status": "submitted",
                "tx_hash": "0x" + "2" * 64,
                "plan_id": 101,
                "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "amount_units": "5000000",
            }
        ]

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service.list_open_intents_by_order_id("0x" + "1" * 64)

    assert result == [
        {
            "intent_id": "intent-1",
            "user_id": "user-1",
            "status": "submitted",
            "tx_hash": "0x" + "2" * 64,
            "plan_id": 101,
            "token_address": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
            "amount_units": 5000000,
        }
    ]
    assert (
        calls[0]["params"]["select"]
        == "id,user_id,status,tx_hash,plan_id,token_address,amount_units"
    )


def test_tx_hash_unused_check_selects_only_intent_id(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    calls = []

    def _fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if table == "payment_transactions":
            return [{"intent_id": "intent-1"}]
        if table == "payment_intents":
            return [{"id": "intent-1"}]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", _fake_rest)

    service._ensure_tx_hash_unused("0x" + "1" * 64, "intent-1")

    assert calls[0]["params"]["select"] == "intent_id"
    assert calls[1]["params"]["select"] == "id"


def test_tx_hash_unused_check_rejects_existing_intent_tx_hash(
    monkeypatch,
    tmp_path,
):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()

    def _fake_rest(method, table, **kwargs):
        if table == "payment_transactions":
            return []
        if table == "payment_intents":
            return [{"id": "other-intent"}]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", _fake_rest)

    try:
        service._ensure_tx_hash_unused("0x" + "1" * 64, "intent-1")
    except PaymentCheckoutError as exc:
        assert exc.status_code == 409
        assert "tx_hash already used" in exc.detail
    else:
        raise AssertionError("expected duplicate tx_hash rejection")


def test_grant_subscription_keeps_unknown_active_subscription_extension(monkeypatch, tmp_path):
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
    trial_end = datetime.now(timezone.utc) + timedelta(days=2)
    captured_post = {}

    def _fake_rest(method, table, **kwargs):
        if method == "GET" and table == "subscriptions":
            assert kwargs["params"]["select"] == "starts_at,expires_at,plan_code,source"
            return [
                {
                    "starts_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
                    "expires_at": trial_end.isoformat(),
                }
            ]
        if method == "POST" and table == "subscriptions":
            captured_post.update(kwargs.get("payload") or {})
            return [captured_post]
        if method == "POST" and table == "entitlement_events":
            return [{"ok": True}]
        return []

    monkeypatch.setattr(service, "_rest", _fake_rest)

    result = service._grant_subscription(
        user_id="user-1",
        plan_code="pro_monthly",
        duration_days=30,
        tx_hash="0x" + "1" * 64,
        payload={"kind": "test"},
    )

    starts_at = datetime.fromisoformat(str(result["starts_at"]).replace("Z", "+00:00"))

    assert starts_at == trial_end
