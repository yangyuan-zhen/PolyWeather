
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


def test_source_adapter_collects_mgm_with_keyword_flags_and_station_metadata():
    from web.services.observation_source_adapters import collect_observation_source

    calls = []

    class FakeWeather:
        def _attach_turkish_mgm_data(
            self,
            results,
            city,
            *,
            include_mgm=True,
            include_nearby=True,
        ):
            calls.append((city, include_mgm, include_nearby))
            if not include_mgm:
                return
            results["mgm"] = {
                "source": "mgm",
                "source_label": "MGM",
                "station_code": "17128",
                "station_name": "Esenboga Airport",
                "obs_time": "2026-06-15T14:20:00Z",
                "current": {"temp": 19.0},
            }

    result = collect_observation_source(
        FakeWeather(),
        "mgm",
        "ankara",
        use_fahrenheit=False,
    )

    assert calls == [("ankara", True, True)]
    assert result.status == "ok"
    assert len(result.records) == 1

    record = result.records[0]
    assert record.source == "mgm"
    assert record.source_label == "MGM"
    assert record.value == 19.0
    assert record.observed_at == "2026-06-15T14:20:00Z"
    assert record.station_code == "17128"
    assert record.station_name == "Esenboga Airport"


def test_source_adapter_collects_jma_official_nearby_rows():
    from web.services.observation_source_adapters import collect_observation_source

    calls = []

    class FakeWeather:
        def _attach_japan_official_nearby(self, results, city, use_fahrenheit):
            calls.append((city, use_fahrenheit))
            results["jma_current"] = {
                "source": "jma_amedas",
                "source_label": "JMA",
                "temp": 23.4,
                "obs_time": "2026-06-16T06:00:00+09:00",
                "station_code": "44166",
                "station_name": "Haneda",
            }

    result = collect_observation_source(
        FakeWeather(),
        "jma_amedas",
        "tokyo",
        use_fahrenheit=False,
    )

    assert calls == [("tokyo", False)]
    assert result.status == "ok"
    assert len(result.records) == 1
    assert result.records[0].source == "jma_amedas"
    assert result.records[0].value == 23.4
    assert result.records[0].observed_at == "2026-06-16T06:00:00+09:00"
    assert result.records[0].station_code == "44166"


def test_source_adapter_collects_cwa_direct_settlement_payload():
    from web.services.observation_source_adapters import collect_observation_source

    calls = []

    class FakeWeather:
        def fetch_cwa_taipei_settlement_current(self):
            calls.append("fetch_cwa")
            return {
                "source": "cwa",
                "source_label": "CWA",
                "station_code": "466920",
                "station_name": "Taipei",
                "observation_time": "2026-06-16T06:00:00+08:00",
                "current": {"temp": 29.2},
            }

    result = collect_observation_source(
        FakeWeather(),
        "cwa",
        "taipei",
        use_fahrenheit=False,
    )

    assert calls == ["fetch_cwa"]
    assert result.status == "ok"
    assert result.records[0].source == "cwa"
    assert result.records[0].value == 29.2
    assert result.records[0].observed_at == "2026-06-16T06:00:00+08:00"
    assert result.records[0].station_code == "466920"


def test_source_adapter_collects_metar_for_low_frequency_cities():
    from web.services.observation_source_adapters import collect_observation_source

    calls = []

    class FakeWeather:
        def fetch_metar(self, city, use_fahrenheit=False, utc_offset=0):
            calls.append((city, use_fahrenheit, utc_offset))
            return {
                "source": "metar",
                "icao": "LEMD",
                "station_name": "Madrid Barajas",
                "observation_time": "2026-06-16T12:00:00.000Z",
                "current": {"temp": 28.0},
            }

    result = collect_observation_source(
        FakeWeather(),
        "metar",
        "madrid",
        use_fahrenheit=False,
    )

    assert calls == [("madrid", False, 3600)]
    assert result.status == "ok"
    assert result.records[0].source == "metar"
    assert result.records[0].value == 28.0
    assert result.records[0].observed_at == "2026-06-16T12:00:00.000Z"
    assert result.records[0].station_code == "LEMD"


def test_source_adapter_reports_parse_error_for_unusable_source_rows():
    from web.services.observation_source_adapters import collect_observation_source

    class FakeWeather:
        def _attach_korean_amos_data(self, results, city, use_fahrenheit):
            results["bad"] = {
                "source": "amos",
                "observation_time": "2026-06-14T01:00:00+00:00",
                "icao": "RKSS",
            }

    result = collect_observation_source(
        FakeWeather(),
        "amos",
        "seoul",
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
