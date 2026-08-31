import web.training_settlement_service as training_settlement_service
from web.training_settlement_service import run_training_settlement_cycle


def test_training_settlement_cycle_runs_analysis_and_reconciles_supported_cities():
    calls = {"analysis": [], "reconcile": []}

    def analysis_runner(city):
        calls["analysis"].append(city)
        return {"city": city, "deb": {"prediction": 31.2}}

    def actual_reconciler(city, *, lookback_days):
        calls["reconcile"].append((city, lookback_days))
        return {"ok": True, "updated": 1}

    result = run_training_settlement_cycle(
        city_registry={
            "shanghai": {"icao": "ZSSS", "settlement_source": "metar"},
            "legacy": {"settlement_source": "noaa"},
        },
        analysis_runner=analysis_runner,
        actual_reconciler=actual_reconciler,
        lookback_days=9,
    )

    assert result["ok"] is True
    assert result["processed"] == 1
    assert result["failed"] == 0
    assert result["unsupported"] == 1
    assert calls["analysis"] == ["shanghai"]
    assert calls["reconcile"] == [("shanghai", 9)]


def test_training_settlement_cycle_preserves_analysis_archive_status():
    result = run_training_settlement_cycle(
        city_registry={"shanghai": {"icao": "ZSSS", "settlement_source": "metar"}},
        analysis_runner=lambda city: {
            "city": city,
            "training_snapshot_archive": {"intraday": True, "probability": False},
        },
        actual_reconciler=lambda city, *, lookback_days: {"ok": True, "updated": 0},
    )

    assert result["items"][0]["analysis_archive"] == {
        "intraday": True,
        "probability": False,
    }


def test_training_settlement_cycle_continues_after_city_failure():
    calls = []

    def analysis_runner(city):
        calls.append(city)
        if city == "shanghai":
            raise RuntimeError("analysis unavailable")
        return {"city": city}

    result = run_training_settlement_cycle(
        city_registry={
            "shanghai": {"icao": "ZSSS", "settlement_source": "metar"},
            "tokyo": {"icao": "RJTT", "settlement_source": "metar"},
        },
        analysis_runner=analysis_runner,
        actual_reconciler=lambda city, *, lookback_days: {"ok": True, "updated": 0},
        lookback_days=3,
    )

    assert result["ok"] is False
    assert result["processed"] == 1
    assert result["failed"] == 1
    assert calls == ["shanghai", "tokyo"]
    assert result["items"][0]["ok"] is False
    assert result["items"][1]["ok"] is True


def test_training_settlement_cycle_skips_reconcile_for_non_reconcile_sources():
    calls = {"analysis": [], "reconcile": []}

    result = run_training_settlement_cycle(
        city_registry={
            "taipei": {"icao": "RCSS", "settlement_source": "madis_hfmetar"},
        },
        analysis_runner=lambda city: calls["analysis"].append(city) or {"city": city},
        actual_reconciler=lambda city, *, lookback_days: calls["reconcile"].append(city)
        or {"ok": True},
        lookback_days=3,
    )

    assert result["ok"] is True
    assert result["processed"] == 1
    assert calls["analysis"] == ["taipei"]
    assert calls["reconcile"] == []
    assert result["items"][0]["reconcile"]["reason"] == "unsupported_reconcile_source"


def test_default_actual_reconciler_bootstraps_missing_history(monkeypatch):
    calls = []

    def bootstrapper(city, *, lookback_days):
        calls.append((city, lookback_days))
        return {"ok": True, "seeded": 8, "updated": 8}

    monkeypatch.setattr(
        training_settlement_service,
        "bootstrap_recent_daily_history_if_missing",
        bootstrapper,
    )

    result = training_settlement_service._default_actual_reconciler(
        "shanghai",
        lookback_days=10,
    )

    assert result == {"ok": True, "seeded": 8, "updated": 8}
    assert calls == [("shanghai", 10)]


def test_default_analysis_runner_archives_training_snapshots(monkeypatch):
    calls = []

    def analyzer(city, **kwargs):
        calls.append((city, kwargs))
        return {"city": city}

    monkeypatch.setattr(
        training_settlement_service,
        "_default_analysis_runner",
        training_settlement_service._default_analysis_runner,
        raising=False,
    )
    monkeypatch.setattr(
        "web.analysis_service._analyze",
        analyzer,
    )

    result = training_settlement_service._default_analysis_runner("shanghai")

    assert result == {"city": "shanghai"}
    assert calls == [
        (
            "shanghai",
            {"force_refresh": False, "detail_mode": "panel", "archive_training_snapshots": True},
        )
    ]


def test_rotating_analysis_slice_rotates_by_cycle_index():
    cities = tuple(f"city{i}" for i in range(10))
    interval = 21_600

    slice0, idx0 = training_settlement_service._rotating_analysis_slice(
        cities, batch_size=4, interval_sec=interval, now_ts=0.0
    )
    slice1, idx1 = training_settlement_service._rotating_analysis_slice(
        cities, batch_size=4, interval_sec=interval, now_ts=float(interval)
    )
    slice2, _ = training_settlement_service._rotating_analysis_slice(
        cities, batch_size=4, interval_sec=interval, now_ts=float(2 * interval)
    )
    slice3, _ = training_settlement_service._rotating_analysis_slice(
        cities, batch_size=4, interval_sec=interval, now_ts=float(3 * interval)
    )

    assert slice0 == ("city0", "city1", "city2", "city3")
    assert slice1 == ("city4", "city5", "city6", "city7")
    assert slice2 == ("city8", "city9")
    # 3 windows of 4 cover 10 cities; cycle 3 wraps to window 0.
    assert slice3 == slice0
    assert (idx1 - idx0) == 1


def test_rotating_analysis_slice_disabled_when_batch_size_covers_all():
    cities = ("a", "b", "c")
    for batch in (0, -1, 3, 5):
        result, idx = training_settlement_service._rotating_analysis_slice(
            cities, batch_size=batch, interval_sec=21600, now_ts=123456789.0
        )
        assert result == cities
        assert idx == -1


def test_training_settlement_cycle_analyzes_only_rotated_batch():
    registry = {
        f"city{i}": {"icao": f"K{i:03d}", "settlement_source": "metar"}
        for i in range(6)
    }
    analyzed = []

    def analysis_runner(city):
        analyzed.append(city)
        return {"city": city}

    reconciled = []

    def actual_reconciler(city, *, lookback_days):
        reconciled.append(city)
        return {"ok": True, "updated": 1}

    result = run_training_settlement_cycle(
        city_registry=registry,
        analysis_runner=analysis_runner,
        actual_reconciler=actual_reconciler,
        lookback_days=5,
        analysis_batch_size=2,
        analysis_interval_sec=21600,
        now_ts=0.0,
    )

    assert analyzed == ["city0", "city1"]
    assert sorted(reconciled) == sorted(registry)
    assert result["analysis_batch_size"] == 2
    assert result["analyzed_cities"] == ["city0", "city1"]
    statuses = {item["city"]: item["analysis_status"] for item in result["items"]}
    assert statuses["city0"] != "rotated_out"
    assert all(
        statuses[c] == "rotated_out" for c in ("city2", "city3", "city4", "city5")
    )


def test_training_settlement_cycle_skip_analysis_still_reconciles_all():
    registry = {
        "shanghai": {"icao": "ZSSS", "settlement_source": "metar"},
        "hong kong": {"settlement_station_code": "HKO", "settlement_source": "hko"},
    }
    calls = {"analysis": [], "reconcile": []}

    result = run_training_settlement_cycle(
        city_registry=registry,
        analysis_runner=lambda city: calls["analysis"].append(city) or {"city": city},
        actual_reconciler=lambda city, *, lookback_days: calls["reconcile"].append(city)
        or {"ok": True},
        skip_analysis=True,
        analysis_batch_size=2,
    )

    assert calls["analysis"] == []
    assert sorted(calls["reconcile"]) == ["hong kong", "shanghai"]
    assert result["analyzed_cities"] == []
    assert result["items"][0]["analysis_status"] == "skipped"
