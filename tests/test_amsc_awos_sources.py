from src.data_collection.amsc_awos_sources import (
    AmscAwosSourceMixin,
    _amsc_parse_wind_plate_payload,
    _amsc_supported_city_codes,
)


ZBAA_SAMPLE = {
    "code": 200,
    "msg": "操作成功",
    "data": {
        "18R/36L": {
            "RNO": "18R/36L",
            "OTIME": "2026-05-14 17:19:00",
            "TDZ_TEMP": "20.8",
            "MID_TEMP": "-",
            "END_TEMP": "20.8",
            "TDZ_HUMID": "67",
            "END_HUMID": "67",
            "METAR": "METAR ZBAA 141700Z 12003MPS 050V170 7000 NSC 21/15 Q1014 NOSIG=",
        },
        "18L/36R": {
            "RNO": "18L/36R",
            "OTIME": "2026-05-14 17:19:00",
            "TDZ_TEMP": "21.0",
            "MID_TEMP": "-",
            "END_TEMP": "20.4",
            "METAR": "METAR ZBAA 141700Z 12003MPS 050V170 7000 NSC 21/15 Q1014 NOSIG=",
        },
        "19/01": {
            "RNO": "19/01",
            "OTIME": "2026-05-14 17:19:00",
            "TDZ_TEMP": "20.2",
            "MID_TEMP": "-",
            "END_TEMP": "20.2",
            "METAR": "METAR ZBAA 141700Z 12003MPS 050V170 7000 NSC 21/15 Q1014 NOSIG=",
        },
    },
}


def test_parse_wind_plate_payload_normalizes_runway_point_temperatures():
    parsed = _amsc_parse_wind_plate_payload(ZBAA_SAMPLE, city_key="beijing", icao="ZBAA")

    assert parsed["source"] == "amsc_awos"
    assert parsed["source_label"] == "AMSC AWOS Beijing Capital (ZBAA)"
    assert parsed["observation_source_zh"] == "AMSC AWOS 跑道观测气温"
    assert parsed["icao"] == "ZBAA"
    assert parsed["temp_c"] == 21.0
    assert parsed["temp_source"] == "runway_max"
    assert parsed["runway_temp_range"] == (20.2, 21.0)
    assert parsed["observation_time"] == "2026-05-14T17:19:00+00:00"
    assert parsed["observation_time_local"] == "2026-05-15 01:19:00"
    assert parsed["raw_metar"].startswith("METAR ZBAA 141700Z")

    runway_obs = parsed["runway_obs"]
    assert runway_obs["runway_pairs"] == [("18R", "36L"), ("18L", "36R"), ("19", "01")]
    assert runway_obs["temperatures"] == [(20.8, None), (21.0, None), (20.2, None)]
    pt0 = runway_obs["point_temperatures"][0]
    assert pt0["runway"] == "18R/36L"
    assert pt0["tdz_temp"] == 20.8
    assert pt0["mid_temp"] is None
    assert pt0["end_temp"] == 20.8
    assert pt0["target_runway_max"] == 20.8
    assert pt0["wind_dir"] is None
    assert pt0["wind_speed"] is None
    assert pt0["rvr"] is None
    assert pt0["mor"] is None
    assert pt0["humidity"] == 67.0


def test_parse_wind_plate_payload_uses_settlement_runway_endpoint_temperature():
    payload = {
        "code": 200,
        "data": {
            "04/22": {
                "RNO": "04/22",
                "OTIME": "2026-05-14 17:19:00",
                "TDZ_TEMP": "31.2",
                "MID_TEMP": "33.4",
                "END_TEMP": "32.6",
            },
            "05/23": {
                "RNO": "05/23",
                "OTIME": "2026-05-14 17:19:00",
                "TDZ_TEMP": "34.8",
                "MID_TEMP": "35.1",
                "END_TEMP": "34.2",
            },
        },
    }

    parsed = _amsc_parse_wind_plate_payload(payload, city_key="wuhan", icao="ZHHH")

    assert parsed is not None
    assert parsed["temp_c"] == 31.2
    assert parsed["temp_source"] == "settlement_runway_endpoint"
    assert parsed["settlement_runway"] == "04"
    assert parsed["settlement_runway_pair"] == "04/22"
    assert parsed["settlement_runway_position"] == "tdz"
    settlement_point = parsed["runway_obs"]["point_temperatures"][0]
    assert settlement_point["is_settlement"] is True
    assert settlement_point["settlement_runway"] == "04"
    assert settlement_point["target_runway_max"] == 31.2


def test_parse_wind_plate_payload_uses_end_temperature_when_target_is_second_runway():
    payload = {
        "code": 200,
        "data": {
            "20R/02L": {
                "RNO": "20R/02L",
                "OTIME": "2026-05-14 17:19:00",
                "TDZ_TEMP": "34.4",
                "MID_TEMP": "35.2",
                "END_TEMP": "33.7",
            },
        },
    }

    parsed = _amsc_parse_wind_plate_payload(payload, city_key="chongqing", icao="ZUCK")

    assert parsed is not None
    assert parsed["temp_c"] == 33.7
    assert parsed["settlement_runway"] == "02L"
    assert parsed["settlement_runway_pair"] == "20R/02L"
    assert parsed["settlement_runway_position"] == "end"
    assert parsed["runway_obs"]["point_temperatures"][0]["target_runway_max"] == 33.7


def test_parse_wind_plate_payload_rejects_unauthorized_or_empty_payloads():
    assert _amsc_parse_wind_plate_payload(
        {"errCode": -12010, "errMsg": "无权访问此接口"},
        city_key="beijing",
        icao="ZBAA",
    ) is None
    assert _amsc_parse_wind_plate_payload({"code": 200, "data": {}}, city_key="beijing", icao="ZBAA") is None


def test_fetch_amsc_official_current_uses_domestic_city_whitelist(monkeypatch):
    import src.data_collection.amsc_awos_sources as _amsc
    monkeypatch.setattr(_amsc, "AMSC_AWOS_BASE_URL", "https://www.amsc.net.cn/gateway/api/saas/rest/amc/AwosController/getWindPlate")
    assert _amsc_supported_city_codes()["beijing"] == "ZBAA"
    assert "new york" not in _amsc_supported_city_codes()

    class FakeCollector(AmscAwosSourceMixin):
        timeout = 1.0

        def _amsc_http_get_json(self, url, *, headers=None):
            assert "getWindPlate?cccc=ZBAA" in url
            return ZBAA_SAMPLE

    data = FakeCollector().fetch_amsc_awos_current("beijing")

    assert data is not None
    assert data["icao"] == "ZBAA"
    assert data["runway_temp_range"] == (20.2, 21.0)
    assert FakeCollector().fetch_amsc_awos_current("new york") is None
