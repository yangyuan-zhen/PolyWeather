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


def test_overlay_appends_latest_amsc_points_to_runway_history():
    class FakeDB:
        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "chengdu")
            return {
                "observed_at": "2026-06-15T10:51:00+00:00",
                "fetched_at": "2026-06-15T10:51:30+00:00",
                "station_code": "ZUUU",
                "station_name": "Chengdu Shuangliu",
                "payload": {
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS Chengdu Shuangliu (ZUUU)",
                    "icao": "ZUUU",
                    "temp_c": 28.4,
                    "observation_time": "2026-06-15T10:51:00+00:00",
                    "observation_time_local": "2026-06-15 18:51:00",
                    "runway_obs": {
                        "point_temperatures": [
                            {
                                "runway": "02L/20R",
                                "tdz_temp": 28.4,
                                "end_temp": 28.2,
                                "target_runway_max": 28.4,
                            },
                            {
                                "runway": "02R/20L",
                                "tdz_temp": 28.1,
                                "end_temp": 28.0,
                                "target_runway_max": 28.1,
                            },
                        ],
                    },
                },
            }

    stale_payload = {
        "name": "chengdu",
        "temp_symbol": "°C",
        "runway_plate_history": {
            "02L/20R": [{"time": "2026-06-14T10:44:00+00:00", "temp": 31.6}],
        },
        "amos": {
            "source": "amsc_awos",
            "observation_time": "2026-06-14T10:44:00+00:00",
        },
    }

    result = overlay_latest_amsc_observation(FakeDB(), "chengdu", stale_payload)

    assert result["runway_plate_history"]["02L/20R"][-1] == {
        "time": "2026-06-15T10:51:00+00:00",
        "temp": 28.4,
    }
    assert result["runway_plate_history"]["02R/20L"][-1] == {
        "time": "2026-06-15T10:51:00+00:00",
        "temp": 28.1,
    }


def test_overlay_uses_latest_success_when_newer_status_row_has_no_observation():
    class FakeDB:
        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "chengdu")
            return {
                "status": "no_results",
                "observed_at": "",
                "fetched_at": "2026-06-14T17:02:09+00:00",
                "updated_at_ts": 1781456529.0,
                "payload": {
                    "source": "amsc_awos",
                    "city": "chengdu",
                    "status": "no_results",
                    "error": "source returned no observation rows",
                },
            }

        def list_latest_raw_observations_for_city(self, city, *, limit=100):
            assert city == "chengdu"
            return [
                self.get_latest_raw_observation("amsc_awos", "chengdu"),
                {
                    "source": "amsc_awos",
                    "city": "chengdu",
                    "station_code": "ZUUU",
                    "station_name": "Chengdu Shuangliu",
                    "status": "ok",
                    "observed_at": "2026-06-14T17:00:00+00:00",
                    "fetched_at": "2026-06-14T17:00:30+00:00",
                    "updated_at_ts": 1781456430.0,
                    "payload": {
                        "source": "amsc_awos",
                        "source_label": "AMSC AWOS Chengdu Shuangliu (ZUUU)",
                        "icao": "ZUUU",
                        "temp_c": 25.8,
                        "observation_time": "2026-06-14T17:00:00+00:00",
                        "observation_time_local": "2026-06-15 01:00:00",
                    },
                },
            ]

    result = overlay_latest_amsc_observation(
        FakeDB(),
        "chengdu",
        {"name": "chengdu", "temp_symbol": "°C", "amos": {}},
    )

    assert result["amos"]["temp_c"] == 25.8
    assert result["current"]["temp"] == 25.8
    assert result["airport_current"]["source_code"] == "amsc_awos"
