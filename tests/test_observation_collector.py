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


def test_observation_collector_records_source_status_to_runtime_state(tmp_path):
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            results["amsc_awos"] = {"source": "amsc_awos", "temp_c": 22.8}

    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    status_repo = ObservationCollectorStatusRepository(db)
    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("beijing",), 180)],
        status_recorder=status_repo,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1

    payload = status_repo.load_snapshot(now_ts=1001.0)
    assert payload["total_entries"] == 1
    assert payload["status_counts"] == {"ok": 1}

    entry = payload["entries"][0]
    assert entry["source"] == "amsc_awos"
    assert entry["city"] == "beijing"
    assert entry["interval_sec"] == 180
    assert entry["failure_count"] == 0
    assert entry["last_error"] is None
    assert entry["last_success_at"] is not None
    assert entry["last_failure_at"] is None
    assert entry["last_latency_ms"] is not None
    assert entry["next_due_ts"] == 1180.0
    assert entry["in_cooldown"] is False
    assert entry["status"] == "ok"

    source = payload["sources"][0]
    assert source["source"] == "amsc_awos"
    assert source["city_count"] == 1
    assert source["failure_count"] == 0
    assert source["avg_latency_ms"] is not None
    assert source["status_counts"] == {"ok": 1}


def test_observation_collector_records_failure_and_cooldown(tmp_path):
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            raise RuntimeError("upstream timeout")

    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    status_repo = ObservationCollectorStatusRepository(db)
    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("seoul",), 180)],
        status_recorder=status_repo,
    )

    assert collector.run_due_once(now_ts=2000.0) == 0

    payload = status_repo.load_snapshot(now_ts=2010.0)
    assert payload["total_entries"] == 1
    assert payload["status_counts"] == {"cooldown": 1}

    entry = payload["entries"][0]
    assert entry["source"] == "amsc_awos"
    assert entry["city"] == "seoul"
    assert entry["failure_count"] == 1
    assert entry["last_success_at"] is None
    assert entry["last_failure_at"] is not None
    assert entry["last_error"] == "upstream timeout"
    assert entry["next_due_ts"] == 2180.0
    assert entry["in_cooldown"] is True
    assert entry["status"] == "cooldown"

    source = payload["sources"][0]
    assert source["failure_count"] == 1
    assert source["cooldown_count"] == 1


def test_ops_observation_collector_status_returns_runtime_snapshot(monkeypatch, tmp_path):
    from src.database.runtime_state import ObservationCollectorStatusRepository, RuntimeStateDB
    from web.services import ops_api

    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    status_repo = ObservationCollectorStatusRepository(db)
    now = time.time()
    status_repo.record_result(
        source="cowin_obs",
        city="hong kong",
        interval_sec=60,
        due_ts=now,
        started_ts=now,
        completed_ts=now + 0.25,
        ok=True,
    )

    monkeypatch.setattr(
        ops_api.legacy_routes,
        "_require_ops_admin",
        lambda request: {"email": "ops@example.com"},
    )
    monkeypatch.setattr(ops_api, "ObservationCollectorStatusRepository", lambda: status_repo)

    payload = ops_api.get_ops_observation_collector_status(object(), limit=10)

    assert payload["total_entries"] == 1
    assert payload["entries"][0]["source"] == "cowin_obs"
    assert payload["entries"][0]["city"] == "hong kong"
    assert payload["sources"][0]["source"] == "cowin_obs"
    assert payload["status_counts"] == {"ok": 1}


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
