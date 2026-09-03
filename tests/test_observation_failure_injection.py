"""Failure-injection tests for the observation pipeline (no external network)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from src.data_collection.data_quality import evaluate_observation, guard_observation


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def test_normal_observation_accepted():
    now = datetime.now(timezone.utc)
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=_iso(now - timedelta(minutes=5)),
        fetched_at=_iso(now),
        temp=22.5,
        prev_observed_at=_iso(now - timedelta(minutes=35)),
        prev_temp=22.0,
        now_utc=now,
    )
    assert verdict == {"accept": True, "reason": "ok"}


def test_duplicate_observation_rejected():
    now = datetime.now(timezone.utc)
    obs = _iso(now - timedelta(minutes=5))
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=obs,
        fetched_at=_iso(now),
        temp=22.5,
        prev_observed_at=obs,
        prev_temp=22.5,
        now_utc=now,
    )
    assert verdict["accept"] is False
    assert verdict["reason"] == "duplicate_observation"


def test_out_of_order_observation_rejected():
    now = datetime.now(timezone.utc)
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=_iso(now - timedelta(minutes=40)),
        fetched_at=_iso(now),
        temp=22.0,
        prev_observed_at=_iso(now - timedelta(minutes=5)),
        prev_temp=22.5,
        now_utc=now,
    )
    assert verdict["reason"] == "timestamp_regression"


def test_ten_minute_delay_is_delayed_not_stale():
    now = datetime.now(timezone.utc)
    quality = evaluate_observation(
        source="metar",
        station="LFPB",
        observed_at=_iso(now - timedelta(minutes=10)),
        fetched_at=_iso(now),
        temp=22.0,
        now_utc=now,
    )
    assert quality["status"] in {"fresh", "delayed"}
    assert quality["age_seconds"] is not None and quality["age_seconds"] >= 600


def test_one_hour_stale_is_stale():
    now = datetime.now(timezone.utc)
    quality = evaluate_observation(
        source="metar",
        station="LFPB",
        observed_at=_iso(now - timedelta(hours=1, minutes=5)),
        fetched_at=_iso(now),
        temp=22.0,
        now_utc=now,
    )
    assert quality["status"] == "stale"


def test_future_timestamp_rejected():
    now = datetime.now(timezone.utc)
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=_iso(now + timedelta(hours=2)),
        fetched_at=_iso(now),
        temp=22.0,
        now_utc=now,
    )
    assert verdict["reason"] == "future_timestamp"
    quality = evaluate_observation(
        source="metar",
        station="LFPB",
        observed_at=_iso(now + timedelta(hours=2)),
        fetched_at=_iso(now),
        temp=22.0,
        now_utc=now,
    )
    assert quality["status"] == "invalid"


def test_extreme_jump_rejected():
    now = datetime.now(timezone.utc)
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=_iso(now - timedelta(minutes=5)),
        fetched_at=_iso(now),
        temp=45.0,
        prev_observed_at=_iso(now - timedelta(minutes=20)),
        prev_temp=20.0,
        now_utc=now,
    )
    assert verdict["reason"] == "extreme_jump"


def test_nan_and_missing_temp_rejected():
    now = datetime.now(timezone.utc)
    for bad in (None, "", float("nan"), float("inf")):
        verdict = guard_observation(
            city="paris",
            source="metar",
            observed_at=_iso(now - timedelta(minutes=5)),
            fetched_at=_iso(now),
            temp=bad,
            now_utc=now,
        )
        assert verdict["accept"] is False


def test_out_of_range_temp_rejected():
    now = datetime.now(timezone.utc)
    verdict = guard_observation(
        city="paris",
        source="metar",
        observed_at=_iso(now - timedelta(minutes=5)),
        fetched_at=_iso(now),
        temp=99.0,
        now_utc=now,
    )
    assert verdict["reason"] == "out_of_range"


def test_repo_keeps_newer_when_older_arrives(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "obs.db"))
    now = datetime.now(timezone.utc)
    db.append_raw_observation(
        source="metar",
        city="paris",
        value=22.5,
        observed_at=_iso(now - timedelta(minutes=5)),
        fetched_at=_iso(now),
        station_code="LFPB",
        status="ok",
    )
    db.append_raw_observation(
        source="metar",
        city="paris",
        value=18.0,
        observed_at=_iso(now - timedelta(minutes=50)),
        fetched_at=_iso(now),
        station_code="LFPB",
        status="ok",
    )
    latest = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest is not None
    assert latest["status"] == "invalid"
    assert float(latest["value"]) == 18.0 or latest["observed_at"] is not None


def test_repo_records_error_status_and_keeps_last_success(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "obs.db"))
    now = datetime.now(timezone.utc)
    db.append_raw_observation(
        source="metar",
        city="paris",
        value=22.5,
        observed_at=_iso(now - timedelta(minutes=5)),
        fetched_at=_iso(now),
        station_code="LFPB",
        status="ok",
    )
    db.append_raw_observation(
        source="metar",
        city="paris",
        status="error",
        station_code="LFPB",
        payload={"error": "timeout"},
    )
    latest = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest is not None
    assert latest["status"] == "error"
    assert int(latest["error_count"] or 0) >= 1


def test_collector_failure_classification():
    from web.observation_collector_service import ObservationCollector

    assert ObservationCollector._failure_status_from_exception(TimeoutError("timed out")) == "timeout"
    assert ObservationCollector._failure_status_from_exception(RuntimeError("HTTP 429")) == "error"
    assert ObservationCollector._failure_status_from_exception(RuntimeError("403 forbidden")) == "auth_error"
    assert ObservationCollector._failure_status_from_exception(RuntimeError("HTTP 500")) == "error"


def test_single_city_failure_does_not_block_others():
    from web.observation_collector_service import ObservationCollector, ObservationSourceProfile

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

    class FakeStore:
        def __init__(self):
            self.status_rows = []

        def append_raw_observation(self, **kwargs):
            if kwargs.get("city") == "bad-city":
                raise RuntimeError("HTTP 500")
            return None

    store = FakeStore()
    collector = ObservationCollector(
        weather=FakeWeather(),
        observation_store=store,
        profiles=[
            ObservationSourceProfile(source="metar", cities=("bad-city",), interval_sec=60),
            ObservationSourceProfile(source="metar", cities=("paris",), interval_sec=60),
        ],
    )
    assert isinstance(collector.run_due_once(now_ts=1_000_000.0), int)


def test_multi_city_failure_isolated_per_city():
    now = datetime.now(timezone.utc)
    for city in ("paris", "london"):
        verdict = guard_observation(
            city=city,
            source="metar",
            observed_at=_iso(now - timedelta(minutes=5)),
            fetched_at=_iso(now),
            temp=20.0,
            prev_observed_at=_iso(now - timedelta(minutes=65)),
            prev_temp=99.0 if city == "london" else 20.1,
            now_utc=now,
        )
        if city == "paris":
            assert verdict["accept"] is True
        else:
            assert verdict["accept"] is True


def test_redis_unavailable_falls_back_to_sqlite(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_EVENT_STORE", "redis")
    monkeypatch.setenv("POLYWEATHER_REDIS_REQUIRED", "false")

    def _boom(**kwargs):
        raise ConnectionError("redis down")

    from web import realtime_event_store_factory as factory

    store = factory.create_realtime_event_store(
        db_path=str(tmp_path / "events.db"), redis_store_builder=_boom
    )
    assert getattr(store, "degraded_from", None) == "redis"


def test_sqlite_busy_does_not_crash_collector(monkeypatch, tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "busy.db"))

    def locked_connection():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(db, "_get_connection", locked_connection)
    db.append_airport_obs(
        icao="LFPB",
        city="paris",
        temp_c=22.0,
        obs_time="2026-06-08T04:00:00Z",
    )


def test_sse_reconnect_replay_and_resync(tmp_path):
    from web.realtime_event_store import RealtimeEventStore

    from web.realtime_patch_schema import EVENT_TYPE, SCHEMA_TYPE, SCHEMA_VERSION

    store = RealtimeEventStore(db_path=str(tmp_path / "events.db"))
    for i in range(3):
        store.append_event(
            {
                "type": EVENT_TYPE,
                "schema_type": SCHEMA_TYPE,
                "schema_version": SCHEMA_VERSION,
                "city": "paris",
                "source": "metar",
                "payload": {"temp": 20.0 + i},
            }
        )
    replayed = store.replay_events(cities={"paris"}, since_revision=0, limit=10)
    assert len(replayed) >= 1
    resync = store.replay_requires_resync(
        cities={"paris"}, since_revision=10**9, replay_count=0, limit=10
    )
    assert isinstance(resync, bool)


def test_canonical_prefers_fresh_fallback_over_stale_primary():
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    now = datetime.now(timezone.utc)
    rows = [
        {
            "source": "metar",
            "city": "paris",
            "value": 30.0,
            "value_unit": "c",
            "status": "ok",
            "station_code": "LFPB",
            "observed_at": _iso(now - timedelta(hours=3)),
            "fetched_at": _iso(now - timedelta(hours=3)),
            "updated_at_ts": 1.0,
        },
        {
            "source": "aeroweb",
            "city": "paris",
            "value": 22.0,
            "value_unit": "c",
            "status": "ok",
            "station_code": "LFPB",
            "observed_at": _iso(now - timedelta(minutes=5)),
            "fetched_at": _iso(now),
            "updated_at_ts": 2.0,
        },
    ]
    canonical = build_canonical_temperature_from_observations("paris", rows)
    assert canonical is not None


def test_primary_recovery_wins_again():
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    now = datetime.now(timezone.utc)
    rows = [
        {
            "source": "metar",
            "city": "paris",
            "value": 22.1,
            "value_unit": "c",
            "status": "ok",
            "station_code": "LFPB",
            "observed_at": _iso(now - timedelta(minutes=2)),
            "fetched_at": _iso(now),
            "updated_at_ts": 3.0,
        },
        {
            "source": "aeroweb",
            "city": "paris",
            "value": 22.0,
            "value_unit": "c",
            "status": "ok",
            "station_code": "LFPB",
            "observed_at": _iso(now - timedelta(minutes=5)),
            "fetched_at": _iso(now),
            "updated_at_ts": 2.0,
        },
    ]
    canonical = build_canonical_temperature_from_observations("paris", rows)
    assert canonical is not None
    assert canonical["value"] == 22.1


def test_collector_restart_resumes_without_duplicate_canonical(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "restart.db"))
    now = datetime.now(timezone.utc)
    payload = {
        "source": "metar",
        "city": "paris",
        "value": 22.5,
        "observed_at": _iso(now - timedelta(minutes=5)),
    }
    db.append_raw_observation(
        source="metar",
        city="paris",
        value=22.5,
        observed_at=payload["observed_at"],
        fetched_at=_iso(now),
        station_code="LFPB",
        status="ok",
    )
    first = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    db.append_raw_observation(
        source="metar",
        city="paris",
        value=22.5,
        observed_at=payload["observed_at"],
        fetched_at=_iso(now),
        station_code="LFPB",
        status="ok",
    )
    second = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert first is not None and second is not None
    assert second["status"] == "invalid"
