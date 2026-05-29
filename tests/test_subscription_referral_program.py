from datetime import datetime, timezone

from src.auth.supabase_entitlement import SupabaseEntitlementService
from src.payments.contract_checkout import PaymentContractCheckoutService


def _payment_env(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc","address":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","decimals":6,"receiver_contract":"0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a","direct_receiver_address":"0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a","is_default":true}]',
    )
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))
    monkeypatch.delenv("POLYWEATHER_PAYMENT_PLAN_CATALOG_JSON", raising=False)
    monkeypatch.delenv("POLYWEATHER_PAYMENT_ALLOWED_PLAN_CODES", raising=False)


def test_default_payment_catalog_has_monthly_and_quarterly_prices(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()

    plans = {
        row["plan_code"]: row for row in service.get_config_payload()["plans"]
    }

    assert plans["pro_monthly"]["amount_usdc"] == "29.9"
    assert plans["pro_monthly"]["duration_days"] == 30
    assert plans["pro_quarterly"]["amount_usdc"] == "79.9"
    assert plans["pro_quarterly"]["duration_days"] == 90


def test_paid_subscription_replaces_active_signup_trial_immediately(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    writes = []

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "subscriptions":
            return [
                {
                    "starts_at": "2026-05-29T00:00:00+00:00",
                    "expires_at": "2026-06-01T00:00:00+00:00",
                    "plan_code": "signup_trial_3d",
                    "source": "signup_trial",
                }
            ]
        if method == "POST" and table in {"subscriptions", "entitlement_events"}:
            writes.append({"table": table, "payload": kwargs["payload"]})
            return []
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service._grant_subscription(
        user_id="user-1",
        plan_code="pro_monthly",
        duration_days=30,
        tx_hash="0x" + "1" * 64,
        payload={"kind": "paid"},
    )

    starts = datetime.fromisoformat(result["starts_at"])
    expires = datetime.fromisoformat(result["expires_at"])
    assert result["source"] == "payment"
    assert starts.date() == datetime.now(timezone.utc).date()
    assert 29 <= (expires - starts).days <= 30


def test_signup_trial_claim_creates_three_day_trial_once(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_AUTH_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    service = SupabaseEntitlementService()
    calls = []

    def fake_rest(method, table, **kwargs):
        calls.append({"method": method, "table": table, **kwargs})
        if method == "GET" and table in {"trial_claims", "user_wallets"}:
            return []
        if method == "POST" and table in {"trial_claims", "subscriptions", "entitlement_events"}:
            return [kwargs.get("payload") or {}]
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service.ensure_signup_trial("user-1", "USER@example.com")

    assert result["created"] is True
    sub_write = next(call for call in calls if call["table"] == "subscriptions")
    payload = sub_write["payload"]
    assert payload["plan_code"] == "signup_trial_3d"
    assert payload["source"] == "signup_trial"
    assert payload["status"] == "active"
    assert payload["user_id"] == "user-1"


def test_referral_discount_applies_to_first_monthly_payment(monkeypatch, tmp_path):
    _payment_env(monkeypatch, tmp_path)
    service = PaymentContractCheckoutService()
    intent_posts = []

    monkeypatch.setattr(
        service,
        "_get_pending_referral_attribution",
        lambda user_id: {
            "id": 7,
            "code": "YUAN2026",
            "referrer_user_id": "referrer-1",
        },
        raising=False,
    )
    monkeypatch.setattr(
        service,
        "_has_prior_paid_subscription",
        lambda user_id: False,
        raising=False,
    )

    def fake_rest(method, table, **kwargs):
        if method == "POST" and table == "payment_intents":
            intent_posts.append(kwargs["payload"])
            return []
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service.create_intent(
        user_id="referred-1",
        plan_code="pro_monthly",
        payment_mode="direct",
    )

    assert result["plan"]["amount_before_discount_usdc"] == "29.9"
    assert result["plan"]["amount_after_discount_usdc"] == "26.9"
    assert intent_posts[0]["amount_units"] == "26900000"
    assert intent_posts[0]["metadata"]["referral_discount"]["discount_usdc"] == "3"


def test_referral_reward_respects_monthly_ten_invite_cap(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_AUTH_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    service = SupabaseEntitlementService()
    writes = []

    def fake_rest(method, table, **kwargs):
        if method == "GET" and table == "referral_attributions":
            return [
                {
                    "id": 77,
                    "referrer_user_id": "referrer-1",
                    "referred_user_id": "referred-1",
                    "status": "pending",
                }
            ]
        if method == "GET" and table == "referral_rewards":
            return [{"id": i} for i in range(10)]
        if method in {"POST", "PATCH"}:
            writes.append({"method": method, "table": table, **kwargs})
            return []
        raise AssertionError((method, table, kwargs))

    monkeypatch.setattr(service, "_rest", fake_rest)

    result = service.settle_referral_reward(
        referred_user_id="referred-1",
        payment_intent_id="intent-1",
        tx_hash="0x" + "2" * 64,
    )

    assert result["awarded"] is False
    assert result["reason"] == "monthly_cap_reached"
    assert not any(call["table"] == "subscriptions" for call in writes)
