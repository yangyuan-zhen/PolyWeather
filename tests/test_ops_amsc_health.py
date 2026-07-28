from src.database.db_manager import DBManager


def test_runtime_secret_metadata_masks_value(tmp_path):
    db = DBManager(str(tmp_path / "polyweather.db"))
    secret = "9153$$example-session"

    saved = db.set_runtime_secret(
        "POLYWEATHER_EXAMPLE_SECRET",
        secret,
        updated_by="ops@example.com",
    )

    assert saved["configured"] is True
    assert saved["masked"] == "9153...sion"
    assert "value" not in saved
    assert db.get_runtime_secret("POLYWEATHER_EXAMPLE_SECRET") == secret

    metadata = db.get_runtime_secret_metadata("POLYWEATHER_EXAMPLE_SECRET")

    assert metadata["configured"] is True
    assert metadata["masked"] == "9153...sion"
    assert metadata["updated_by"] == "ops@example.com"
    assert "value" not in metadata
