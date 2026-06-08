from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.database.db_manager import DBManager
from web.services import feedback_api
from web.services import ops_api


def test_user_feedback_round_trip_includes_context_and_status(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback.db"))

    created = db.append_user_feedback(
        category="bug",
        message="The Helsinki chart keeps loading.",
        source="chart",
        contact="pilot@example.com",
        user_id="user-123",
        user_email="pilot@example.com",
        context={"city": "helsinki", "slot": 3, "detail_error": "timeout"},
    )

    assert created["id"] > 0
    assert created["status"] == "open"

    rows = db.list_user_feedback(limit=10)

    assert len(rows) == 1
    assert rows[0]["category"] == "bug"
    assert rows[0]["message"] == "The Helsinki chart keeps loading."
    assert rows[0]["source"] == "chart"
    assert rows[0]["contact"] == "pilot@example.com"
    assert rows[0]["user_id"] == "user-123"
    assert rows[0]["user_email"] == "pilot@example.com"
    assert rows[0]["context"]["city"] == "helsinki"
    assert rows[0]["context"]["detail_error"] == "timeout"

    updated = db.update_user_feedback_status(created["id"], status="triaged")

    assert updated["status"] == "triaged"
    assert db.list_user_feedback(limit=10, status="triaged")[0]["id"] == created["id"]


def test_user_feedback_status_filter_excludes_other_statuses(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback-filter.db"))
    db.append_user_feedback(category="idea", message="Add a dark chart grid.")
    closed = db.append_user_feedback(category="bug", message="Payment page failed.")
    db.update_user_feedback_status(closed["id"], status="closed")

    open_rows = db.list_user_feedback(limit=10, status="open")

    assert [row["status"] for row in open_rows] == ["open"]
    assert open_rows[0]["message"] == "Add a dark chart grid."


def test_user_feedback_reward_metadata_round_trip(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback-reward.db"))

    created = db.append_user_feedback(
        category="data",
        message="Hong Kong COWIN reading was stale.",
        user_id="user-reward",
        user_email="reward@example.com",
    )

    assert created["reward_points"] == 0
    assert created["reward_reason"] == ""
    assert created["reward_status"] == ""
    assert created["rewarded_at"] is None

    rewarded = db.update_user_feedback_reward(
        created["id"],
        points=300,
        reason="Valid data freshness report",
        status="granted",
    )

    assert rewarded is not None
    assert rewarded["reward_points"] == 300
    assert rewarded["reward_reason"] == "Valid data freshness report"
    assert rewarded["reward_status"] == "granted"
    assert rewarded["rewarded_at"]

    row = db.list_user_feedback(
        limit=10,
        user_id="user-reward",
        user_email="reward@example.com",
    )[0]
    assert row["id"] == created["id"]
    assert row["reward_points"] == 300
    assert row["reward_reason"] == "Valid data freshness report"
    assert row["reward_status"] == "granted"
    assert row["rewarded_at"] == rewarded["rewarded_at"]


def test_feedback_reward_grant_adds_points_and_marks_feedback(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback-grant.db"))
    db.upsert_user(1001, "pilot")
    with db._get_connection() as conn:  # noqa: SLF001
        conn.execute(
            """
            UPDATE users
            SET points = ?, supabase_email = ?
            WHERE telegram_id = ?
            """,
            (50, "pilot@example.com", 1001),
        )
        conn.commit()

    created = db.append_user_feedback(
        category="data",
        message="Amsterdam METAR stale.",
        user_id="user-1001",
        user_email="pilot@example.com",
    )

    result = db.grant_feedback_reward(
        created["id"],
        points=300,
    )

    assert result["ok"] is True
    assert result["points_before"] == 50
    assert result["points_added"] == 300
    assert result["points_after"] == 350
    assert result["feedback"]["reward_points"] == 300
    assert result["feedback"]["reward_reason"] == ""
    assert result["feedback"]["reward_status"] == "granted"
    assert db.get_points_by_supabase_email("pilot@example.com") == 350

    duplicate = db.grant_feedback_reward(
        created["id"],
        points=300,
    )

    assert duplicate["ok"] is False
    assert duplicate["reason"] == "already_rewarded"
    assert duplicate["points_after"] == 350


def test_ops_feedback_reward_service_returns_operator(monkeypatch):
    class FakeDB:
        def grant_feedback_reward(self, feedback_id, *, points, reason=""):
            return {
                "ok": True,
                "feedback_id": feedback_id,
                "points_added": points,
                "points_after": 900,
                "feedback": {
                    "id": feedback_id,
                    "reward_points": points,
                    "reward_reason": reason,
                    "reward_status": "granted",
                },
            }

    monkeypatch.setattr(ops_api, "_require_ops", lambda request: {"email": "ops@example.com"})
    monkeypatch.setattr(ops_api, "DBManager", lambda: FakeDB())

    payload = ops_api.grant_ops_feedback_reward(
        object(),
        feedback_id=42,
        points=500,
    )

    assert payload["ok"] is True
    assert payload["operator_email"] == "ops@example.com"
    assert payload["feedback"]["reward_points"] == 500
    assert payload["feedback"]["reward_reason"] == ""


def test_user_feedback_identity_filter_returns_only_matching_user(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback-identity.db"))
    mine_by_user_id = db.append_user_feedback(
        category="bug",
        message="My chart needs attention.",
        user_id="user-a",
        user_email="a@example.com",
    )
    mine_by_email = db.append_user_feedback(
        category="data",
        message="My older email-only report.",
        user_email="a@example.com",
    )
    db.append_user_feedback(
        category="bug",
        message="Someone else's report.",
        user_id="user-b",
        user_email="b@example.com",
    )
    db.append_user_feedback(
        category="idea",
        message="Anonymous report should not leak.",
        contact="a@example.com",
    )

    rows = db.list_user_feedback(
        limit=10,
        user_id="user-a",
        user_email="a@example.com",
    )

    assert [row["id"] for row in rows] == [mine_by_email["id"], mine_by_user_id["id"]]
    assert {row["message"] for row in rows} == {
        "My chart needs attention.",
        "My older email-only report.",
    }


def test_list_current_user_feedback_requires_identity(tmp_path, monkeypatch):
    db = DBManager(str(tmp_path / "polyweather-feedback-current-user.db"))
    db.append_user_feedback(
        category="bug",
        message="Mine.",
        user_id="user-a",
        user_email="a@example.com",
    )
    db.append_user_feedback(
        category="bug",
        message="Not mine.",
        user_id="user-b",
        user_email="b@example.com",
    )
    monkeypatch.setattr(feedback_api, "DBManager", lambda: db)
    monkeypatch.setattr(feedback_api.legacy_routes, "_bind_optional_supabase_identity", lambda request: None)

    request = SimpleNamespace(
        state=SimpleNamespace(auth_user_id="user-a", auth_email="a@example.com")
    )

    payload = feedback_api.list_current_user_feedback(request, limit=20)

    assert payload["total"] == 1
    assert payload["feedback"][0]["message"] == "Mine."

    anonymous_request = SimpleNamespace(state=SimpleNamespace())
    with pytest.raises(HTTPException) as exc_info:
        feedback_api.list_current_user_feedback(anonymous_request, limit=20)
    assert exc_info.value.status_code == 401
