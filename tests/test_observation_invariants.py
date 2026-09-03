"""Data-quality invariants over real SQLite state (parameterized)."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

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


def _rebuild(db, city):
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    rows = db.list_latest_raw_observations_for_city(city, limit=100)
    canonical = build_canonical_temperature_from_observations(city, rows)
    if canonical is not None:
        db.set_canonical_temperature(city, canonical)
    return canonical


@pytest.mark.parametrize("city", ["paris", "london", "tokyo"])
def test_canonical_observed_at_never_regresses(tmp_path, city):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, city, "metar", 20.0, _iso(now - timedelta(minutes=30)), _iso(now))
    first = _rebuild(db, city)
    assert first is not None
    # Older data arrives late: must not move canonical backwards.
    _write(db, city, "metar", 25.0, _iso(now - timedelta(minutes=60)), _iso(now))
    second = _rebuild(db, city)
    assert second is not None
    assert second["observed_at"] >= first["observed_at"]


@pytest.mark.parametrize("bad", [None, "", float("nan"), float("inf"), 99.0, -99.0])
def test_canonical_temp_always_finite_and_in_range(tmp_path, bad):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 20.0, _iso(now - timedelta(minutes=10)), _iso(now))
    _rebuild(db, city="paris")
    _write(db, "paris", "metar", bad, _iso(now - timedelta(minutes=2)), _iso(now))
    canonical = _rebuild(db, city="paris")
    assert canonical is not None
    assert math.isfinite(float(canonical["value"]))
    assert float(canonical["value"]) == 20.0


def test_canonical_only_from_ok_rows(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(
        db, "paris", "metar", 20.0, _iso(now - timedelta(minutes=5)), _iso(now),
        status="error",
    )
    assert _rebuild(db, city="paris") is None


def test_raw_latest_valid_timestamp_never_regresses(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    first_obs = _iso(now - timedelta(minutes=5))
    _write(db, "paris", "metar", 30.0, _iso(now - timedelta(hours=12)), _iso(now))
    _write(db, "paris", "metar", 30.0, first_obs, _iso(now))
    _write(db, "paris", "metar", 29.0, _iso(now - timedelta(minutes=10)), _iso(now))
    latest = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest is not None
    assert latest["observed_at"] == first_obs
    assert float(latest["value"]) == 30.0


def test_duplicate_and_invalid_never_change_canonical(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    obs = _iso(now - timedelta(minutes=5))
    _write(db, "paris", "metar", 30.0, obs, _iso(now))
    before = _rebuild(db, city="paris")
    assert before is not None
    _write(db, "paris", "metar", 30.0, obs, _iso(now))  # duplicate
    _write(db, "paris", "metar", 99.0, _iso(now - timedelta(minutes=1)), _iso(now))  # invalid
    after = _rebuild(db, city="paris")
    assert after is not None
    assert after["value"] == before["value"]
    assert after["observed_at"] == before["observed_at"]


def test_fallback_status_always_has_reason(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "paris", "metar", 21.5, _iso(now - timedelta(minutes=3)), _iso(now))
    _rebuild(db, city="paris")
    snap = build_data_quality_snapshot(db)
    for row in snap["cities"]:
        if row["fallback_in_use"]:
            assert row["fallback_reason"]
            assert row["primary_source"]
            assert row["active_source"]


def test_source_error_always_has_last_error(tmp_path):
    from src.database.db_manager import DBManager
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "london", "metar", 22.0, _iso(now - timedelta(hours=2)), _iso(now - timedelta(hours=2)))
    _rebuild(db, city="london")
    repo = ObservationCollectorStatusRepository(RuntimeStateDB(str(tmp_path / "c.db")))
    ts = now.timestamp()
    repo.record_result(
        source="metar", city="london", interval_sec=60, due_ts=ts,
        started_ts=ts, completed_ts=ts + 0.1, ok=False, error="HTTP 500",
    )
    snap = build_data_quality_snapshot(db)
    for row in snap["cities"]:
        if row["status"] == "source_error":
            assert row["last_error"]


def test_fresh_rows_have_valid_observed_at(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "london", "metar", 20.0, _iso(now - timedelta(minutes=2)), _iso(now))
    _rebuild(db, city="london")
    snap = build_data_quality_snapshot(db)
    for row in snap["cities"]:
        if row["status"] == "fresh":
            assert row["latest_observation_at"]


def test_api_status_consistent_with_health(tmp_path):
    from src.database.db_manager import DBManager
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB

    db = DBManager(str(tmp_path / "c.db"))
    now = datetime.now(timezone.utc)
    _write(db, "london", "metar", 20.0, _iso(now - timedelta(minutes=2)), _iso(now))
    _rebuild(db, city="london")
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "london")
    # Fresh usable obs + no failures -> no contradiction.
    assert row["status"] in {"fresh", "fallback"}
    assert row["consecutive_failures"] == 0
    repo = ObservationCollectorStatusRepository(RuntimeStateDB(str(tmp_path / "c.db")))
    ts = now.timestamp()
    repo.record_result(
        source="metar", city="london", interval_sec=60, due_ts=ts,
        started_ts=ts, completed_ts=ts + 0.1, ok=False, error="timeout",
    )
    snap = build_data_quality_snapshot(db)
    row = next(r for r in snap["cities"] if r["city"] == "london")
    # Still usable -> status stays usable, error surfaced via flags.
    assert row["status"] in {"fresh", "fallback"}
    assert "recent_source_errors" in (row["quality_flags"] or [])


def test_regression_keeps_store_history_latest_and_canonical(tmp_path):
    """Phase-2 section 2 proof: valid 30C@12:00, then 29C@11:50 regression."""
    import sqlite3

    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "c.db"))
    base = datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc)
    _write(db, "paris", "metar", 30.0, _iso(base), _iso(base + timedelta(minutes=1)))
    _write(
        db, "paris", "metar", 29.0,
        _iso(base - timedelta(minutes=10)), _iso(base + timedelta(minutes=2)),
    )
    with sqlite3.connect(str(tmp_path / "c.db")) as conn:
        store_count = conn.execute(
            "SELECT COUNT(*) FROM raw_observation_store WHERE city='paris' AND source='metar'"
        ).fetchone()[0]
    assert store_count == 2
    latest = db.get_latest_raw_observation("metar", "paris", station_code="LFPB")
    assert latest is not None
    assert float(latest["value"]) == 30.0
    assert latest["observed_at"] == _iso(base)
    canonical = _rebuild(db, city="paris")
    assert canonical is not None
    assert float(canonical["value"]) == 30.0
    assert canonical["observed_at"] == _iso(base)
