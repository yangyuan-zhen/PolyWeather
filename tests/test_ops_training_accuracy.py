from web.services.ops_api import _build_training_accuracy_payload


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
