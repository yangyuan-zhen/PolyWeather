import json
from pathlib import Path

from scripts.build_probability_shadow_report import main


def test_shadow_report_builds_summary(monkeypatch, tmp_path: Path):
    history_file = tmp_path / "daily_records.json"
    output_file = tmp_path / "shadow_report.json"
    history_file.write_text(
        json.dumps(
            {
                "ankara": {
                    "2026-03-18": {
                        "actual_high": 10.0,
                        "mu": 9.6,
                        "prob_snapshot": [
                            {"v": 10, "p": 0.48},
                            {"v": 9, "p": 0.41},
                        ],
                        "shadow_prob_snapshot": [
                            {"v": 10, "p": 0.55},
                            {"v": 9, "p": 0.28},
                        ],
                        "probability_calibration": {
                            "mode": "emos_shadow",
                            "engine": "legacy",
                            "version": "emos-test",
                            "raw_mu": 9.6,
                            "calibrated_mu": 9.9,
                        },
                    }
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_probability_shadow_report.py",
            "--history-file",
            str(history_file),
            "--output",
            str(output_file),
        ],
    )

    main()

    payload = json.loads(output_file.read_text(encoding="utf-8"))
    assert payload["summary"]["samples"] == 1
    assert payload["summary"]["legacy_mean_mae"] == 0.4
    assert payload["summary"]["shadow_mean_mae"] == 0.1
    assert payload["summary"]["delta_mae"] == -0.3
    assert payload["summary"]["legacy_bucket_hit_rate"] == 1.0
    assert payload["summary"]["shadow_bucket_hit_rate"] == 1.0
    assert payload["recent_observations"][0]["calibration_version"] == "emos-test"
