import threading
from datetime import datetime, timezone

import httpx

from src.data_collection import cowin_sources
from src.data_collection.cowin_sources import CowinSourceMixin
from src.data_collection.observation_source_gate import reset_observation_source_gate_for_tests


class _FakeResponse:
    content = b"{}"

    def __init__(self, payload):
        self._payload = payload
        self.text = "{}"

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class _FakeCowinCollector(CowinSourceMixin):
    timeout = 2
    cowin_obs_cache_ttl_sec = 0
    _cowin_obs_cache = {}
    _cowin_obs_cache_lock = threading.Lock()
    user_agent = "test"

    def _http_get(self, url):
        raise httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] unable to get local issuer certificate")


def test_cowin_current_retries_without_tls_verification_when_chain_is_incomplete(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_OBSERVATION_SOURCE_DB_LOCK_ENABLED", "false")
    reset_observation_source_gate_for_tests()
    calls = []

    def fake_get(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _FakeResponse(
            {
                "station": 6087,
                "minutely": [
                    {"obstime": "2026-05-28T07:59:00", "value1": 30.1},
                    {"obstime": "2026-05-28T08:00:00", "value1": 30.0},
                ],
            }
        )

    monkeypatch.setattr(cowin_sources.requests, "get", fake_get)

    current = _FakeCowinCollector().fetch_cowin_obs_current("hong kong")

    assert current is not None
    assert current["station_code"] == "6087"
    assert current["current"]["temp"] == 30.0
    assert current["obs_time"] == "2026-05-28T08:00:00+08:00"
    assert calls
    assert calls[0]["verify"] is False


def test_cowin_today_series_returns_hong_kong_local_intraday_points(monkeypatch):
    def fake_get(url, **kwargs):
        return _FakeResponse(
            {
                "station": 6087,
                "minutely": [
                    {"obstime": "2026-05-27T23:59:00", "value1": 29.8},
                    {"obstime": "2026-05-28T00:00:00", "value1": 29.9},
                    {"obstime": "2026-05-28T07:58:00", "value1": 30.1},
                    {"obstime": "2026-05-28T08:00:00", "value1": 30.0},
                ],
            }
        )

    monkeypatch.setattr(cowin_sources.requests, "get", fake_get)

    points = _FakeCowinCollector().fetch_cowin_obs_today_series(
        "hong kong",
        now_utc=datetime(2026, 5, 28, 0, 5, tzinfo=timezone.utc),
    )

    assert points == [
        {"time": "00:00", "temp": 29.9},
        {"time": "07:58", "temp": 30.1},
        {"time": "08:00", "temp": 30.0},
    ]
