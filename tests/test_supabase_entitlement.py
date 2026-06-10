from datetime import datetime, timedelta, timezone
import time

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
    def _fake_get(url, headers=None, params=None, timeout=None):
        assert params["select"] == "plan_code,source,starts_at,expires_at"
        assert str(params["starts_at"]).startswith("lte.")
        assert params["limit"] == "1"
        return _Response(200, [current_trial])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    result = service._query_latest_active_subscription("user-1")

    assert result is not None
    assert result["plan_code"] == "signup_trial_3d"


def test_get_identity_caches_invalid_token_result(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        return _Response(401, {"message": "invalid token"})

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.get_identity("bad-token") is None
    assert service.get_identity("bad-token") is None
    assert calls["count"] == 1


def test_get_identity_does_not_cache_transient_auth_errors(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        return _Response(503, {"message": "temporarily unavailable"})

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.get_identity("temporarily-bad-token") is None
    assert service.get_identity("temporarily-bad-token") is None
    assert calls["count"] == 2


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

    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params)
        assert params["select"] == "plan_code,source,starts_at,expires_at"
        if params["limit"] == "1":
            assert str(params["starts_at"]).startswith("lte.")
            return _Response(200, [current])
        assert params["limit"] == "100"
        assert "starts_at" not in params
        return _Response(200, [queued, current])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service._query_latest_active_subscription("user-1") == current

    window = service.get_subscription_window("user-1", respect_requirement=False)

    assert window["current"] == current
    assert window["total_expires_at"] == queued["expires_at"]
    assert window["queued_days"] == 30
    assert window["queued_count"] == 1
    assert len(calls) == 2


def test_subscription_window_query_selects_only_window_fields(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    def _fake_get(url, headers=None, params=None, timeout=None):
        assert params["select"] == "plan_code,source,starts_at,expires_at"
        return _Response(
            200,
            [
                {
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2099-04-01T00:00:00+00:00",
                }
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    window = service.get_subscription_window(
        "user-1",
        respect_requirement=False,
        bypass_cache=True,
    )

    assert window["current"]["plan_code"] == "pro_monthly"


def test_subscription_window_can_report_unknown_on_transient_query_failure(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    def _fake_get(url, headers=None, params=None, timeout=None):
        return _Response(503, {"message": "temporarily unavailable"})

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    window = service.get_subscription_window(
        "user-1",
        respect_requirement=False,
        bypass_cache=True,
        unknown_on_error=True,
    )

    assert window["unknown"] is True
    assert window["rows"] is None


def test_subscription_access_window_uses_single_current_subscription_query(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    def _fake_get(url, headers=None, params=None, timeout=None):
        assert params["select"] == "plan_code,source,starts_at,expires_at"
        assert str(params["starts_at"]).startswith("lte.")
        assert params["limit"] == "1"
        return _Response(
            200,
            [
                {
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2099-04-01T00:00:00+00:00",
                }
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    window = service.get_subscription_access_window(
        "user-1",
        respect_requirement=False,
        unknown_on_error=True,
    )

    assert window["current"]["plan_code"] == "pro_monthly"
    assert window["queued_days"] == 0
    assert window["rows"] == [window["current"]]


def test_subscription_access_window_reuses_cached_current_row(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    current = {
        "plan_code": "pro_monthly",
        "source": "payment_contract",
        "starts_at": "2026-03-01T00:00:00+00:00",
        "expires_at": "2099-04-01T00:00:00+00:00",
    }
    service._sub_cache["user-1"] = {
        "active": True,
        "row": current,
        "ts": time.time(),
    }

    monkeypatch.setattr(
        entitlement_module.requests,
        "get",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("cached access window must not hit Supabase"),
        ),
    )

    window = service.get_subscription_access_window(
        "user-1",
        respect_requirement=False,
        unknown_on_error=True,
    )

    assert window["current"] == current
    assert window["total_expires_at"] == current["expires_at"]


def test_list_subscription_windows_selects_only_batch_window_fields(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()

    def _fake_get(url, headers=None, params=None, timeout=None):
        assert params["select"] == "user_id,plan_code,source,starts_at,expires_at"
        assert params["user_id"] == "in.(user-1,user-2)"
        return _Response(
            200,
            [
                {
                    "user_id": "user-1",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2099-04-01T00:00:00+00:00",
                },
                {
                    "user_id": "user-2",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-02T00:00:00+00:00",
                    "expires_at": "2099-04-02T00:00:00+00:00",
                },
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    windows = service.list_subscription_windows(
        ["user-1", "user-2"],
        bypass_cache=True,
    )

    assert set(windows) == {"user-1", "user-2"}


def test_list_active_subscription_windows_uses_single_window_query(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = []
    now = datetime.now(timezone.utc)
    current = {
        "user_id": "user-1",
        "plan_code": "pro_monthly",
        "source": "payment_contract",
        "starts_at": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=10)).isoformat(),
    }
    queued = {
        "user_id": "user-1",
        "plan_code": "pro_monthly",
        "source": "payment_contract",
        "starts_at": (now + timedelta(days=10)).isoformat(),
        "expires_at": (now + timedelta(days=40)).isoformat(),
    }

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params)
        assert params["select"] == "user_id,plan_code,source,starts_at,expires_at"
        assert params["status"] == "eq.active"
        assert params["order"] == "user_id.asc,expires_at.desc"
        return _Response(200, [queued, current])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    result = service.list_active_subscription_windows(limit=200)

    assert result["subscriptions"] == [current]
    assert result["windows"]["user-1"]["queued_count"] == 1
    assert calls and len(calls) == 1


def test_latest_subscription_any_status_uses_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}
    latest = {
        "id": 3,
        "user_id": "user-1",
        "status": "expired",
        "plan_code": "pro_monthly",
        "starts_at": "2026-03-01T00:00:00+00:00",
        "expires_at": "2026-04-01T00:00:00+00:00",
        "created_at": "2026-03-01T00:00:00+00:00",
        "updated_at": "2026-04-01T00:00:00+00:00",
    }

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        assert params["user_id"] == "eq.user-1"
        assert params["order"] == "created_at.desc"
        assert params["select"] == "plan_code,starts_at,expires_at"
        return _Response(200, [latest])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.get_latest_subscription_any_status("user-1") == latest
    assert service.get_latest_subscription_any_status("user-1") == latest
    assert calls["count"] == 1


def test_get_auth_users_batches_profiles_before_admin_fallback(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append((url, params))
        if url.endswith("/rest/v1/profiles"):
            assert params["id"] == "in.(user-1,user-2)"
            return _Response(
                200,
                [
                    {
                        "id": "user-1",
                        "email": "one@example.com",
                        "created_at": "2026-03-01T00:00:00+00:00",
                    },
                    {
                        "id": "user-2",
                        "email": "two@example.com",
                        "created_at": "2026-03-02T00:00:00+00:00",
                    },
                ],
            )
        raise AssertionError(f"unexpected admin fallback call: {url}")

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    result = service.get_auth_users(["user-1", "user-2"])

    assert result == {
        "user-1": {
            "email": "one@example.com",
            "created_at": "2026-03-01T00:00:00+00:00",
        },
        "user-2": {
            "email": "two@example.com",
            "created_at": "2026-03-02T00:00:00+00:00",
        },
    }
    assert len(calls) == 1


def test_get_auth_users_uses_short_cache_for_profile_results(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        assert url.endswith("/rest/v1/profiles")
        return _Response(
            200,
            [
                {
                    "id": "user-1",
                    "email": "one@example.com",
                    "created_at": "2026-03-01T00:00:00+00:00",
                },
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.get_auth_users(["user-1"]) == {
        "user-1": {
            "email": "one@example.com",
            "created_at": "2026-03-01T00:00:00+00:00",
        },
    }
    assert service.get_auth_users(["user-1"]) == {
        "user-1": {
            "email": "one@example.com",
            "created_at": "2026-03-01T00:00:00+00:00",
        },
    }
    assert calls["count"] == 1


def test_list_active_subscriptions_uses_cache_and_invalidation(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}
    row = {
        "id": 1,
        "user_id": "user-1",
        "status": "active",
        "plan_code": "pro_monthly",
        "starts_at": "2026-03-01T00:00:00+00:00",
        "expires_at": "2099-04-01T00:00:00+00:00",
    }

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        assert params["status"] == "eq.active"
        assert params["select"] == "user_id,plan_code,starts_at,expires_at"
        return _Response(200, [row])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.list_active_subscriptions(limit=200) == [row]
    assert service.list_active_subscriptions(limit=200) == [row]
    assert calls["count"] == 1

    service.invalidate_subscription_cache("user-1")

    assert service.list_active_subscriptions(limit=200) == [row]
    assert calls["count"] == 2


def test_has_active_subscription_uses_lightweight_query_without_polluting_detail_cache(
    monkeypatch,
):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params["select"])
        if params["select"] == "expires_at":
            assert str(params["starts_at"]).startswith("lte.")
            assert params["limit"] == "1"
            return _Response(
                200,
                [
                    {
                        "expires_at": "2099-04-01T00:00:00+00:00",
                    }
                ],
            )
        if params["select"] == "plan_code,source,starts_at,expires_at":
            return _Response(
                200,
                [
                    {
                        "plan_code": "pro_monthly",
                        "source": "payment_contract",
                        "starts_at": "2026-03-01T00:00:00+00:00",
                        "expires_at": "2099-04-01T00:00:00+00:00",
                    }
                ],
            )
        raise AssertionError(params["select"])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.has_active_subscription("user-1", respect_requirement=False) is True
    assert service.has_active_subscription("user-1", respect_requirement=False) is True
    assert service.get_latest_active_subscription(
        "user-1",
        respect_requirement=False,
    )["plan_code"] == "pro_monthly"

    assert calls == [
        "expires_at",
        "plan_code,source,starts_at,expires_at",
    ]


def test_has_active_subscription_lightweight_cache_invalidates(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = {"count": 0}

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls["count"] += 1
        assert params["select"] == "expires_at"
        assert str(params["starts_at"]).startswith("lte.")
        assert params["limit"] == "1"
        return _Response(
            200,
            [
                {
                    "expires_at": "2099-04-01T00:00:00+00:00",
                }
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.has_active_subscription("user-1", respect_requirement=False) is True
    assert service.has_active_subscription("user-1", respect_requirement=False) is True
    assert calls["count"] == 1

    service.invalidate_subscription_cache("user-1")

    assert service.has_active_subscription("user-1", respect_requirement=False) is True
    assert calls["count"] == 2


def test_has_active_subscription_reuses_detailed_subscription_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params["select"])
        assert params["select"] == "plan_code,source,starts_at,expires_at"
        return _Response(
            200,
            [
                {
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2099-04-01T00:00:00+00:00",
                }
            ],
        )

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.get_latest_active_subscription(
        "user-1",
        respect_requirement=False,
    )["plan_code"] == "pro_monthly"
    assert service.has_active_subscription("user-1", respect_requirement=False) is True

    assert calls == ["plan_code,source,starts_at,expires_at"]


def test_latest_active_subscription_reuses_negative_lightweight_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    service = SupabaseEntitlementService()
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params["select"])
        assert params["select"] == "expires_at"
        assert str(params["starts_at"]).startswith("lte.")
        assert params["limit"] == "1"
        return _Response(200, [])

    monkeypatch.setattr(entitlement_module.requests, "get", _fake_get)

    assert service.has_active_subscription("user-1", respect_requirement=False) is False
    assert service.get_latest_active_subscription(
        "user-1",
        respect_requirement=False,
    ) is None

    assert calls == ["expires_at"]
