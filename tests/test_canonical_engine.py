def test_canonical_engine_prefers_settlement_station_over_later_nearby_row():
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    canonical = build_canonical_temperature_from_observations(
        "shenzhen",
        [
            {
                "source": "hko_obs",
                "city": "shenzhen",
                "station_code": "HKO",
                "station_name": "Hong Kong Observatory",
                "value": 27.6,
                "value_unit": "c",
                "observed_at": "2026-06-14T01:00:00+00:00",
                "fetched_at": "2026-06-14T01:05:00+00:00",
                "status": "ok",
                "payload": {"source_label": "HKO"},
                "updated_at_ts": 2000.0,
            },
            {
                "source": "hko_obs",
                "city": "shenzhen",
                "station_code": "LFS",
                "station_name": "Lau Fau Shan",
                "value": 28.1,
                "value_unit": "c",
                "observed_at": "2026-06-14T01:00:00+00:00",
                "fetched_at": "2026-06-14T01:05:00+00:00",
                "status": "ok",
                "payload": {"source_label": "HKO"},
                "updated_at_ts": 1000.0,
            },
        ],
    )

    assert canonical is not None
    assert canonical["city"] == "shenzhen"
    assert canonical["value"] == 28.1
    assert canonical["source"] == "hko_obs"
    assert canonical["source_role"] == "settlement_official"
    assert canonical["station_code"] == "LFS"
    assert canonical["station_name"] == "Lau Fau Shan"
    assert canonical["freshness_status"] == "fresh"
    assert canonical["freshness_sec"] == 300


def test_canonical_engine_ignores_failed_latest_rows():
    from web.services.canonical_engine import build_canonical_temperature_from_observations

    canonical = build_canonical_temperature_from_observations(
        "qingdao",
        [
            {
                "source": "amsc_awos",
                "city": "qingdao",
                "station_code": "ZSQD",
                "value": None,
                "value_unit": "c",
                "observed_at": "",
                "fetched_at": "2026-06-14T01:05:00+00:00",
                "status": "timeout",
                "payload": {"error": "timeout"},
                "updated_at_ts": 2000.0,
            },
            {
                "source": "madis_hfmetar",
                "city": "qingdao",
                "station_code": "ZSQD",
                "station_name": "Qingdao Jiaodong",
                "value": 24.0,
                "value_unit": "c",
                "observed_at": "2026-06-14T01:00:00+00:00",
                "fetched_at": "2026-06-14T01:05:00+00:00",
                "status": "ok",
                "payload": {"source_label": "MADIS HFMETAR"},
                "updated_at_ts": 1000.0,
            },
        ],
    )

    assert canonical is not None
    assert canonical["source"] == "madis_hfmetar"
    assert canonical["value"] == 24.0


def test_canonical_engine_builds_realtime_event_from_canonical():
    from web.services.canonical_engine import build_realtime_event_from_canonical

    event = build_realtime_event_from_canonical(
        {
            "city": "shenzhen",
            "value": 28.1,
            "temp_symbol": "°C",
            "source": "hko_obs",
            "station_code": "LFS",
            "station_name": "Lau Fau Shan",
            "observed_at": "2026-06-14T01:00:00+00:00",
            "freshness_sec": 300,
            "freshness_status": "fresh",
            "confidence": 0.9,
        }
    )

    assert event is not None
    assert event["type"] == "city_observation_patch.v1"
    assert event["city"] == "shenzhen"
    assert event["source"] == "hko_obs"
    assert event["obs_time"] == "2026-06-14T01:00:00Z"
    assert event["payload"]["temp"] == 28.1
    assert event["payload"]["station_code"] == "LFS"
    assert event["payload"]["station_label"] == "Lau Fau Shan"
    assert event["payload"]["unit"] == "celsius"
    assert event["payload"]["freshness_status"] == "fresh"
    assert event["payload"]["confidence"] == 0.9
