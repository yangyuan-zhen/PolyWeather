from scripts.fit_probability_calibration import _extract_samples


def test_extract_samples_prefers_snapshot_rows_for_same_city_day():
    history = {
        "ankara": {
            "2026-03-19": {
                "actual_high": 11.0,
                "mu": 10.8,
                "deb_prediction": 10.9,
                "forecasts": {"ECMWF": 10.5, "GFS": 11.2},
                "probability_features": {
                    "ens_median": 10.7,
                    "ensemble_spread": 0.8,
                    "peak_status": "before",
                },
            }
        }
    }
    snapshot_rows = [
        {
            "city": "ankara",
            "date": "2026-03-19",
            "timestamp": "2026-03-19T12:00:00+03:00",
            "raw_mu": 11.2,
            "raw_sigma": 1.1,
            "deb_prediction": 11.0,
            "ensemble": {"p10": 10.0, "median": 11.1, "p90": 12.2},
            "multi_model": {"ECMWF": 10.5, "GFS": 11.2},
            "max_so_far": 10.9,
            "peak_status": "in_window",
        }
    ]
    truth_history = {
        "ankara": {
            "2026-03-19": {
                "actual_high": 11.0,
                "settlement_source": "metar",
                "settlement_station_code": "LTAC",
                "truth_version": "v1",
                "updated_by": "test",
                "truth_updated_at": 123.0,
            }
        }
    }

    samples, filled = _extract_samples(
        history,
        truth_history=truth_history,
        settlement_history={},
        snapshot_rows=snapshot_rows,
    )

    assert filled == 0
    assert len(samples) == 1
    assert samples[0]["sample_source"] == "snapshot"
    assert samples[0]["raw_mu"] == 11.2
    assert samples[0]["peak_flag"] == 0.5
    assert samples[0]["settlement_source"] == "metar"
    assert samples[0]["settlement_station_code"] == "LTAC"
    assert samples[0]["truth_version"] == "v1"
