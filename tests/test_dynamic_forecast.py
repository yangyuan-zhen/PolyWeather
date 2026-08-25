"""Tests for the dynamic intraday forecast adjustment (src/analysis/dynamic_forecast.py)."""

from src.analysis.dynamic_forecast import (
    apply_dynamic_forecast,
    build_dynamic_forecast_payload,
    compute_trend_rate,
    weather_suppression_factor,
)


def _payload(mu=30.0, lo=26, hi=34, sigma=1.0):
    """Uniform-ish normal payload for tests."""
    import math

    def bucket_prob(tau):
        return 0.5 * (
            math.erf((tau + 0.5 - mu) / (sigma * math.sqrt(2)))
            - math.erf((tau - 0.5 - mu) / (sigma * math.sqrt(2)))
        )

    all_buckets = [
        {"value": tau, "probability": round(bucket_prob(tau), 4)}
        for tau in range(lo, hi + 1)
    ]
    total = sum(b["probability"] for b in all_buckets)
    for b in all_buckets:
        b["probability"] = round(b["probability"] / total, 4)
    top = sorted(all_buckets, key=lambda x: x["probability"], reverse=True)[:4]
    return {"engine": "deb_normal", "mu": mu, "sigma": sigma, "probabilities": top, "probabilities_all": all_buckets}


# ── hard floor ──


def test_hard_floor_zeroes_buckets_below_observed_high():
    payload = _payload(mu=31.0)
    # max_so_far=31 -> floor_tau=31; buckets 26..30 must vanish.
    out = apply_dynamic_forecast(payload, max_so_far=31.0, trend_rate_c_per_hour=None,
                                 hours_to_peak=None, suppression_factor=None)
    values = [b["value"] for b in out["probabilities_all"]]
    assert all(v >= 31 for v in values), f"buckets below floor survived: {values}"
    total = sum(b["probability"] for b in out["probabilities_all"])
    assert abs(total - 1.0) < 0.01
    assert any("hard_floor>=31" in n for n in out.get("dynamic_notes", []))


def test_hard_floor_redistributes_mass_to_floor_bucket():
    payload = _payload(mu=33.0, lo=28, hi=38)
    out = apply_dynamic_forecast(payload, max_so_far=32.0, trend_rate_c_per_hour=None,
                                 hours_to_peak=None, suppression_factor=None)
    floor_bucket = next(b for b in out["probabilities_all"] if b["value"] == 32)
    below = [b for b in out["probabilities_all"] if b["value"] < 32]
    assert not below
    # Floor bucket should now hold meaningful probability after redistribution.
    assert floor_bucket["probability"] > 0.05


# ── trend rate ──


def test_compute_trend_rate_warming_slope():
    from datetime import datetime, timezone
    obs = [{"time": "13:00", "temp": 29.0}, {"time": "14:00", "temp": 30.5}]
    rate = compute_trend_rate(obs, now_utc=datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc))
    assert rate is not None and rate == 1.5


def test_compute_trend_rate_rejects_stale_window():
    obs = [{"time": "09:00", "temp": 25.0}, {"time": "14:00", "temp": 30.0}]
    assert compute_trend_rate(obs) is None


def test_trend_shift_moves_mu_up_when_warming():
    payload = _payload(mu=30.0)
    out = apply_dynamic_forecast(payload, max_so_far=None, trend_rate_c_per_hour=2.0,
                                 hours_to_peak=1.0, suppression_factor=None)
    assert out["mu"] == 31.0  # 2 deg/h * 1h * 0.5 damping
    assert any("trend_shift" in n for n in out.get("dynamic_notes", []))


# ── weather suppression ──


def test_weather_suppression_rain_compresses_upside():
    payload = _payload(mu=31.0)
    before_upside = sum(b["probability"] for b in payload["probabilities_all"] if b["value"] > 31.5)
    out = apply_dynamic_forecast(payload, max_so_far=None, trend_rate_c_per_hour=None,
                                 hours_to_peak=None, suppression_factor=0.70)
    after_upside = sum(b["probability"] for b in out["probabilities_all"] if b["value"] > 31.5)
    assert after_upside < before_upside * 0.85


def test_suppression_factor_detects_thunderstorm():
    factor = weather_suppression_factor("TSRA", cloud_cover=None, taf_signal=None)
    assert factor is not None and factor <= 0.60


def test_suppression_factor_none_for_clear_sky():
    assert weather_suppression_factor("SKC", cloud_cover=None, taf_signal=None) is None


def test_suppression_factor_thick_cloud():
    factor = weather_suppression_factor("", cloud_cover=7, taf_signal=None)
    assert factor is not None and factor <= 0.90


# ── wrapper ──


def test_build_dynamic_payload_end_to_end():
    payload = _payload(mu=31.0)
    out = build_dynamic_forecast_payload(
        payload,
        max_so_far=31.0,
        metar_today_obs=[{"time": "13:00", "temp": 30.0}, {"time": "14:00", "temp": 31.0}],
        wx_desc="-RA",
        peak_first_hour=14,
        peak_last_hour=16,
        local_hour=12,
    )
    assert out is not None
    assert out.get("dynamic_adjusted") is True
    values = [b["value"] for b in out["probabilities_all"]]
    assert all(v >= 31 for v in values)


def test_build_dynamic_payload_returns_none_without_base():
    assert build_dynamic_forecast_payload(None, max_so_far=30.0) is None


def test_dead_market_short_circuits_adjustment():
    payload = _payload(mu=31.0)
    out = build_dynamic_forecast_payload(
        payload, max_so_far=31.0, metar_today_obs=[{"time": "13:00", "temp": 30.0}],
        wx_desc="TSRA", is_dead_market=True,
    )
    assert out is None or out == payload
