from scripts.auto_retrain_probability_calibration import judge_candidate


def _report(sample_count=80, crps=-0.1, mae=0.0, hit=0.0):
    return {
        "summary": {
            "sample_count": sample_count,
            "delta": {
                "crps": crps,
                "mae": mae,
                "bucket_hit_rate": hit,
            },
        }
    }


def test_candidate_gate_promotes_when_metrics_pass():
    decision = judge_candidate(
        _report(),
        min_samples=50,
        max_delta_crps=0.0,
        max_delta_mae=0.05,
        min_delta_bucket_hit_rate=-0.05,
    )

    assert decision["decision"] == "promote"
    assert decision["ready_for_promotion"] is True
    assert decision["blocking_reasons"] == []


def test_candidate_gate_holds_when_metrics_regress():
    decision = judge_candidate(
        _report(sample_count=40, crps=0.1, mae=0.2, hit=-0.2),
        min_samples=50,
        max_delta_crps=0.0,
        max_delta_mae=0.05,
        min_delta_bucket_hit_rate=-0.05,
    )

    assert decision["decision"] == "hold"
    assert decision["ready_for_promotion"] is False
    assert len(decision["blocking_reasons"]) == 4
