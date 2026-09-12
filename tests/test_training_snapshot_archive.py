import web.analysis_service as analysis_service


def test_intraday_snapshot_archive_reports_success(monkeypatch):
    calls = []

    class Repository:
        def append_snapshot(self, payload):
            calls.append(payload)

    monkeypatch.setattr(analysis_service, "IntradayPathSnapshotRepository", Repository)

    result = analysis_service._archive_intraday_path_snapshot(
        "shanghai",
        {
            "hourly": {"times": ["2026-08-31T01:00:00"], "temps": [30.0]},
            "forecast": {"today_high": 32.0},
            "deb": {"prediction": 31.0},
            "current": {},
            "local_date": "2026-08-31",
            "local_time": "09:00",
            "utc_offset_seconds": 28800,
        },
    )

    assert result is True
    assert calls[0]["city"] == "shanghai"


def test_probability_snapshot_archive_reports_failure(monkeypatch):
    class Repository:
        def append_snapshot(self, payload):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(analysis_service, "_time", analysis_service._time)
    monkeypatch.setattr(
        "src.database.runtime_state.ProbabilitySnapshotRepository", Repository
    )

    result = analysis_service._archive_probability_snapshot(
        "shanghai",
        {"local_date": "2026-08-31", "probabilities": {}, "deb": {}},
    )

    assert result is False


def test_future_training_snapshot_archive_persists_lead_one_and_two(monkeypatch):
    intraday_calls = []
    probability_calls = []

    class IntradayRepository:
        def append_snapshot(self, payload):
            intraday_calls.append(payload)

    class ProbabilityRepository:
        def append_snapshot(self, payload):
            probability_calls.append(payload)

    monkeypatch.setattr(
        analysis_service, "IntradayPathSnapshotRepository", IntradayRepository
    )
    monkeypatch.setattr(
        "src.database.runtime_state.ProbabilitySnapshotRepository",
        ProbabilityRepository,
    )

    result = analysis_service._archive_future_training_snapshots(
        "shanghai",
        {
            "local_date": "2026-09-12",
            "local_time": "09:00",
            "utc_offset_seconds": 28800,
            "multi_model_daily": {
                "2026-09-12": {"deb": {"prediction": 31.0}},
                "2026-09-13": {
                    "models": {"Open-Meteo": 32.0},
                    "deb": {"prediction": 31.5},
                },
                "2026-09-14": {"deb": {"prediction": 30.5}},
                "2026-09-15": {"deb": {"prediction": 30.0}},
            },
        },
    )

    assert result == {"intraday": 2, "probability": 2, "skipped": 0}
    assert [row["target_date"] for row in intraday_calls] == [
        "2026-09-13",
        "2026-09-14",
    ]
    assert [row["lead_days"] for row in intraday_calls] == [1, 2]
    assert [row["date"] for row in probability_calls] == [
        "2026-09-13",
        "2026-09-14",
    ]
