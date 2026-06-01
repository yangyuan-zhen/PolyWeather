
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from starlette.requests import Request

import web.core as web_core
import web.services.auth_api as auth_api
from web.app import app
import web.routes as routes
import web.services.ops_api as ops_api
import web.scan_terminal_cache as scan_terminal_cache
import web.scan_terminal_service as scan_terminal_service
import web.services.city_api as city_api
import web.services.city_runtime as city_runtime
from web.services.observation_freshness import build_observation_freshness
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


def test_healthz_keeps_liveness_200_when_db_health_is_degraded(monkeypatch):
    from web.services import system_api

    monkeypatch.setattr(
        system_api,
        "build_health_payload",
        lambda: {
            "status": "degraded",
            "time_utc": "2026-05-30T00:00:00+00:00",
            "db": {"ok": False, "error": "database is locked"},
            "state_storage_mode": "sqlite",
            "cities_count": 50,
        },
    )

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


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


def test_observation_freshness_accepts_epoch_seconds():
    now = datetime.fromtimestamp(1780169100, tz=timezone.utc)

    payload = build_observation_freshness(
        source_code="mgm",
        observed_at=1780168800,
        now_utc=now,
    )

    assert payload["freshness_status"] == "fresh"
    assert payload["freshness_reason"] == "within_native_fresh_window"
    assert payload["age_sec"] == 300
    assert payload["observed_at"].startswith("2026-")


def test_metrics_endpoint_returns_prometheus_payload():
    response = client.get('/metrics')
    assert response.status_code == 200
    assert 'polyweather_http_requests_total' in response.text


def test_standard_growth_funnel_events_are_trackable():
    assert {
        "landing_view",
        "enter_terminal",
        "login_start",
        "signup_success",
        "trial_created",
        "payment_start",
        "payment_success",
        "degraded_auth_profile",
    }.issubset(city_runtime.TRACKABLE_ANALYTICS_EVENTS)


def test_standard_growth_funnel_summary_order(monkeypatch):
    from src.database.db_manager import DBManager

    rows = [
        {"id": 1, "event_type": "landing_view", "user_id": "", "client_id": "c1", "session_id": "s1"},
        {"id": 2, "event_type": "enter_terminal", "user_id": "", "client_id": "c1", "session_id": "s1"},
        {"id": 3, "event_type": "login_start", "user_id": "", "client_id": "c1", "session_id": "s1"},
        {"id": 4, "event_type": "signup_success", "user_id": "u1", "client_id": "c1", "session_id": "s1"},
        {"id": 5, "event_type": "trial_created", "user_id": "u1", "client_id": "c1", "session_id": "s1"},
        {"id": 6, "event_type": "payment_start", "user_id": "u1", "client_id": "c1", "session_id": "s1"},
        {"id": 7, "event_type": "payment_success", "user_id": "u1", "client_id": "c1", "session_id": "s1"},
        {"id": 8, "event_type": "degraded_auth_profile", "user_id": "", "client_id": "auth:u1", "session_id": "", "payload": {"reason": "backend_500"}},
    ]
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=5000, since_iso=None: rows,
    )

    summary = DBManager().get_app_analytics_funnel_summary(days=7)
    assert list(summary["events"].keys()) == [
        "landing_view",
        "enter_terminal",
        "login_start",
        "signup_success",
        "trial_created",
        "payment_start",
        "payment_success",
    ]
    assert summary["rates"]["payment_success_rate"] == 1.0
    assert summary["diagnostics"]["degraded_auth_profile"]["total"] == 1
    assert summary["diagnostics"]["degraded_auth_profile"]["by_reason"][0] == {
        "name": "backend_500",
        "count": 1,
    }


def test_growth_funnel_summarizes_traffic_sources(monkeypatch):
    from src.database.db_manager import DBManager

    rows = [
        {
            "id": 1,
            "event_type": "landing_view",
            "user_id": "",
            "client_id": "c1",
            "session_id": "s1",
            "payload": {
                "referrer": "https://x.com/polyweather",
                "cf_country": "us",
                "device_type": "mobile",
                "path": "/",
            },
        },
        {
            "id": 2,
            "event_type": "landing_view",
            "user_id": "",
            "client_id": "c2",
            "session_id": "s2",
            "payload": {
                "referrer": "",
                "cf_country": "hk",
                "device_type": "desktop",
                "path": "/?ref=abc",
            },
        },
    ]
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=20000, since_iso=None: rows,
    )

    summary = DBManager().get_app_analytics_funnel_summary(days=7)

    assert summary["traffic"]["referrers"][0] == {"name": "x.com", "count": 1}
    assert {"name": "(direct)", "count": 1} in summary["traffic"]["referrers"]
    assert {"name": "US", "count": 1} in summary["traffic"]["countries"]
    assert {"name": "mobile", "count": 1} in summary["traffic"]["devices"]


def test_ops_source_health_flags_expected_official_sources(monkeypatch):
    class FakeCache:
        def get_city_cache(self, kind, city):
            if kind != "full":
                return None
            payloads = {
                "ankara": {
                    "airport_primary": {
                        "source_code": "mgm",
                        "source_label": "MGM",
                        "obs_age_min": 80,
                        "temp": 17,
                    }
                },
                "amsterdam": {
                    "airport_primary": {
                        "source_code": "knmi",
                        "source_label": "KNMI",
                        "obs_age_min": 5,
                        "temp": 19,
                    }
                },
                "tel aviv": {
                    "airport_current": {
                        "source_code": "metar",
                        "source_label": "METAR",
                        "obs_age_min": 5,
                        "temp": 25,
                    }
                },
            }
            payload = payloads.get(city)
            if not payload:
                return None
            return {
                "payload": payload,
                "updated_at": "2026-05-31T10:00:00Z",
                "updated_at_ts": 1,
            }

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(
        ops_api.legacy_routes,
        "CITIES",
        {"ankara": {}, "amsterdam": {}, "tel aviv": {}},
        raising=False,
    )

    payload = ops_api.get_ops_source_health(None, limit=10)
    by_city = {row["city"]: row for row in payload["cities"]}

    assert by_city["ankara"]["worst_status"] == "stale"
    assert any(source["source_code"] == "mgm" for source in by_city["ankara"]["sources"])
    assert by_city["amsterdam"]["worst_status"] == "fresh"
    assert any(
        source["source_code"] == "ims" and source["status"] == "missing"
        for source in by_city["tel aviv"]["sources"]
    )


def test_ops_billing_risk_surfaces_trial_payment_referral_and_points(monkeypatch):
    from src.database.db_manager import DBManager

    now = datetime.now(timezone.utc)
    old = (now - timedelta(minutes=20)).isoformat()
    recent = now.isoformat()

    def fake_supabase_rows(table, params, *, timeout=10):
        if table == "payment_intents":
            return [
                {
                    "id": "intent-stuck",
                    "user_id": "user-pay",
                    "plan_code": "pro_monthly",
                    "status": "submitted",
                    "updated_at": old,
                    "created_at": old,
                    "tx_hash": "0x" + "a" * 64,
                    "metadata": {},
                },
                {
                    "id": "intent-points",
                    "user_id": "user-points",
                    "plan_code": "pro_monthly",
                    "status": "confirmed",
                    "updated_at": recent,
                    "created_at": recent,
                    "metadata": {
                        "points_redemption": {
                            "applied": True,
                            "points_to_consume": 1500,
                        }
                    },
                },
            ]
        if table == "referral_attributions":
            return [
                {
                    "id": 1,
                    "code": "CAP1",
                    "referrer_user_id": "referrer-cap",
                    "referred_user_id": "referred-cap",
                    "status": "capped",
                    "updated_at": recent,
                    "created_at": recent,
                },
                {
                    "id": 2,
                    "code": "MISS1",
                    "referrer_user_id": "referrer-missing",
                    "referred_user_id": "referred-missing",
                    "status": "converted",
                    "converted_payment_intent_id": "intent-converted",
                    "converted_at": recent,
                    "updated_at": recent,
                    "created_at": recent,
                },
            ]
        if table == "referral_rewards":
            return [
                {
                    "id": 10,
                    "referral_attribution_id": 99,
                    "referrer_user_id": "referrer-ok",
                    "referred_user_id": "referred-ok",
                    "payment_intent_id": "intent-ok",
                    "reward_points": 3500,
                    "reward_days": 0,
                    "created_at": recent,
                }
            ]
        if table == "trial_claims":
            return []
        return []

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api, "_supabase_rest_rows", fake_supabase_rows)
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=20000, since_iso=None: [
            {
                "id": 10,
                "event_type": "login_start",
                "user_id": None,
                "client_id": "c1",
                "session_id": "session-gap",
                "created_at": recent,
                "payload": {"mode": "signup"},
            },
            {
                "id": 11,
                "event_type": "signup_success",
                "user_id": "user-trial-gap",
                "client_id": "",
                "session_id": "session-gap",
                "created_at": recent,
                "payload": {},
            }
        ],
    )
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [
            {
                "id": 21,
                "event_type": "payment_intent_failed",
                "payload": {"reason": "receiver_mismatch"},
                "created_at": recent,
            }
        ],
    )

    payload = ops_api.get_ops_billing_risk(None, days=30, limit=20)
    summary = payload["summary"]

    assert summary["stuck_intents"] == 1
    assert summary["trial_gaps"] == 1
    assert summary["points_discount_issues"] == 1
    assert summary["referral_settlement_issues"] == 1
    assert summary["monthly_cap_hits"] == 1
    assert summary["payment_incidents"] == 1
    assert payload["recent_referral_rewards"][0]["reward_points"] == 3500
    assert {
        "payment_intent",
        "signup_trial",
        "points_redemption",
        "referral",
    }.issubset({issue["category"] for issue in payload["issues"]})


def test_ops_billing_risk_does_not_flag_signup_when_backend_trial_exists(monkeypatch):
    from src.database.db_manager import DBManager

    now = datetime.now(timezone.utc)
    recent = now.isoformat()

    def fake_supabase_rows(table, params, *, timeout=10):
        if table == "trial_claims":
            return [
                {
                    "id": 31,
                    "user_id": "user-with-trial",
                    "email": "trial@example.com",
                    "telegram_user_id": None,
                    "claimed_at": recent,
                    "created_at": recent,
                }
            ]
        if table == "subscriptions":
            return [
                {
                    "id": 41,
                    "user_id": "user-with-trial",
                    "plan_code": "signup_trial_3d",
                    "source": "signup_trial",
                    "status": "active",
                    "starts_at": recent,
                    "expires_at": (now + timedelta(days=3)).isoformat(),
                    "created_at": recent,
                }
            ]
        return []

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api, "_supabase_rest_rows", fake_supabase_rows)
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=20000, since_iso=None: [
            {
                "id": 51,
                "event_type": "signup_success",
                "user_id": "user-with-trial",
                "client_id": "",
                "session_id": "session-trial",
                "created_at": recent,
                "payload": {"user_id": "user-with-trial"},
            }
        ],
    )
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [],
    )

    payload = ops_api.get_ops_billing_risk(None, days=30, limit=20)

    assert payload["summary"]["trial_gaps"] == 0
    assert not any(issue["category"] == "signup_trial" for issue in payload["issues"])


def test_ops_billing_risk_ignores_account_visit_without_signup_intent(monkeypatch):
    from src.database.db_manager import DBManager

    recent = datetime.now(timezone.utc).isoformat()

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api, "_supabase_rest_rows", lambda table, params, *, timeout=10: [])
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=20000, since_iso=None: [
            {
                "id": 61,
                "event_type": "signup_success",
                "user_id": "returning-no-trial-user",
                "client_id": "client-return",
                "session_id": "session-return",
                "created_at": recent,
                "payload": {
                    "entry": "account_center",
                    "user_id": "returning-no-trial-user",
                },
            }
        ],
    )
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [],
    )

    payload = ops_api.get_ops_billing_risk(None, days=30, limit=20)

    assert payload["summary"]["trial_gaps"] == 0
    assert not any(issue["category"] == "signup_trial" for issue in payload["issues"])


def test_ops_billing_risk_treats_expired_signup_trial_subscription_as_backend_evidence(monkeypatch):
    from src.database.db_manager import DBManager

    now = datetime.now(timezone.utc)
    recent = now.isoformat()
    expired = (now - timedelta(days=2)).isoformat()

    def fake_supabase_rows(table, params, *, timeout=10):
        if table == "subscriptions" and params.get("or") == "(source.eq.signup_trial,plan_code.eq.signup_trial_3d)":
            return [
                {
                    "id": 81,
                    "user_id": "expired-trial-user",
                    "plan_code": "signup_trial_3d",
                    "source": "signup_trial",
                    "status": "expired",
                    "starts_at": (now - timedelta(days=5)).isoformat(),
                    "expires_at": expired,
                    "created_at": (now - timedelta(days=5)).isoformat(),
                    "updated_at": expired,
                }
            ]
        return []

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api, "_supabase_rest_rows", fake_supabase_rows)
    monkeypatch.setattr(
        DBManager,
        "list_app_analytics_events",
        lambda self, limit=20000, since_iso=None: [
            {
                "id": 80,
                "event_type": "login_start",
                "user_id": None,
                "client_id": "client-expired",
                "session_id": "session-expired",
                "created_at": recent,
                "payload": {"mode": "signup"},
            },
            {
                "id": 82,
                "event_type": "signup_success",
                "user_id": "expired-trial-user",
                "client_id": "client-expired",
                "session_id": "session-expired",
                "created_at": recent,
                "payload": {
                    "entry": "account_center",
                    "user_id": "expired-trial-user",
                },
            },
        ],
    )
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [],
    )

    payload = ops_api.get_ops_billing_risk(None, days=30, limit=20)

    assert payload["summary"]["trial_gaps"] == 0
    assert not any(issue["category"] == "signup_trial" for issue in payload["issues"])


def test_ops_payment_incidents_expose_top_level_reason_and_filters_resolved(monkeypatch):
    from src.database.db_manager import DBManager

    recent = datetime.now(timezone.utc).isoformat()

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [
            {
                "id": 71,
                "event_type": "payment_intent_failed",
                "created_at": recent,
                "payload": {
                    "reason": "receiver_mismatch",
                    "detail": "receiver address differs",
                    "intent_id": "intent-71",
                    "user_id": "user-71",
                    "tx_hash": "0x" + "7" * 64,
                },
            },
            {
                "id": 72,
                "event_type": "payment_intent_failed",
                "created_at": recent,
                "payload": {
                    "reason": "receiver_mismatch",
                    "resolved_at": recent,
                    "resolved_by": "ops@example.com",
                },
            },
        ],
    )

    payload = ops_api.list_ops_payment_incidents(None, limit=20)

    assert len(payload["incidents"]) == 1
    incident = payload["incidents"][0]
    assert incident["id"] == 71
    assert incident["reason"] == "receiver_mismatch"
    assert incident["detail"] == "receiver address differs"
    assert incident["intent_id"] == "intent-71"
    assert incident["user_id"] == "user-71"
    assert incident["tx_hash"].startswith("0x777")
    assert incident["resolved"] is False


def test_ops_payment_incidents_group_duplicate_failures(monkeypatch):
    from src.database.db_manager import DBManager

    older = "2026-05-25T12:26:44"
    newer = "2026-05-25T12:29:51"

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=50, event_type=None: [
            {
                "id": 275751,
                "event_type": "payment_intent_failed",
                "created_at": newer,
                "payload": {
                    "reason": "event_mismatch",
                    "detail": "OrderPaid event mismatch",
                    "intent_id": "intent-1",
                    "user_id": "user-1",
                    "tx_hash": "0x" + "1" * 64,
                },
            },
            {
                "id": 275730,
                "event_type": "payment_intent_failed",
                "created_at": older,
                "payload": {
                    "reason": "event_mismatch",
                    "detail": "OrderPaid event mismatch",
                    "intent_id": "intent-1",
                    "user_id": "user-1",
                    "tx_hash": "0x" + "1" * 64,
                },
            },
        ],
    )

    payload = ops_api.list_ops_payment_incidents(None, limit=20)

    assert payload["total"] == 1
    assert payload["raw_total"] == 2
    incident = payload["incidents"][0]
    assert incident["id"] == 275751
    assert incident["occurrence_count"] == 2
    assert incident["event_ids"] == [275751, 275730]
    assert incident["first_seen_at"] == older
    assert incident["last_seen_at"] == newer


def test_ops_resolve_payment_incident_marks_duplicate_group(monkeypatch):
    from src.database.db_manager import DBManager

    called = {}

    monkeypatch.setattr(ops_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})

    def mark_related(self, event_id, resolved_by):
        called["event_id"] = event_id
        called["resolved_by"] = resolved_by
        return [
            {"id": 275751, "payload": {"resolved_at": "now"}},
            {"id": 275730, "payload": {"resolved_at": "now"}},
        ]

    monkeypatch.setattr(
        DBManager,
        "mark_related_payment_audit_events_resolved",
        mark_related,
        raising=False,
    )

    payload = ops_api.resolve_ops_payment_incident(None, 275751)

    assert called == {"event_id": 275751, "resolved_by": "ops@example.com"}
    assert payload["resolved_count"] == 2


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


def test_cities_endpoint_does_not_block_on_recent_deb_index(monkeypatch):
    monkeypatch.setattr(city_api, "_RECENT_DEB_CACHE", None, raising=False)
    monkeypatch.setattr(city_api, "_RECENT_DEB_CACHE_TS", 0.0, raising=False)
    monkeypatch.setattr(city_api, "_RECENT_DEB_REFRESHING", False, raising=False)
    monkeypatch.setattr(city_api, "_get_recent_deb_cache", lambda: None, raising=False)
    monkeypatch.setattr(city_api, "_start_recent_deb_refresh", lambda: None, raising=False)

    def fail_recent_index():
        raise AssertionError("recent DEB stats must not run in the default city-list request")

    monkeypatch.setattr(
        city_api.legacy_routes,
        "_build_recent_deb_performance_index",
        fail_recent_index,
    )

    response = client.get("/api/cities")

    assert response.status_code == 200
    denver = next(item for item in response.json()["cities"] if item["name"] == "denver")
    assert denver["deb_recent_tier"] == "other"
    assert denver["deb_recent_sample_count"] == 0


def test_city_detail_batch_endpoint_builds_multiple_cached_details(monkeypatch):
    calls = []

    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_city_cache_is_fresh",
        lambda entry, ttl: True,
    )
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_overlay_latest_wunderground_current",
        lambda city, payload: {**payload, "overlay_city": city},
    )

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return {
                "payload": {
                    "city": city,
                    "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
                }
            }

    def build_detail(data, market_slug, target_date, resolution):
        calls.append((data["city"], resolution))
        return {
            "city": data["city"],
            "hourly": data["hourly"],
            "resolution": resolution,
            "overlay_city": data["overlay_city"],
        }

    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    response = client.get("/api/cities/detail-batch?cities=Shanghai,Paris&resolution=10m")

    assert response.status_code == 200
    payload = response.json()
    assert payload["cities"] == ["shanghai", "paris"]
    assert sorted(payload["details"]) == ["paris", "shanghai"]
    assert payload["details"]["shanghai"]["resolution"] == "10m"
    assert payload["details"]["paris"]["overlay_city"] == "paris"
    assert sorted(calls) == [("paris", "10m"), ("shanghai", "10m")]


def test_city_detail_batch_chart_scope_returns_only_chart_fields(monkeypatch):
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_city_cache_is_fresh",
        lambda entry, ttl: True,
    )
    monkeypatch.setattr(
        city_api.legacy_routes,
        "_overlay_latest_wunderground_current",
        lambda city, payload: payload,
    )

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return {
                "payload": {
                    "name": city,
                    "display_name": city.title(),
                    "local_date": "2026-05-30",
                    "local_time": "15:20",
                    "temp_symbol": "°C",
                    "current": {
                        "temp": 20.0,
                        "settlement_source": "metar",
                        "settlement_source_label": "METAR",
                    },
                    "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
                    "forecast": {
                        "today_high": 22.0,
                        "daily": [{"date": "2026-05-30", "max_temp": 22.0}],
                    },
                    "multi_model": {
                        "hourly_times": ["15:00"],
                        "hourly_forecasts": {"ECMWF": [21.0]},
                    },
                    "deb": {"prediction": 21.5, "hourly_path": {"times": ["15:00"], "temps": [21.5]}},
                    "probabilities": {"mu": 21.4, "distribution": [{"value": 21, "probability": 0.4}]},
                    "runway_plate_history": {"01/19": [{"time": "2026-05-30T15:20:00Z", "temp": 20.1}]},
                    "airport_current": {"temp": 20.0},
                    "airport_primary": {"temp": 20.0},
                    "airport_primary_today_obs": [["15:20", 20.0]],
                    "wunderground_current": {"max_so_far": 20.5},
                    "settlement_station": {"settlement_station_label": "Station"},
                    "amos": {"runway_obs": {"point_temperatures": []}},
                    "metar_today_obs": [{"time": "15:20", "temp": 20.0}],
                    "settlement_today_obs": [],
                    "dynamic_commentary": {"summary": "large text"},
                    "official_nearby": [{"name": "unused"}],
                    "taf": {"raw": "unused"},
                    "ai_analysis": "unused",
                }
            }

    def build_detail(_data, _market_slug, _target_date, _resolution):
        raise AssertionError("chart scope must not build the full city detail payload")

    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    response = client.get("/api/cities/detail-batch?cities=Paris&resolution=10m&scope=chart")

    assert response.status_code == 200
    detail = response.json()["details"]["paris"]
    assert detail["timeseries"]["hourly"]["temps"] == [20.0]
    assert detail["models_hourly"]["curves"]["ECMWF"] == [21.0]
    assert detail["deb"]["hourly_path"]["temps"] == [21.5]
    assert detail["airport_primary_today_obs"] == [["15:20", 20.0]]
    assert "dynamic_commentary" not in detail
    assert "official_nearby" not in detail
    assert "taf" not in detail
    assert "ai_analysis" not in detail


def test_chart_detail_payload_uses_threadpool_and_reuses_short_cache(monkeypatch):
    import asyncio

    build_calls = 0
    threadpool_calls = 0

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        nonlocal threadpool_calls
        threadpool_calls += 1
        await asyncio.sleep(0)
        return fn(*args, **kwargs)

    def build_chart_detail(data, resolution):
        nonlocal build_calls
        build_calls += 1
        return {
            "city": data["city"],
            "resolution": resolution,
            "hourly": data["hourly"],
        }

    city_api._CITY_CHART_DETAIL_PAYLOAD_CACHE.clear()
    city_api._CITY_CHART_DETAIL_PAYLOAD_CACHE_TS.clear()
    monkeypatch.setenv("POLYWEATHER_CITY_DETAIL_PAYLOAD_CACHE_TTL_SEC", "20")
    monkeypatch.setattr(city_api, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_chart_detail_payload", build_chart_detail)

    data = {
        "city": "paris",
        "updated_at": "2026-05-30T15:00:00Z",
        "hourly": {"times": ["2026-05-30T15:00:00Z"], "temps": [20.0]},
    }

    first = asyncio.run(city_api._build_city_chart_detail_payload(data, "10m"))
    second = asyncio.run(city_api._build_city_chart_detail_payload(data, "10m"))

    assert first == second
    assert first["resolution"] == "10m"
    assert build_calls == 1
    assert threadpool_calls == 1


def test_city_detail_batch_partial_timeout_default_stays_below_proxy_budget(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS", raising=False)
    assert city_api._city_detail_batch_partial_timeout_seconds() == 6.0


def test_city_detail_batch_endpoint_limits_backend_concurrency(monkeypatch):
    import asyncio

    active = 0
    max_active = 0

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        try:
            await asyncio.sleep(0.01)
            return fn(*args, **kwargs)
        finally:
            active -= 1

    monkeypatch.setenv("POLYWEATHER_CITY_DETAIL_BATCH_CONCURRENCY", "2")
    monkeypatch.setattr(city_api, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_city_cache_is_fresh", lambda entry, ttl: False)

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return None

    def refresh_full(city, force_refresh):
        return {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
        }

    def build_detail(data, market_slug, target_date, resolution):
        return {
            "city": data["city"],
            "hourly": data["hourly"],
            "resolution": resolution,
        }

    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", refresh_full)
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    response = client.get("/api/cities/detail-batch?cities=a,b,c,d,e&resolution=10m&limit=5")

    assert response.status_code == 200
    assert response.json()["cities"] == ["a", "b", "c", "d", "e"]
    assert max_active <= 2


def test_city_detail_batch_returns_completed_details_when_one_city_is_slow(monkeypatch):
    import asyncio

    completed = []

    async def build_batch_item(city, **kwargs):
        if city == "slow":
            await asyncio.sleep(0.08)
        completed.append(city)
        return city, {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
            "resolution": kwargs.get("resolution"),
        }

    monkeypatch.setenv("POLYWEATHER_CITY_DETAIL_BATCH_PARTIAL_TIMEOUT_MS", "20")
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api, "_build_city_detail_batch_item_async", build_batch_item)

    payload = asyncio.run(
        city_api.get_city_detail_batch_payload(
            object(),
            cities="fast,slow,other",
            resolution="10m",
            limit=3,
        )
    )

    assert payload["cities"] == ["fast", "slow", "other"]
    assert sorted(payload["details"]) == ["fast", "other"]
    assert payload["details"]["fast"]["resolution"] == "10m"
    assert payload["partial"] is True
    assert payload["missing"] == ["slow"]
    assert payload["errors"] == {}
    assert "slow" not in completed


def test_city_detail_batch_response_cache_keeps_entitlement_check(monkeypatch):
    import asyncio

    entitlement_calls = 0
    build_calls = 0

    async def build_batch_item(city, **kwargs):
        nonlocal build_calls
        build_calls += 1
        return city, {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
            "resolution": kwargs.get("resolution"),
        }

    def assert_entitlement(request):
        nonlocal entitlement_calls
        entitlement_calls += 1

    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.clear()

    monkeypatch.setenv("POLYWEATHER_CITY_DETAIL_BATCH_RESPONSE_CACHE_TTL_SEC", "20")
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", assert_entitlement)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api, "_build_city_detail_batch_item_async", build_batch_item)

    first = asyncio.run(
        city_api.get_city_detail_batch_payload(
            object(),
            cities="Paris",
            resolution="10m",
            limit=12,
        )
    )
    second = asyncio.run(
        city_api.get_city_detail_batch_payload(
            object(),
            cities="Paris",
            resolution="10m",
            limit=12,
        )
    )

    assert first == second
    assert first["details"]["paris"]["resolution"] == "10m"
    assert entitlement_calls == 2
    assert build_calls == 1


def test_concurrent_city_detail_batch_requests_share_inflight_response(monkeypatch):
    import asyncio

    entitlement_calls = 0
    build_calls = 0

    async def build_batch_item(city, **kwargs):
        nonlocal build_calls
        build_calls += 1
        await asyncio.sleep(0.02)
        return city, {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
            "resolution": kwargs.get("resolution"),
        }

    def assert_entitlement(request):
        nonlocal entitlement_calls
        entitlement_calls += 1

    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_CACHE_TS.clear()
    city_api._CITY_DETAIL_BATCH_RESPONSE_INFLIGHT.clear()

    monkeypatch.setenv("POLYWEATHER_CITY_DETAIL_BATCH_RESPONSE_CACHE_TTL_SEC", "20")
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", assert_entitlement)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api, "_build_city_detail_batch_item_async", build_batch_item)

    async def run_requests():
        return await asyncio.gather(
            city_api.get_city_detail_batch_payload(
                object(),
                cities="Paris",
                resolution="10m",
                limit=12,
            ),
            city_api.get_city_detail_batch_payload(
                object(),
                cities="Paris",
                resolution="10m",
                limit=12,
            ),
        )

    first, second = asyncio.run(run_requests())

    assert first == second
    assert entitlement_calls == 2
    assert build_calls == 1


def test_concurrent_city_detail_requests_share_same_full_cache_refresh(monkeypatch):
    import asyncio

    refresh_calls = 0
    build_calls = 0

    class FakeCache:
        payload = None

        def get_city_cache(self, kind, city):
            assert kind == "full"
            if self.payload is None:
                return None
            return {"payload": self.payload}

    fake_cache = FakeCache()

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        if fn is city_api.legacy_routes._refresh_city_full_cache:
            await asyncio.sleep(0.02)
        return fn(*args, **kwargs)

    def refresh_full(city, force_refresh):
        nonlocal refresh_calls
        refresh_calls += 1
        fake_cache.payload = {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
        }
        return fake_cache.payload

    def build_detail(data, market_slug, target_date, resolution):
        nonlocal build_calls
        build_calls += 1
        return {
            "city": data["city"],
            "hourly": data["hourly"],
            "resolution": resolution,
        }

    monkeypatch.setattr(city_api, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", fake_cache)
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", refresh_full)
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    async def run_two_requests():
        return await asyncio.gather(
            city_api.get_city_detail_aggregate_payload(object(), "Paris", resolution="10m"),
            city_api.get_city_detail_aggregate_payload(object(), "Paris", resolution="10m"),
        )

    results = asyncio.run(run_two_requests())

    assert [item["city"] for item in results] == ["paris", "paris"]
    assert refresh_calls == 1
    assert build_calls == 1


def test_stale_city_detail_uses_cached_full_payload_while_refreshing(monkeypatch):
    import asyncio

    refresh_calls = 0
    build_inputs = []

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            assert city == "paris"
            return {
                "payload": {
                    "city": "paris",
                    "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
                },
            }

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        if fn is city_api.legacy_routes._refresh_city_full_cache:
            await asyncio.sleep(0.01)
        return fn(*args, **kwargs)

    def refresh_full(city, force_refresh):
        nonlocal refresh_calls
        refresh_calls += 1
        return {
            "city": city,
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [21.0]},
        }

    def build_detail(data, market_slug, target_date, resolution):
        build_inputs.append(data["hourly"]["temps"][0])
        return {
            "city": data["city"],
            "live_temp": data["hourly"]["temps"][0],
            "resolution": resolution,
        }

    city_api._CITY_FULL_REFRESH_INFLIGHT.clear()
    city_api._CITY_DETAIL_PAYLOAD_CACHE.clear()
    city_api._CITY_DETAIL_PAYLOAD_CACHE_TS.clear()
    city_api._CITY_DETAIL_PAYLOAD_INFLIGHT.clear()

    monkeypatch.setattr(city_api, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_city_cache_is_fresh", lambda entry, ttl: False)
    monkeypatch.setattr(city_api.legacy_routes, "_overlay_latest_wunderground_current", lambda city, payload: payload)
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", refresh_full)
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    async def run_request():
        payload = await city_api.get_city_detail_aggregate_payload(object(), "Paris", resolution="10m")
        await asyncio.sleep(0.03)
        return payload

    result = asyncio.run(run_request())

    assert result["live_temp"] == 20.0
    assert build_inputs == [20.0]
    assert refresh_calls == 1


def test_force_refresh_invalidates_short_city_detail_payload_cache(monkeypatch):
    import asyncio

    build_calls = 0
    refreshed_payloads = [
        {
            "city": "paris",
            "local_date": "2026-05-30",
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [20.0]},
        },
        {
            "city": "paris",
            "local_date": "2026-05-30",
            "hourly": {"times": ["2026-05-30T00:00:00Z"], "temps": [21.0]},
        },
    ]

    class FakeCache:
        def get_city_cache(self, kind, city):
            assert kind == "full"
            return None

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    def refresh_full(city, force_refresh):
        assert city == "paris"
        assert refreshed_payloads
        return refreshed_payloads.pop(0)

    def build_detail(data, market_slug, target_date, resolution):
        nonlocal build_calls
        build_calls += 1
        return {
            "city": data["city"],
            "live_temp": data["hourly"]["temps"][0],
            "resolution": resolution,
        }

    city_api._CITY_DETAIL_PAYLOAD_CACHE.clear()
    city_api._CITY_DETAIL_PAYLOAD_CACHE_TS.clear()
    city_api._CITY_DETAIL_PAYLOAD_INFLIGHT.clear()

    monkeypatch.setattr(city_api, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(city_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(city_api.legacy_routes, "_normalize_city_or_404", lambda name: name.strip().lower())
    monkeypatch.setattr(city_api.legacy_routes, "_CACHE_DB", FakeCache())
    monkeypatch.setattr(city_api.legacy_routes, "_refresh_city_full_cache", refresh_full)
    monkeypatch.setattr(city_api.legacy_routes, "_build_city_detail_payload", build_detail)

    first = asyncio.run(city_api.get_city_detail_aggregate_payload(object(), "Paris", resolution="10m"))
    second = asyncio.run(
        city_api.get_city_detail_aggregate_payload(
            object(),
            "Paris",
            resolution="10m",
            force_refresh=True,
        ),
    )

    assert first["live_temp"] == 20.0
    assert second["live_temp"] == 21.0
    assert build_calls == 2


def test_payment_runtime_endpoint_returns_shape():
    response = client.get('/api/payments/runtime')
    assert response.status_code == 200
    payload = response.json()
    assert 'checkout' in payload
    assert 'rpc' in payload
    assert 'event_loop_state' in payload
    assert 'recent_audit_events' in payload


def test_payment_runtime_endpoint_returns_ops_summary_fields(monkeypatch):
    from src.database.db_manager import DBManager

    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "get_config_payload",
        lambda: {
            "enabled": True,
            "chain_id": 137,
            "receiver_contract": "0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a",
        },
    )
    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "get_rpc_runtime_status",
        lambda: {"connected": True, "chain_id": 137},
    )
    monkeypatch.setattr(
        DBManager,
        "get_payment_runtime_state",
        lambda self, key: {"last_scanned_block": 123456},
    )
    monkeypatch.setattr(
        DBManager,
        "list_payment_audit_events",
        lambda self, limit=20, event_type=None: [
            {"id": 1, "event_type": "event_loop_cycle", "payload": {}, "created_at": "now"},
            {"id": 2, "event_type": "payment_intent_failed", "payload": {}, "created_at": "now"},
        ],
    )

    response = client.get("/api/payments/runtime")

    assert response.status_code == 200
    payload = response.json()
    assert payload["chain_id"] == 137
    assert payload["receiver_contract"] == "0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a"
    assert payload["last_scanned_block"] == 123456
    assert payload["audit_events_count"] == 2


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


def test_auth_me_entitlement_scope_skips_non_access_profile_sections(monkeypatch):
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "enabled", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "require_subscription", True)
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "anon_key", "anon-key")
    monkeypatch.setattr(web_core, "_SUPABASE_AUTH_REQUIRED", True)

    class _Identity:
        user_id = "user-1"
        email = "user@example.com"
        points = 7
        created_at = "2026-05-01T00:00:00+00:00"

    monkeypatch.setattr(web_core.SUPABASE_ENTITLEMENT, "get_identity", lambda token: _Identity())
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_subscription_window",
        lambda user_id, respect_requirement=False, bypass_cache=False, unknown_on_error=False: {
            "current": {
                "plan_code": "pro_monthly",
                "starts_at": "2026-06-01T00:00:00+00:00",
                "expires_at": "2026-07-01T00:00:00+00:00",
            },
            "total_expires_at": "2026-07-01T00:00:00+00:00",
            "queued_days": 0,
            "queued_count": 0,
        },
    )
    monkeypatch.setattr(
        web_core.SUPABASE_ENTITLEMENT,
        "get_referral_summary",
        lambda user_id: (_ for _ in ()).throw(
            AssertionError("entitlement scope must not block on referral summary"),
        ),
    )
    monkeypatch.setattr(
        routes,
        "_resolve_auth_points",
        lambda request: (_ for _ in ()).throw(
            AssertionError("entitlement scope must not block on points summary"),
        ),
    )
    monkeypatch.setattr(
        routes,
        "_resolve_weekly_profile",
        lambda request: (_ for _ in ()).throw(
            AssertionError("entitlement scope must not block on weekly profile"),
        ),
    )

    response = client.get(
        "/api/auth/me?scope=entitlement",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert payload["points"] == 7
    assert payload["weekly_points"] == 0
    assert payload["referral"] is None


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


def test_scan_terminal_timeout_does_not_replace_better_cached_snapshot(monkeypatch):
    import time

    filters = {"scan_mode": "tradable", "limit": 5}
    normalized_filters = scan_terminal_service._normalize_scan_terminal_filters(filters)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()
    previous_payload = {
        "generated_at": "2026-05-31T00:00:00Z",
        "snapshot_id": "scan-existing",
        "filters": normalized_filters,
        "summary": {"candidate_total": 2, "visible_count": 2},
        "top_signal": {"id": "old-1"},
        "rows": [{"id": "old-1"}, {"id": "old-2"}],
        "status": "ready",
        "stale": False,
        "stale_reason": None,
        "last_success_at": None,
        "last_failed_at": None,
    }
    scan_terminal_cache.set_cached_scan_terminal_payload(
        normalized_filters,
        previous_payload,
    )

    monkeypatch.setattr(
        scan_terminal_service,
        "CITIES",
        {"fast": {"tz": 0}, "slow": {"tz": 0}},
    )
    monkeypatch.setattr(scan_terminal_service, "SCAN_TERMINAL_BUILD_TIMEOUT_SEC", 0.01)
    monkeypatch.setattr(scan_terminal_service, "SCAN_TERMINAL_MAX_WORKERS", 2)

    def _scan_city(city_name, *_args, **_kwargs):
        if city_name == "slow":
            time.sleep(0.05)
        return {
            "city": city_name,
            "candidate_total": 1,
            "primary_scores": [80.0],
            "rows": [
                {
                    "id": f"{city_name}-row",
                    "market_key": f"{city_name}-market",
                    "edge_percent": 4.0,
                    "final_score": 80.0,
                    "volume": 1000,
                }
            ],
        }

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _scan_city)

    stale = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert stale["status"] == "stale"
    assert stale["stale"] is True
    assert [row["id"] for row in stale["rows"]] == ["old-1", "old-2"]
    assert stale["stale_reason"].startswith("scan terminal build timed out")
    cached = scan_terminal_cache.get_cached_scan_terminal_payload(
        normalized_filters,
        ttl_sec=3600,
    )
    assert [row["id"] for row in cached["rows"]] == ["old-1", "old-2"]


def test_scan_terminal_prewarm_builds_default_terminal_payload(monkeypatch):
    calls = []

    def _fake_build(filters, *, force_refresh=False, timeout_sec=None):
        calls.append((dict(filters), force_refresh, timeout_sec))
        return {"rows": []}

    monkeypatch.setattr(
        scan_terminal_service,
        "_build_scan_terminal_payload_uncached",
        _fake_build,
    )

    assert scan_terminal_service._warm_scan_terminal_payloads() == 2
    assert {filters["limit"] for filters, _, _ in calls} == {25, 180}
    filters, force_refresh, timeout_sec = calls[0]
    assert all(force_refresh is False for _, force_refresh, _ in calls)
    assert all(
        timeout_sec == scan_terminal_service.SCAN_TERMINAL_PREWARM_PAYLOAD_TIMEOUT_SEC
        for _, _, timeout_sec in calls
    )
    assert filters["scan_mode"] == "tradable"
    assert filters["min_price"] == 0.05
    assert filters["max_price"] == 0.95
    assert filters["min_edge_pct"] == 2.0
    assert filters["min_liquidity"] == 500.0
    assert filters["market_type"] == "maxtemp"
    assert filters["time_range"] == "today"
    assert filters["limit"] == 25


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
