from types import SimpleNamespace

import src.database.db_manager as db_manager_module
from src.database.db_manager import DBManager


def _bound_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("POLYWEATHER_SUPABASE_PROFILE_SYNC_MIN_INTERVAL_SEC", "3600")
    DBManager._profile_sync_cache.clear()  # noqa: SLF001
    db = DBManager(str(tmp_path / "profile-sync.db"))
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


def test_repeated_user_upsert_coalesces_supabase_profile_sync(tmp_path, monkeypatch):
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

    db.upsert_user(1001, "eraer")
    now["value"] += 10.0
    db.upsert_user(1001, "eraer")

    assert len(calls) == 1
    assert calls[0][1]["headers"]["Prefer"] == "return=minimal"


def test_changed_username_bypasses_supabase_profile_sync_coalescing(tmp_path, monkeypatch):
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

    db.upsert_user(1001, "eraer")
    now["value"] += 10.0
    db.upsert_user(1001, "new-name")

    assert len(calls) == 2
    assert calls[-1][1]["json"]["telegram_username"] == "new-name"
