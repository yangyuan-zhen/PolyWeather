from src.database.db_manager import DBManager


def test_grant_points_by_supabase_email(tmp_path):
    db = DBManager(str(tmp_path / "test.db"))
    db.upsert_user(1001, "eraer")
    with db._get_connection() as conn:  # noqa: SLF001
        conn.execute(
            """
            UPDATE users
            SET points = ?, supabase_email = ?
            WHERE telegram_id = ?
            """,
            (50, "eraer031905@gmail.com", 1001),
        )
        conn.commit()

    result = db.grant_points_by_supabase_email("eraer031905@gmail.com", 300)
    assert result["ok"] is True
    assert result["points_before"] == 50
    assert result["points_added"] == 300
    assert result["points_after"] == 350
