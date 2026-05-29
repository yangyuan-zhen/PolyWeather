import importlib.util
from pathlib import Path


def _load_script(name: str):
    root = Path(__file__).resolve().parents[1]
    path = root / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


grant_script = _load_script("grant_subscription_by_email")
reconcile_script = _load_script("reconcile_subscription_by_email")


class _Checkout:
    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "service-role"

    def __init__(self):
        self.rest_calls = []
        self.admin_calls = []

    def _rest(self, method, table, params=None, **kwargs):
        self.rest_calls.append((method, table, params))
        assert table == "profiles"
        return [{"id": "user-1", "email": "user@example.com"}]

    def _auth_admin_request(self, *args, **kwargs):
        self.admin_calls.append((args, kwargs))
        raise AssertionError("profile-backed lookup should avoid Auth Admin")


def test_grant_script_email_lookup_prefers_profiles(monkeypatch):
    checkout = _Checkout()
    monkeypatch.setattr("src.payments.contract_checkout.PAYMENT_CHECKOUT", checkout)

    assert grant_script._lookup_user_id_by_email("user@example.com") == "user-1"
    assert checkout.rest_calls == [
        (
            "GET",
            "profiles",
            {
                "select": "id",
                "email": "eq.user@example.com",
                "limit": "1",
            },
        )
    ]
    assert checkout.admin_calls == []


def test_reconcile_script_email_lookup_prefers_profiles(monkeypatch):
    checkout = _Checkout()
    monkeypatch.setattr("src.payments.contract_checkout.PAYMENT_CHECKOUT", checkout)

    assert reconcile_script._lookup_user_id_by_email("user@example.com") == "user-1"
    assert checkout.rest_calls == [
        (
            "GET",
            "profiles",
            {
                "select": "id",
                "email": "eq.user@example.com",
                "limit": "1",
            },
        )
    ]
    assert checkout.admin_calls == []


def test_grant_script_entitlement_event_uses_minimal_return():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "grant_subscription_by_email.py").read_text(
        encoding="utf-8"
    )

    entitlement_event_pos = source.index('"entitlement_events"')
    minimal_pos = source.index('prefer="return=minimal"', entitlement_event_pos)
    assert minimal_pos > entitlement_event_pos


def test_grant_script_subscription_writes_use_minimal_return():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "grant_subscription_by_email.py").read_text(
        encoding="utf-8"
    )

    subscription_write_count = source.count('prefer="return=minimal"')
    assert subscription_write_count >= 3
    assert 'prefer="return=representation"' not in source


def test_grant_script_subscription_lookup_selects_only_grant_fields():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "grant_subscription_by_email.py").read_text(
        encoding="utf-8"
    )

    assert '"select": "id,plan_code,source,starts_at,expires_at"' in source
    assert '"select": "id,expires_at,status,plan_code,starts_at,source,created_at"' not in source
