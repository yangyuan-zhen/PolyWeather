from src.analysis.probability_rollout import judge_probability_rollout


def test_judge_probability_rollout_holds_on_shadow_brier_regression():
    evaluation_report = {
        "summary": {
            "sample_count": 105,
            "delta": {
                "crps": -0.09,
                "mae": 0.0,
                "bucket_hit_rate": 0.0,
            },
        }
    }
    shadow_report = {
        "summary": {
            "samples": 103,
            "delta_mae": 0.01,
            "delta_bucket_hit_rate": 0.01,
            "delta_bucket_brier": 0.29,
        },
        "by_city": {
            "miami": {
                "samples": 4,
                "delta_mae": 0.24,
                "delta_bucket_hit_rate": -0.5,
                "delta_bucket_brier": 0.47,
            }
        },
    }

    payload = judge_probability_rollout(evaluation_report, shadow_report)

    assert payload["decision"] == "hold"
    assert payload["ready_for_primary"] is False
    assert payload["blocking_reasons"]
    assert payload["worst_shadow_regressions"][0]["city"] == "miami"


def test_judge_probability_rollout_promotes_on_clean_metrics():
    evaluation_report = {
        "summary": {
            "sample_count": 120,
            "delta": {
                "crps": -0.08,
                "mae": 0.0,
                "bucket_hit_rate": 0.02,
            },
        }
    }
    shadow_report = {
        "summary": {
            "samples": 110,
            "delta_mae": 0.0,
            "delta_bucket_hit_rate": 0.01,
            "delta_bucket_brier": 0.01,
        },
        "by_city": {},
    }

    payload = judge_probability_rollout(evaluation_report, shadow_report)

    assert payload["decision"] == "promote"
    assert payload["ready_for_primary"] is True
    assert payload["blocking_reasons"] == []
