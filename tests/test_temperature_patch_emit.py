from types import SimpleNamespace

from src.data_collection.weather_sources import WeatherDataCollector


def test_collector_patch_post_retries_transient_failures(monkeypatch):
    collector = WeatherDataCollector({})
    collector.collector_patch_endpoint = "http://internal.local/api/internal/collector-patch"
    calls = []

    def fake_post(url, *, json, timeout):
        calls.append((url, json, timeout))
        if len(calls) < 3:
            raise RuntimeError("temporary 502")
        return SimpleNamespace(status_code=200, text="ok")

    monkeypatch.setattr("src.data_collection.weather_sources.requests.post", fake_post)
    monkeypatch.setattr("src.data_collection.weather_sources.time.sleep", lambda _seconds: None)

    sent = collector._post_temperature_patch_payload(
        {"city": "busan", "changes": {"temp": 23.0}},
        city_value="busan",
        source_value="amos",
    )

    assert sent is True
    assert len(calls) == 3


def test_collector_patch_post_retries_internal_server_errors(monkeypatch):
    collector = WeatherDataCollector({})
    collector.collector_patch_endpoint = "http://internal.local/api/internal/collector-patch"
    calls = []

    def fake_post(url, *, json, timeout):
        calls.append((url, json, timeout))
        status = 502 if len(calls) == 1 else 204
        return SimpleNamespace(status_code=status, text="bad gateway" if status == 502 else "")

    monkeypatch.setattr("src.data_collection.weather_sources.requests.post", fake_post)
    monkeypatch.setattr("src.data_collection.weather_sources.time.sleep", lambda _seconds: None)

    sent = collector._post_temperature_patch_payload(
        {"city": "shanghai", "changes": {"temp": 22.4}},
        city_value="shanghai",
        source_value="amsc_awos",
    )

    assert sent is True
    assert len(calls) == 2


def test_failed_collector_patch_clears_dedupe_for_next_attempt(monkeypatch):
    collector = WeatherDataCollector({})
    collector.collector_patch_endpoint = "http://internal.local/api/internal/collector-patch"
    calls = []

    class ImmediateThread:
        def __init__(self, target, daemon):
            self._target = target
            self.daemon = daemon

        def start(self):
            self._target()

    def fake_post(payload, *, city_value, source_value):
        calls.append((payload, city_value, source_value))
        return False

    monkeypatch.setattr("src.data_collection.weather_sources.threading.Thread", ImmediateThread)
    monkeypatch.setattr(collector, "_post_temperature_patch_payload", fake_post)

    collector._emit_temperature_patch_if_changed(
        "busan",
        23.0,
        "2026-06-06T13:01:00Z",
        source="amos",
    )
    collector._emit_temperature_patch_if_changed(
        "busan",
        23.0,
        "2026-06-06T13:01:00Z",
        source="amos",
    )

    assert len(calls) == 2
