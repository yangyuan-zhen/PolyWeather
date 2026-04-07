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


def test_ensure_signup_trial_grants_three_day_subscription(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_SIGNUP_TRIAL_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_SIGNUP_TRIAL_DAYS", "3")

    service = SupabaseEntitlementService()
    monkeypatch.setattr(service, "_query_latest_active_subscription", lambda user_id: None)
    monkeypatch.setattr(service, "_query_latest_subscription_any_status", lambda user_id: None)

    captured_posts = []

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured_posts.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        if url.endswith("/rest/v1/subscriptions"):
            return _Response(
                201,
                [
                    {
                        "user_id": json["user_id"],
                        "plan_code": json["plan_code"],
                        "status": json["status"],
                        "starts_at": json["starts_at"],
                        "expires_at": json["expires_at"],
                        "source": json["source"],
                    }
                ],
            )
        return _Response(201, {})

    monkeypatch.setattr(entitlement_module.requests, "post", _fake_post)

    starts_at = datetime.now(timezone.utc) - timedelta(hours=1)
    result = service.ensure_signup_trial(
        "user-1",
        created_at=starts_at.isoformat(),
    )

    assert result is not None
    assert result["plan_code"] == "signup_trial_3d"
    assert result["status"] == "active"
    assert result["starts_at"] == starts_at.isoformat()
    assert result["expires_at"] == (starts_at + timedelta(days=3)).isoformat()

    subscription_insert = next(
        item for item in captured_posts if item["url"].endswith("/rest/v1/subscriptions")
    )
    assert subscription_insert["json"]["user_id"] == "user-1"
    assert subscription_insert["json"]["source"] == "signup_trial"


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
