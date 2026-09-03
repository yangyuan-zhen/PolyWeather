"""Round-2 chaos tests: failover transitions verified against real SQLite state."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from web.services.data_quality_api import build_data_quality_snapshot


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _write(db, city, source, value, observed_at, fetched_at, station="LFPB", status="ok"):
    db.append_raw_observation(
        source=source,
        city=city,
        value=value,
        observed_at=observed_at,
        fetched_at=fetched_at,
        station_code=station,
        status=status,
    )


def _canonical(db, city, source, value, observed_at, fetched_at, station="LFPB"):
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    rows = db.list_latest_raw_observations_for_city(city, limit=100)
    assert rows
    canonical = build_canonical_temperature_from_observations(city, rows)
    assert canonical is not None
    db.set_canonical_temperature(city, canonical)
    return canonical


def test_primary_timeout_fallback_takeover(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    # Paris primary per registry is aeroweb; feed fresh aeroweb first.
    _write(db, "paris", "aeroweb", 22.0, _iso(now - timedelta(minutes=5)), _iso(now))
    _canonical(db, "paris", "aeroweb", 22.0, _iso(now - timedelta(minutes=5)), _iso(now))
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "paris")
    assert row["fallback_in_use"] is False
    assert row["active_source"] == "aeroweb"
    # Primary goes stale, metar stays fresh -> fallback.
    _write(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    _canonical(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "paris")
    assert row["fallback_in_use"] is True
    assert row["fallback_reason"] == "primary_aeroweb_not_usable"
    assert row["primary_source"] == "aeroweb"


def test_fallback_recovers_to_primary(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    _canonical(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    snap = build_data_quality_snapshot(db)
    assert next(r for r in snap["cities"] if r["city"] == "paris")["fallback_in_use"] is True
    # Time passes: the fallback metar reading ages past stale (simulated by
    # backdating, since the guard rightly rejects older writes as regressions).
    import sqlite3 as _sqlite3

    with _sqlite3.connect(str(tmp_path / "c.db")) as _conn:
        _conn.execute(
            "UPDATE raw_observation_latest SET observed_at = ? WHERE city = 'paris' AND source = 'metar'",
            (_iso(now - timedelta(minutes=70)),),
        )
        _conn.commit()
    _write(db, "paris", "aeroweb", 22.2, _iso(now - timedelta(minutes=1)), _iso(now))
    _canonical(db, "paris", "aeroweb", 22.2, _iso(now - timedelta(minutes=1)), _iso(now))
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "paris")
    assert row["fallback_in_use"] is False
    assert row["active_source"] == "aeroweb"


def test_late_primary_data_does_not_clobber(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 22.0, _iso(now - timedelta(minutes=5)), _iso(now))
    _canonical(db, "paris", "metar", 22.0, _iso(now - timedelta(minutes=5)), _iso(now))
    # Late-arriving older primary data: audit only.
    _write(db, "paris", "metar", 19.0, _iso(now - timedelta(minutes=50)), _iso(now))
    latest = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest is not None
    assert float(latest["value"]) == 22.0
    assert latest["status"] == "ok"


def test_interleaved_sources_keep_monotonic_canonical(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    # Older metar value arrives after the newer one: audit-only regression.
    _write(db, "paris", "metar", 21.0, _iso(now - timedelta(minutes=5)), _iso(now))
    _write(db, "paris", "aeroweb", 21.5, _iso(now - timedelta(minutes=10)), _iso(now))
    _write(db, "paris", "metar", 20.0, _iso(now - timedelta(minutes=25)), _iso(now))
    _write(db, "paris", "aeroweb", 21.7, _iso(now - timedelta(minutes=3)), _iso(now))
    latest_metar = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest_metar is not None
    assert float(latest_metar["value"]) == 21.0
    _canonical(db, "paris", "metar", 21.0, _iso(now - timedelta(minutes=5)), _iso(now))
    canonical = db.get_canonical_temperature("paris")
    assert canonical is not None
    # metar outscores aeroweb while fresh (460 vs 100+300); the 20.0 regression
    # never entered latest or canonical.
    assert float(canonical["value"]) == 21.0


def test_collector_restart_during_fallback_keeps_state(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    _canonical(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    # Simulated restart: new manager on the same file.
    db2 = DBManager(str(tmp_path / "c.db"))
    canonical = db2.get_canonical_temperature("paris")
    assert canonical is not None
    assert float(canonical["value"]) == 21.5
    snap = build_data_quality_snapshot(db2)
    assert next(r for r in snap["cities"] if r["city"] == "paris")["fallback_in_use"] is True


def test_redis_down_during_switch_uses_sqlite_events(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYWEATHER_EVENT_STORE", "redis")
    monkeypatch.setenv("POLYWEATHER_REDIS_REQUIRED", "false")

    def _boom(**kwargs):
        raise ConnectionError("redis down")

    from web import realtime_event_store_factory as factory

    store = factory.create_realtime_event_store(
        db_path=str(tmp_path / "e.db"), redis_store_builder=_boom
    )
    assert getattr(store, "degraded_from", None) == "redis"


def test_sqlite_busy_during_canonical_refresh_skips_city(tmp_path, monkeypatch):
    import sqlite3

    from src.database.db_manager import DBManager
    from web.services.canonical_engine import refresh_canonical_temperature_from_latest

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 22.0, _iso(now - timedelta(minutes=5)), _iso(now))
    assert refresh_canonical_temperature_from_latest(db, "paris") is not None

    class ExplodingStore:
        def list_latest_raw_observations_for_city(self, city, **kwargs):
            raise sqlite3.OperationalError("database is locked")

    assert refresh_canonical_temperature_from_latest(ExplodingStore(), "paris") is None


def test_sse_reconnect_during_fallback_replays(tmp_path):
    from web.realtime_event_store import RealtimeEventStore
    from web.realtime_patch_schema import EVENT_TYPE, SCHEMA_TYPE, SCHEMA_VERSION

    store = RealtimeEventStore(db_path=str(tmp_path / "e.db"))
    for temp in (21.5, 21.7):
        store.append_event(
            {
                "type": EVENT_TYPE,
                "schema_type": SCHEMA_TYPE,
                "schema_version": SCHEMA_VERSION,
                "city": "paris",
                "source": "metar",
                "payload": {"temp": temp, "fallback_in_use": True},
            }
        )
    replayed = store.replay_events(cities={"paris"}, since_revision=0, limit=10)
    assert len(replayed) == 2


def test_repeated_429_then_recovery(tmp_path):
    from src.database.db_manager import DBManager
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

    db = DBManager(str(tmp_path / "c.db"))
    repo = ObservationCollectorStatusRepository(RuntimeStateDB(str(tmp_path / "c.db")))
    now = datetime.now(timezone.utc).timestamp()
    for _ in range(3):
        repo.record_result(
            source="metar",
            city="paris",
            interval_sec=60,
            due_ts=now,
            started_ts=now,
            completed_ts=now + 0.1,
            ok=False,
            error="HTTP 429",
        )
    snap = repo.load_snapshot(limit=10)
    entries = [e for e in snap.get("entries", []) if e["city"] == "paris"]
    assert entries and entries[0]["failure_count"] >= 3
    repo.record_result(
        source="metar",
        city="paris",
        interval_sec=60,
        due_ts=now + 60,
        started_ts=now + 60,
        completed_ts=now + 60.1,
        ok=True,
    )
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "paris")
    assert row["consecutive_failures"] == 0


def test_source_error_fresh_keeps_fresh_with_flag(tmp_path):
    from src.database.db_manager import DBManager
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "london", "metar", 22.0, _iso(now - timedelta(minutes=3)), _iso(now))
    _canonical(db, "london", "metar", 22.0, _iso(now - timedelta(minutes=3)), _iso(now))
    repo = ObservationCollectorStatusRepository(RuntimeStateDB(str(tmp_path / "c.db")))
    ts = now.timestamp()
    repo.record_result(
        source="metar", city="london", interval_sec=60, due_ts=ts,
        started_ts=ts, completed_ts=ts + 0.1, ok=False, error="timeout",
    )
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "london")
    assert row["status"] in {"fresh", "delayed"}
    assert "recent_source_errors" in (row["quality_flags"] or [])


def test_source_error_stale_upgrades(tmp_path):
    from src.database.db_manager import DBManager
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "london", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    _canonical(db, "london", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    repo = ObservationCollectorStatusRepository(RuntimeStateDB(str(tmp_path / "c.db")))
    ts = now.timestamp()
    repo.record_result(
        source="metar", city="london", interval_sec=60, due_ts=ts,
        started_ts=ts, completed_ts=ts + 0.1, ok=False, error="HTTP 500",
    )
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "london")
    assert row["status"] == "source_error"
    assert row["last_error"] == "HTTP 500"


def test_both_sources_fail(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(
        db, "london", "metar", 22.0, _iso(now - timedelta(hours=2)),
        _iso(now - timedelta(hours=2)),
    )
    _canonical(db, "london", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "london")
    assert row["status"] in {"stale", "source_error"}


def test_fallback_itself_stale(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    _canonical(db, "paris", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "paris")
    assert row["fallback_in_use"] is True
    assert row["status"] in {"stale", "source_error"}
