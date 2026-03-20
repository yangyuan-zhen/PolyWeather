import os

from src.payments.contract_audit import analyze_checkout_contract


def test_payment_contract_audit_detects_current_controls():
    report = analyze_checkout_contract(
        os.path.join("contracts", "PolyWeatherCheckout.sol")
    )

    assert report["checks"]["has_only_owner_modifier"] is True
    assert report["checks"]["allowed_token_check"] is True
    assert report["checks"]["duplicate_order_check"] is True
    assert report["checks"]["paid_order_written_before_transfer"] is True
    assert report["checks"]["has_pause_switch"] is False
    assert report["checks"]["binds_plan_amount_onchain"] is False
    assert any(risk["id"] == "single_owner_admin" for risk in report["risks"])

