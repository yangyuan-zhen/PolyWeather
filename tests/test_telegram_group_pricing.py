import hashlib
import hmac
import time
from decimal import Decimal

import pytest

from src.auth.telegram_group_pricing import (
    TelegramGroupPricing,
    verify_telegram_login_payload,
)
from src.payments.contract_checkout import PaymentContractCheckoutService


def _signed_payload(bot_token: str, **overrides):
    payload = {
        "id": "12345",
        "first_name": "Ada",
        "username": "ada",
        "auth_date": str(int(time.time())),
    }
    payload.update({key: str(value) for key, value in overrides.items()})
    data_check = "\n".join(
        f"{key}={payload[key]}" for key in sorted(payload.keys()) if key != "hash"
    )
    secret = hashlib.sha256(bot_token.encode("utf-8")).digest()
    payload["hash"] = hmac.new(
        secret,
        data_check.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return payload


def test_verify_telegram_login_payload_accepts_valid_hash(monkeypatch):
    payload = _signed_payload("bot-token")

    result = verify_telegram_login_payload(payload, "bot-token", max_age_sec=60)

    assert result["telegram_id"] == 12345
    assert result["username"] == "ada"


def test_verify_telegram_login_payload_rejects_tampered_hash():
    payload = _signed_payload("bot-token")
    payload["id"] = "999"

    with pytest.raises(ValueError, match="invalid telegram login hash"):
        verify_telegram_login_payload(payload, "bot-token", max_age_sec=60)


def test_group_pricing_treats_member_status_as_group_member(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    monkeypatch.setenv("POLYWEATHER_GROUP_MEMBER_PRICE_USDC", "5")
    monkeypatch.setenv("POLYWEATHER_PUBLIC_PRICE_USDC", "10")

    def fake_get(url, params, timeout):
        assert url.endswith("/getChatMember")
        assert params == {"chat_id": "-100123", "user_id": 12345}

        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {"ok": True, "result": {"status": "member"}}

        return Response()

    monkeypatch.setattr("src.auth.telegram_group_pricing.requests.get", fake_get)

    pricing = TelegramGroupPricing()
    result = pricing.resolve_price_for_telegram_id(12345)

    assert result["is_group_member"] is True
    assert result["amount_usdc"] == "5"
    assert result["telegram_status"] == "member"


def test_group_pricing_treats_left_status_as_public_price(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    monkeypatch.setenv("POLYWEATHER_GROUP_MEMBER_PRICE_USDC", "5")
    monkeypatch.setenv("POLYWEATHER_PUBLIC_PRICE_USDC", "10")

    def fake_get(url, params, timeout):
        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {"ok": True, "result": {"status": "left"}}

        return Response()

    monkeypatch.setattr("src.auth.telegram_group_pricing.requests.get", fake_get)

    pricing = TelegramGroupPricing()
    result = pricing.resolve_price_for_telegram_id(12345)

    assert result["is_group_member"] is False
    assert result["amount_usdc"] == "10"
    assert result["telegram_status"] == "left"


def test_payment_plan_uses_linked_telegram_group_price(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    monkeypatch.setenv("POLYWEATHER_GROUP_MEMBER_PRICE_USDC", "5")
    monkeypatch.setenv("POLYWEATHER_PUBLIC_PRICE_USDC", "10")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    service = PaymentContractCheckoutService()
    service._db.bind_supabase_identity(12345, "user-1", "u@example.com")

    monkeypatch.setattr(
        "src.auth.telegram_group_pricing.TelegramGroupPricing.resolve_price_for_telegram_id",
        lambda self, telegram_id: {
            "configured": True,
            "telegram_id": telegram_id,
            "is_group_member": True,
            "telegram_status": "member",
            "amount_usdc": "5",
            "pricing_source": "telegram_group_member",
        },
    )

    plan = service._select_plan("pro_monthly")
    priced = service._apply_telegram_group_pricing("user-1", plan)

    assert priced["amount_usdc"] == "5"
    assert priced["amount_usdc_decimal"] == Decimal("5")
    assert priced["telegram_pricing"]["pricing_source"] == "telegram_group_member"


def test_payment_plan_uses_public_price_without_telegram_link(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_PAYMENT_RPC_URL", "https://rpc-1.example")
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "payments.db"))
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    monkeypatch.setenv("POLYWEATHER_GROUP_MEMBER_PRICE_USDC", "5")
    monkeypatch.setenv("POLYWEATHER_PUBLIC_PRICE_USDC", "10")
    monkeypatch.setenv(
        "POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON",
        '[{"code":"usdc_e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0xeD2f13Aa5fF033c58FB436E178451Cd07f693f32","is_default":true}]',
    )
    service = PaymentContractCheckoutService()

    plan = service._select_plan("pro_monthly")
    priced = service._apply_telegram_group_pricing("user-1", plan)

    assert priced["amount_usdc"] == "10"
    assert priced["amount_usdc_decimal"] == Decimal("10")
    assert priced["telegram_pricing"]["pricing_source"] == "telegram_public"
