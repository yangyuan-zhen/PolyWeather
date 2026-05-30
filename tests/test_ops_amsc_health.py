from web.services import ops_api


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
