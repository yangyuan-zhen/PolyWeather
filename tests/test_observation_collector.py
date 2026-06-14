from concurrent.futures import ThreadPoolExecutor, TimeoutError
import sqlite3
import threading
import time
from types import SimpleNamespace


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


def test_observation_collector_run_due_once_collects_without_panel_cache_refresh():
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    calls = []

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
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1
    assert calls == [("qingdao", False)]

    assert collector.run_due_once(now_ts=1100.0) == 0
    assert calls == [("qingdao", False)]

    assert collector.run_due_once(now_ts=1180.0) == 1
    assert calls == [("qingdao", False), ("qingdao", False)]


def test_raw_observation_store_records_latest_observation(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    db.append_raw_observation(
        source="amsc_awos",
        city="Qingdao",
        value=24.0,
        observed_at="2026-06-14T01:00:00+00:00",
        fetched_at="2026-06-14T01:01:00+00:00",
        station_code="ZSQD",
        station_name="Qingdao Jiaodong",
        status="ok",
        payload={"temp_c": 24.0},
    )

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao")

    assert latest is not None
    assert latest["source"] == "amsc_awos"
    assert latest["city"] == "qingdao"
    assert latest["value"] == 24.0
    assert latest["observed_at"] == "2026-06-14T01:00:00+00:00"
    assert latest["fetched_at"] == "2026-06-14T01:01:00+00:00"
    assert latest["station_code"] == "ZSQD"
    assert latest["status"] == "ok"
    assert latest["payload"]["temp_c"] == 24.0


def test_observation_collector_aligns_amsc_payload_time_with_record_observed_at(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import ObservationCollector
    from web.services.observation_source_adapters import ObservationRecord

    db = DBManager(str(tmp_path / "polyweather.db"))
    collector = ObservationCollector(
        weather=object(),
        profiles=[],
        observation_store=db,
    )

    record = ObservationRecord(
        source="amsc_awos",
        city="shanghai",
        value=25.4,
        observed_at="2026-06-14T15:43:00+00:00",
        observed_at_local="2026-06-14 23:43:00",
        station_code="ZSPD",
        station_name="Shanghai Pudong",
        runway="",
        value_unit="c",
        source_label="AMSC AWOS Shanghai Pudong (ZSPD)",
        payload={
            "source": "amsc_awos",
            "temp_c": 25.4,
            "observation_time": "2026-06-14T10:44:00+00:00",
            "observation_time_local": "2026-06-14 18:44:00",
        },
    )

    assert collector._store_raw_observations([record]) == 1

    latest = db.get_latest_raw_observation("amsc_awos", "shanghai")

    assert latest is not None
    assert latest["observed_at"] == "2026-06-14T15:43:00+00:00"
    assert latest["payload"]["observation_time"] == "2026-06-14T15:43:00+00:00"
    assert latest["payload"]["observation_time_local"] == "2026-06-14 23:43:00"


def test_raw_observation_failure_preserves_last_success_and_increments_errors(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    db.append_raw_observation(
        source="amsc_awos",
        city="Qingdao",
        value=24.0,
        observed_at="2026-06-14T01:00:00+00:00",
        fetched_at="2026-06-14T01:01:00+00:00",
        station_code="ZSQD",
        station_name="Qingdao Jiaodong",
        status="ok",
        payload={"temp_c": 24.0},
    )
    db.append_raw_observation(
        source="amsc_awos",
        city="qingdao",
        fetched_at="2026-06-14T01:02:00+00:00",
        status="timeout",
        payload={"error": "upstream timeout"},
    )

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao")

    assert latest is not None
    assert latest["status"] == "timeout"
    assert latest["value"] is None
    assert latest["error_count"] == 1
    assert latest["last_success_at"] == "2026-06-14T01:01:00+00:00"
    assert latest["payload"]["error"] == "upstream timeout"


def test_raw_observation_store_computes_source_latency_when_times_are_known(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    db.append_raw_observation(
        source="amsc_awos",
        city="Qingdao",
        value=24.0,
        observed_at="2026-06-14T01:00:00+00:00",
        fetched_at="2026-06-14T01:01:30+00:00",
        station_code="ZSQD",
        status="ok",
        payload={"temp_c": 24.0},
    )

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao")

    assert latest is not None
    assert latest["source_latency_sec"] == 90.0


def test_raw_observation_store_lists_latest_observations_for_city(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    db.append_raw_observation(
        source="hko_obs",
        city="Shenzhen",
        value=28.1,
        observed_at="2026-06-14T01:00:00+00:00",
        fetched_at="2026-06-14T01:05:00+00:00",
        station_code="LFS",
        station_name="Lau Fau Shan",
        status="ok",
        payload={"source_label": "HKO"},
    )
    db.append_raw_observation(
        source="hko_obs",
        city="shenzhen",
        value=27.6,
        observed_at="2026-06-14T01:00:00+00:00",
        fetched_at="2026-06-14T01:05:30+00:00",
        station_code="HKO",
        station_name="Hong Kong Observatory",
        status="ok",
        payload={"source_label": "HKO"},
    )

    rows = db.list_latest_raw_observations_for_city("shenzhen")

    assert [row["station_code"] for row in rows] == ["HKO", "LFS"]
    assert [row["value"] for row in rows] == [27.6, 28.1]


def test_observation_refresh_request_queue_claims_pending_requests(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    assert db.enqueue_observation_refresh_request(
        city="Shanghai",
        kind="panel",
        priority="high",
        reason="cold_canonical_fallback",
    )

    claimed = db.claim_observation_refresh_requests(limit=5, owner="collector-1", now_ts=1000.0)

    assert len(claimed) == 1
    request = claimed[0]
    assert request["city"] == "shanghai"
    assert request["kind"] == "panel"
    assert request["priority"] == "high"
    assert request["reason"] == "cold_canonical_fallback"

    db.mark_observation_refresh_request_done(request["id"], status="done")

    assert db.claim_observation_refresh_requests(limit=5, owner="collector-1", now_ts=1001.0) == []


def test_observation_refresh_request_queue_coalesces_city_source_across_kinds(tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather.db"))

    assert db.enqueue_observation_refresh_request(
        city="Shanghai",
        kind="panel",
        priority="high",
        reason="panel_cold_start",
    )
    assert db.enqueue_observation_refresh_request(
        city="shanghai",
        kind="full",
        priority="normal",
        reason="chart_cold_start",
    )

    claimed = db.claim_observation_refresh_requests(limit=5, owner="collector-1", now_ts=1000.0)

    assert len(claimed) == 1
    request = claimed[0]
    assert request["city"] == "shanghai"
    assert request["kind"] == "full"
    assert request["priority"] == "high"
    assert request["reason"] == "chart_cold_start"


def test_observation_collector_writes_raw_observation_store(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            results["amos"] = {
                "source": "amsc_awos",
                "temp_c": 24.0,
                "observation_time": "2026-06-14T01:00:00+00:00",
                "icao": "ZSQD",
                "station_label": "Qingdao Jiaodong",
            }

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("qingdao",), 180)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao")
    assert latest is not None
    assert latest["value"] == 24.0
    assert latest["observed_at"] == "2026-06-14T01:00:00+00:00"
    assert latest["station_code"] == "ZSQD"


def test_observation_collector_consumes_source_adapter_records(monkeypatch, tmp_path):
    from src.database.db_manager import DBManager
    import web.observation_collector_service as collector_service
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )
    from web.services.observation_source_adapters import (
        ObservationRecord,
        ObservationSourceResult,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))
    calls = []

    def fake_collect_observation_source(weather, source, city, *, use_fahrenheit):
        calls.append((weather.marker, source, city, use_fahrenheit))
        return ObservationSourceResult(
            source="amsc_awos",
            city="qingdao",
            status="ok",
            error="",
            records=(
                ObservationRecord(
                    source="amsc_awos",
                    city="qingdao",
                    value=24.5,
                    observed_at="2026-06-14T01:00:00+00:00",
                    observed_at_local="2026-06-14 09:00",
                    station_code="ZSQD",
                    station_name="Qingdao Jiaodong",
                    runway="17L",
                    value_unit="c",
                    source_label="AMSC AWOS",
                    payload={"temp_c": 24.5},
                ),
            ),
        )

    monkeypatch.setattr(
        collector_service,
        "collect_observation_source",
        fake_collect_observation_source,
    )

    class FakeWeather:
        marker = "weather"

        def _uses_fahrenheit(self, city):
            return False

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("qingdao",), 180)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1
    assert calls == [("weather", "amsc_awos", "qingdao", False)]

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao", station_code="ZSQD", runway="17L")
    assert latest is not None
    assert latest["value"] == 24.5
    assert latest["payload"]["temp_c"] == 24.5


def test_observation_collector_recomputes_canonical_from_raw_latest_settlement_station(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_hko_obs_official_nearby(self, results, city, use_fahrenheit):
            results["hko_obs_nearby"] = [
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 28.1,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "LFS",
                    "station_name": "Lau Fau Shan",
                },
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 27.6,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "HKO",
                    "station_name": "Hong Kong Observatory",
                },
            ]

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("hko_obs", ("shenzhen",), 600)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1

    canonical = db.get_canonical_temperature("shenzhen")
    assert canonical is not None
    assert canonical["payload"]["station_code"] == "LFS"
    assert canonical["payload"]["station_name"] == "Lau Fau Shan"
    assert canonical["payload"]["value"] == 28.1


def test_observation_collector_appends_realtime_event_after_canonical_refresh(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))
    appended = []
    broadcasted = []

    class FakeEventStore:
        uses_external_live_fanout = False

        def append_event(self, event):
            appended.append(event)
            return {**event, "revision": 7}

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_hko_obs_official_nearby(self, results, city, use_fahrenheit):
            results["hko_obs_nearby"] = [
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 28.1,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "LFS",
                    "station_name": "Lau Fau Shan",
                },
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 27.6,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "HKO",
                    "station_name": "Hong Kong Observatory",
                },
            ]

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("hko_obs", ("shenzhen",), 600)],
        observation_store=db,
        realtime_event_store=FakeEventStore(),
        realtime_broadcaster=lambda event: broadcasted.append(event),
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1

    assert len(appended) == 1
    event = appended[0]
    assert event["type"] == "city_observation_patch.v1"
    assert event["city"] == "shenzhen"
    assert event["source"] == "hko_obs"
    assert event["payload"]["temp"] == 28.1
    assert event["payload"]["station_code"] == "LFS"
    assert broadcasted == [{**event, "revision": 7}]


def test_observation_collector_records_no_results_source_health(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            return None

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("qingdao",), 180)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 0

    latest = db.get_latest_raw_observation("amsc_awos", "qingdao")
    assert latest is not None
    assert latest["status"] == "no_results"
    assert latest["value"] is None
    assert latest["error_count"] == 1
    assert latest["last_success_at"] == ""
    assert latest["payload"]["status"] == "no_results"


def test_observation_collector_writes_canonical_latest_from_source(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            results["amos"] = {
                "source": "amsc_awos",
                "source_label": "AMSC AWOS",
                "temp_c": 24.0,
                "observation_time": "2026-06-14T01:00:00+00:00",
                "icao": "ZSQD",
                "station_label": "Qingdao Jiaodong",
            }

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("qingdao",), 180)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=1000.0) == 1

    canonical = db.get_canonical_temperature("qingdao")
    assert canonical is not None
    assert canonical["payload"]["value"] == 24.0
    assert canonical["payload"]["source"] == "amsc_awos"
    assert canonical["payload"]["source_role"] == "settlement_proxy"
    assert canonical["payload"]["observed_at"] == "2026-06-14T01:00:00+00:00"


def test_observation_collector_canonical_uses_source_freshness_profile(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import ObservationCollector
    from web.services.observation_source_adapters import ObservationRecord

    db = DBManager(str(tmp_path / "polyweather.db"))
    collector = ObservationCollector(
        weather=object(),
        profiles=[],
        observation_store=db,
        async_cache_refresh=False,
    )

    collector._store_canonical_temperature_from_observation(
        record=ObservationRecord(
            source="amsc_awos",
            city="qingdao",
            value=24.0,
            observed_at="2026-06-14T01:00:00+00:00",
            observed_at_local="",
            station_code="ZSQD",
            station_name="",
            runway="",
            value_unit="c",
            source_label="AMSC AWOS",
            payload={"temp_c": 24.0},
        ),
        fetched_at="2026-06-14T01:05:00+00:00",
    )

    canonical = db.get_canonical_temperature("qingdao")

    assert canonical is not None
    assert canonical["payload"]["freshness_status"] == "expected_wait"
    assert canonical["payload"]["freshness_sec"] == 300
    assert canonical["payload"]["confidence"] < 0.92


def test_observation_collector_consumes_refresh_request_queue(tmp_path):
    from src.database.db_manager import DBManager
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    db = DBManager(str(tmp_path / "polyweather.db"))
    db.enqueue_observation_refresh_request(
        city="qingdao",
        kind="panel",
        priority="high",
        reason="canonical_fallback",
    )
    calls = []

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            calls.append(city)
            results["amos"] = {
                "source": "amsc_awos",
                "temp_c": 24.0,
                "observation_time": "2026-06-14T01:00:00+00:00",
                "icao": "ZSQD",
            }

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[ObservationSourceProfile("amsc_awos", ("qingdao",), 180)],
        observation_store=db,
        async_cache_refresh=False,
    )

    assert collector.run_due_once(now_ts=100.0) == 1
    assert calls == ["qingdao"]
    assert db.claim_observation_refresh_requests(limit=5, owner="test", now_ts=101.0) == []


def test_observation_collector_cache_refresh_does_not_block_source_polling():
    from web.observation_collector_service import (
        ObservationCollector,
        ObservationSourceProfile,
    )

    calls = []
    refresh_started = threading.Event()
    release_refresh = threading.Event()
    refreshed = []

    class FakeWeather:
        def _uses_fahrenheit(self, city):
            return False

        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            calls.append(city)
            results["amsc_awos"] = {"source": "amsc_awos", "temp_c": 24.0}

    def slow_cache_refresher(city):
        refresh_started.set()
        release_refresh.wait(timeout=2)
        refreshed.append(city)

    collector = ObservationCollector(
        weather=FakeWeather(),
        profiles=[
            ObservationSourceProfile(
                source="amsc_awos",
                cities=("qingdao", "beijing"),
                interval_sec=180,
            )
        ],
        cache_refresher=slow_cache_refresher,
    )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(collector.run_due_once, now_ts=1000.0)
        assert refresh_started.wait(timeout=1)
        try:
            try:
                result = future.result(timeout=0.1)
            except TimeoutError:
                result = None
        finally:
            release_refresh.set()

    assert result == 2
    assert calls == ["qingdao", "beijing"]
    deadline = time.time() + 2
    while set(refreshed) != {"qingdao", "beijing"} and time.time() < deadline:
        time.sleep(0.01)
    assert set(refreshed) == {"qingdao", "beijing"}
    collector.close()


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


def test_observation_collector_worker_does_not_bind_panel_cache_refresher(monkeypatch):
    from web import observation_collector_worker

    captured = {}

    def fake_start_observation_collector_loop(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(name="observation-collector")

    class StopEvent:
        @staticmethod
        def wait(_timeout):
            return True

        @staticmethod
        def set():
            return None

    monkeypatch.setattr(observation_collector_worker.signal, "signal", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        observation_collector_worker,
        "start_observation_collector_loop",
        fake_start_observation_collector_loop,
    )
    monkeypatch.setattr(observation_collector_worker, "_STOP_EVENT", StopEvent())

    observation_collector_worker.main()

    assert captured["weather"] is observation_collector_worker._weather
    assert captured.get("cache_refresher") is None


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


def test_airport_obs_batch_writes_share_one_sqlite_transaction(monkeypatch, tmp_path):
    from src.database.db_manager import DBManager

    db = DBManager(str(tmp_path / "polyweather-airport-obs-batch.db"))
    original_get_connection = db._get_connection
    connection_calls = {"count": 0}

    def counting_connection():
        connection_calls["count"] += 1
        return original_get_connection()

    monkeypatch.setattr(db, "_get_connection", counting_connection)

    db.append_airport_obs_batch(
        [
            {
                "icao": "ZBAA",
                "city": "beijing",
                "temp_c": 24.0,
                "obs_time": "2026-06-08T04:00:00Z",
            },
            {
                "icao": "ZBAD",
                "city": "beijing",
                "temp_c": 25.0,
                "obs_time": "2026-06-08T04:00:00Z",
            },
        ]
    )

    assert connection_calls["count"] == 1
    assert [row["temp_c"] for row in db.get_airport_obs_recent("ZBAA", minutes=180)] == [24.0]
    assert [row["temp_c"] for row in db.get_airport_obs_recent("ZBAD", minutes=180)] == [25.0]
