"""Resilience tests for the METAR source against empty/204 API responses."""

import json

import pytest


class _FakeEmptyResponse:
    """httpx-like response with empty body (aviationweather 204 for ZSJN)."""

    status_code = 204
    content = b""

    def raise_for_status(self):
        return None

    def json(self):
        # Same failure mode as httpx: empty content cannot be parsed.
        raise json.JSONDecodeError("Expecting value", "", 0)


@pytest.fixture
def metar_collector():
    from src.data_collection.weather_sources import WeatherDataCollector

    collector = WeatherDataCollector({})
    # Any city -> a fixed ICAO so the request path is exercised.
    collector.get_icao_code = lambda city: "ZSJN"  # type: ignore[method-assign]
    return collector


def test_fetch_metar_empty_204_falls_back_and_returns_none(metar_collector, monkeypatch):
    """A station absent from the aviationweather feed (204, empty body) must not
    crash the whole analysis chain: every hours-window attempt fails over and
    the method returns None."""
    def _fake_http_get(*args, **kwargs):
        return _FakeEmptyResponse()

    monkeypatch.setattr(metar_collector, "_http_get", _fake_http_get)

    result = metar_collector.fetch_metar("jinan")
    assert result is None


def test_fetch_metar_json_error_falls_back_and_returns_none(metar_collector, monkeypatch):
    """A 200 response with a non-JSON body is treated like a failed window."""

    class _FakeBadJsonResponse(_FakeEmptyResponse):
        status_code = 200

    def _fake_http_get(*args, **kwargs):
        return _FakeBadJsonResponse()

    monkeypatch.setattr(metar_collector, "_http_get", _fake_http_get)

    result = metar_collector.fetch_metar("jinan")
    assert result is None
