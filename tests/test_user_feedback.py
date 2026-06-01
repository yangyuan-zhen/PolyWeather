from src.database.db_manager import DBManager


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
