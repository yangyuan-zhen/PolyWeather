from src.database.runtime_state import (
    DailyRecordRepository,
    RuntimeStateDB,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
)


def _wire_runtime_repos(monkeypatch, tmp_path):
    from src.analysis import deb_algorithm

    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    daily_repo = DailyRecordRepository(db)
    truth_repo = TruthRecordRepository(db)
    feature_repo = TrainingFeatureRecordRepository(db)
    monkeypatch.setattr(deb_algorithm, "_daily_record_repo", daily_repo)
    monkeypatch.setattr(deb_algorithm, "_truth_record_repo", truth_repo)
    monkeypatch.setattr(deb_algorithm, "_training_feature_repo", feature_repo)
    monkeypatch.setattr(deb_algorithm, "_history_cache", {})
    monkeypatch.setattr(deb_algorithm, "_history_mtime", 0)
    monkeypatch.setenv("POLYWEATHER_STATE_STORAGE_MODE", "sqlite")
    return db


def test_intraday_daily_record_does_not_persist_unfinal_actual_as_truth(monkeypatch, tmp_path):
    from src.analysis.deb_algorithm import update_daily_record

    db = _wire_runtime_repos(monkeypatch, tmp_path)

    update_daily_record(
        "ankara",
        "2026-06-24",
        {"ECMWF": 28.0, "GFS": 27.0},
        24.0,
        deb_prediction=27.5,
        mu=27.2,
        actual_is_final=False,
    )

    with db.connect() as conn:
        daily = conn.execute(
            """
            SELECT actual_high, deb_prediction, mu, payload_json
            FROM daily_records_store
            WHERE city = ? AND target_date = ?
            """,
            ("ankara", "2026-06-24"),
        ).fetchone()
        truth_count = conn.execute(
            """
            SELECT count(*) AS n
            FROM truth_records_store
            WHERE city = ? AND target_date = ?
            """,
            ("ankara", "2026-06-24"),
        ).fetchone()["n"]

    assert daily is not None
    assert daily["actual_high"] is None
    assert daily["deb_prediction"] == 27.5
    assert daily["mu"] == 27.2
    assert truth_count == 0


def test_dynamic_weights_skip_actual_only_rows_when_selecting_recent_training_days(monkeypatch):
    from src.analysis.deb_algorithm import calculate_dynamic_weight_components

    history = {"ankara": {}}
    for day in range(23, 15, -1):
        history["ankara"][f"2026-06-{day:02d}"] = {"actual_high": 20.0}
    history["ankara"]["2026-06-15"] = {
        "actual_high": 20.0,
        "forecasts": {"ECMWF": 20.0, "GFS": 30.0},
    }
    history["ankara"]["2026-06-14"] = {
        "actual_high": 20.0,
        "forecasts": {"ECMWF": 20.0, "GFS": 30.0},
    }
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", lambda _path: history)

    components = calculate_dynamic_weight_components(
        "ankara",
        {"ECMWF": 20.0, "GFS": 30.0},
        lookback_days=7,
    )

    assert components["weights"]["ECMWF"] > components["weights"]["GFS"]
    assert components["prediction"] < 25.0
