import json
import subprocess
import sys
from pathlib import Path

from src.analysis.deb_evaluation import (
    DEB_BUCKET_CALIBRATED_VERSION,
    DEB_GUARDED_CALIBRATED_VERSION,
    DEB_RAW_VERSION,
    DEB_RECENT_BIAS_CORRECTED_VERSION,
    backtest_deb_versions,
    build_bucket_calibrated_corrector,
    build_recent_bias_corrector,
    choose_guarded_deb_correction,
    evaluate_prediction_records,
    write_backtest_report,
)
from src.database.runtime_state import DailyRecordRepository, RuntimeStateDB


def test_deb_evaluation_reports_mae_rmse_bias_and_bucket_hits():
    records = [
        {"city": "ankara", "target_date": "2026-05-20", "prediction": 20.0, "actual": 21.0},
        {"city": "ankara", "target_date": "2026-05-21", "prediction": 22.0, "actual": 21.0},
        {"city": "ankara", "target_date": "2026-05-22", "prediction": 23.0, "actual": 23.0},
    ]

    metrics = evaluate_prediction_records(records, version=DEB_RAW_VERSION)

    assert metrics["version"] == DEB_RAW_VERSION
    assert metrics["samples"] == 3
    assert metrics["mae"] == 0.667
    assert metrics["rmse"] == 0.816
    assert metrics["bias"] == 0.0
    assert metrics["bucket_hit_rate"] == 0.333


def test_recent_bias_corrector_uses_signed_error_without_rewriting_raw_deb():
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.0, "actual_high": 22.0},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 21.0, "actual_high": 23.0},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 24.0, "actual_high": 25.0},
    ]

    corrector = build_recent_bias_corrector(history, lookback_days=30, min_samples=2)
    corrected = corrector.apply("ankara", raw_prediction=24.0)

    assert corrected["version"] == DEB_RECENT_BIAS_CORRECTED_VERSION
    assert corrected["raw_prediction"] == 24.0
    assert corrected["corrected_prediction"] > corrected["raw_prediction"]
    assert corrected["bias_adjustment"] == 1.0
    assert corrected["samples"] == 3


def test_bucket_calibrated_corrector_optimizes_settlement_bucket_hits():
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.4, "actual_high": 21.0},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 21.4, "actual_high": 22.0},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 22.4, "actual_high": 23.0},
        {"city": "ankara", "target_date": "2026-05-23", "deb_prediction": 23.4, "actual_high": 24.0},
        {"city": "ankara", "target_date": "2026-05-24", "deb_prediction": 24.4, "actual_high": 25.0},
    ]

    corrector = build_bucket_calibrated_corrector(history, lookback_days=30, min_samples=5)
    corrected = corrector.apply("ankara", raw_prediction=25.4)

    assert corrected["version"] == DEB_BUCKET_CALIBRATED_VERSION
    assert corrected["raw_prediction"] == 25.4
    assert corrected["corrected_prediction"] == 26.0
    assert corrected["bias_adjustment"] == 0.6
    assert corrected["samples"] == 5


def test_guarded_deb_correction_rejects_bucket_when_recent_holdout_gets_worse():
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-23", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-24", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-25", "deb_prediction": 20.49, "actual_high": 20.49},
        {"city": "ankara", "target_date": "2026-05-26", "deb_prediction": 20.49, "actual_high": 20.49},
        {"city": "ankara", "target_date": "2026-05-27", "deb_prediction": 20.49, "actual_high": 20.49},
    ]

    corrected = choose_guarded_deb_correction(
        history,
        "ankara",
        raw_prediction=20.49,
        min_samples=3,
        validation_samples=3,
    )

    assert corrected["version"] == DEB_GUARDED_CALIBRATED_VERSION
    assert corrected["selected_version"] == DEB_RECENT_BIAS_CORRECTED_VERSION
    assert corrected["corrected_prediction"] == 20.5
    assert corrected["guard_reason"] == "bucket_rejected_holdout"


def test_guarded_deb_correction_accepts_bucket_when_holdout_improves():
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-23", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-24", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-25", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-26", "deb_prediction": 20.49, "actual_high": 20.51},
        {"city": "ankara", "target_date": "2026-05-27", "deb_prediction": 20.49, "actual_high": 20.51},
    ]

    corrected = choose_guarded_deb_correction(
        history,
        "ankara",
        raw_prediction=20.49,
        min_samples=3,
        validation_samples=3,
    )

    assert corrected["version"] == DEB_GUARDED_CALIBRATED_VERSION
    assert corrected["selected_version"] == DEB_BUCKET_CALIBRATED_VERSION
    assert corrected["corrected_prediction"] == 20.6
    assert corrected["guard_reason"] == "bucket_selected_holdout"


def test_backtest_deb_versions_compares_raw_and_bias_corrected_versions():
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.0, "actual_high": 22.0},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 21.0, "actual_high": 23.0},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 24.0, "actual_high": 25.0},
        {"city": "ankara", "target_date": "2026-05-23", "deb_prediction": 24.0, "actual_high": 26.0},
    ]

    report = backtest_deb_versions(history, train_lookback_days=30)

    assert report["schema_version"] == "deb_backtest_report.v1"
    assert report["versions"][DEB_RAW_VERSION]["samples"] == 2
    assert report["versions"][DEB_RECENT_BIAS_CORRECTED_VERSION]["samples"] == 2
    assert report["versions"][DEB_BUCKET_CALIBRATED_VERSION]["samples"] == 0
    assert report["versions"][DEB_GUARDED_CALIBRATED_VERSION]["samples"] == 2
    assert (
        report["versions"][DEB_RECENT_BIAS_CORRECTED_VERSION]["mae"]
        < report["versions"][DEB_RAW_VERSION]["mae"]
    )
    assert report["rows"][0]["versions"][DEB_RAW_VERSION]["prediction"] == 24.0
    assert report["rows"][0]["versions"][DEB_RECENT_BIAS_CORRECTED_VERSION]["prediction"] == 24.8


def test_write_backtest_report_persists_versioned_json_and_csv(tmp_path):
    history = [
        {"city": "ankara", "target_date": "2026-05-20", "deb_prediction": 20.0, "actual_high": 22.0},
        {"city": "ankara", "target_date": "2026-05-21", "deb_prediction": 21.0, "actual_high": 23.0},
        {"city": "ankara", "target_date": "2026-05-22", "deb_prediction": 24.0, "actual_high": 25.0},
    ]
    report = backtest_deb_versions(history)
    json_path = tmp_path / "deb-backtest.json"
    csv_path = tmp_path / "deb-backtest.csv"

    write_backtest_report(report, json_path=json_path, csv_path=csv_path)

    assert json_path.read_text(encoding="utf-8").startswith("{\n  \"schema_version\": \"deb_backtest_report.v1\"")
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "deb_v1_raw_prediction" in csv_text
    assert "deb_v1_recent_bias_corrected_prediction" in csv_text


def test_backtest_deb_versions_cli_reads_sqlite_and_writes_outputs(tmp_path):
    db_path = tmp_path / "polyweather.db"
    db = RuntimeStateDB(str(db_path))
    repo = DailyRecordRepository(db)
    repo.upsert_record("ankara", "2026-05-20", {"deb_prediction": 20.0, "actual_high": 22.0})
    repo.upsert_record("ankara", "2026-05-21", {"deb_prediction": 21.0, "actual_high": 23.0})
    repo.upsert_record("ankara", "2026-05-22", {"deb_prediction": 24.0, "actual_high": 25.0})
    json_path = tmp_path / "report.json"
    csv_path = tmp_path / "report.csv"

    result = subprocess.run(
        [
            sys.executable,
            str(Path("scripts") / "backtest_deb_versions.py"),
            "--db",
            str(db_path),
            "--output-json",
            str(json_path),
            "--output-csv",
            str(csv_path),
        ],
        cwd=Path(__file__).resolve().parents[1],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == "deb_backtest_report.v1"
    assert payload["versions"][DEB_RAW_VERSION]["samples"] == 1
    assert csv_path.exists()
