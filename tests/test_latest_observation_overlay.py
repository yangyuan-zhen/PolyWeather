from web.services.latest_observation_overlay import overlay_latest_amsc_observation


def test_overlay_replaces_amos_when_old_local_time_string_looks_later_than_new_utc():
    class FakeDB:
        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "qingdao")
            return {
                "observed_at": "2026-06-14T17:23:00+00:00",
                "fetched_at": "2026-06-14T17:23:30+00:00",
                "station_code": "ZSQD",
                "station_name": "Qingdao Jiaodong",
                "payload": {
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS Qingdao Jiaodong (ZSQD)",
                    "icao": "ZSQD",
                    "temp_c": 18.2,
                    "observation_time": "2026-06-14T17:23:00+00:00",
                    "observation_time_local": "2026-06-15 01:23:00",
                    "runway_obs": {
                        "point_temperatures": [
                            {
                                "runway": "17L/35R",
                                "tdz_temp": 18.0,
                                "mid_temp": 18.2,
                                "end_temp": 18.1,
                            }
                        ],
                    },
                },
            }

    stale_payload = {
        "name": "qingdao",
        "temp_symbol": "C",
        "amos": {
            "source": "amsc_awos",
            "temp_c": 21.0,
            "observation_time": "2026-06-14T10:46:00+00:00",
            "observation_time_local": "2026-06-14 18:46:00",
        },
    }

    result = overlay_latest_amsc_observation(FakeDB(), "qingdao", stale_payload)

    assert result["amos"]["observation_time"] == "2026-06-14T17:23:00+00:00"
    assert result["amos"]["observation_time_local"] == "2026-06-15 01:23:00"
    assert result["amos"]["runway_obs"]["point_temperatures"][0]["runway"] == "17L/35R"
