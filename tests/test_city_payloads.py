from web.services.city_payloads import build_city_summary_payload


def test_city_summary_payload_preserves_deb_metadata():
    payload = build_city_summary_payload(
        {
            "name": "shanghai",
            "display_name": "Shanghai",
            "temp_symbol": "°C",
            "current": {},
            "risk": {},
            "deb": {
                "prediction": 29.7,
                "raw_prediction": 27.6,
                "version": "deb_v1_recent_bias_corrected",
                "bias_adjustment": 1.3,
                "bias_samples": 18,
            },
        }
    )

    assert payload["deb"] == {
        "prediction": 29.7,
        "raw_prediction": 27.6,
        "version": "deb_v1_recent_bias_corrected",
        "bias_adjustment": 1.3,
        "bias_samples": 18,
    }
