from datetime import datetime, timedelta, timezone

import src.auth.supabase_entitlement as entitlement_module
from src.auth.supabase_entitlement import SupabaseEntitlementService


class _Response:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.content = b"1"

    def json(self):
        return self._payload


def test_latest_active_subscription_ignores_future_start(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    now = datetime.now(timezone.utc)
    current_trial = {
        "id": 1,
        "user_id": "user-1",
        "status": "active",
        "plan_code": "signup_trial_3d",
        "starts_at": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=2)).isoformat(),
    }
    future_paid = {
        "id": 2,
        "user_id": "user-1",
        "status": "active",
        "plan_code": "pro_monthly",
        "starts_at": (now + timedelta(days=2)).isoformat(),
        "expires_at": (now + timedelta(days=32)).isoformat(),
    }

    def _fake_get(url, headers=None, params=None, timeout=None):
        return _Response(200, [future_paid, current_trial])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    result = service._query_latest_active_subscription("user-1")

    assert result is not None
    assert result["plan_code"] == "signup_trial_3d"


def test_subscription_window_keeps_queued_renewal_after_current_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    now = datetime.now(timezone.utc)
    current = {
        "id": 1,
        "user_id": "user-1",
        "status": "active",
        "plan_code": "pro_monthly",
        "starts_at": (now - timedelta(days=29)).isoformat(),
        "expires_at": (now + timedelta(days=1)).isoformat(),
    }
    queued = {
        "id": 2,
        "user_id": "user-1",
        "status": "active",
        "plan_code": "pro_monthly",
        "starts_at": (now + timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=31)).isoformat(),
    }

    def _fake_get(url, headers=None, params=None, timeout=None):
        return _Response(200, [queued, current])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service._query_latest_active_subscription("user-1") == current

    window = service.get_subscription_window("user-1", respect_requirement=False)

    assert window["current"] == current
    assert window["total_expires_at"] == queued["expires_at"]
    assert window["queued_days"] == 30
    assert window["queued_count"] == 1
