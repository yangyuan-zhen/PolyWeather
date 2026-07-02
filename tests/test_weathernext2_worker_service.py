from __future__ import annotations

import json
from datetime import date, timedelta

from src.database.runtime_state import (
    RuntimeStateDB,
    TrainingFeatureRecordRepository,
    TruthRecordRepository,
)
from web.weathernext2_worker_service import run_weathernext2_cycle


def _seed_training_rows(feature_repo, truth_repo, count: int = 170):
    for idx in range(count):
        city = "houston" if idx % 2 == 0 else "shanghai"
        target_date = (date(2026, 1, 1) + timedelta(days=idx)).isoformat()
        median = 30.0 + (idx % 7) * 0.2
        residual = 1.0 if city == "houston" else -0.5
        feature_repo.upsert_record(
            city,
            target_date,
            {
                "weathernext2": {
                    "summary": {
                        "mean": median,
                        "median": median,
                        "p10": median - 1.0,
                        "p25": median - 0.5,
                        "p75": median + 0.5,
                        "p90": median + 1.0,
                        "spread": 2.0,
                    }
                },
                "deb_prediction": median + 0.2,
                "model_median_c": median + 0.1,
                "model_spread": 1.4,
                "current_max_so_far_c": median - 2.0,
                "local_hour": 12,
            },
        )
        truth_repo.upsert_truth(
            city=city,
            target_date=target_date,
            actual_high=median + residual,
            settlement_source="metar",
            settlement_station_code="TEST",
            settlement_station_label="TEST",
            truth_version="test",
            updated_by="test",
            is_final=True,
        )


def test_weathernext2_worker_writes_city_artifact_and_trains_calibrator(tmp_path):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    feature_repo = TrainingFeatureRecordRepository(db)
    truth_repo = TruthRecordRepository(db)
    _seed_training_rows(feature_repo, truth_repo)

    def fake_fetcher(city, meta, target_date):
        return {
            "city": city,
            "target_date": target_date,
            "source_run": "2026-06-29T00:00:00Z",
            "member_highs": [30.0, 30.2, 30.4, 30.6],
        }

    output_path = tmp_path / "weathernext2_city_highs.json"
    model_dir = tmp_path / "model"
    result = run_weathernext2_cycle(
        city_registry={
            "houston": {"name": "Houston", "lat": 29.7, "lon": -95.3, "use_fahrenheit": False, "tz_offset": -5 * 3600},
        },
        output_path=str(output_path),
        model_dir=str(model_dir),
        fetcher=fake_fetcher,
        feature_repo=feature_repo,
        truth_repo=truth_repo,
        min_global_samples=150,
        min_city_samples=5,
    )

    assert result["status"] == "written"
    assert result["city_count"] == 1
    assert result["calibration"]["trained"] is True
    assert (model_dir / "metadata.json").is_file()
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["cities"]["houston"]["member_highs"] == [30.0, 30.2, 30.4, 30.6]
    assert payload["calibration_training"]["samples"] == 170


def test_weathernext2_worker_does_not_overwrite_artifact_when_no_city_payloads(tmp_path):
    db = RuntimeStateDB(str(tmp_path / "polyweather.db"))
    output_path = tmp_path / "weathernext2_city_highs.json"
    output_path.write_text('{"cities":{"old":{"member_highs":[1]}}}', encoding="utf-8")

    result = run_weathernext2_cycle(
        city_registry={"houston": {"name": "Houston", "lat": 29.7, "lon": -95.3}},
        output_path=str(output_path),
        model_dir=str(tmp_path / "model"),
        fetcher=lambda _city, _meta, _target_date: None,
        feature_repo=TrainingFeatureRecordRepository(db),
        truth_repo=TruthRecordRepository(db),
    )

    assert result["status"] == "no_city_payloads"
    assert json.loads(output_path.read_text(encoding="utf-8"))["cities"]["old"]["member_highs"] == [1]
