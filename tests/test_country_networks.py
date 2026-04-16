from src.data_collection.country_networks import build_country_network_snapshot
from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from web.analysis_service import _build_city_detail_payload


def test_new_south_asia_city_registry_entries_are_wired():
    assert CITY_REGISTRY["manila"]["settlement_source"] == "wunderground"
    assert CITY_REGISTRY["manila"]["settlement_station_code"] == "RPLL"
    assert CITY_REGISTRY["karachi"]["settlement_source"] == "wunderground"
    assert CITY_REGISTRY["karachi"]["settlement_station_code"] == "OPKC"
    assert CITY_REGISTRY["masroor air base"]["icao"] == "OPMR"
    assert ALIASES["rpll"] == "manila"
    assert ALIASES["opkc"] == "karachi"
    assert ALIASES["opmr"] == "masroor air base"


def test_turkey_mgm_provider_returns_official_nearby_rows():
    raw = {
        "metar": {
            "observation_time": "2026-04-06T10:00:00.000Z",
            "current": {"temp": 16.0},
        },
        "mgm_nearby": [
            {
                "name": "Airport (MGM/17128)",
                "istNo": "17128",
                "lat": 40.1,
                "lon": 32.9,
                "temp": 17.1,
            }
        ],
    }

    snapshot = build_country_network_snapshot("ankara", raw)

    assert snapshot["provider_code"] == "turkey_mgm"
    assert snapshot["official_network_status"]["available"] is True
    assert snapshot["official_nearby"][0]["source_code"] == "mgm"
    assert snapshot["official_nearby"][0]["is_official"] is True


def test_china_provider_falls_back_to_metar_cluster_without_replacing_airport_anchor():
    raw = {
        "metar": {
            "observation_time": "2026-04-06T10:00:00.000Z",
            "current": {"temp": 22.5},
        },
        "mgm_nearby": [
            {
                "name": "Hongqiao",
                "icao": "ZSSS",
                "lat": 31.2,
                "lon": 121.3,
                "temp": 23.1,
            }
        ],
    }

    snapshot = build_country_network_snapshot("shanghai", raw)

    assert snapshot["provider_code"] == "china_cma"
    assert snapshot["airport_primary_current"]["source_code"] == "metar"
    assert snapshot["airport_primary_current"]["is_airport_station"] is True
    assert snapshot["official_network_status"]["mode"] == "fallback_metar_cluster"
    assert snapshot["official_nearby"][0]["source_code"] == "metar_cluster"
    assert snapshot["official_nearby"][0]["is_official"] is False


def test_china_provider_prefers_nmc_rows_when_available():
    raw = {
        "metar": {
            "observation_time": "2026-04-06T10:00:00.000Z",
            "current": {"temp": 22.5},
        },
        "nmc_official_nearby": [
            {
                "name": "浦东区域实况 (NMC)",
                "icao": "atcMf",
                "lat": 31.14,
                "lon": 121.80,
                "temp": 17.9,
                "obs_time": "2026-04-06 06:50",
            }
        ],
        "mgm_nearby": [
            {
                "name": "Hongqiao",
                "icao": "ZSSS",
                "lat": 31.2,
                "lon": 121.3,
                "temp": 23.1,
            }
        ],
    }

    snapshot = build_country_network_snapshot("shanghai", raw)

    assert snapshot["provider_code"] == "china_cma"
    assert snapshot["official_network_status"]["available"] is True
    assert snapshot["official_network_status"]["mode"] == "official_active"
    assert snapshot["official_nearby"][0]["source_code"] == "nmc"
    assert snapshot["official_nearby"][0]["is_official"] is True


def test_hko_provider_marks_explicit_official_station_as_anchor():
    raw = {
        "settlement_current": {
            "station_code": "LFS",
            "station_name": "Lau Fau Shan",
            "observation_time": "2026-04-06T10:00:00+08:00",
            "current": {"temp": 25.0},
        }
    }

    snapshot = build_country_network_snapshot("lau fau shan", raw)

    assert snapshot["provider_code"] == "hongkong_hko"
    assert snapshot["settlement_station"]["is_official_station_anchor"] is True
    assert snapshot["official_nearby"][0]["is_settlement_anchor"] is True
    assert snapshot["official_nearby"][0]["station_code"] == "LFS"


def test_russia_provider_prefers_official_web_rows_when_available():
    raw = {
        "metar": {
            "observation_time": "2026-04-06T10:00:00.000Z",
            "current": {"temp": 11.0},
        },
        "ru_official_nearby": [
            {
                "station_code": "27524",
                "station_label": "Vnukovo",
                "lat": 55.5870,
                "lon": 37.2500,
                "temp": 12.3,
                "obs_time": "2026-04-06T09:00:00+00:00",
                "is_airport_station": True,
                "page_url": "https://www.pogodaiklimat.ru/weather.php?id=27524",
            }
        ],
        "mgm_nearby": [
            {
                "name": "Sheremetyevo",
                "icao": "UUEE",
                "lat": 55.97,
                "lon": 37.41,
                "temp": 12.0,
            }
        ],
    }

    snapshot = build_country_network_snapshot("moscow", raw)

    assert snapshot["provider_code"] == "russia_station_web"
    assert snapshot["official_network_status"]["available"] is True
    assert snapshot["official_network_status"]["mode"] == "official_web_crawl"
    assert snapshot["official_nearby"][0]["source_code"] == "ru_station_web"
    assert snapshot["official_nearby"][0]["is_official"] is True


def test_city_detail_payload_exposes_airport_and_official_network_layers():
    payload = _build_city_detail_payload(
        {
            "name": "ankara",
            "display_name": "Ankara",
            "local_time": "12:00",
            "local_date": "2026-04-06",
            "temp_symbol": "°C",
            "updated_at": "2026-04-06T04:00:00Z",
            "current": {
                "temp": 16.0,
                "settlement_source": "metar",
                "settlement_source_label": "METAR",
            },
            "risk": {"icao": "LTAC", "airport": "Esenboga", "level": "medium", "warning": ""},
            "airport_primary": {"temp": 16.0, "source_code": "metar"},
            "airport_primary_today_obs": [{"time": "10:00", "temp": 16.0}],
            "official_nearby": [{"station_code": "17128", "temp": 17.2, "source_code": "mgm"}],
            "official_network_source": "turkey_mgm",
            "official_network_status": {"provider_code": "turkey_mgm", "available": True},
            "network_lead_signal": {"available": True, "delta": 1.2},
            "network_spread_signal": {"available": True, "spread": 2.1},
            "center_station_candidate": {"station_code": "17128", "temp": 17.2},
            "airport_vs_network_delta": 1.2,
            "settlement_station": {
                "settlement_station_code": "LTAC",
                "settlement_station_label": "Ankara Esenboga Airport",
                "is_airport_anchor": True,
            },
            "probabilities": {"distribution": []},
            "multi_model": {},
            "multi_model_daily": {},
            "dynamic_commentary": {"summary": "", "notes": []},
            "taf": {},
        }
    )

    assert payload["official"]["airport_primary"]["source_code"] == "metar"
    assert payload["official"]["official_nearby"][0]["source_code"] == "mgm"
    assert payload["settlement_station"]["settlement_station_code"] == "LTAC"
