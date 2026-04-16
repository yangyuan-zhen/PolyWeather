from src.analysis.deb_algorithm import (
    _collapse_forecasts_for_deb,
    calculate_dynamic_weights,
)


def test_deb_collapses_regional_model_families_before_blending():
    collapsed = _collapse_forecasts_for_deb(
        {
            "ECMWF": 20.0,
            "ECMWF AIFS": 20.5,
            "GFS": 19.5,
            "ICON": 21.0,
            "ICON-EU": 21.4,
            "ICON-D2": 21.8,
            "GEM": 18.8,
            "GDPS": 19.0,
            "RDPS": 19.4,
            "HRDPS": 20.2,
            "JMA": 19.8,
        }
    )

    assert collapsed == {
        "ECMWF": 20.0,
        "ECMWF AIFS": 20.5,
        "GFS": 19.5,
        "ICON-D2": 21.8,
        "HRDPS": 20.2,
        "JMA": 19.8,
    }


def test_deb_equal_weight_uses_deduped_family_values(monkeypatch):
    monkeypatch.setattr("src.analysis.deb_algorithm.load_history", lambda _: {})

    blended, info = calculate_dynamic_weights(
        "ankara",
        {
            "ECMWF": 20.0,
            "GFS": 20.0,
            "ICON": 30.0,
            "ICON-EU": 40.0,
            "ICON-D2": 50.0,
        },
    )

    assert blended == 30.0
    assert "家族去重" in info


def test_deb_weighted_path_uses_deduped_family_values(monkeypatch):
    monkeypatch.setattr(
        "src.analysis.deb_algorithm.load_history",
        lambda _: {
            "ankara": {
                "2026-04-14": {
                    "actual_high": 22.0,
                    "forecasts": {
                        "ECMWF": 22.0,
                        "GFS": 21.0,
                        "ICON-D2": 30.0,
                    },
                },
                "2026-04-15": {
                    "actual_high": 23.0,
                    "forecasts": {
                        "ECMWF": 23.0,
                        "GFS": 22.0,
                        "ICON-D2": 31.0,
                    },
                },
            }
        },
    )

    blended, info = calculate_dynamic_weights(
        "ankara",
        {
            "ECMWF": 24.0,
            "GFS": 24.0,
            "ICON": 32.0,
            "ICON-EU": 34.0,
            "ICON-D2": 36.0,
        },
        lookback_days=5,
    )

    assert blended < 30.0
    assert "ICON-D2" in info
    assert "家族去重" in info
