from src.database.db_manager import DBManager


def test_runtime_config_round_trip(tmp_path):
    db = DBManager(str(tmp_path / "polyweather.db"))

    meta = db.set_runtime_config(
        "POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH",
        "观测采集更新",
        updated_by="ops@example.com",
    )

    assert meta["key"] == "POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH"
    assert meta["value"] == "观测采集更新"
    assert meta["updated_by"] == "ops@example.com"
    assert meta["source"] == "runtime_config"
    assert db.get_runtime_config_value("POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH") == "观测采集更新"


def test_ops_update_announcement_uses_runtime_config_store(monkeypatch, tmp_path):
    from web.services import ops_api

    db = DBManager(str(tmp_path / "polyweather.db"))
    monkeypatch.setattr(ops_api, "DBManager", lambda: db)
    monkeypatch.setattr(ops_api, "_require_ops", lambda request: {"email": "admin@polyweather.top"})

    result = ops_api.update_ops_config(
        object(),
        "POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_EN",
        "Runway observation collector now writes patches independently.",
    )

    assert result["ok"] is True
    assert result["source"] == "runtime_config"
    assert result["updated_by"] == "admin@polyweather.top"
    assert (
        db.get_runtime_config_value("POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_EN")
        == "Runway observation collector now writes patches independently."
    )


def test_public_update_announcement_returns_enabled_bilingual_payload(monkeypatch, tmp_path):
    from web.services import system_api

    db = DBManager(str(tmp_path / "polyweather.db"))
    monkeypatch.setattr(system_api, "DBManager", lambda: db)
    db.set_runtime_config("POLYWEATHER_UPDATE_ANNOUNCEMENT_ENABLED", "true")
    db.set_runtime_config("POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH", "数据更新公告")
    db.set_runtime_config("POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_ZH", "AMSC 观测采集已独立运行。")
    db.set_runtime_config("POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_EN", "Data update")
    db.set_runtime_config(
        "POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_EN",
        "The AMSC observation collector now runs independently.",
    )

    payload = system_api.get_public_update_announcement()

    assert payload["enabled"] is True
    assert payload["zh"]["title"] == "数据更新公告"
    assert payload["zh"]["body"] == "AMSC 观测采集已独立运行。"
    assert payload["en"]["title"] == "Data update"
    assert payload["en"]["body"] == "The AMSC observation collector now runs independently."
    assert payload["updated_at"]
