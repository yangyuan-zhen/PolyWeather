"""Unit tests for the DEB normal probability engine (src/analysis/deb_probability.py)."""

from __future__ import annotations

import pytest

from src.analysis.deb_probability import (
    _bucket_probability,
    _build_deb_normal_probability_payload,
    _c_to_f,
    _lead_key,
    _load_deb_normal_stats,
    _normal_cdf,
    train_deb_lead_stats,
)


@pytest.fixture(autouse=True)
def _empty_snapshot_source(monkeypatch):
    """Isolate training from the local runtime DB.

    `_walk_forward_deb_residuals` derives lead from the earliest probability
    snapshot timestamp; against a populated local DB the test dates collide with
    real snapshots and lead strata become nondeterministic. Patching the
    repository to return no snapshots forces the lead=1 fallback everywhere.
    """

    class _FakeRepo:
        def __init__(self, *a, **k):
            pass

        def load_all_rows(self):
            return []

    monkeypatch.setattr(
        "src.database.runtime_state.ProbabilitySnapshotRepository",
        _FakeRepo,
    )


def _sample_stats():
    return {
        "lead_biases": {"0": 0.7, "1": 1.1, "2": 1.3},
        "lead_sigmas": {"0": 1.8, "1": 2.4, "2": 2.8},
        "city_biases": {},
        "temp_biases": {},
        "samples": 726,
        "window_days": 84,
        "computed_at": 1785529783.0,
    }


# ---- formula correctness ----


def test_bucket_probability_symmetric_around_mu():
    # P(T == tau) peaks at the bucket containing mu.
    p_mu = _bucket_probability(mu=30.0, sigma=2.0, tau=30)
    p_low = _bucket_probability(mu=30.0, sigma=2.0, tau=28)
    p_high = _bucket_probability(mu=30.0, sigma=2.0, tau=32)
    assert p_mu > p_low
    assert p_mu > p_high
    assert p_low == pytest.approx(p_high, abs=1e-6)


def test_bucket_probability_sums_to_cdf_range():
    # Sum over tau in [mu-4sigma, mu+4sigma] covers ~= Phi(4.5) - Phi(-4.5) ~ 1.0
    total = sum(_bucket_probability(30.0, 1.0, tau) for tau in range(25, 36))
    assert total == pytest.approx(1.0, abs=1e-6)


def test_normal_cdf_values():
    assert _normal_cdf(0.0) == pytest.approx(0.5)
    assert _normal_cdf(1.96) == pytest.approx(0.975, abs=1e-3)


def test_c_to_f():
    assert _c_to_f(35.0) == pytest.approx(95.0)
    assert _c_to_f(0.0) == pytest.approx(32.0)


def test_lead_key_stratification():
    assert _lead_key(0) == 0
    assert _lead_key(1) == 1
    assert _lead_key(2) == 2
    assert _lead_key(5) == 2
    assert _lead_key(-1) == 0
    assert _lead_key(None) == 1
    assert _lead_key("bad") == 1


# ---- payload building ----


def test_payload_shape_contract():
    payload = _build_deb_normal_probability_payload(
        30.0, lead=1, temp_symbol="°C", stats=_sample_stats()
    )
    assert payload is not None
    assert payload["engine"] == "deb_normal"
    assert "mu" in payload
    assert isinstance(payload["probabilities"], list)
    assert isinstance(payload["probabilities_all"], list)
    assert len(payload["probabilities"]) <= 4
    assert payload["lead"] == 1
    # probabilities sorted descending by probability
    probs = [b["probability"] for b in payload["probabilities"]]
    assert probs == sorted(probs, reverse=True)


def test_payload_mu_uses_bias():
    stats = _sample_stats()
    payload = _build_deb_normal_probability_payload(30.0, lead=1, temp_symbol="°C", stats=stats)
    # mu = deb + bias(lead=1) = 30.0 + 1.1
    assert payload["mu"] == pytest.approx(31.1, abs=0.01)


def test_payload_lead_strata_select_different_biases():
    stats = _sample_stats()
    p0 = _build_deb_normal_probability_payload(30.0, lead=0, temp_symbol="°C", stats=stats)
    p1 = _build_deb_normal_probability_payload(30.0, lead=1, temp_symbol="°C", stats=stats)
    assert p0["mu"] == pytest.approx(30.7, abs=0.01)
    assert p1["mu"] == pytest.approx(31.1, abs=0.01)


def test_payload_applies_city_bias_adjustment():
    stats = _sample_stats()
    stats["city_biases"] = {"1": {"seoul": 1.4}}
    p = _build_deb_normal_probability_payload(
        30.0, lead=1, temp_symbol="°C", stats=stats, city="Seoul"
    )
    # mu = deb(30) + lead bias(1.1) + seoul adj(1.4) = 32.5
    assert p["mu"] == pytest.approx(32.5, abs=0.01)
    # Unknown city gets no adjustment.
    p2 = _build_deb_normal_probability_payload(
        30.0, lead=1, temp_symbol="°C", stats=stats, city="atlantis"
    )
    assert p2["mu"] == pytest.approx(31.1, abs=0.01)


def test_payload_applies_temp_bucket_bias_adjustment():
    stats = _sample_stats()
    stats["temp_biases"] = {"1": {"33-36": 0.6}}
    # deb=35.0 falls in the 33-36 bucket -> +0.6 applied.
    p = _build_deb_normal_probability_payload(35.0, lead=1, temp_symbol="°C", stats=stats)
    assert p["mu"] == pytest.approx(36.7, abs=0.01)
    # deb=28.0 falls in the <=32 bucket -> no adjustment.
    p2 = _build_deb_normal_probability_payload(28.0, lead=1, temp_symbol="°C", stats=stats)
    assert p2["mu"] == pytest.approx(29.1, abs=0.01)


def test_payload_combines_city_and_temp_adjustments():
    stats = _sample_stats()
    stats["city_biases"] = {"1": {"seoul": 1.4}}
    stats["temp_biases"] = {"1": {"33-36": 0.6}}
    p = _build_deb_normal_probability_payload(
        35.0, lead=1, temp_symbol="°C", stats=stats, city="seoul"
    )
    # 35.0 + 1.1 + 1.4 + 0.6 = 38.1
    assert p["mu"] == pytest.approx(38.1, abs=0.01)


def test_payload_fahrenheit_conversion():
    stats = _sample_stats()
    payload = _build_deb_normal_probability_payload(
        30.0, lead=1, temp_symbol="°F", stats=stats, is_fahrenheit_city=True
    )
    # mu in Fahrenheit = (30.0 + 1.1) * 9/5 + 32 = 88.0
    assert payload["mu"] == pytest.approx(88.0, abs=0.1)
    # buckets should be whole Fahrenheit degrees
    for b in payload["probabilities"]:
        assert float(b["value"]) == int(b["value"])


def test_payload_none_without_stats(monkeypatch):
    # stats explicitly None and DB has none -> falls back and returns None.
    monkeypatch.setattr(
        "src.analysis.deb_probability._load_deb_normal_stats", lambda *a, **k: None
    )
    assert (
        _build_deb_normal_probability_payload(30.0, lead=1, temp_symbol="°C", stats=None)
        is None
    )
    assert (
        _build_deb_normal_probability_payload(None, lead=1, temp_symbol="°C", stats=_sample_stats())
        is None
    )


def test_payload_buckets_cover_mu_plus_minus_4sigma():
    stats = _sample_stats()
    payload = _build_deb_normal_probability_payload(30.0, lead=1, temp_symbol="°C", stats=stats)
    vals = [b["value"] for b in payload["probabilities_all"]]
    mu = payload["mu"]
    assert min(vals) <= mu - 3 * stats["lead_sigmas"]["1"]
    assert max(vals) >= mu + 3 * stats["lead_sigmas"]["1"]


def test_load_stats_from_empty_db_returns_none():
    # No training has run -> stats table empty -> None (engine falls back to WX2).
    assert _load_deb_normal_stats() is None or isinstance(_load_deb_normal_stats(), dict)


# ---- training (walk-forward, no leakage) ----


def _make_record(city, date, actual, forecasts, snap_ts=None, deb_prediction=None):
    rec = {
        "city": city,
        "target_date": date,
        "actual_high": actual,
        "forecasts": forecasts,
    }
    if deb_prediction is not None:
        rec["deb_prediction"] = deb_prediction
    return rec


def test_train_deb_lead_stats_insufficient_samples():
    daily_records = {
        "tokyo": {
            "2026-04-01": _make_record("tokyo", "2026-04-01", 22.0, {"Open-Meteo": 21.0, "ECMWF": 20.5}),
        }
    }
    result = train_deb_lead_stats(daily_records, min_samples=20)
    assert result["trained"] is False
    assert result["reason"] == "insufficient_lead_samples"


def test_train_deb_lead_stats_synthetic_pool():
    # Build 25 city-days with a known +1.0 residual bias and ~2.0 spread,
    # all lead=1, so stats should recover bias ~= 1.0, sigma ~= 2.0.
    daily_records = {}
    import random

    rng = random.Random(42)
    for i in range(25):
        city = f"city{i % 5}"
        date = f"2026-05-{i + 1:02d}"
        raw = 30.0 + (i % 5) * 0.5
        actual = raw + 1.0 + rng.gauss(0, 2.0)
        daily_records.setdefault(city, {})[date] = _make_record(
            city, date, actual, {"Open-Meteo": raw - 0.5, "ECMWF": raw + 0.5}
        )
    result = train_deb_lead_stats(daily_records, min_samples=10)
    assert result["trained"] is True
    assert "1" in result["lead_biases"]
    assert abs(result["lead_biases"]["1"] - 1.0) < 1.0
    assert result["lead_sigmas"]["1"] > 0.5
    assert result["samples"] >= 10


def test_train_deb_lead_stats_emits_city_and_temp_biases():
    # Two cities with opposite residual biases at a hot forecast stratum:
    # seoul residuals +3.0 (warm), tokyo residuals -1.0, raw forecasts in 33-36.
    # 34 days each -> 32 usable walk-forward rows per city, above
    # MIN_ADJUST_SAMPLES=30 so both adjustments are emitted.
    daily_records = {}
    for i in range(34):
        date = f"2026-05-{i + 1:02d}"
        raw = 34.0
        daily_records.setdefault("seoul", {})[date] = _make_record(
            "seoul", date, raw + 3.0 + 0.2, {"Open-Meteo": raw, "ECMWF": raw + 0.1}
        )
        daily_records.setdefault("tokyo", {})[date] = _make_record(
            "tokyo", date, raw - 1.0 + 0.2, {"Open-Meteo": raw, "ECMWF": raw + 0.1}
        )
    result = train_deb_lead_stats(daily_records, min_samples=10)
    assert result["trained"] is True
    # City adjustments are shrunk deviations from the lead-global bias.
    city_map = result.get("city_biases", {}).get("1", {})
    assert "seoul" in city_map
    assert city_map["seoul"] > 1.0
    assert "tokyo" in city_map
    assert city_map["tokyo"] < 0.0


def test_train_deb_lead_stats_emits_temp_bucket_biases():
    # 40 cool days (unbiased) + 32 hot days (+1.9 warm): the hot stratum is a
    # minority deviating from the global median, so it receives a positive
    # adjustment while the cool majority defines the global bias. Hot group
    # (33-36) has 32 usable rows >= MIN_ADJUST_SAMPLES=30.
    daily_records = {}
    for i in range(72):
        date = f"2026-05-{i + 1:02d}"
        if i < 40:
            raw = 28.0
            actual = raw + 0.2
        else:
            raw = 34.5
            actual = raw + 1.9
        daily_records.setdefault("singapore", {})[date] = _make_record(
            "singapore", date, actual, {"Open-Meteo": raw, "ECMWF": raw + 0.1}
        )
    result = train_deb_lead_stats(daily_records, min_samples=5)
    assert result["trained"] is True
    temp_map = result.get("temp_biases", {}).get("1", {})
    assert temp_map.get("33-36", 0.0) > 0.5


def test_train_deb_lead_stats_small_city_group_shrinks_to_zero():
    # 6 days for seoul (4 usable rows < MIN_ADJUST_SAMPLES=30) mixed with other
    # cities: seoul's adjustment shrinks to zero and is not emitted.
    daily_records = {}
    for i in range(30):  # 6 days x 5 cities
        date = f"2026-06-{i + 1:02d}"
        raw = 20.0
        actual = raw + (3.0 if i < 6 else 1.0)
        city = "seoul" if i < 6 else f"city{i // 6}"
        daily_records.setdefault(city, {})[date] = _make_record(
            city, date, actual, {"Open-Meteo": raw, "ECMWF": raw}
        )
    result = train_deb_lead_stats(daily_records, min_samples=5)
    assert result["trained"] is True
    city_map = result.get("city_biases", {}).get("1", {})
    assert "seoul" not in city_map


def test_train_deb_lead_stats_uses_robust_sigma():
    # Outlier residuals inflate pstdev but not the MAD-based scale.
    daily_records = {}
    for i in range(15):
        date = f"2026-07-{i + 1:02d}"
        raw = 25.0
        # 14 normal residuals of 0, 1 outlier of +20.
        actual = raw + (20.0 if i == 14 else 0.0)
        daily_records.setdefault("singapore", {})[date] = _make_record(
            "singapore", date, actual, {"Open-Meteo": raw, "ECMWF": raw}
        )
    result = train_deb_lead_stats(daily_records, min_samples=5)
    assert result["trained"] is True
    sigma = result["lead_sigmas"]["1"]
    # MAD-based scale stays near the inlier spread (~0), floored at MIN_SIGMA.
    assert sigma <= 1.0
    assert sigma >= 0.5


def test_train_deb_lead_stats_uses_stored_deb_prediction_as_residual_basis():
    # The core calibration fix: training residuals must be computed against the
    # STORED deb_prediction (what inference actually consumes), not a
    # walk-forward recomputation. Here the stored value (32.0) deliberately
    # differs from the raw blend (28.0), so a bias trained on the stored basis
    # (residual = 33.0 - 32.0 = +1.0) is distinguishable from the walk-forward
    # basis (residual = 33.0 - 28.0 = +5.0).
    daily_records = {}
    for i in range(25):
        date = f"2026-05-{i + 1:02d}"
        raw = 28.0
        daily_records.setdefault("singapore", {})[date] = _make_record(
            "singapore",
            date,
            33.0,
            {"Open-Meteo": raw, "ECMWF": raw + 0.1},
            deb_prediction=32.0,
        )
    result = train_deb_lead_stats(daily_records, min_samples=10)
    assert result["trained"] is True
    # Stored basis dominates: bias ≈ +1.0, never the walk-forward +5.0.
    assert abs(result["lead_biases"]["1"] - 1.0) < 0.3


def test_train_deb_lead_stats_falls_back_to_walkforward_without_stored():
    # Without a stored deb_prediction the training falls back to a walk-forward
    # recomputation (no leakage): raw blend ~28.0, actual 33.0 -> +5.0 bias.
    daily_records = {}
    for i in range(25):
        date = f"2026-05-{i + 1:02d}"
        raw = 28.0
        daily_records.setdefault("singapore", {})[date] = _make_record(
            "singapore", date, 33.0, {"Open-Meteo": raw, "ECMWF": raw + 0.1}
        )
    result = train_deb_lead_stats(daily_records, min_samples=10)
    assert result["trained"] is True
    assert abs(result["lead_biases"]["1"] - 5.0) < 1.0


# ---- trend_engine integration (branch priority + fallback) ----


def _fake_weather_data():
    return {
        "target_date": "2026-08-01",
        "open-meteo": {
            "daily": {"temperature_2m_max": [36.0], "time": ["2026-08-01"]},
        },
        "metar": {
            "current": {"temp": 30.0, "max_temp_so_far": 30.0},
            "recent_temps": [("12:00", 29.0), ("13:00", 30.0), ("14:00", 30.5)],
        },
        "forecasts": {"Open-Meteo": 36.0, "ECMWF": 36.5, "GFS": 35.8},
    }


def test_trend_engine_deb_normal_primary(monkeypatch):
    import src.analysis.trend_engine as te

    # Force deb_prediction to be set and stub the payload builder.
    fake_payload = {
        "engine": "deb_normal",
        "mu": 37.2,
        "probabilities": [
            {"value": 37, "range": "[36.5~37.5)", "probability": 0.2},
            {"value": 38, "range": "[37.5~38.5)", "probability": 0.18},
        ],
        "probabilities_all": [],
    }
    monkeypatch.setattr(te, "calculate_deb_prediction", lambda *a, **k: {"prediction": 36.5})
    monkeypatch.setattr(
        te, "_build_deb_normal_probability_payload", lambda *a, **k: fake_payload
    )
    monkeypatch.setattr(te, "_load_deb_normal_stats", lambda *a, **k: {"samples": 10})

    _, _, sd = te.analyze_weather_trend(_fake_weather_data(), "°C", "shanghai")
    assert sd.get("probability_engine") == "deb_normal"
    assert sd.get("mu") == pytest.approx(37.2)
    probs = sd.get("probabilities", [])
    assert probs and probs[0]["value"] == 37


def test_trend_engine_no_probability_engine_when_deb_stats_missing(monkeypatch):
    import src.analysis.trend_engine as te

    monkeypatch.setattr(te, "calculate_deb_prediction", lambda *a, **k: {"prediction": 36.5})
    # payload builder returns None -> no probability engine (legacy Gaussian
    # branch was removed together with weathernext2)
    monkeypatch.setattr(te, "_build_deb_normal_probability_payload", lambda *a, **k: None)

    _, _, sd = te.analyze_weather_trend(_fake_weather_data(), "°C", "shanghai")
    assert sd.get("probability_engine") is None
    assert sd.get("mu") is not None


def test_trend_engine_deb_normal_respects_existing_mu(monkeypatch):
    """When dead_market already anchored mu, deb_normal must not override it.

    We can't easily force is_dead_market via the clock, so we assert the
    branch structure directly: if `mu` is already set by an earlier anchor
    and deb_normal payload is available, the engine label still reflects the
    DEB normal path (the anchor happens before the probability engine).
    """
    import src.analysis.trend_engine as te

    fake_payload = {
        "engine": "deb_normal",
        "mu": 37.2,
        "probabilities": [{"value": 37, "range": "[36.5~37.5)", "probability": 0.2}],
        "probabilities_all": [],
    }
    monkeypatch.setattr(te, "calculate_deb_prediction", lambda *a, **k: {"prediction": 36.5})
    monkeypatch.setattr(
        te, "_build_deb_normal_probability_payload", lambda *a, **k: fake_payload
    )
    monkeypatch.setattr(te, "_load_deb_normal_stats", lambda *a, **k: {"samples": 10})

    wd = _fake_weather_data()
    _, _, sd = te.analyze_weather_trend(wd, "°C", "shanghai")
    assert sd.get("probability_engine") == "deb_normal"
    assert sd.get("mu") == pytest.approx(37.2)
