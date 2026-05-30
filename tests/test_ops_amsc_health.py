from web.services import ops_api
from src.database.db_manager import DBManager
from src.data_collection.amsc_awos_sources import AmscAwosSourceMixin


def test_runtime_secret_metadata_masks_value(tmp_path):
    db = DBManager(str(tmp_path / "polyweather.db"))
    secret = "9153$$example-session"

    saved = db.set_runtime_secret(
        "POLYWEATHER_AMSC_SESSION_ID",
        secret,
        updated_by="ops@example.com",
    )

    assert saved["configured"] is True
    assert saved["masked"] == "9153...sion"
    assert "value" not in saved
    assert db.get_runtime_secret("POLYWEATHER_AMSC_SESSION_ID") == secret

    metadata = db.get_runtime_secret_metadata("POLYWEATHER_AMSC_SESSION_ID")

    assert metadata["configured"] is True
    assert metadata["masked"] == "9153...sion"
    assert metadata["updated_by"] == "ops@example.com"
    assert "value" not in metadata


def test_amsc_headers_prefer_runtime_secret_over_env(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "polyweather.db"))
    monkeypatch.setenv("POLYWEATHER_AMSC_SESSION_ID", "env-session")
    monkeypatch.delenv("POLYWEATHER_AMSC_COOKIE", raising=False)
    DBManager().set_runtime_secret(
        "POLYWEATHER_AMSC_SESSION_ID",
        "db-session-1234",
        updated_by="ops@example.com",
    )

    class FakeSource(AmscAwosSourceMixin):
        timeout = 1.0

    headers = FakeSource()._amsc_headers()

    assert headers["sessionId"] == "db-session-1234"
    assert headers["app"] == "AMS"


def test_ops_sensitive_config_update_rotates_session_without_echoing_secret(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "polyweather.db"))
    monkeypatch.setattr(
        ops_api,
        "_require_ops",
        lambda request: {"email": "ops@example.com"},
    )
    monkeypatch.setattr(
        ops_api,
        "_check_amsc_awos_health",
        lambda timeout=8: {"ok": True, "credential_configured": True, "points": 4},
    )
    secret = "9153$$rotated-session"

    result = ops_api.update_ops_sensitive_config(
        object(),
        "POLYWEATHER_AMSC_SESSION_ID",
        secret,
    )

    assert result["ok"] is True
    assert result["config"]["configured"] is True
    assert result["config"]["masked"] == "9153...sion"
    assert result["health"]["ok"] is True
    assert DBManager().get_runtime_secret("POLYWEATHER_AMSC_SESSION_ID") == secret
    assert "value" not in result["config"]
    assert secret not in str(result)


def test_ops_sensitive_config_status_uses_metadata_not_plaintext(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_DB_PATH", str(tmp_path / "polyweather.db"))
    monkeypatch.setattr(
        ops_api,
        "_require_ops",
        lambda request: {"email": "ops@example.com"},
    )
    secret = "9153$$stored-session"
    DBManager().set_runtime_secret(
        "POLYWEATHER_AMSC_SESSION_ID",
        secret,
        updated_by="ops@example.com",
    )

    result = ops_api.get_ops_sensitive_config(object())

    assert result["configs"][0]["key"] == "POLYWEATHER_AMSC_SESSION_ID"
    assert result["configs"][0]["configured"] is True
    assert result["configs"][0]["masked"] == "9153...sion"
    assert "value" not in result["configs"][0]
    assert secret not in str(result)


def test_ops_amsc_health_uses_configured_session_header(monkeypatch):
    captured = {}

    payload = {
        "code": 200,
        "data": {
            "35R/17L": {
                "RNO": "35R/17L",
                "OTIME": "2026-05-30 20:03:00",
                "TDZ_TEMP": "23.6",
                "MID_TEMP": "-",
                "END_TEMP": "23.4",
            }
        },
    }

    class FakeResponse:
        ok = True
        status_code = 200
        content = b"{}"

        def json(self):
            return payload

    def fake_get(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers") or {}
        return FakeResponse()

    session_id = "9153$$example-session"
    monkeypatch.setenv("AMSC_AWOS_BASE_URL", "https://example.test/getWindPlate")
    monkeypatch.setenv("POLYWEATHER_AMSC_SESSION_ID", session_id)
    monkeypatch.delenv("POLYWEATHER_AMSC_COOKIE", raising=False)
    monkeypatch.setattr(ops_api._requests, "get", fake_get)

    result = ops_api._check_amsc_awos_health(timeout=1)

    assert result["ok"] is True
    assert result["credential_configured"] is True
    assert result["points"] == 1
    assert captured["url"].endswith("?cccc=ZSPD")
    assert captured["headers"]["sessionId"] == session_id
    assert captured["headers"]["app"] == "AMS"


def test_ops_amsc_health_rejects_empty_success_response(monkeypatch):
    class FakeResponse:
        ok = True
        status_code = 200
        content = b"{}"

        def json(self):
            return {"code": 200, "data": {}}

    monkeypatch.setenv("AMSC_AWOS_BASE_URL", "https://example.test/getWindPlate")
    monkeypatch.setenv("POLYWEATHER_AMSC_SESSION_ID", "session")
    monkeypatch.setattr(ops_api._requests, "get", lambda *args, **kwargs: FakeResponse())

    result = ops_api._check_amsc_awos_health(timeout=1)

    assert result["ok"] is False
    assert result["status"] == 200
    assert result["error"] == "empty_or_unauthorized_response"
