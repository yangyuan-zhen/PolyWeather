from types import SimpleNamespace

import src.database.db_manager as db_manager_module
from src.database.db_manager import DBManager


def _bound_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    db = DBManager(str(tmp_path / "points-sync.db"))
    db.upsert_user(1001, "eraer")
    with db._get_connection() as conn:  # noqa: SLF001
        conn.execute(
            """
            UPDATE users
            SET supabase_user_id = ?, supabase_email = ?
            WHERE telegram_id = ?
            """,
            ("supabase-user-1", "eraer@example.com", 1001),
        )
        conn.execute(
            """
            INSERT INTO supabase_bindings (supabase_user_id, telegram_id, supabase_email)
            VALUES (?, ?, ?)
            """,
            ("supabase-user-1", 1001, "eraer@example.com"),
        )
        conn.commit()
    return db


def test_message_points_sync_to_supabase_metadata_is_throttled(tmp_path, monkeypatch):
    db = _bound_db(tmp_path, monkeypatch)
    calls = []
    now = {"value": 1000.0}

    monkeypatch.setattr(
        db_manager_module,
        "time",
        SimpleNamespace(monotonic=lambda: now["value"]),
        raising=False,
    )
    monkeypatch.setattr(
        db_manager_module.requests,
        "patch",
        lambda *args, **kwargs: calls.append((args, kwargs))
        or SimpleNamespace(status_code=204, text="", content=b""),
    )

    first = db.add_message_activity(
        1001,
        "第一条有效发言",
        cooldown_sec=0,
        daily_cap=1000,
    )
    now["value"] += 10.0
    second = db.add_message_activity(
        1001,
        "第二条有效发言",
        cooldown_sec=0,
        daily_cap=1000,
    )

    assert first["awarded"] is True
    assert second["awarded"] is True
    assert len(calls) == 1


def test_manual_point_grant_forces_supabase_metadata_sync(tmp_path, monkeypatch):
    db = _bound_db(tmp_path, monkeypatch)
    calls = []
    now = {"value": 1000.0}

    monkeypatch.setattr(
        db_manager_module,
        "time",
        SimpleNamespace(monotonic=lambda: now["value"]),
        raising=False,
    )
    monkeypatch.setattr(
        db_manager_module.requests,
        "patch",
        lambda *args, **kwargs: calls.append((args, kwargs))
        or SimpleNamespace(status_code=204, text="", content=b""),
    )

    db.add_message_activity(1001, "第一条有效发言", cooldown_sec=0, daily_cap=1000)
    now["value"] += 10.0
    result = db.grant_points_by_supabase_email("eraer@example.com", 300)

    assert result["ok"] is True
    assert len(calls) == 2
    assert calls[-1][1]["json"]["user_metadata"]["points"] == result["points_after"]
