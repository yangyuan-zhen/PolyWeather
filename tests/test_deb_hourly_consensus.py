from src.analysis.deb_hourly_consensus import (
    DEB_HOURLY_CONSENSUS_VERSION,
    build_deb_hourly_consensus_path,
)


def test_deb_hourly_consensus_uses_deb_weights_and_anchors_to_daily_prediction(monkeypatch):
    monkeypatch.setattr(
        "src.analysis.deb_algorithm.load_history",
        lambda _: {
            "wuhan": {
                "2026-05-20": {
                    "actual_high": 31.0,
                    "forecasts": {"ECMWF": 31.0, "GFS": 35.0, "ICON": 28.0},
                },
                "2026-05-21": {
                    "actual_high": 32.0,
                    "forecasts": {"ECMWF": 32.0, "GFS": 36.0, "ICON": 29.0},
                },
            }
        },
    )

    path = build_deb_hourly_consensus_path(
        city="wuhan",
        hourly_times=[
            "2026-05-28T09:00",
            "2026-05-28T12:00",
            "2026-05-28T15:00",
            "2026-05-28T18:00",
        ],
        hourly_forecasts={
            "ECMWF": [25.0, 29.0, 31.0, 27.0],
            "GFS": [25.0, 31.0, 35.0, 29.0],
            "ICON": [24.0, 27.0, 28.0, 26.0],
        },
        daily_forecasts={"ECMWF": 31.0, "GFS": 35.0, "ICON": 28.0},
        deb_prediction=30.0,
        local_date="2026-05-28",
    )

    assert path["version"] == DEB_HOURLY_CONSENSUS_VERSION
    assert path["times"] == ["09:00", "12:00", "15:00", "18:00"]
    assert max(path["temps"]) == 30.0
    assert path["temps"].index(30.0) == 2
    assert path["weights"]["ECMWF"] > path["weights"]["GFS"]
    assert path["weights"]["ECMWF"] > path["weights"]["ICON"]
    assert path["base_source"] == "multi_model_hourly_deb_weights"


def test_deb_hourly_consensus_filters_to_city_local_date(monkeypatch):
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", lambda _: {})

    path = build_deb_hourly_consensus_path(
        city="wuhan",
        hourly_times=[
            "2026-05-27T15:00",
            "2026-05-28T09:00",
            "2026-05-28T15:00",
            "2026-05-29T09:00",
        ],
        hourly_forecasts={
            "ECMWF": [40.0, 24.0, 30.0, 41.0],
            "GFS": [40.0, 25.0, 31.0, 41.0],
        },
        daily_forecasts={"ECMWF": 30.0, "GFS": 31.0},
        deb_prediction=30.0,
        local_date="2026-05-28",
    )

    assert path["times"] == ["09:00", "15:00"]
    assert path["temps"] == [24.0, 30.0]
