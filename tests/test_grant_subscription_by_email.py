from scripts.grant_subscription_by_email import _select_exact_user_id
from src.payments.contract_checkout import PaymentCheckoutError


def test_select_exact_user_id_prefers_exact_email_match():
    payload = {
        "users": [
            {"id": "wrong-user", "email": "louischanre+alias@gmail.com"},
            {"id": "right-user", "email": "louischanre@gmail.com"},
        ]
    }

    result = _select_exact_user_id(payload, "louischanre@gmail.com")

    assert result == "right-user"


def test_select_exact_user_id_raises_when_exact_email_missing():
    payload = {
        "users": [
            {"id": "wrong-user", "email": "louischanre+alias@gmail.com"},
        ]
    }

    try:
        _select_exact_user_id(payload, "louischanre@gmail.com")
    except PaymentCheckoutError as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("expected PaymentCheckoutError")
