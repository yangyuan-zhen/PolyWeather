from src.analysis.deb_hourly_correction import (
    DEB_HOURLY_PEAK_CORRECTED_VERSION,
    build_deb_hourly_path,
    build_hourly_peak_corrector,
)


def test_hourly_peak_corrector_learns_peak_window_shape_from_snapshots():
    snapshots = [
        {
            "city": "ankara",
            "target_date": "2026-05-20",
            "deb_prediction": 30.0,
            "deb_base_path": {
                "times": ["10:00", "12:00", "14:00", "16:00"],
                "temps": [25.0, 27.0, 30.0, 28.0],
            },
            "settlement_today_obs": [
                {"time": "12:00", "temp": 27.5},
                {"time": "14:00", "temp": 32.0},
                {"time": "16:00", "temp": 28.5},
            ],
            "peak": {"first_h": 13, "last_h": 15},
        },
        {
            "city": "ankara",
            "target_date": "2026-05-21",
            "deb_prediction": 29.0,
            "deb_base_path": {
                "times": ["10:00", "12:00", "14:00", "16:00"],
                "temps": [24.0, 26.0, 29.0, 27.0],
            },
            "settlement_today_obs": [
                {"time": "12:00", "temp": 26.5},
                {"time": "14:00", "temp": 31.0},
                {"time": "16:00", "temp": 27.5},
            ],
            "peak": {"first_h": 13, "last_h": 15},
        },
    ]

    corrector = build_hourly_peak_corrector(snapshots, min_samples=2)
    result = corrector.apply(
        "ankara",
        ["10:00", "12:00", "14:00", "16:00"],
        [24.0, 26.0, 29.0, 27.0],
        peak_first_h=13,
        peak_last_h=15,
        deb_prediction=30.0,
    )

    assert result["version"] == DEB_HOURLY_PEAK_CORRECTED_VERSION
    assert result["samples"] == 6
    assert result["temps"][2] == 30.0
    assert result["temps"][1] < result["temps"][2]
    assert result["temps"][3] < result["temps"][2]
    assert result["phase_adjustments"]["peak_window"]["samples"] == 2


def test_build_deb_hourly_path_anchors_corrected_curve_to_deb_prediction():
    corrector = build_hourly_peak_corrector(
        [
            {
                "city": "shanghai",
                "target_date": "2026-05-20",
                "deb_base_path": {
                    "times": ["10:00", "14:00", "18:00"],
                    "temps": [25.0, 28.0, 24.0],
                },
                "settlement_today_obs": [
                    {"time": "10:00", "temp": 24.0},
                    {"time": "14:00", "temp": 30.0},
                    {"time": "18:00", "temp": 23.0},
                ],
                "peak": {"first_h": 13, "last_h": 15},
            },
            {
                "city": "shanghai",
                "target_date": "2026-05-21",
                "deb_base_path": {
                    "times": ["10:00", "14:00", "18:00"],
                    "temps": [26.0, 29.0, 25.0],
                },
                "settlement_today_obs": [
                    {"time": "10:00", "temp": 25.0},
                    {"time": "14:00", "temp": 31.0},
                    {"time": "18:00", "temp": 24.0},
                ],
                "peak": {"first_h": 13, "last_h": 15},
            },
        ],
        min_samples=2,
    )

    path = build_deb_hourly_path(
        city="shanghai",
        hourly_times=["10:00", "14:00", "18:00"],
        hourly_temps=[24.0, 28.0, 23.0],
        deb_prediction=29.0,
        peak_first_h=13,
        peak_last_h=15,
        corrector=corrector,
    )

    assert path["source"] == DEB_HOURLY_PEAK_CORRECTED_VERSION
    assert path["base_source"] == "hourly_plus_deb_offset"
    assert max(path["temps"]) == 29.0
    assert path["temps"][1] == 29.0
    assert path["temps"][0] < 25.5
    assert path["correction"]["samples"] == 6


def test_build_deb_hourly_path_preserves_consensus_base_source():
    corrector = build_hourly_peak_corrector([], min_samples=2)

    path = build_deb_hourly_path(
        city="wuhan",
        hourly_times=["09:00", "15:00"],
        hourly_temps=[24.0, 30.0],
        deb_prediction=30.0,
        peak_first_h=15,
        peak_last_h=15,
        corrector=corrector,
        base_source="deb_hourly_consensus",
    )

    assert path["base_source"] == "deb_hourly_consensus"
    assert path["temps"] == [24.0, 30.0]
