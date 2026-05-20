from src.payments.contract_checkout import PaymentContractCheckoutService, PaymentIntentRecord


def _setup_env(monkeypatch, tmp_path):
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


def test_direct_intent_does_not_require_bound_wallet(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    posts = []

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "user_wallets":
            return []
        if method == "POST" and table == "payment_intents":
            payload = dict(kwargs["payload"])
            payload["id"] = "intent-direct-1"
            payload["tx_hash"] = None
            posts.append(payload)
            return [payload]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service.create_intent("user-1", "pro_monthly", payment_mode="direct")

    assert result["intent"]["payment_mode"] == "direct"
    assert result["intent"]["allowed_wallet"] is None
    assert "direct_payment" in result
    assert result["direct_payment"]["receiver_address"] == "0xed2f13aa5ff033c58fb436e178451cd07f693f32"
    assert result["direct_payment"]["amount_usdc"] in ("5", "10")
    assert posts[0]["payment_mode"] == "direct"


def test_direct_submit_tx_does_not_require_from_address(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    submitted = {}

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

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "payment_transactions":
            return []
        if method == "PATCH" and table == "payment_intents":
            submitted.update(kwargs["payload"])
            return [{"ok": True}]
        if method == "POST" and table == "payment_transactions":
            return [kwargs["payload"]]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service.submit_intent_tx("user-1", "intent-direct-1", "0x" + "2" * 64, "")

    assert result["status"] == "submitted"
    assert result["from_address"] is None
    assert submitted["tx_hash"] == "0x" + "2" * 64



def test_confirm_direct_transfer_uses_erc20_transfer_without_wallet_binding(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    tx_hash = "0x" + "3" * 64
    intent = PaymentIntentRecord(
        intent_id="intent-direct-2",
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
        payment_mode="direct",
        allowed_wallet=None,
        expires_at="2099-01-01T00:00:00+00:00",
        tx_hash=tx_hash,
        metadata={},
    )
    confirmed_intent = PaymentIntentRecord(**{**intent.__dict__, "status": "confirmed"})
    intents = [intent, confirmed_intent]
    rest_calls = []

    monkeypatch.setattr(service, "get_intent", lambda user_id, intent_id: intents.pop(0) if intents else confirmed_intent)

    class _Eth:
        chain_id = 137
        block_number = 20

        @staticmethod
        def get_transaction(_tx_hash):
            return {
                "to": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "from": "0x9999999999999999999999999999999999999999",
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
            "to": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "from": "0x9999999999999999999999999999999999999999",
            "blockNumber": 10,
        },
    )
    monkeypatch.setattr(
        service,
        "_extract_direct_transfer_event",
        lambda receipt, local_intent: {
            "from": "0x9999999999999999999999999999999999999999",
            "to": local_intent.receiver_address,
            "token_address": local_intent.token_address,
            "amount_units": local_intent.amount_units,
        },
    )
    monkeypatch.setattr(service, "_consume_points_for_intent", lambda user_id, local_intent: {"applied": False})
    monkeypatch.setattr(service, "_select_plan", lambda plan_code: {"duration_days": 30})
    monkeypatch.setattr(service, "_insert_payment_record", lambda **kwargs: {"tx_hash": kwargs["tx_hash"]})
    monkeypatch.setattr(service, "_grant_subscription", lambda **kwargs: {"status": "active", "plan_code": kwargs["plan_code"]})
    monkeypatch.setattr(service, "_notify_telegram", lambda **kwargs: None)

    def fake_rest(method, table, **kwargs):
        rest_calls.append((method, table, kwargs))
        if method == "GET" and table == "payment_transactions":
            return []
        if method == "PATCH" and table == "payment_intents":
            return [{"id": intent.intent_id, "status": "confirmed"}]
        if method == "POST" and table == "payment_transactions":
            return [kwargs["payload"]]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)
    monkeypatch.setattr(service, "_require_user_wallet", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("wallet not required")))

    result = service.confirm_intent_tx("user-1", intent.intent_id, tx_hash)

    assert result["subscription"]["status"] == "active"
    assert result["tx"]["event"]["amount_units"] == 5000000
    assert any(call[1] == "payment_transactions" for call in rest_calls)

def test_submit_rejects_tx_hash_used_by_another_intent(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    tx_hash = "0x" + "4" * 64
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

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "payment_transactions":
            return [{"intent_id": "other-intent", "tx_hash": tx_hash, "status": "confirmed"}]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    try:
        service.submit_intent_tx("user-1", "intent-direct-3", tx_hash, "")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409
        assert "tx_hash already used" in getattr(exc, "detail", "")
    else:
        raise AssertionError("expected duplicate tx_hash rejection")


def test_submit_marks_late_tx_as_refund_required_after_intent_paid(monkeypatch, tmp_path):
    _setup_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    paid_tx = "0x" + "5" * 64
    late_tx = "0x" + "6" * 64
    duplicate_rows = []
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
                "status": "confirmed",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "tx_hash": paid_tx,
                "metadata": {},
            }
        ),
    )

    def fake_rest(method, table, **kwargs):
        if method == "POST" and table == "payment_transactions":
            duplicate_rows.append(kwargs["payload"])
            return [kwargs["payload"]]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    try:
        service.submit_intent_tx("user-1", "intent-direct-paid", late_tx, "")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409
        assert "已支付" in getattr(exc, "detail", "")
    else:
        raise AssertionError("expected already-paid rejection")

    assert duplicate_rows[0]["tx_hash"] == late_tx
    assert duplicate_rows[0]["status"] == "refund_required"
    assert duplicate_rows[0]["payment_method"] == "direct"
