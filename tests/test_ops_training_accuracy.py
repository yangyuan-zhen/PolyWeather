from web.services.ops_api import _build_training_accuracy_payload
from datetime import date, timedelta


def test_training_accuracy_payload_includes_recent_deb_summary():
    history = {
        "alpha": {
            "2026-05-25": {"actual_high": 20.0, "deb_prediction": 20.0, "mu": 20.0},
            "2026-06-01": {"actual_high": 21.0, "deb_prediction": 20.4, "mu": 21.0},
            "2026-06-02": {"actual_high": 22.0, "deb_prediction": 21.6, "mu": 22.0},
        },
        "beta": {
            "2026-06-03": {"actual_high": 30.0, "deb_prediction": 30.2, "mu": 30.0},
            "2026-06-04": {"actual_high": 31.0, "deb_prediction": 29.2, "mu": 31.0},
        },
    }
    registry = {
        "alpha": {"name": "Alpha"},
        "beta": {"name": "Beta"},
        "gamma": {"name": "Gamma"},
    }

    payload = _build_training_accuracy_payload(
        history,
        registry,
        today_str="2026-06-07",
    )

    assert [row["city_id"] for row in payload["accuracy"]] == ["alpha", "beta"]
    assert payload["deb_summary"]["historical"]["city_count"] == 2
    assert payload["deb_summary"]["historical"]["sample_days"] == 5
    assert payload["deb_summary"]["recent_7d"]["start_date"] == "2026-05-31"
    assert payload["deb_summary"]["recent_7d"]["end_date"] == "2026-06-06"
    assert payload["deb_summary"]["recent_7d"]["samples"] == 4
    assert payload["deb_summary"]["recent_7d"]["hits"] == 2
    assert payload["deb_summary"]["recent_7d"]["hit_rate"] == 50.0
    assert payload["deb_summary"]["recent_14d"]["samples"] == 5
    assert "deb_v1_raw" in payload["deb_summary"]["versions"]
    assert "deb_v2_bucket_calibrated" in payload["deb_summary"]["versions"]


def test_training_accuracy_payload_caps_version_backtest_samples(monkeypatch):
    start = date(2025, 1, 1)
    history = {
        "alpha": {
            (start + timedelta(days=idx)).isoformat(): {
                "actual_high": 20.0 + (idx % 3),
                "deb_prediction": 20.0 + (idx % 3),
            }
            for idx in range(405)
        }
    }
    captured = {}

    def fake_backtest(rows, **_kwargs):
        row_list = list(rows)
        captured["count"] = len(row_list)
        captured["first_date"] = row_list[0]["target_date"]
        return {"versions": {}}

    monkeypatch.setattr("src.analysis.deb_evaluation.backtest_deb_versions", fake_backtest)

    _build_training_accuracy_payload(
        history,
        {"alpha": {"name": "Alpha"}},
        today_str="2026-03-01",
    )

    assert captured["count"] == 400
    assert captured["first_date"] == "2025-01-06"
