import json
from pathlib import Path
import pytest

from src.analysis.probability_snapshot_archive import append_probability_snapshot


@pytest.fixture(autouse=True)
def _force_file_mode(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_STATE_STORAGE_MODE", "file")


def test_append_probability_snapshot_writes_jsonl(tmp_path: Path):
    archive_path = tmp_path / "probability_training_snapshots.jsonl"

    append_probability_snapshot(
        city_name="ankara",
        local_date="2026-03-20",
        observation_time="2026-03-20T12:00:00+03:00",
        temp_symbol="°C",
        raw_mu=15.2,
        raw_sigma=1.2,
        deb_prediction=15.4,
        ens_data={"p10": 14.8, "median": 15.8, "p90": 17.9},
        current_forecasts={"ECMWF": 15.8, "GFS": 14.1},
        max_so_far=15.0,
        peak_status="before",
        probabilities=[{"value": 15, "probability": 0.552}],
        shadow_probabilities=[{"value": 15, "probability": 0.324}],
        calibration_summary={
            "engine": "legacy",
            "mode": "emos_shadow",
            "calibration_version": "emos-test",
            "calibration_source": "artifacts/probability_calibration/default.json",
            "calibrated_mu": 15.1,
            "calibrated_sigma": 1.25,
        },
        archive_path=str(archive_path),
    )

    lines = archive_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["city"] == "ankara"
    assert payload["date"] == "2026-03-20"
    assert payload["raw_mu"] == 15.2
    assert payload["ensemble"]["median"] == 15.8
    assert payload["prob_snapshot"][0]["v"] == 15
    assert payload["shadow_prob_snapshot"][0]["v"] == 15
    assert payload["calibration_version"] == "emos-test"


def test_append_probability_snapshot_skips_near_duplicate(tmp_path: Path):
    archive_path = tmp_path / "probability_training_snapshots.jsonl"
    kwargs = dict(
        city_name="ankara",
        local_date="2026-03-20",
        observation_time="2026-03-20T12:00:00+03:00",
        temp_symbol="°C",
        raw_mu=15.2,
        raw_sigma=1.2,
        deb_prediction=15.4,
        ens_data={"p10": 14.8, "median": 15.8, "p90": 17.9},
        current_forecasts={"ECMWF": 15.8, "GFS": 14.1},
        max_so_far=15.0,
        peak_status="before",
        probabilities=[{"value": 15, "probability": 0.552}],
        shadow_probabilities=[{"value": 15, "probability": 0.324}],
        calibration_summary={
            "engine": "legacy",
            "mode": "emos_shadow",
            "calibration_version": "emos-test",
            "calibration_source": "artifacts/probability_calibration/default.json",
            "calibrated_mu": 15.1,
            "calibrated_sigma": 1.25,
        },
        archive_path=str(archive_path),
    )

    append_probability_snapshot(**kwargs)
    append_probability_snapshot(**kwargs)

    lines = archive_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1


def test_append_probability_snapshot_writes_on_bucket_change(tmp_path: Path):
    archive_path = tmp_path / "probability_training_snapshots.jsonl"
    base_kwargs = dict(
        city_name="ankara",
        local_date="2026-03-20",
        observation_time="2026-03-20T12:00:00+03:00",
        temp_symbol="°C",
        raw_mu=15.2,
        raw_sigma=1.2,
        deb_prediction=15.4,
        ens_data={"p10": 14.8, "median": 15.8, "p90": 17.9},
        current_forecasts={"ECMWF": 15.8, "GFS": 14.1},
        max_so_far=15.0,
        peak_status="before",
        shadow_probabilities=[{"value": 15, "probability": 0.324}],
        calibration_summary={
            "engine": "legacy",
            "mode": "emos_shadow",
            "calibration_version": "emos-test",
            "calibration_source": "artifacts/probability_calibration/default.json",
            "calibrated_mu": 15.1,
            "calibrated_sigma": 1.25,
        },
        archive_path=str(archive_path),
    )

    append_probability_snapshot(
        probabilities=[{"value": 15, "probability": 0.552}],
        **base_kwargs,
    )
    append_probability_snapshot(
        probabilities=[{"value": 16, "probability": 0.552}],
        **base_kwargs,
    )

    lines = archive_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
