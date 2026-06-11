from web.services import ops_api


class _Elapsed:
    def total_seconds(self):
        return 0.01


class _Response:
    ok = True
    status_code = 200
    elapsed = _Elapsed()


def test_ops_health_check_uses_lightweight_head_for_madis(monkeypatch):
    import requests

    head_calls = []

    monkeypatch.setattr(ops_api, "_require_ops", lambda request: {})
    monkeypatch.setattr(ops_api, "_check_amsc_awos_health", lambda timeout=8: {"ok": True})
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: _Response())
    monkeypatch.setattr(
        requests,
        "head",
        lambda url, **kwargs: head_calls.append((url, kwargs)) or _Response(),
    )
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "KNMI_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "CWA_API_KEY",
        "CWA_OPEN_DATA_AUTH",
        "CWA_OPEN_DATA_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    result = ops_api.get_ops_health_check(object())

    assert result["services"]["madis"]["ok"] is True
    assert head_calls == [
        (
            "https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/",
            {"timeout": 8, "allow_redirects": True},
        )
    ]
