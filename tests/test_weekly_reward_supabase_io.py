from datetime import datetime

import src.bot.weekly_reward_loop as weekly_reward_loop


class _Response:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.content = b"1"

    def json(self):
        return self._payload


def test_weekly_reward_bonus_subscription_insert_uses_minimal_return(monkeypatch):
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(("GET", url, headers, params))
        return _Response(200, [])

    def _fake_post(url, headers=None, json=None, timeout=None):
        calls.append(("POST", url, headers, json))
        assert headers["Prefer"] == "return=minimal"
        return _Response(201, [])

    monkeypatch.setattr(weekly_reward_loop.requests, "get", _fake_get)
    monkeypatch.setattr(weekly_reward_loop.requests, "post", _fake_post)

    ok, reason, expires_at = weekly_reward_loop._grant_bonus_subscription_days(
        supabase_url="https://example.supabase.co",
        service_role_key="service-role",
        user_id="user-1",
        days=7,
        timeout_sec=5,
    )

    assert ok is True
    assert reason == ""
    assert datetime.fromisoformat(str(expires_at)).tzinfo is not None
    assert [call[0] for call in calls] == ["GET", "POST"]
