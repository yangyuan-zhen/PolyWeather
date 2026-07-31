"""DEB weight snapshot repository + generation tests."""

from __future__ import annotations

from src.analysis.deb_weight_snapshot import (
    build_city_weight_snapshot,
    load_deb_weight_snapshot,
    refresh_deb_weight_snapshots,
)
from src.database.runtime_state import (
    DailyRecordRepository,
    DebWeightSnapshotRepository,
    RuntimeStateDB,
)


def _make_history(n_days: int = 6) -> dict[str, dict[str, float]]:
    records: dict[str, dict[str, float]] = {}
    for i in range(n_days):
        actual = 20.0 + i
        records[f"2026-05-{20 + i:02d}"] = {
            "actual_high": actual,
            "forecasts": {"ecmwf": actual, "gfs": actual + 2.0},
        }
    return records


def test_deb_weight_snapshot_repository_roundtrip(tmp_path):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    repo = DebWeightSnapshotRepository(db)
    snapshot = {
        "weights": {"ecmwf": 0.9, "gfs": 0.1},
        "maes": {"ecmwf": 0.2, "gfs": 2.1},
        "biases": {"ecmwf": 0.0, "gfs": 2.0},
        "forecast_models": ["ecmwf", "gfs"],
        "samples": 6,
        "days_used": 6,
        "lookback_days": 7,
        "decay_factor": 0.85,
        "bias_penalty": 0.5,
        "divergence_threshold": 3.0,
        "weights_info": "ecmwf(90%",
    }

    repo.upsert_snapshot("ankara", snapshot)
    loaded = repo.load_snapshot("ankara")

    assert loaded is not None
    assert loaded["weights"] == snapshot["weights"]
    assert loaded["maes"] == snapshot["maes"]
    assert loaded["biases"] == snapshot["biases"]
    assert loaded["forecast_models"] == ["ecmwf", "gfs"]
    assert loaded["samples"] == 6
    assert loaded["lookback_days"] == 7
    assert loaded["decay_factor"] == 0.85
    assert loaded["computed_at"] > 0

    # Upsert overwrites
    repo.upsert_snapshot("ankara", {**snapshot, "decay_factor": 0.95})
    assert repo.load_snapshot("ankara")["decay_factor"] == 0.95

    all_snapshots = repo.load_all()
    assert set(all_snapshots) == {"ankara"}


def test_build_city_weight_snapshot_uses_latest_forecasts():
    history = _make_history()
    snapshot = build_city_weight_snapshot("ankara", history)

    assert snapshot is not None
    assert snapshot["samples"] >= 5
    assert snapshot["days_used"] >= 5
    assert snapshot["weights"]["ecmwf"] > snapshot["weights"]["gfs"]
    assert snapshot["forecast_models"] == ["ecmwf", "gfs"]
    assert snapshot["lookback_days"] == 7
    assert snapshot["decay_factor"] == 0.85
    assert snapshot["bias_penalty"] == 0.5
    assert snapshot["divergence_threshold"] == 3.0
    assert "ecmwf" in (snapshot["weights_info"] or "")


def test_build_city_weight_snapshot_honours_custom_hyperparams():
    history = _make_history()
    snapshot = build_city_weight_snapshot(
        "ankara",
        history,
        hyperparams={"lookback_days": 14, "decay_factor": 0.95, "bias_penalty": 0.0},
    )

    assert snapshot["lookback_days"] == 14
    assert snapshot["decay_factor"] == 0.95
    assert snapshot["bias_penalty"] == 0.0


def test_build_city_weight_snapshot_returns_none_without_forecasts():
    history = {
        "2026-05-20": {"actual_high": 20.0},
        "2026-05-21": {"actual_high": 21.0},
    }
    assert build_city_weight_snapshot("ankara", history) is None


def test_refresh_deb_weight_snapshots_persists_all_cities(tmp_path):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    daily_repo = DailyRecordRepository(db)
    for city in ("ankara", "seoul"):
        for date_str, record in _make_history().items():
            daily_repo.upsert_record(city, date_str, record)

    result = refresh_deb_weight_snapshots(db=db)

    assert result["updated_cities"] == 2
    assert result["total_cities"] == 2
    all_snapshots = DebWeightSnapshotRepository(db).load_all()
    assert set(all_snapshots) == {"ankara", "seoul"}
    assert all_snapshots["ankara"]["samples"] >= 5


def test_refresh_deb_weight_snapshots_filters_cities(tmp_path):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    daily_repo = DailyRecordRepository(db)
    for city in ("ankara", "seoul"):
        for date_str, record in _make_history().items():
            daily_repo.upsert_record(city, date_str, record)

    result = refresh_deb_weight_snapshots(db=db, cities=["ankara"])

    assert result["updated_cities"] == 1
    assert set(DebWeightSnapshotRepository(db).load_all()) == {"ankara"}


def test_load_deb_weight_snapshot_respects_env_flag(tmp_path, monkeypatch):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    repo = DebWeightSnapshotRepository(db)
    repo.upsert_snapshot(
        "ankara",
        {
            "weights": {"ecmwf": 1.0},
            "maes": {},
            "biases": {},
            "forecast_models": ["ecmwf"],
            "samples": 3,
            "days_used": 3,
            "lookback_days": 7,
            "decay_factor": 0.85,
            "bias_penalty": 0.5,
            "divergence_threshold": 3.0,
            "weights_info": None,
        },
    )

    # Flag off → nothing read
    monkeypatch.delenv("POLYWEATHER_USE_DEB_WEIGHT_SNAPSHOT", raising=False)
    assert load_deb_weight_snapshot("ankara", db=db) is None

    # Flag on → snapshot returned
    monkeypatch.setenv("POLYWEATHER_USE_DEB_WEIGHT_SNAPSHOT", "true")
    loaded = load_deb_weight_snapshot("ankara", db=db)
    assert loaded is not None
    assert loaded["weights"]["ecmwf"] == 1.0

    # Flag on but city missing → None
    assert load_deb_weight_snapshot("seoul", db=db) is None
