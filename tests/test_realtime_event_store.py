import sqlite3
from datetime import datetime, timezone

from src.database.db_manager import DBManager
from web.realtime_event_store import RealtimeEventStore
from web.realtime_patch_schema import normalize_observation_patch


def _event(city: str, temp: float, source: str = "metar"):
    return normalize_observation_patch(
        {
            "city": city,
            "changes": {
                "temp": temp,
                "obs_time": "2026-05-26T08:15:00Z",
                "source": source,
            },
        }
    )


def test_event_store_appends_monotonic_revisions_and_replays_by_city(tmp_path):
    db_path = str(tmp_path / "polyweather.db")
    DBManager._initialized_paths.clear()
    store = RealtimeEventStore(db_path=db_path)

    taipei = store.append_event(_event("taipei", 31.2))
    seoul = store.append_event(_event("seoul", 27.8))
    taipei_next = store.append_event(_event("taipei", 31.5))

    assert taipei["revision"] == 1
    assert seoul["revision"] == 2
    assert taipei_next["revision"] == 3
    assert store.latest_revision() == 3

    replay = store.replay_events(cities={"taipei"}, since_revision=1, limit=10)

    assert [event["revision"] for event in replay] == [3]
    assert replay[0]["city"] == "taipei"
    assert replay[0]["payload"]["temp"] == 31.5


def test_event_store_cleanup_uses_short_replay_retention(tmp_path):
    db_path = str(tmp_path / "polyweather.db")
    DBManager._initialized_paths.clear()
    store = RealtimeEventStore(db_path=db_path)

    old_event = store.append_event(_event("taipei", 30.0))
    fresh_event = store.append_event(_event("taipei", 31.0))

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE observation_patch_events SET created_at = ? WHERE revision = ?",
            ("2026-05-26T00:00:00+00:00", old_event["revision"]),
        )
        conn.execute(
            "UPDATE observation_patch_events SET created_at = ? WHERE revision = ?",
            ("2026-05-26T11:30:00+00:00", fresh_event["revision"]),
        )
        conn.commit()

    deleted = store.cleanup_old_events(
        retention_hours=6,
        now=datetime(2026, 5, 26, 12, 0, tzinfo=timezone.utc),
    )

    assert deleted == 1
    replay = store.replay_events(cities={"taipei"}, since_revision=0, limit=10)
    assert [event["revision"] for event in replay] == [fresh_event["revision"]]


def test_event_store_reports_replay_gap_when_limit_is_exceeded(tmp_path):
    db_path = str(tmp_path / "polyweather.db")
    DBManager._initialized_paths.clear()
    store = RealtimeEventStore(db_path=db_path)

    for temp in [30.0, 30.5, 31.0]:
        store.append_event(_event("hong kong", temp, source="hko"))

    replay = store.replay_events(cities={"hong kong"}, since_revision=0, limit=2)

    assert len(replay) == 2
    assert store.replay_requires_resync(
        cities={"hong kong"},
        since_revision=0,
        replay_count=len(replay),
        limit=2,
    )
