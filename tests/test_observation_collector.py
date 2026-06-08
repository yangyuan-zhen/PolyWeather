from concurrent.futures import ThreadPoolExecutor
import sqlite3
import time


def test_observation_source_gate_shares_inflight_and_cooldown(monkeypatch):
    from src.data_collection.observation_source_gate import (
        reset_observation_source_gate_for_tests,
        run_observation_source,
    )

    monkeypatch.setenv("POLYWEATHER_OBSERVATION_SOURCE_DB_LOCK_ENABLED", "false")
    reset_observation_source_gate_for_tests()
    calls = 0

    def fetcher():
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return {"temp": 23.4}

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(run_observation_source, "amsc_awos", "qingdao", 180, fetcher),
            executor.submit(run_observation_source, "amsc_awos", "qingdao", 180, fetcher),
        ]
        results = [future.result(timeout=2) for future in futures]

    assert results == [{"temp": 23.4}, {"temp": 23.4}]
    assert calls == 1

    cached = run_observation_source("amsc_awos", "qingdao", 180, fetcher)

    assert cached == {"temp": 23.4}
    assert calls == 1


def test_observation_source_gate_respects_failure_cooldown(monkeypatch):
    from src.data_collection.observation_source_gate import (
        reset_observation_source_gate_for_tests,
        run_observation_source,
    )

    monkeypatch.setenv("POLYWEATHER_OBSERVATION_SOURCE_DB_LOCK_ENABLED", "false")
    reset_observation_source_gate_for_tests()
    calls = 0

    def fetcher():
        nonlocal calls
        calls += 1
        raise RuntimeError("upstream down")

    try:
        run_observation_source(
            "cowin_obs",
            "hong kong",
            60,
            fetcher,
            failure_cooldown_sec=60,
        )
    except RuntimeError:
        pass

    skipped = run_observation_source(
        "cowin_obs",
        "hong kong",
        60,
        fetcher,
        failure_cooldown_sec=60,
    )

    assert skipped is None
    assert calls == 1


def test_observation_collector_profiles_match_source_cadence():
    from web.observation_collector_service import build_observation_source_profiles
    from web.realtime_patch_schema import SOURCE_CADENCE_SECONDS

    profiles = {profile.source: profile for profile in build_observation_source_profiles()}

    assert profiles["amsc_awos"].interval_sec == 180
    assert profiles["amos"].interval_sec == 60
    assert profiles["madis_hfmetar"].interval_sec == 300
    assert profiles["cowin_obs"].interval_sec == 60
    assert profiles["hko_obs"].interval_sec == 600
    assert "qingdao" in profiles["amsc_awos"].cities
    assert {"seoul", "busan"}.issubset(set(profiles["amos"].cities))
    assert "new york" in profiles["madis_hfmetar"].cities
    assert "hong kong" in profiles["cowin_obs"].cities
    assert {"hong kong", "shenzhen"}.issubset(set(profiles["hko_obs"].cities))
    assert SOURCE_CADENCE_SECONDS["amsc_awos"] == 180


def test_observation_collector_run_due_once_refreshes_panel_cache():
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    calls = []
    refreshed = []

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            calls.append((city, use_fahrenheit))
            results["amos"] = {"source": "amsc_awos", "temp_c": 24.0}

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[
            ObservationSourceProfile(
                source="amsc_awos",
                cities=("qingdao",),
                interval_sec=180,
            )
        ],
        cache_refresher=lambda city: refreshed.append(city),
    )

    assert collector.run_due_once(now_ts=1000.0) == 1
    assert calls == [("qingdao", False)]
    assert refreshed == ["qingdao"]

    assert collector.run_due_once(now_ts=1100.0) == 0
    assert calls == [("qingdao", False)]

    assert collector.run_due_once(now_ts=1180.0) == 1
    assert calls == [("qingdao", False), ("qingdao", False)]
    assert refreshed == ["qingdao", "qingdao"]


def test_observation_collector_worker_entrypoint_exists():
    from web import observation_collector_worker

    assert callable(observation_collector_worker.main)


def test_ephemeral_observation_log_writes_skip_sqlite_lock(monkeypatch, tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    def locked_connection():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(db, "_get_connection", locked_connection)

    db.append_airport_obs(
        icao="ZSQD",
        city="qingdao",
        temp_c=24.0,
        obs_time="2026-06-08T04:00:00Z",
    )
    db.append_runway_obs(
        icao="ZSQD",
        city="qingdao",
        runway="17/35",
        target_runway_max=24.0,
        otime_utc="2026-06-08T04:00:00Z",
    )
