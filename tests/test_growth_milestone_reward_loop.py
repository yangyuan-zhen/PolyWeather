from datetime import datetime, timezone

from src.bot import growth_milestone_reward_loop as growth
from src.database.db_manager import DBManager


def test_reached_growth_milestones_follow_confirmed_schedule():
    assert growth.reached_growth_milestones(599) == []
    assert growth.reached_growth_milestones(600) == [(600, 1)]
    assert growth.reached_growth_milestones(999) == [(600, 1), (750, 2)]
    assert growth.reached_growth_milestones(1000) == [(600, 1), (750, 2), (1000, 3)]
    assert growth.reached_growth_milestones(1250)[-2:] == [(1100, 3), (1200, 3)]


def test_select_eligible_paid_users_requires_current_access_and_confirmed_payment():
    now = datetime(2026, 6, 12, tzinfo=timezone.utc)
    subscriptions = [
        {
            "user_id": "paid-current",
            "status": "active",
            "starts_at": "2026-06-01T00:00:00+00:00",
            "expires_at": "2026-07-01T00:00:00+00:00",
        },
        {
            "user_id": "trial-only",
            "status": "active",
            "starts_at": "2026-06-11T00:00:00+00:00",
            "expires_at": "2026-06-14T00:00:00+00:00",
        },
        {
            "user_id": "paid-expired",
            "status": "active",
            "starts_at": "2026-05-01T00:00:00+00:00",
            "expires_at": "2026-06-01T00:00:00+00:00",
        },
    ]
    confirmed = [
        {"user_id": "paid-current", "status": "confirmed"},
        {"user_id": "paid-expired", "status": "confirmed"},
    ]

    assert growth.select_eligible_paid_user_ids(subscriptions, confirmed, now=now) == [
        "paid-current"
    ]


def test_growth_history_and_payouts_are_idempotent(tmp_path):
    db = DBManager(str(tmp_path / "growth.db"))
    db.record_user_growth_snapshot(
        snapshot_date="2026-06-12",
        total_registered=588,
        verified_users=573,
        ever_signed_in=561,
    )
    db.record_user_growth_snapshot(
        snapshot_date="2026-06-12",
        total_registered=590,
        verified_users=575,
        ever_signed_in=563,
    )
    snapshots = db.list_user_growth_snapshots(limit=10)
    assert len(snapshots) == 1
    assert snapshots[0]["total_registered"] == 590
    assert snapshots[0]["verified_users"] == 575

    assert db.record_growth_milestone_payout(600, "user-1", 1, "granted", "") is True
    assert db.record_growth_milestone_payout(600, "user-1", 1, "granted", "") is False
    assert db.is_growth_milestone_settled(600) is False
    db.mark_growth_milestone_settled(600, 601, 1, 1, 0, {"ok": True})
    assert db.is_growth_milestone_settled(600) is True


def test_growth_bonus_grant_uses_milestone_source_as_idempotency_guard(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.content = b"1"

        def json(self):
            return self._payload

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append(("GET", params))
        if params.get("source") == "eq.growth_milestone_reward_600":
            return Response(200, [])
        return Response(
            200,
            [{"expires_at": "2026-07-01T00:00:00+00:00"}],
        )

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(("POST", json))
        return Response(201, [])

    monkeypatch.setattr(growth.requests, "get", fake_get)
    monkeypatch.setattr(growth.requests, "post", fake_post)

    ok, reason, expires_at = growth.grant_growth_milestone_days(
        supabase_url="https://example.supabase.co",
        service_role_key="service-role",
        user_id="user-1",
        milestone=600,
        days=1,
        timeout_sec=5,
    )

    assert ok is True
    assert reason == ""
    assert expires_at
    assert calls[-1][1]["source"] == "growth_milestone_reward_600"
    assert calls[-1][1]["plan_code"] == "growth_milestone_bonus"


def test_growth_cycle_retries_frozen_failed_recipient_after_membership_changes(monkeypatch):
    grants = []

    class FakeDb:
        def record_user_growth_snapshot(self, **kwargs):
            pass

        def is_growth_milestone_settled(self, milestone):
            return False

        def list_growth_milestone_payouts(self, milestone):
            return [{"supabase_user_id": "user-frozen", "status": "failed"}]

        def has_growth_milestone_payout(self, milestone, user_id):
            return False

        def record_growth_milestone_payout(self, *args, **kwargs):
            return True

        def mark_growth_milestone_settled(self, *args, **kwargs):
            pass

    monkeypatch.setattr(
        growth,
        "fetch_auth_user_counts",
        lambda **kwargs: {
            "total_registered": 615,
            "verified_users": 600,
            "ever_signed_in": 590,
        },
    )
    monkeypatch.setattr(
        growth,
        "fetch_current_subscriptions_and_confirmed_payments",
        lambda **kwargs: ([], []),
    )

    def fake_grant(**kwargs):
        grants.append(kwargs["user_id"])
        return True, "", "2026-07-01T00:00:00+00:00"

    monkeypatch.setattr(growth, "grant_growth_milestone_days", fake_grant)

    growth.run_growth_milestone_cycle(
        bot=object(),
        db=FakeDb(),
        supabase_url="https://example.supabase.co",
        service_role_key="service-role",
        timeout_sec=5,
        announce=False,
        chat_ids=[],
    )

    assert grants == ["user-frozen"]
