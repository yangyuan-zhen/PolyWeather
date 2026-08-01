"""Walk-forward DEB weight hyperparameter backtest tests."""

from __future__ import annotations

from src.analysis.deb_algorithm import (
    calculate_dynamic_weight_components,
    calculate_dynamic_weights,
)
from src.analysis.deb_evaluation import (
    DEFAULT_WEIGHT_CONFIGS,
    DEB_WEIGHT_BACKTEST_SCHEMA_VERSION,
    backtest_deb_weight_configs,
    write_weight_config_report,
)


def _build_history(
    n_days: int,
    *,
    city: str = "ankara",
    start_date: str = "2026-05-20",
    ecmwf_bias: float = 0.0,
    gfs_bias: float = 2.0,
) -> dict[str, dict[str, dict[str, float]]]:
    """History where ecmwf is perfect and gfs drifts by gfs_bias."""
    records: dict[str, dict[str, dict[str, float]]] = {}
    for i in range(n_days):
        actual = 20.0 + i
        date_str = f"{(int(start_date[8:10]) + i):02d}"
        target_date = f"{start_date[:8]}{date_str}"
        records[city] = {
            **records.get(city, {}),
            target_date: {
                "actual_high": actual,
                "forecasts": {
                    "ecmwf": actual + ecmwf_bias,
                    "gfs": actual + gfs_bias,
                },
            },
        }
    return records


def test_backtest_deb_weight_configs_compares_baseline_and_deb_configs():
    daily_records = _build_history(6)

    report = backtest_deb_weight_configs(
        daily_records,
        configs=[
            {"name": "baseline_equal_weight", "mode": "equal"},
            {
                "name": "prod_decay0.85_bias0.5_lb7",
                "mode": "deb",
                "decay_factor": 0.85,
                "bias_penalty": 0.5,
                "lookback_days": 7,
            },
        ],
    )

    assert report["schema_version"] == DEB_WEIGHT_BACKTEST_SCHEMA_VERSION
    summaries = {cfg["version"]: cfg for cfg in report["configs"]}
    assert set(summaries) == {
        "baseline_equal_weight",
        "prod_decay0.85_bias0.5_lb7",
    }
    for name, summary in summaries.items():
        assert summary["samples"] == 6
        assert summary["mae"] is not None
        assert summary["bucket_hit_rate"] is not None
    # Baseline averages ecmwf (perfect) with gfs (+2) → error ≈ 1.0
    baseline = summaries["baseline_equal_weight"]
    assert 0.5 <= baseline["mae"] <= 1.5
    # DEB weights ecmwf heavily → error much smaller than baseline
    deb = summaries["prod_decay0.85_bias0.5_lb7"]
    assert deb["mae"] < baseline["mae"] * 0.5


def test_backtest_deb_weight_configs_walk_forward_uses_only_past_data():
    daily_records = _build_history(6)

    report = backtest_deb_weight_configs(
        daily_records,
        configs=[
            {"name": "baseline_equal_weight", "mode": "equal"},
            {
                "name": "prod_decay0.85_bias0.5_lb7",
                "mode": "deb",
                "decay_factor": 0.85,
                "bias_penalty": 0.5,
                "lookback_days": 7,
            },
        ],
    )

    # First 2 days have <2 days of usable history → equal-weight fallback.
    deb_summary = next(
        cfg for cfg in report["configs"] if cfg["version"] == "prod_decay0.85_bias0.5_lb7"
    )
    assert abs(deb_summary["equal_weight_share"] - 2 / 6) < 0.001

    # From day 3 onward the blend should track the accurate ecmwf model.
    prod_rows = [
        row
        for row in report["rows"]
        if row["predictions"]["prod_decay0.85_bias0.5_lb7"] is not None
    ]
    assert len(prod_rows) == 6
    for row in prod_rows[2:]:
        pred = row["predictions"]["prod_decay0.85_bias0.5_lb7"]
        assert abs(pred - row["actual"]) <= 0.3


def test_weight_configs_history_injection_bypasses_storage():
    history = _build_history(6)["ankara"]
    components = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        history_data={"ankara": history},
        divergence_threshold=10.0,  # isolate injection: no spread fallback
    )

    assert components["prediction"] is not None
    assert components["days_used"] >= 5
    # Perfect ecmwf dominates the blend.
    assert components["weights"]["ecmwf"] > 0.9


def test_bias_penalty_parameter_changes_blend():
    history = _build_history(6)["ankara"]

    no_penalty = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        bias_penalty=0.0,
        history_data={"ankara": history},
    )
    heavy_penalty = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        bias_penalty=1.0,
        history_data={"ankara": history},
    )

    assert heavy_penalty["weights"]["gfs"] < no_penalty["weights"]["gfs"]
    assert heavy_penalty["weights"]["ecmwf"] > no_penalty["weights"]["ecmwf"]


def test_divergence_threshold_parameter_changes_blend():
    history = _build_history(6)["ankara"]
    # spread = 4 (25 vs 29): active under 3.0 threshold, inactive under 10.0
    narrow = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        divergence_threshold=3.0,
        history_data={"ankara": history},
    )
    wide = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        divergence_threshold=10.0,
        history_data={"ankara": history},
    )

    # Fallback pulls low-weight gfs toward equal weight → larger weight.
    assert narrow["weights"]["gfs"] > wide["weights"]["gfs"]
    assert narrow["weights"]["ecmwf"] < wide["weights"]["ecmwf"]


def test_calculate_dynamic_weights_passes_hyperparameters_through():
    history = _build_history(6)["ankara"]
    prediction, info = calculate_dynamic_weights(
        "ankara",
        {"ecmwf": 25.0, "gfs": 29.0},
        bias_penalty=1.0,
        divergence_threshold=10.0,
        history_data={"ankara": history},
    )
    assert prediction is not None
    assert "权重" in info or "MAE" in info or "bias" in info


def _build_hot_cool_history() -> dict[str, dict[str, dict[str, float]]]:
    """3 cool days (ecmwf drifts +4, gfs perfect) + 3 hot days (ecmwf perfect,
    gfs drifts +4, actual >= 35C). Without hot-day x2 weighting both models have
    identical MAE; with it the hot-accurate ecmwf wins."""
    records: dict[str, dict[str, dict[str, float]]] = {}
    for i in range(6):
        if i < 3:  # cool days
            actual, ecmwf, gfs = 20.0, 24.0, 20.0
        else:  # hot days (>= 35C for ankara)
            actual, ecmwf, gfs = 38.0, 38.0, 42.0
        date_str = f"2026-07-{11 + i:02d}"  # fixed past dates, never "today"
        records["ankara"] = {
            **records.get("ankara", {}),
            date_str: {
                "actual_high": actual,
                "forecasts": {"ecmwf": ecmwf, "gfs": gfs},
            },
        }
    return records


def test_hot_day_weighting_doubles_weight_and_counts_hot_days():
    history = _build_hot_cool_history()["ankara"]
    components = calculate_dynamic_weight_components(
        "ankara",
        {"ecmwf": 38.0, "gfs": 42.0},
        bias_penalty=0.0,
        divergence_threshold=10.0,  # isolate hot weighting: no spread fallback
        history_data={"ankara": history},
    )

    assert components["hot_days_used"] == 3
    assert "高温日加权x2(3天)" in components["weights_info"]
    # Hot days get decay_weight * 2: the hot-accurate ecmwf edges out gfs even
    # though both models carry identical total error (without x2 they tie 0.5).
    assert components["weights"]["ecmwf"] > 0.5
    assert components["weights"]["gfs"] < 0.5


def test_write_weight_config_report_persists_json_and_csv(tmp_path):
    daily_records = _build_history(6)
    report = backtest_deb_weight_configs(daily_records, configs=DEFAULT_WEIGHT_CONFIGS[:2])
    json_path = tmp_path / "weight_backtest.json"
    csv_path = tmp_path / "weight_backtest.csv"

    write_weight_config_report(report, json_path=json_path, csv_path=csv_path)

    assert json_path.exists()
    assert csv_path.exists()
    import json

    loaded = json.loads(json_path.read_text(encoding="utf-8"))
    assert loaded["schema_version"] == DEB_WEIGHT_BACKTEST_SCHEMA_VERSION
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "city,target_date,actual" in csv_text
    assert "baseline_equal_weight_prediction" in csv_text
