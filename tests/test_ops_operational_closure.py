from src.database.db_manager import DBManager
from web.schemas.auth import GrantPointsRequest
import web.services.auth_api as auth_api
import web.services.ops.payments as ops_payments
import web.services.ops.users as ops_users
import web.services.system_api as system_api


def test_ops_audit_log_records_admin_action_roundtrip(tmp_path):
    db = DBManager(str(tmp_path / "ops-audit.db"))

    event = db.append_ops_audit_event(
        action="manual_points_grant",
        actor_email="ops@example.com",
        target_user_id="user-1",
        target_email="pilot@example.com",
        payload={"points": 300},
    )

    rows = db.list_ops_audit_events(limit=10)

    assert event["id"] > 0
    assert rows[0]["action"] == "manual_points_grant"
    assert rows[0]["actor_email"] == "ops@example.com"
    assert rows[0]["target_user_id"] == "user-1"
    assert rows[0]["target_email"] == "pilot@example.com"
    assert rows[0]["payload"]["points"] == 300


def test_points_ledger_explains_manual_and_feedback_sources(tmp_path):
    db = DBManager(str(tmp_path / "points-ledger.db"))
    db.upsert_user(1001, "pilot")
    with db._get_connection() as conn:  # noqa: SLF001
        conn.execute(
            """
            UPDATE users
            SET points = ?, supabase_user_id = ?, supabase_email = ?
            WHERE telegram_id = ?
            """,
            (50, "user-1", "pilot@example.com", 1001),
        )
        conn.commit()

    grant = db.grant_points_by_supabase_email(
        "pilot@example.com",
        300,
        source="ops_manual_grant",
        actor_email="ops@example.com",
        reference_type="ops_audit",
        reference_id="audit-1",
    )
    feedback = db.append_user_feedback(
        category="data",
        message="METAR was stale.",
        user_id="user-1",
        user_email="pilot@example.com",
    )
    reward = db.grant_feedback_reward(
        feedback["id"],
        points=500,
        reason="valid stale-data report",
        actor_email="ops@example.com",
    )

    summary = db.get_points_ledger_summary(
        supabase_user_id="user-1",
        supabase_email="pilot@example.com",
        limit=10,
    )

    assert grant["ok"] is True
    assert reward["ok"] is True
    assert summary["balance"] == 850
    assert summary["by_source"]["ops_manual_grant"]["points"] == 300
    assert summary["by_source"]["feedback_reward"]["points"] == 500
    assert summary["recent"][0]["source"] == "feedback_reward"
    assert summary["recent"][0]["metadata"]["reason"] == "valid stale-data report"


def test_points_ledger_requires_user_identity(tmp_path):
    db = DBManager(str(tmp_path / "points-ledger-identity.db"))
    db.append_points_ledger_entry(
        supabase_user_id="user-1",
        supabase_email="pilot@example.com",
        source="ops_manual_grant",
        delta_points=100,
        balance_after=100,
    )

    summary = db.get_points_ledger_summary(limit=10)

    assert summary["balance"] == 0
    assert summary["recent"] == []
    assert summary["by_source"] == {}


def test_refund_case_state_machine_roundtrip(tmp_path):
    db = DBManager(str(tmp_path / "refund-cases.db"))

    created = db.create_refund_case(
        reason="duplicate_payment",
        intent_id="intent-1",
        tx_hash="0x" + "1" * 64,
        user_id="user-1",
        amount_usdc="29.9",
        created_by="ops@example.com",
        note="User submitted tx after order already paid.",
    )
    updated = db.update_refund_case(
        created["id"],
        status="processing",
        handled_by="ops2@example.com",
        note="Refund tx prepared.",
    )
    rows = db.list_refund_cases(limit=10)

    assert created["status"] == "open"
    assert updated["status"] == "processing"
    assert updated["handled_by"] == "ops2@example.com"
    assert updated["notes"][-1]["note"] == "Refund tx prepared."
    assert rows[0]["id"] == created["id"]
    assert rows[0]["reason"] == "duplicate_payment"


def test_payment_incidents_include_refund_required_cases(monkeypatch):
    class FakeDB:
        def list_payment_audit_events(self, limit=50, event_type=None):
            if event_type == "payment_intent_failed":
                return [
                    {
                        "id": 1,
                        "event_type": "payment_intent_failed",
                        "payload": {
                            "reason": "receiver_mismatch",
                            "intent_id": "intent-1",
                            "user_id": "user-1",
                            "tx_hash": "0x" + "1" * 64,
                        },
                        "created_at": "2026-06-01T00:00:00",
                    }
                ]
            if event_type == "payment_refund_required":
                return [
                    {
                        "id": 2,
                        "event_type": "payment_refund_required",
                        "payload": {
                            "reason": "refund_required",
                            "intent_id": "intent-2",
                            "user_id": "user-2",
                            "tx_hash": "0x" + "2" * 64,
                        },
                        "created_at": "2026-06-01T00:01:00",
                    }
                ]
            return []

        def list_refund_cases(self, limit=50, status=None):
            return [
                {
                    "id": 10,
                    "status": "open",
                    "reason": "duplicate_payment",
                    "intent_id": "intent-3",
                    "user_id": "user-3",
                    "tx_hash": "0x" + "3" * 64,
                    "created_at": "2026-06-01T00:02:00",
                }
            ]

    monkeypatch.setattr(ops_payments, "_require_ops", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_payments, "_get_db", lambda: FakeDB())

    payload = ops_payments.list_ops_payment_incidents(object(), limit=20)
    reasons = {item["reason"] for item in payload["incidents"]}

    assert {"receiver_mismatch", "refund_required", "duplicate_payment"}.issubset(
        reasons
    )
    assert any(item.get("refund_case_id") == 10 for item in payload["incidents"])


def test_ops_points_grant_writes_audit_and_ledger(monkeypatch):
    calls = []

    class FakeDB:
        def grant_points_by_supabase_email(self, email, amount, **kwargs):
            calls.append(("grant", email, amount, kwargs))
            return {
                "ok": True,
                "supabase_user_id": "user-1",
                "supabase_email": email,
                "points_added": amount,
                "points_after": 350,
            }

        def append_ops_audit_event(self, **kwargs):
            calls.append(("audit", kwargs))
            return {"id": 9, **kwargs}

    monkeypatch.setattr(ops_users, "_require_ops", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_users, "_get_db", lambda: FakeDB())

    payload = ops_users.grant_ops_points(
        object(),
        GrantPointsRequest(email="pilot@example.com", points=300),
    )

    assert payload["ok"] is True
    assert calls[0][0] == "grant"
    assert calls[0][3]["source"] == "ops_manual_grant"
    assert calls[0][3]["actor_email"] == "ops@example.com"
    assert calls[1][0] == "audit"
    assert calls[1][1]["action"] == "manual_points_grant"
    assert payload["audit_event_id"] == 9


def test_auth_me_payload_includes_points_ledger_summary(monkeypatch):
    class FakeEntitlement:
        enabled = True
        require_subscription = False

        @staticmethod
        def ensure_signup_trial(user_id, email):
            return None

        @staticmethod
        def get_subscription_window(*args, **kwargs):
            return {"current": None, "rows": [], "total_expires_at": None}

        @staticmethod
        def get_latest_subscription_any_status(user_id):
            return None

        @staticmethod
        def get_referral_summary(user_id):
            return {"reward_points": 3500}

    class FakeDB:
        def get_points_ledger_summary(self, **kwargs):
            assert kwargs["supabase_user_id"] == "user-1"
            assert kwargs["supabase_email"] == "pilot@example.com"
            return {
                "balance": 850,
                "by_source": {"feedback_reward": {"points": 500, "count": 1}},
                "recent": [
                    {
                        "source": "feedback_reward",
                        "delta_points": 500,
                        "balance_after": 850,
                    }
                ],
            }

    class RequestStub:
        query_params = {}

        def __init__(self):
            self.state = type(
                "State",
                (),
                {
                    "auth_user_id": "user-1",
                    "auth_email": "pilot@example.com",
                },
            )()

    monkeypatch.setattr(auth_api.legacy_routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(auth_api.legacy_routes, "_bind_optional_supabase_identity", lambda request: None)
    monkeypatch.setattr(auth_api.legacy_routes, "_resolve_auth_points", lambda request: 850)
    monkeypatch.setattr(
        auth_api.legacy_routes,
        "_resolve_weekly_profile",
        lambda request: {"weekly_points": 0, "weekly_rank": None},
    )
    monkeypatch.setattr(auth_api.legacy_routes, "SUPABASE_ENTITLEMENT", FakeEntitlement())
    monkeypatch.setattr(auth_api.legacy_routes, "_SUPABASE_AUTH_REQUIRED", False, raising=False)
    monkeypatch.setattr(auth_api, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(auth_api.TelegramGroupPricing, "configured", False, raising=False)

    payload = auth_api.get_auth_me_payload(RequestStub())

    assert payload["points"] == 850
    assert payload["points_ledger"]["balance"] == 850
    assert payload["points_ledger"]["by_source"]["feedback_reward"]["points"] == 500


def test_prometheus_exports_operational_closure_metrics(monkeypatch, tmp_path):
    db_path = tmp_path / "metrics.db"
    db_path.write_bytes(b"x" * 2048)
    db_path_text = str(db_path)

    class FakeDB:
        db_path = db_path_text

        def list_payment_audit_events(self, limit=500, event_type=None):
            if event_type == "payment_intent_failed":
                return [
                    {
                        "id": 1,
                        "event_type": "payment_intent_failed",
                        "payload": {"reason": "receiver_mismatch"},
                        "created_at": "2026-06-01T00:00:00",
                    },
                    {
                        "id": 2,
                        "event_type": "payment_intent_failed",
                        "payload": {
                            "reason": "event_mismatch",
                            "resolved_at": "2026-06-01T00:05:00",
                        },
                        "created_at": "2026-06-01T00:01:00",
                    },
                ]
            if event_type == "payment_refund_required":
                return [
                    {
                        "id": 3,
                        "event_type": "payment_refund_required",
                        "payload": {"reason": "refund_required"},
                        "created_at": "2026-06-01T00:02:00",
                    }
                ]
            return []

        def list_refund_cases(self, limit=500, status=None):
            return [
                {"id": 10, "status": "open", "reason": "duplicate_payment"},
                {"id": 11, "status": "refunded", "reason": "receiver_mismatch"},
            ]

    monkeypatch.setattr(system_api.legacy_routes, "_require_ops_admin", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(system_api, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(
        system_api,
        "_realtime_status_payload",
        lambda: {
            "store": "degraded_sqlite",
            "latest_revision": 42,
            "sse_connections": 3,
            "degraded_from": "redis",
        },
    )

    response = system_api.get_prometheus_metrics_response(object())
    text = response.body.decode("utf-8")

    assert "polyweather_payment_incidents_open 2" in text
    assert 'polyweather_payment_incidents_by_reason{reason="receiver_mismatch"} 1' in text
    assert "polyweather_refund_cases_open 1" in text
    assert "polyweather_sse_connections 3" in text
    assert "polyweather_realtime_latest_revision 42" in text
    assert "polyweather_realtime_redis_fallback 1" in text
    assert "polyweather_sqlite_db_size_bytes 2048" in text
