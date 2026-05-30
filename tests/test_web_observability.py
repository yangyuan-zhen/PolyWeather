
from datetime import datetime

from fastapi.testclient import TestClient
from starlette.requests import Request

import web.core as web_core
import web.services.auth_api as auth_api
from web.app import app
import web.routes as routes
import web.services.ops_api as ops_api
import web.scan_terminal_cache as scan_terminal_cache
import web.scan_terminal_service as scan_terminal_service
from web.scan_terminal_cache import scan_terminal_cache_key
from src.database.runtime_state import TruthRecordRepository


client = TestClient(app)


def test_healthz_returns_ok_shape():
    response = client.get('/healthz')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] in {'ok', 'degraded'}
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'cities_count' in payload


def test_system_status_returns_summary_shape():
    response = client.get('/api/system/status')
    assert response.status_code == 200
    payload = response.json()
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'features' in payload
    assert 'integrations' in payload
    assert 'cache' in payload
    assert 'analysis' in payload['cache']
    assert 'probability' in payload
    assert payload['probability']['engine_mode'] == 'legacy'
    assert 'training_data' in payload
    assert 'station_networks' in payload
    assert 'realtime' in payload
    assert payload['realtime']['store'] in {'sqlite', 'redis', 'degraded_sqlite'}
    assert 'latest_revision' in payload['realtime']
    assert 'sse_connections' in payload['realtime']
    assert 'truth_records' in payload['training_data']
    assert 'training_features' in payload['training_data']
    assert 'city_coverage' in payload['training_data']
    assert 'model_city_coverage' in payload['training_data']
    assert 'metar_entries' in payload['cache']
    assert 'cities_count' in payload


def test_metrics_endpoint_returns_prometheus_payload():
    response = client.get('/metrics')
    assert response.status_code == 200
    assert 'polyweather_http_requests_total' in response.text



def test_cities_endpoint_uses_denver_display_name_for_aurora_market():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    denver = next(item for item in payload["cities"] if item["name"] == "denver")
    assert denver["display_name"] == "Denver"
    assert denver["network_provider"] == "global_metar"
    assert denver["deb_recent_tier"] in {"high", "medium", "low", "other"}
    assert "deb_recent_sample_count" in denver


def test_cities_endpoint_includes_new_wunderground_cities():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    names = {item["name"] for item in payload["cities"]}
    assert {
        "busan",
        "qingdao",
        "panama city",
        "kuala lumpur",
        "jakarta",
        "helsinki",
        "amsterdam",
    }.issubset(names)


def test_payment_runtime_endpoint_returns_shape():
    response = client.get('/api/payments/runtime')
    assert response.status_code == 200
    payload = response.json()
    assert 'checkout' in payload
    assert 'rpc' in payload
    assert 'event_loop_state' in payload
    assert 'recent_audit_events' in payload


def test_payment_config_does_not_require_entitlement(monkeypatch):
    monkeypatch.setattr(
        routes,
        "_assert_entitlement",
        lambda request: (_ for _ in ()).throw(
            AssertionError("public payment config should not validate Supabase auth"),
        ),
    )
    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "get_config_payload",
        lambda: {"enabled": True, "plans": []},
    )

    response = client.get("/api/payments/config")

    assert response.status_code == 200
    assert response.json()["enabled"] is True


def test_payment_wallets_requires_identity_without_subscription_gate(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 0
        created_at = "2026-05-01T00:00:00+00:00"

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", lambda token: _Identity())
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "has_active_subscription",
        lambda user_id: (_ for _ in ()).throw(
            AssertionError("payment identity endpoints should not query subscription gate"),
        ),
    )
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "list_wallets", lambda user_id: [])
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "chain_id", 137)

    response = client.get(
        "/api/payments/wallets",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"wallets": [], "chain_id": 137}


def test_telegram_identity_endpoints_skip_subscription_gate(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 0
        created_at = "2026-05-01T00:00:00+00:00"

    class _FakePricing:
        configured = True

        @staticmethod
        def verify_login_payload(payload):
            return {"telegram_id": int(payload["id"]), "username": "tester"}

        @staticmethod
        def get_member_status(telegram_id):
            return "member"

        @staticmethod
        def resolve_price_for_telegram_id(telegram_id):
            return {"telegram_id": telegram_id, "pricing_source": "telegram_group_member"}

    class _FakeDB:
        @staticmethod
        def upsert_user(telegram_id, username):
            return None

        @staticmethod
        def bind_supabase_identity(*, telegram_id, supabase_user_id, supabase_email):
            return {"ok": True}

        @staticmethod
        def consume_bind_token(token):
            return 12345

        @staticmethod
        def create_web_bind_token(*, supabase_user_id, supabase_email, ttl_minutes):
            return "bind-token"

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", lambda token: _Identity())
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "has_active_subscription",
        lambda user_id: (_ for _ in ()).throw(
            AssertionError("telegram identity endpoints should not query subscription gate"),
        ),
    )
    monkeypatch.setattr(auth_api, "TelegramGroupPricing", lambda: _FakePricing())
    monkeypatch.setattr(auth_api, "DBManager", lambda: _FakeDB())

    auth_headers = {"Authorization": "Bearer access-token"}

    login_response = client.post(
        "/api/auth/telegram/login",
        headers=auth_headers,
        json={"id": 12345, "username": "tester", "auth_date": 1770000000, "hash": "x" * 64},
    )
    assert login_response.status_code == 200

    token_response = client.post(
        "/api/auth/telegram/bind-by-token",
        headers=auth_headers,
        json={"token": "token-12345"},
    )
    assert token_response.status_code == 200

    link_response = client.post(
        "/api/auth/telegram/bot-bind-link",
        headers=auth_headers,
    )
    assert link_response.status_code == 200


def test_auth_me_does_not_reconcile_on_status_probe(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "enabled", True)

    reconcile_calls = {"count": 0}

    def _subscription_window(user_id, respect_requirement=False):
        return {
            "current": {
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            },
        }

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        _subscription_window,
    )
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", True)

    def _reconcile_latest_intent(user_id):
        reconcile_calls["count"] += 1
        return {"ok": True, "action": "reconciled_confirmed_intent"}

    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "reconcile_latest_intent",
        _reconcile_latest_intent,
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert reconcile_calls["count"] == 0


def test_auth_me_reuses_identity_bound_by_entitlement(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 7
        created_at = "2026-05-01T00:00:00+00:00"

    calls = {"identity": 0}

    def _get_identity(token):
        calls["identity"] += 1
        assert token == "access-token"
        return _Identity()

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", _get_identity)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "has_active_subscription", lambda user_id: True)
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False: {
            "current": {
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            },
        },
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["points"] == 7
    assert calls["identity"] == 1


def test_auth_me_uses_subscription_window_as_required_subscription_gate(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 7
        created_at = "2026-05-01T00:00:00+00:00"

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", lambda token: _Identity())
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "has_active_subscription",
        lambda user_id: (_ for _ in ()).throw(
            AssertionError("auth/me should not run a separate lightweight subscription gate"),
        ),
    )
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("auth/me should derive current subscription from the window query"),
        ),
    )
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False: {
            "current": {
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            },
            "total_expires_at": "2026-05-21T00:00:00+00:00",
            "queued_days": 30,
            "queued_count": 1,
        },
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert payload["subscription_queued_days"] == 30


def test_auth_me_preserves_unknown_subscription_window(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", False)
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", False)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False, bypass_cache=False, unknown_on_error=False: {
            "unknown": True,
            "rows": None,
        },
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("unknown subscription window must not be downgraded to inactive"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_subscription_any_status",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("unknown subscription window must not be treated as subscription history"),
        ),
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["subscription_active"] is None
    assert payload["subscription_plan_code"] is None


def test_auth_me_uses_window_rows_for_non_required_latest_known_subscription(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", False)
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", False)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False: {
            "current": None,
            "rows": [
                {
                    "plan_code": "pro_monthly",
                    "starts_at": "2026-06-01T00:00:00+00:00",
                    "expires_at": "2026-07-01T00:00:00+00:00",
                }
            ],
            "total_expires_at": "2026-07-01T00:00:00+00:00",
            "queued_days": 0,
            "queued_count": 0,
        },
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("auth/me should reuse window rows before latest active fallback"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_subscription_any_status",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("auth/me should reuse window rows before historical fallback"),
        ),
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is False
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert payload["subscription_expires_at"] == "2026-07-01T00:00:00+00:00"


def test_auth_me_skips_latest_active_after_empty_non_required_window(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", False)
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", False)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    latest_any_calls = {"count": 0}

    def _latest_any_status(user_id):
        latest_any_calls["count"] += 1
        return {
            "plan_code": "expired_pro",
            "starts_at": "2026-03-01T00:00:00+00:00",
            "expires_at": "2026-04-01T00:00:00+00:00",
        }

    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False: {},
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("empty subscription window should skip latest active fallback"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_subscription_any_status",
        _latest_any_status,
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is False
    assert payload["subscription_plan_code"] == "expired_pro"
    assert latest_any_calls["count"] == 1


def test_auth_me_preserves_required_subscription_403_from_window(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 0
        created_at = "2026-05-01T00:00:00+00:00"

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", lambda token: _Identity())
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "has_active_subscription",
        lambda user_id: (_ for _ in ()).throw(
            AssertionError("auth/me should not run a separate lightweight subscription gate"),
        ),
    )
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False: {},
    )
    latest_any_calls = {"count": 0}

    def _latest_any_status(user_id):
        latest_any_calls["count"] += 1
        return {
            "plan_code": "expired_pro",
            "starts_at": "2026-03-01T00:00:00+00:00",
            "expires_at": "2026-04-01T00:00:00+00:00",
        }

    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_latest_subscription_any_status",
        _latest_any_status,
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Subscription required"
    assert latest_any_calls["count"] == 0


def test_backend_entitlement_token_binds_forwarded_supabase_identity(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)
    monkeypatch.setattr(web_core, "_ENTITLEMENT_TOKEN", "backend-token")

    request = Request(
        {
            "type": "http",
            "headers": [
                (b"x-polyweather-entitlement", b"backend-token"),
                (b"x-polyweather-auth-user-id", b"user-1"),
                (b"x-polyweather-auth-email", b"user@example.com"),
            ],
        }
    )

    web_core._assert_entitlement(request)

    assert request.state.auth_user_id == "user-1"
    assert request.state.auth_email == "user@example.com"


def test_backend_entitlement_token_without_forwarded_identity_validates_bearer(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", False)
    monkeypatch.setattr(web_core, "_ENTITLEMENT_TOKEN", "backend-token")

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 7
        created_at = "2026-05-01T00:00:00+00:00"

    calls = {"count": 0}

    def _get_identity(token):
        calls["count"] += 1
        assert token == "access-token"
        return _Identity()

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", _get_identity)

    request = Request(
        {
            "type": "http",
            "headers": [
                (b"x-polyweather-entitlement", b"backend-token"),
                (b"authorization", b"Bearer access-token"),
            ],
        }
    )

    web_core._assert_entitlement(request)

    assert calls["count"] == 1
    assert request.state.auth_user_id == "user-1"
    assert request.state.auth_email == "user@example.com"


def test_ops_memberships_prefers_supabase_auth_email(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {
                "user-1": {
                    "supabase_email": "stale@example.com",
                    "username": "tester",
                    "telegram_id": 1,
                    "created_at": "2026-03-01T00:00:00+00:00",
                }
            }

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda limit=200: [
            {
                "user_id": "user-1",
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            }
        ],
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_auth_users",
        lambda user_ids: {
            "user-1": {
                "email": "fresh@example.com",
                "created_at": "2026-03-02T00:00:00+00:00",
            }
        },
    )
    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    payload = response.json()
    assert payload["memberships"][0]["email"] == "fresh@example.com"


def test_ops_memberships_uses_batched_subscription_windows(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {
                "user-1": {"supabase_email": "one@example.com"},
                "user-2": {"supabase_email": "two@example.com"},
            }

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda limit=200: [
            {
                "user_id": "user-1",
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-01T00:00:00+00:00",
                "expires_at": "2026-04-01T00:00:00+00:00",
            },
            {
                "user_id": "user-2",
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-02T00:00:00+00:00",
                "expires_at": "2026-04-02T00:00:00+00:00",
            },
        ],
    )
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "get_auth_users", lambda user_ids: {})

    def _fail_per_user_window(*args, **kwargs):
        raise AssertionError("per-user subscription window query should not run")

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        _fail_per_user_window,
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_subscription_windows",
        lambda user_ids, bypass_cache=True: {
            "user-1": {"total_expires_at": "2026-04-15T00:00:00+00:00", "queued_days": 14, "queued_count": 1},
            "user-2": {"total_expires_at": "2026-04-02T00:00:00+00:00", "queued_days": 0, "queued_count": 0},
        },
        raising=False,
    )

    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    payload = response.json()
    rows = {row["user_id"]: row for row in payload["memberships"]}
    assert rows["user-1"]["queued_days"] == 14
    assert rows["user-2"]["queued_days"] == 0


def test_ops_memberships_prefers_single_active_subscription_window_query(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {"user-1": {"supabase_email": "one@example.com"}}

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("memberships should not run a separate active subscription query"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_subscription_windows",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("memberships should not run a second window query"),
        ),
    )
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "get_auth_users", lambda user_ids: {})
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscription_windows",
        lambda limit=200: {
            "subscriptions": [
                {
                    "user_id": "user-1",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2026-04-01T00:00:00+00:00",
                }
            ],
            "windows": {
                "user-1": {
                    "total_expires_at": "2026-05-01T00:00:00+00:00",
                    "queued_days": 30,
                    "queued_count": 1,
                }
            },
        },
        raising=False,
    )

    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    row = response.json()["memberships"][0]
    assert row["queued_days"] == 30
    assert row["expires_at"] == "2026-05-01T00:00:00+00:00"


def test_ops_memberships_growth_reuses_active_subscription_window_query(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)

    starts_at = datetime.utcnow().replace(microsecond=0).isoformat()

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("growth should not run a separate active subscription query"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscription_windows",
        lambda limit=5000: {
            "subscriptions": [
                {
                    "user_id": "user-1",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": starts_at,
                    "expires_at": "2099-01-01T00:00:00+00:00",
                }
            ],
            "windows": {},
        },
        raising=False,
    )

    response = client.get("/api/ops/memberships/growth?days=7")

    assert response.status_code == 200
    assert any(day["paid"] == 1 for day in response.json()["daily"])


def test_ops_telegram_audit_reuses_active_subscription_window_query(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("TELEGRAM_CHAT_IDS", "chat-1")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.delenv("POLYWEATHER_TELEGRAM_GROUP_ID", raising=False)
    monkeypatch.delenv("POLYWEATHER_TELEGRAM_TOPICS_GROUP_ID", raising=False)
    monkeypatch.setattr(ops_api, "_require_ops", lambda request: None)

    class _FakeRows(list):
        def fetchall(self):
            return self

    class _FakeConnection:
        row_factory = None

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql):
            if "FROM users" in sql:
                return _FakeRows([{"telegram_id": 1, "username": "tester"}])
            if "FROM supabase_bindings" in sql:
                return _FakeRows(
                    [
                        {
                            "telegram_id": 1,
                            "supabase_user_id": "user-1",
                            "supabase_email": "one@example.com",
                        }
                    ]
                )
            raise AssertionError(sql)

    class _FakeDB:
        @staticmethod
        def _get_connection():
            return _FakeConnection()

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True, "result": {"status": "member"}}

    import requests as requests_module
    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(requests_module, "get", lambda *args, **kwargs: _Response())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("telegram audit should not run a separate active subscription query"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscription_windows",
        lambda limit=5000: {
            "subscriptions": [
                {
                    "user_id": "user-1",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": "2026-03-01T00:00:00+00:00",
                    "expires_at": "2099-01-01T00:00:00+00:00",
                }
            ],
            "windows": {},
        },
        raising=False,
    )

    result = ops_api.get_ops_telegram_audit(object())

    assert result["valid_count"] == 1
    assert result["anomaly_count"] == 0


def test_ops_memberships_overview_combines_memberships_and_growth_in_one_subscription_query(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    starts_at = datetime.utcnow().replace(microsecond=0).isoformat()
    calls = {"active_windows": 0}

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {"user-1": {"supabase_email": "one@example.com"}}

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("overview should not run a separate active subscription query"),
        ),
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_subscription_windows",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("overview should not run a second window query"),
        ),
    )
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "get_auth_users", lambda user_ids: {})

    def _active_windows(limit=5000):
        calls["active_windows"] += 1
        assert limit == 5000
        return {
            "subscriptions": [
                {
                    "user_id": "user-1",
                    "plan_code": "pro_monthly",
                    "source": "payment_contract",
                    "starts_at": starts_at,
                    "expires_at": "2099-01-01T00:00:00+00:00",
                },
                {
                    "user_id": "user-2",
                    "plan_code": "signup_trial_3d",
                    "source": "signup_trial",
                    "starts_at": starts_at,
                    "expires_at": "2099-01-02T00:00:00+00:00",
                },
            ],
            "windows": {
                "user-1": {
                    "total_expires_at": "2099-01-01T00:00:00+00:00",
                    "queued_days": 0,
                    "queued_count": 0,
                },
                "user-2": {
                    "total_expires_at": "2099-01-02T00:00:00+00:00",
                    "queued_days": 0,
                    "queued_count": 0,
                },
            },
        }

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscription_windows",
        _active_windows,
        raising=False,
    )

    response = client.get("/api/ops/memberships/overview?limit=1&days=7")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["memberships"]) == 1
    assert payload["memberships"][0]["user_id"] == "user-1"
    assert any(day["paid"] == 1 and day["trial"] == 1 for day in payload["daily"])
    assert calls["active_windows"] == 1


def test_ops_memberships_does_not_reconcile_payments_by_default(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_OPS_MEMBERSHIPS_RECONCILE_ENABLED", raising=False)
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", True)

    calls = {"count": 0}

    def _count_reconcile(*args, **kwargs):
        calls["count"] += 1
        return {"ok": True}

    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "reconcile_recent_intents", _count_reconcile)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {}

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "list_active_subscriptions", lambda limit=200: [])
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "get_auth_users", lambda user_ids: {})
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "list_subscription_windows", lambda user_ids, bypass_cache=True: {})

    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    assert response.json()["memberships"] == []
    assert calls["count"] == 0


def test_ops_email_lookup_prefers_profiles_over_auth_admin(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    calls = []

    class _Response:
        ok = True
        status_code = 200
        content = b"1"
        text = ""

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append((url, params))
        if url.endswith("/rest/v1/profiles"):
            assert headers is not None
            assert headers.get("Prefer") != "return=representation"
            assert params["select"] == "id"
            assert params["email"] == "eq.user@example.com"
            return _Response([{"id": "user-1"}])
        raise AssertionError(f"unexpected auth admin lookup: {url}")

    monkeypatch.setattr(ops_api._requests, "get", _fake_get)

    assert (
        ops_api._lookup_supabase_user_id_by_email(
            "https://example.supabase.co",
            "service-role",
            "user@example.com",
        )
        == "user-1"
    )
    assert len(calls) == 1


def test_ops_subscription_grant_invalidates_subscription_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(ops_api, "_require_ops", lambda request: {"email": "admin@example.com"})

    class _Response:
        ok = True
        status_code = 200
        content = b"1"
        text = ""

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def _fake_get(url, headers=None, params=None, timeout=None):
        assert url.endswith("/rest/v1/profiles")
        assert params["select"] == "id"
        return _Response([{"id": "user-1"}])

    def _fake_post(url, headers=None, json=None, timeout=None):
        assert url.endswith("/rest/v1/subscriptions")
        assert headers["Prefer"] == "return=minimal"
        return _Response([{"id": 1, "user_id": "user-1"}])

    invalidated = []
    monkeypatch.setattr(ops_api._requests, "get", _fake_get)
    monkeypatch.setattr(ops_api._requests, "post", _fake_post)
    monkeypatch.setattr(
        ops_api.legacy_routes.SUPABASE_ENTITLEMENT,
        "invalidate_subscription_cache",
        lambda user_id: invalidated.append(user_id),
    )

    result = ops_api.grant_ops_subscription(object(), "user@example.com")

    assert result["ok"] is True
    assert invalidated == ["user-1"]


def test_ops_subscription_extend_uses_minimal_return_and_invalidates_cache(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(ops_api, "_require_ops", lambda request: {"email": "admin@example.com"})

    class _Response:
        ok = True
        status_code = 200
        content = b"1"
        text = ""

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def _fake_get(url, headers=None, params=None, timeout=None):
        if url.endswith("/rest/v1/profiles"):
            assert params["select"] == "id"
            return _Response([{"id": "user-1"}])
        if url.endswith("/rest/v1/subscriptions"):
            assert params["select"] == "id,expires_at"
            return _Response(
                [
                    {
                        "id": 7,
                        "expires_at": "2026-04-01T00:00:00+00:00",
                    }
                ]
            )
        raise AssertionError(url)

    def _fake_patch(url, headers=None, json=None, timeout=None):
        assert url.endswith("/rest/v1/subscriptions?id=eq.7")
        assert headers["Prefer"] == "return=minimal"
        assert "expires_at" in json
        return _Response([])

    invalidated = []
    monkeypatch.setattr(ops_api._requests, "get", _fake_get)
    monkeypatch.setattr(ops_api._requests, "patch", _fake_patch)
    monkeypatch.setattr(
        ops_api.legacy_routes.SUPABASE_ENTITLEMENT,
        "invalidate_subscription_cache",
        lambda user_id: invalidated.append(user_id),
    )

    result = ops_api.extend_ops_subscription(object(), "user@example.com", additional_days=7)

    assert result["ok"] is True
    assert result["new_expires_at"].startswith("2026-04-08")
    assert invalidated == ["user-1"]


def test_ops_truth_history_returns_filtered_rows(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)

    repo = TruthRecordRepository()
    repo.upsert_truth(
        city="taipei",
        target_date="2026-04-02",
        actual_high=26.0,
        settlement_source="wunderground",
        settlement_station_code="RCSS",
        settlement_station_label="Taipei Songshan Airport Station",
        truth_version="v1",
        updated_by="test",
        source_payload={"sample": True},
        is_final=True,
    )

    response = client.get("/api/ops/truth-history?city=taipei&date_from=2026-04-01&date_to=2026-04-03&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert "items" in payload
    assert payload["filters"]["city"] == "taipei"
    assert payload["items"][0]["city"] == "taipei"


def test_scan_terminal_service_returns_stale_payload_after_failed_refresh(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    normalized_filters = scan_terminal_service._normalize_scan_terminal_filters(filters)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    monkeypatch.setattr(
        scan_terminal_service,
        "_scan_city_terminal_rows",
        lambda *_args, **_kwargs: {
            "city": "taipei",
            "rows": [
                {
                    "id": "row-1",
                    "market_key": "market-1",
                    "edge_percent": 12.4,
                    "final_score": 83.0,
                    "volume": 2000,
                }
            ],
            "candidate_total": 1,
            "primary_scores": [83.0],
        },
    )

    ready = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)
    assert ready["status"] == "ready"
    assert ready["rows"][0]["id"] == "row-1"

    def _explode(*_args, **_kwargs):
        raise RuntimeError("upstream 504")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    stale = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert stale["status"] == "stale"
    assert stale["stale"] is True
    assert stale["rows"][0]["id"] == "row-1"
    assert stale["filters"] == normalized_filters
    assert stale["stale_reason"] == "upstream 504"


def test_scan_terminal_service_returns_failed_without_success_snapshot(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    def _explode(*_args, **_kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    failed = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert failed["status"] == "failed"
    assert failed["stale"] is False
    assert failed["rows"] == []
    assert failed["summary"]["candidate_total"] == 0
    assert failed["stale_reason"] == "network down"


def test_scan_terminal_endpoint_forwards_filters(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    captured = {}

    def _fake_build_scan_terminal_payload(filters, *, force_refresh=False):
        captured["filters"] = dict(filters)
        captured["force_refresh"] = force_refresh
        return {
            "generated_at": "2026-04-23T00:00:00Z",
            "filters": filters,
            "summary": {
                "recommended_count": 1,
                "visible_count": 1,
                "candidate_total": 3,
                "avg_edge_percent": 4.2,
                "avg_primary_confidence": 88.0,
                "tradable_market_count": 1,
                "total_volume": 1500,
                "resolved_market_type": "maxtemp",
            },
            "top_signal": None,
            "rows": [],
        }

    monkeypatch.setattr(routes, "build_scan_terminal_payload", _fake_build_scan_terminal_payload)

    response = client.get(
        "/api/scan/terminal?scan_mode=trend&min_price=0.1&max_price=0.8&min_edge_pct=3"
        "&min_liquidity=700&high_liquidity_only=true&market_type=all&time_range=week&limit=12&force_refresh=true"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["recommended_count"] == 1
    assert captured["force_refresh"] is True
    assert captured["filters"]["scan_mode"] == "trend"
    assert captured["filters"]["market_type"] == "all"
    assert captured["filters"]["time_range"] == "week"
    assert captured["filters"]["limit"] == 12


def test_scan_terminal_cache_key_includes_filter_dimensions():
    first = scan_terminal_cache_key(
        {
            "scan_mode": "tradable",
            "time_range": "today",
            "limit": 25,
        }
    )
    second = scan_terminal_cache_key(
        {
            "scan_mode": "trend",
            "time_range": "week",
            "limit": 10,
        }
    )

    assert first != second
    assert "trend" in second
    assert "week" in second
