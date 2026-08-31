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
