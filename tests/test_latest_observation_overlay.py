import web.services.latest_observation_overlay as observation_overlay
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
    runway_writes = []

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

        def append_runway_obs(self, **kwargs):
            runway_writes.append(kwargs)

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
    assert [(row["icao"], row["runway"], row["otime_utc"]) for row in runway_writes] == [
        ("ZUUU", "02L/20R", "2026-06-15T10:51:00+00:00"),
        ("ZUUU", "02R/20L", "2026-06-15T10:51:00+00:00"),
    ]
    assert runway_writes[0]["target_runway_max"] == 28.4


def test_overlay_builds_amsc_runway_history_from_raw_store():
    def raw_row(observed_at, temp):
        return {
            "observed_at": observed_at,
            "payload": {
                "source": "amsc_awos",
                "icao": "ZUUU",
                "temp_c": temp,
                "observation_time": observed_at,
                "runway_obs": {
                    "point_temperatures": [
                        {
                            "runway": "02L/20R",
                            "target_runway_max": temp,
                        },
                    ],
                },
            },
        }

    class FakeDB:
        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "chengdu")
            return raw_row("2026-06-15T11:08:00+00:00", 25.4)

        def list_raw_observation_history(self, source, city, *, minutes=60, limit=1000):
            assert (source, city) == ("amsc_awos", "chengdu")
            return [
                raw_row("2026-06-15T11:04:00+00:00", 25.6),
                raw_row("2026-06-15T11:08:00+00:00", 25.4),
            ]

    result = overlay_latest_amsc_observation(
        FakeDB(),
        "chengdu",
        {
            "name": "chengdu",
            "temp_symbol": "°C",
            "runway_plate_history": {
                "02L/20R": [{"time": "2026-06-12T10:44:00+00:00", "temp": 31.6}],
            },
        },
    )

    assert result["runway_plate_history"]["02L/20R"] == [
        {"time": "2026-06-15T11:04:00+00:00", "temp": 25.6},
        {"time": "2026-06-15T11:08:00+00:00", "temp": 25.4},
    ]


def test_overlay_skips_raw_store_when_runway_history_already_has_points():
    existing_points = [
        {"time": f"2026-06-15T{hour:02d}:00:00+00:00", "temp": 25.0 + hour / 10}
        for hour in range(0, 15)
        for _ in range(2)
    ]

    class FakeDB:
        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "chengdu")
            return {
                "observed_at": "2026-06-15T14:30:00+00:00",
                "station_code": "ZUUU",
                "payload": {
                    "source": "amsc_awos",
                    "icao": "ZUUU",
                    "temp_c": 25.4,
                    "observation_time": "2026-06-15T14:30:00+00:00",
                    "runway_obs": {
                        "point_temperatures": [
                            {
                                "runway": "02L/20R",
                                "target_runway_max": 25.4,
                            },
                        ],
                    },
                },
            }

        def list_raw_observation_history(self, source, city, *, minutes=60, limit=1000):
            raise AssertionError("raw store history should not be read for populated runway history")

    result = overlay_latest_amsc_observation(
        FakeDB(),
        "chengdu",
        {
            "name": "chengdu",
            "temp_symbol": "°C",
            "runway_plate_history": {
                "02L/20R": existing_points,
            },
        },
    )

    assert result["runway_plate_history"]["02L/20R"][-1] == {
        "time": "2026-06-15T14:30:00+00:00",
        "temp": 25.4,
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


def test_overlay_latest_jma_resets_stale_tokyo_detail_to_latest_local_day():
    class FakeWeather:
        def fetch_jma_amedas_official_nearby(self, city, use_fahrenheit=False):
            assert (city, use_fahrenheit) == ("tokyo", False)
            return [
                {
                    "station_label": "羽田 10分实况 (JMA)",
                    "temp": 24.0,
                    "icao": "44166",
                    "source": "jma",
                    "source_label": "JMA",
                    "obs_time": "2026-06-16T06:00:00+09:00",
                }
            ]

    stale_payload = {
        "name": "tokyo",
        "display_name": "Tokyo",
        "temp_symbol": "°C",
        "local_date": "2026-06-14",
        "local_time": "19:00",
        "current": {
            "temp": 23.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "airport_current": {
            "temp": 23.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "airport_primary": {
            "temp": 23.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "overview": {
            "local_date": "2026-06-14",
            "local_time": "19:00",
            "current_temp": 23.0,
        },
        "metar_today_obs": [
            {"time": "00:00", "temp": 23.0},
            {"time": "17:00", "temp": 25.0},
        ],
        "timeseries": {
            "metar_today_obs": [
                {"time": "00:00", "temp": 23.0},
                {"time": "17:00", "temp": 25.0},
            ],
        },
    }

    assert hasattr(observation_overlay, "overlay_latest_jma_amedas_observation")

    result = observation_overlay.overlay_latest_jma_amedas_observation(
        FakeWeather(),
        "tokyo",
        stale_payload,
    )

    assert result["local_date"] == "2026-06-16"
    assert result["local_time"] == "06:00"
    assert result["current"]["temp"] == 24.0
    assert result["current"]["source_code"] == "jma_amedas"
    assert result["airport_current"]["obs_time"] == "2026-06-16T06:00:00+09:00"
    assert result["airport_primary"]["station_code"] == "44166"
    assert result["overview"]["local_date"] == "2026-06-16"
    assert result["overview"]["current_temp"] == 24.0
    assert result["metar_today_obs"] == [
        {
            "time": "06:00",
            "temp": 24.0,
            "obs_time": "2026-06-16T06:00:00+09:00",
            "source_code": "jma_amedas",
            "source_label": "JMA",
        }
    ]
    assert result["timeseries"]["metar_today_obs"] == result["metar_today_obs"]


def test_overlay_latest_jma_does_not_downgrade_newer_payload_current():
    class FakeWeather:
        def fetch_jma_amedas_official_nearby(self, city, use_fahrenheit=False):
            return [
                {
                    "station_label": "羽田 10分实况 (JMA)",
                    "temp": 24.0,
                    "icao": "44166",
                    "source": "jma",
                    "source_label": "JMA",
                    "obs_time": "2026-06-16T06:00:00+09:00",
                }
            ]

    payload = {
        "name": "tokyo",
        "local_date": "2026-06-16",
        "local_time": "07:00",
        "current": {
            "temp": 25.0,
            "source_code": "jma_amedas",
            "obs_time": "2026-06-16T07:00:00+09:00",
        },
    }

    result = observation_overlay.overlay_latest_jma_amedas_observation(
        FakeWeather(),
        "tokyo",
        payload,
    )

    assert result is payload
    assert result["current"]["temp"] == 25.0
    assert result["local_time"] == "07:00"


def test_non_amsc_raw_overlays_keep_their_source_codes():
    cases = [
        (
            "amos",
            observation_overlay.overlay_latest_amos_observation,
            "seoul",
            {
                "observed_at": "2026-06-16T06:03:00+09:00",
                "fetched_at": "2026-06-15T21:03:30+00:00",
                "station_code": "RKSS",
                "station_name": "Gimpo",
                "payload": {
                    "source": "amos",
                    "source_label": "AMOS",
                    "icao": "RKSS",
                    "temp": 22.4,
                    "observation_time": "2026-06-16T06:03:00+09:00",
                },
            },
        ),
        (
            "hko_obs",
            observation_overlay.overlay_latest_hko_observation,
            "hong kong",
            {
                "observed_at": "2026-06-16T05:55:00+08:00",
                "fetched_at": "2026-06-15T21:55:30+00:00",
                "station_code": "HKO",
                "station_name": "Hong Kong Observatory",
                "payload": {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "station_code": "HKO",
                    "station_label": "Hong Kong Observatory",
                    "temp": 28.6,
                    "obs_time": "2026-06-16T05:55:00+08:00",
                },
            },
        ),
        (
            "mgm",
            observation_overlay.overlay_latest_mgm_observation,
            "ankara",
            {
                "observed_at": "2026-06-16T00:10:00+03:00",
                "fetched_at": "2026-06-15T21:10:30+00:00",
                "station_code": "17130",
                "station_name": "Ankara",
                "payload": {
                    "source": "mgm",
                    "source_label": "MGM",
                    "icao": "17130",
                    "station_label": "Ankara (Bölge/Center)",
                    "temp": 25.3,
                    "obs_time": "2026-06-16T00:10:00+03:00",
                },
            },
        ),
    ]

    for source_code, overlay_fn, city, row in cases:
        class FakeDB:
            def get_latest_raw_observation(self, source, requested_city):
                assert (source, requested_city) == (source_code, city)
                return row

        result = overlay_fn(
            FakeDB(),
            city,
            {
                "name": city,
                "temp_symbol": "°C",
                "current": {
                    "temp": 19.0,
                    "source_code": "metar",
                    "obs_time": "2026-06-15T00:00:00+00:00",
                },
                "airport_current": {
                    "temp": 19.0,
                    "source_code": "metar",
                    "obs_time": "2026-06-15T00:00:00+00:00",
                },
            },
        )

        assert result["current"]["source_code"] == source_code
        assert result["airport_current"]["source_code"] == source_code
        assert result["current"]["source_label"] == row["payload"]["source_label"]
        assert result["current"].get("settlement_source") != "amsc_awos"
        assert result["canonical_temperature"]["source"] == source_code


def test_overlay_latest_cwa_resets_stale_taipei_detail_to_latest_local_day():
    class FakeWeather:
        def fetch_cwa_taipei_settlement_current(self):
            return {
                "source": "cwa",
                "source_label": "CWA",
                "station_code": "466920",
                "station_name": "臺北",
                "observation_time": "2026-06-16T15:30:00+08:00",
                "current": {
                    "temp": 29.4,
                    "max_temp_so_far": 31.0,
                },
            }

    stale_payload = {
        "name": "taipei",
        "display_name": "Taipei",
        "temp_symbol": "°C",
        "local_date": "2026-06-14",
        "local_time": "18:00",
        "current": {
            "temp": 24.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "airport_current": {
            "temp": 24.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "airport_primary": {
            "temp": 24.0,
            "source_code": "metar",
            "obs_time": "2026-06-14T10:00:00+00:00",
        },
        "overview": {
            "local_date": "2026-06-14",
            "local_time": "18:00",
            "current_temp": 24.0,
        },
        "metar_today_obs": [
            {"time": "18:00", "temp": 24.0},
        ],
        "timeseries": {
            "metar_today_obs": [
                {"time": "18:00", "temp": 24.0},
            ],
        },
    }

    result = observation_overlay.overlay_latest_cwa_observation(
        FakeWeather(),
        "taipei",
        stale_payload,
    )

    assert result["local_date"] == "2026-06-16"
    assert result["local_time"] == "15:30"
    assert result["current"]["temp"] == 29.4
    assert result["current"]["source_code"] == "cwa"
    assert result["airport_current"]["obs_time"] == "2026-06-16T15:30:00+08:00"
    assert result["overview"]["local_date"] == "2026-06-16"
    assert result["overview"]["current_temp"] == 29.4
    assert result["metar_today_obs"] == [
        {
            "time": "15:30",
            "temp": 29.4,
            "obs_time": "2026-06-16T15:30:00+08:00",
            "source_code": "cwa",
            "source_label": "CWA",
        }
    ]
    assert result["timeseries"]["metar_today_obs"] == result["metar_today_obs"]
