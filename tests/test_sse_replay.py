import json

from fastapi.testclient import TestClient

from web.app import app
from web.routers import sse_router


def _decode_sse_events(text: str):
    events = []
    for frame in text.strip().split("\n\n"):
        if not frame.startswith("data: "):
            continue
        events.append(json.loads(frame[len("data: "):]))
    return events


def test_events_endpoint_replays_only_requested_cities(monkeypatch):
    captured = {}

    class FakeStore:
        def latest_revision(self):
            return 44

        def replay_events(self, *, cities, since_revision, limit):
            captured["cities"] = cities
            captured["since_revision"] = since_revision
            captured["limit"] = limit
            return [
                {
                    "type": "city_observation_patch.v1",
                    "revision": 43,
                    "city": "taipei",
                    "source": "cwa",
                    "obs_time": "2026-05-26T08:15:00Z",
                    "ts": 1780000000000,
                    "payload": {"temp": 31.2},
                }
            ]

        def replay_requires_resync(self, *, cities, since_revision, replay_count, limit):
            return False

    async def finite_stream(
        user_id,
        *,
        cities=None,
        replay_events=None,
        connected_revision=0,
        resync_event=None,
    ):
        yield sse_router.sse_manager._format_event(
            {"type": "connected", "revision": connected_revision}
        )
        for event in replay_events or []:
            yield sse_router.sse_manager._format_event(event)

    monkeypatch.setattr(sse_router, "event_store", FakeStore())
    monkeypatch.setattr(sse_router.sse_manager, "event_stream", finite_stream)

    response = TestClient(app).get(
        "/api/events?cities=taipei,hong%20kong&since_revision=42&replay_limit=25"
    )

    assert response.status_code == 200
    assert captured == {
        "cities": {"taipei", "hong kong"},
        "since_revision": 42,
        "limit": 25,
    }
    events = _decode_sse_events(response.text)
    assert [event["type"] for event in events] == [
        "connected",
        "city_observation_patch.v1",
    ]
    assert events[1]["city"] == "taipei"


def test_events_endpoint_emits_resync_when_replay_is_incomplete(monkeypatch):
    class FakeStore:
        def latest_revision(self):
            return 99

        def replay_events(self, *, cities, since_revision, limit):
            return [
                {
                    "type": "city_observation_patch.v1",
                    "revision": 98,
                    "city": "taipei",
                    "source": "cwa",
                    "obs_time": "2026-05-26T08:15:00Z",
                    "ts": 1780000000000,
                    "payload": {"temp": 31.2},
                }
            ]

        def replay_requires_resync(self, *, cities, since_revision, replay_count, limit):
            return True

    async def finite_stream(
        user_id,
        *,
        cities=None,
        replay_events=None,
        connected_revision=0,
        resync_event=None,
    ):
        yield sse_router.sse_manager._format_event(
            {"type": "connected", "revision": connected_revision}
        )
        for event in replay_events or []:
            yield sse_router.sse_manager._format_event(event)
        if resync_event:
            yield sse_router.sse_manager._format_event(resync_event)

    monkeypatch.setattr(sse_router, "event_store", FakeStore())
    monkeypatch.setattr(sse_router.sse_manager, "event_stream", finite_stream)

    response = TestClient(app).get(
        "/api/events?cities=taipei&since_revision=1&replay_limit=1"
    )

    assert response.status_code == 200
    events = _decode_sse_events(response.text)
    assert events[-1]["type"] == "resync_required"
    assert events[-1]["reason"] == "replay_window_exceeded"
    assert events[-1]["latest_revision"] == 99


def test_replay_limit_is_bounded():
    assert sse_router._bounded_replay_limit(0) == 1
    assert sse_router._bounded_replay_limit(500) == 60
    assert sse_router._bounded_replay_limit(5000) == 60
    assert sse_router._bounded_replay_limit(500, city_count=5) == 120
    assert sse_router._bounded_replay_limit(500, city_count=20) == 240
    assert sse_router._bounded_replay_limit(25, city_count=5) == 25


def test_replay_gap_direct_resync_policy():
    assert (
        sse_router._should_direct_resync(
            since_revision=1000,
            latest_revision=1200,
            limit=60,
        )
        is False
    )
    assert (
        sse_router._should_direct_resync(
            since_revision=1000,
            latest_revision=1300,
            limit=60,
        )
        is True
    )
    assert (
        sse_router._should_direct_resync(
            since_revision=0,
            latest_revision=1300,
            limit=60,
        )
        is False
    )


def test_legacy_high_replay_limit_is_clamped_by_city_count(monkeypatch):
    captured = {}

    class FakeStore:
        def latest_revision(self):
            return 44

        def replay_events(self, *, cities, since_revision, limit):
            captured["cities"] = cities
            captured["limit"] = limit
            return []

        def replay_requires_resync(self, *, cities, since_revision, replay_count, limit):
            captured["resync_limit"] = limit
            return False

    async def finite_stream(
        user_id,
        *,
        cities=None,
        replay_events=None,
        connected_revision=0,
        resync_event=None,
    ):
        yield sse_router.sse_manager._format_event(
            {"type": "connected", "revision": connected_revision}
        )

    monkeypatch.setattr(sse_router, "event_store", FakeStore())
    monkeypatch.setattr(sse_router.sse_manager, "event_stream", finite_stream)

    response = TestClient(app).get(
        "/api/events?cities=ankara,buenos%20aires,istanbul,jeddah,seoul"
        "&since_revision=42&replay_limit=500"
    )

    assert response.status_code == 200
    assert captured["cities"] == {"ankara", "buenos aires", "istanbul", "jeddah", "seoul"}
    assert captured["limit"] == 120
    assert captured["resync_limit"] == 120


def test_stale_client_gets_direct_resync_without_replay_scan(monkeypatch):
    calls = {"replay": 0, "requires_resync": 0}

    class FakeStore:
        def latest_revision(self):
            return 2000

        def replay_events(self, *, cities, since_revision, limit):
            calls["replay"] += 1
            return []

        def replay_requires_resync(self, *, cities, since_revision, replay_count, limit):
            calls["requires_resync"] += 1
            return False

    async def finite_stream(
        user_id,
        *,
        cities=None,
        replay_events=None,
        connected_revision=0,
        resync_event=None,
    ):
        yield sse_router.sse_manager._format_event(
            {"type": "connected", "revision": connected_revision}
        )
        if resync_event:
            yield sse_router.sse_manager._format_event(resync_event)

    monkeypatch.setattr(sse_router, "event_store", FakeStore())
    monkeypatch.setattr(sse_router.sse_manager, "event_stream", finite_stream)

    response = TestClient(app).get(
        "/api/events?cities=ankara,buenos%20aires,istanbul,jeddah,seoul"
        "&since_revision=100&replay_limit=500"
    )

    assert response.status_code == 200
    assert calls == {"replay": 0, "requires_resync": 0}
    events = _decode_sse_events(response.text)
    assert events[-1]["type"] == "resync_required"
    assert events[-1]["reason"] == "replay_gap_too_large"
    assert events[-1]["latest_revision"] == 2000


def test_ingest_patch_uses_external_fanout_without_direct_broadcast(monkeypatch):
    class FakeExternalStore:
        uses_external_live_fanout = True

        def __init__(self):
            self.started = 0

        def start_live_subscription(self, callback):
            self.started += 1
            self.callback = callback

        def append_event(self, event):
            return {
                **event,
                "revision": 12,
            }

    class FakeManager:
        def __init__(self):
            self.broadcasted = []

        def broadcast_event(self, event):
            self.broadcasted.append(event)
            return event

    store = FakeExternalStore()
    manager = FakeManager()
    monkeypatch.setattr(sse_router, "event_store", store)
    monkeypatch.setattr(sse_router, "sse_manager", manager)
    monkeypatch.setattr(sse_router, "_live_subscription_started", False)

    response = TestClient(app).post(
        "/api/internal/collector-patch",
        json={
            "city": "taipei",
            "changes": {
                "temp": 34.2,
                "source": "cwa",
                "obs_time": "2026-05-27T10:00:00+08:00",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["revision"] == 12
    assert store.started == 1
    assert manager.broadcasted == []
