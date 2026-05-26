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
    assert sse_router._bounded_replay_limit(500) == 500
    assert sse_router._bounded_replay_limit(5000) == 2000
