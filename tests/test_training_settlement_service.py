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
            "legacy": {"settlement_source": "wunderground"},
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
            "taipei": {"icao": "RCSS", "settlement_source": "cwa"},
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
