def test_source_adapter_normalizes_amsc_awos_payload_to_observation_record():
    from web.services.observation_source_adapters import collect_observation_source

    calls = []

    class FakeWeather:
        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            calls.append((city, use_fahrenheit))
            results["amos"] = {
                "source": "amsc_awos",
                "source_label": "AMSC AWOS",
                "temp_c": "24.3",
                "observation_time": "2026-06-14T01:00:00+00:00",
                "observation_time_local": "2026-06-14 09:00",
                "icao": "ZSQD",
                "station_label": "Qingdao Jiaodong",
                "runway": "17L",
            }

    result = collect_observation_source(
        FakeWeather(),
        "AMSC_AWOS",
        "Qingdao",
        use_fahrenheit=False,
    )

    assert calls == [("qingdao", False)]
    assert result.source == "amsc_awos"
    assert result.city == "qingdao"
    assert result.status == "ok"
    assert result.error == ""
    assert len(result.records) == 1

    record = result.records[0]
    assert record.source == "amsc_awos"
    assert record.city == "qingdao"
    assert record.value == 24.3
    assert record.observed_at == "2026-06-14T01:00:00+00:00"
    assert record.observed_at_local == "2026-06-14 09:00"
    assert record.station_code == "ZSQD"
    assert record.station_name == "Qingdao Jiaodong"
    assert record.runway == "17L"
    assert record.value_unit == "c"
    assert record.source_label == "AMSC AWOS"
    assert record.payload["temp_c"] == "24.3"


def test_source_adapter_flattens_nearby_source_lists():
    from web.services.observation_source_adapters import collect_observation_source

    class FakeWeather:
        def _attach_hko_obs_official_nearby(self, results, city, use_fahrenheit):
            results["hko_obs_nearby"] = [
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 28.1,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "LFS",
                    "station_name": "Lau Fau Shan",
                },
                {
                    "source": "hko_obs",
                    "source_label": "HKO",
                    "temperature_c": 27.6,
                    "observation_time": "2026-06-14T01:00:00+00:00",
                    "station_code": "HKO",
                    "station_name": "Hong Kong Observatory",
                },
            ]

    result = collect_observation_source(
        FakeWeather(),
        "hko_obs",
        "shenzhen",
        use_fahrenheit=False,
    )

    assert result.status == "ok"
    assert [record.station_code for record in result.records] == ["LFS", "HKO"]
    assert [record.value for record in result.records] == [28.1, 27.6]


def test_source_adapter_reports_parse_error_for_unusable_source_rows():
    from web.services.observation_source_adapters import collect_observation_source

    class FakeWeather:
        def _attach_china_amsc_awos_data(self, results, city, use_fahrenheit):
            results["bad"] = {
                "source": "amsc_awos",
                "observation_time": "2026-06-14T01:00:00+00:00",
                "icao": "ZSQD",
            }

    result = collect_observation_source(
        FakeWeather(),
        "amsc_awos",
        "qingdao",
        use_fahrenheit=False,
    )

    assert result.status == "parse_error"
    assert result.error == "source response had no usable temperature"
    assert result.records == ()


def test_source_adapter_reports_unsupported_source_without_calling_weather():
    from web.services.observation_source_adapters import collect_observation_source

    result = collect_observation_source(
        object(),
        "unknown_source",
        "qingdao",
        use_fahrenheit=False,
    )

    assert result.status == "unsupported"
    assert result.error == "unsupported observation source"
    assert result.records == ()
