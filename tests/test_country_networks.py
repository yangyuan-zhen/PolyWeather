from datetime import datetime, timedelta, timezone

from src.data_collection.country_networks import build_country_network_snapshot
from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
from src.data_collection.city_time import CITY_TIME_ZONES, get_city_utc_offset_seconds
from src.data_collection.metar_sources import MetarSourceMixin
from web.analysis_service import _build_city_detail_payload, _build_intraday_meteorology
from web.core import CITIES


class _DummyMetarSource(MetarSourceMixin):
    CITY_REGISTRY = CITY_REGISTRY
    CITY_TO_ICAO = {key: value["icao"] for key, value in CITY_REGISTRY.items() if value.get("icao")}
    metar_cache_ttl_sec = 600
    metar_fast_cache_ttl_sec = 60


def test_new_south_asia_city_registry_entries_are_wired():
    assert CITY_REGISTRY["manila"]["settlement_source"] == "wunderground"
    assert CITY_REGISTRY["manila"]["settlement_station_code"] == "RPLL"
    assert CITY_REGISTRY["karachi"]["settlement_source"] == "wunderground"
    assert CITY_REGISTRY["karachi"]["settlement_station_code"] == "OPKC"
    assert CITY_REGISTRY["masroor air base"]["icao"] == "OPMR"
    assert ALIASES["rpll"] == "manila"
    assert ALIASES["opkc"] == "karachi"
    assert ALIASES["opmr"] == "masroor air base"
    assert CITIES["manila"]["lat"] == CITY_REGISTRY["manila"]["lat"]
    assert CITIES["karachi"]["lon"] == CITY_REGISTRY["karachi"]["lon"]
    assert CITIES["masroor air base"]["settlement_source"] == "metar"


def test_city_time_zone_mapping_covers_every_city_and_dst_offsets():
    missing = sorted(set(CITY_REGISTRY) - set(CITY_TIME_ZONES))
    assert missing == []

    april = datetime(2026, 4, 19, 6, 30, tzinfo=timezone.utc)

    assert get_city_utc_offset_seconds("guangzhou", april) == 28800
    assert get_city_utc_offset_seconds("ankara", april) == 10800
    assert get_city_utc_offset_seconds("london", april) == 3600
    assert get_city_utc_offset_seconds("paris", april) == 7200
    assert get_city_utc_offset_seconds("new york", april) == -14400
    assert get_city_utc_offset_seconds("chicago", april) == -18000
    assert get_city_utc_offset_seconds("los angeles", april) == -25200
    assert get_city_utc_offset_seconds("wellington", april) == 43200


def test_paris_registry_uses_le_bourget_anchor():
    paris = CITY_REGISTRY["paris"]

    assert paris["icao"] == "LFPB"
    assert paris["settlement_source"] == "metar"
    assert paris["settlement_station_code"] == "LFPB"
    assert "bonneuil-en-france/LFPB" in paris["settlement_url"]
    assert CITIES["paris"]["lat"] == paris["lat"]
    assert CITIES["paris"]["settlement_source"] == "metar"
    assert _DummyMetarSource.CITY_TO_ICAO["paris"] == "LFPB"


def test_turkey_metar_uses_fast_cache_ttl():
    source = _DummyMetarSource()

    assert source._metar_cache_ttl_for_city("ankara", "LTAC") == 60
    assert source._metar_cache_ttl_for_city("istanbul", "LTFM") == 60
    assert source._metar_cache_ttl_for_city("lagos", "DNMM") == 60
    assert source._metar_cache_ttl_for_city("karachi", "OPKC") == 600


def test_turkey_mgm_provider_returns_official_nearby_rows():
    anchor_time = datetime.now(timezone.utc).replace(microsecond=0)
    station_time = anchor_time + timedelta(minutes=8)
    raw = {
        "metar": {
            "observation_time": anchor_time.isoformat().replace("+00:00", "Z"),
            "current": {"temp": 16.0},
        },
        "mgm_nearby": [
            {
                "name": "Airport (MGM/17128)",
                "istNo": "17128",
                "lat": 40.1,
                "lon": 32.9,
                "temp": 17.1,
                "obs_time": station_time.isoformat().replace("+00:00", "Z"),
            }
        ],
    }

    snapshot = build_country_network_snapshot("ankara", raw)

    assert snapshot["provider_code"] == "turkey_mgm"
    assert snapshot["official_network_status"]["available"] is True
    assert snapshot["official_nearby"][0]["source_code"] == "mgm"
    assert snapshot["official_nearby"][0]["is_official"] is True
    assert snapshot["official_nearby"][0]["time_delta_vs_anchor_minutes"] == 8
    assert snapshot["official_nearby"][0]["sync_status"] == "synced"
    assert snapshot["official_nearby"][0]["usable_for_intraday"] is True
    assert snapshot["official_network_status"]["usable_row_count"] == 1


def test_nearby_station_timing_marks_stale_rows_unusable_for_network_signal():
    anchor_time = datetime.now(timezone.utc).replace(microsecond=0)
    fresh_time = anchor_time + timedelta(minutes=20)
    stale_time = anchor_time - timedelta(minutes=90)
    raw = {
        "metar": {
            "observation_time": anchor_time.isoformat().replace("+00:00", "Z"),
            "current": {"temp": 20.0},
        },
        "mgm_nearby": [
            {
                "name": "Fresh",
                "istNo": "100",
                "lat": 40.1,
                "lon": 32.9,
                "temp": 21.0,
                "obs_time": fresh_time.isoformat().replace("+00:00", "Z"),
            },
            {
                "name": "Stale Hot",
                "istNo": "101",
                "lat": 40.2,
                "lon": 33.0,
                "temp": 26.0,
                "obs_time": stale_time.isoformat().replace("+00:00", "Z"),
            },
        ],
    }

    snapshot = build_country_network_snapshot("ankara", raw)

    stale = next(row for row in snapshot["official_nearby"] if row["station_label"] == "Stale Hot")
    assert stale["sync_status"] == "stale"
    assert stale["usable_for_intraday"] is False
    assert snapshot["official_network_status"]["stale_row_count"] == 1
    assert snapshot["network_lead_signal"]["leader_station_label"] == "Fresh"
    assert snapshot["airport_vs_network_delta"] == 1.0


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


def test_metar_cluster_obs_time_label_uses_city_local_time():
    raw = {
        "metar": {
            "observation_time": "2026-04-19T06:30:00.000Z",
            "current": {"temp": 32.0},
        },
        "mgm_nearby": [
            {
                "name": "Guangzhou/Baiyun",
                "icao": "ZGGG",
                "lat": 23.39,
                "lon": 113.30,
                "temp": 32.0,
                "obs_time": "2026-04-19T06:30:00.000Z",
            }
        ],
    }

    snapshot = build_country_network_snapshot("guangzhou", raw)
    row = snapshot["official_nearby"][0]

    assert row["source_code"] == "metar_cluster"
    assert row["obs_time_label"] == "14:30"
    assert row["obs_time_display_tz"] == "city_local"


def test_metar_cluster_obs_time_label_uses_dst_aware_city_time():
    raw = {
        "metar": {
            "observation_time": "2026-04-19T06:30:00.000Z",
            "current": {"temp": 12.0},
        },
        "mgm_nearby": [
            {
                "name": "London test",
                "icao": "EGLC",
                "lat": 51.50,
                "lon": -0.05,
                "temp": 12.0,
                "obs_time": "2026-04-19T06:30:00.000Z",
            }
        ],
    }

    snapshot = build_country_network_snapshot("london", raw)
    row = snapshot["official_nearby"][0]

    assert row["source_code"] == "metar_cluster"
    assert row["obs_time_label"] == "07:30"


def test_metar_cluster_naive_obs_time_is_interpreted_as_utc_before_city_display():
    raw = {
        "metar": {
            "observation_time": "2026-04-19 08:00",
            "current": {"temp": 4.0},
        },
        "mgm_nearby": [
            {
                "name": "Moscow/Vnukovo",
                "icao": "UUWW",
                "lat": 55.59,
                "lon": 37.26,
                "temp": 4.0,
                "obs_time": "2026-04-19 08:00",
            }
        ],
    }

    snapshot = build_country_network_snapshot("moscow", raw)
    row = snapshot["official_nearby"][0]

    assert row["source_code"] == "metar_cluster"
    assert row["obs_time_label"] == "11:00"
    assert row["obs_time_display_tz"] == "city_local"


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


def test_china_nmc_local_time_stale_when_absolute_age_is_old():
    raw = {
        "metar": {
            "observation_time": "2020-01-01T06:30:00.000Z",
            "current": {"temp": 32.0},
        },
        "nmc_official_nearby": [
            {
                "name": "广州区域实况 (NMC)",
                "icao": "atcGz",
                "lat": 23.39,
                "lon": 113.30,
                "temp": 32.0,
                "obs_time": "2020-01-01 06:30",
            }
        ],
    }

    snapshot = build_country_network_snapshot("guangzhou", raw)
    row = snapshot["official_nearby"][0]

    assert row["source_code"] == "nmc"
    assert row["sync_status"] == "stale"
    assert row["usable_for_intraday"] is False


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


def test_moscow_provider_uses_realtime_metar_cluster_not_station_archive_rows():
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

    assert snapshot["provider_code"] == "russia_metar_cluster"
    assert snapshot["official_network_status"]["available"] is True
    assert snapshot["official_network_status"]["mode"] == "realtime_metar_cluster"
    assert snapshot["official_nearby"][0]["source_code"] == "metar_cluster"
    assert snapshot["official_nearby"][0]["is_airport_station"] is True


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


def test_intraday_meteorology_supportive_heating_case():
    payload = _build_intraday_meteorology(
        {
            "local_time": "12:04",
            "temp_symbol": "°C",
            "current": {"temp": 38.2, "max_so_far": 38.2},
            "deb": {"prediction": 40.4},
            "probabilities": {"distribution": [{"value": 40, "probability": 0.42}]},
            "peak": {"first_h": 14, "last_h": 15, "status": "before"},
            "deviation_monitor": {"direction": "hot", "severity": "strong", "current_delta": 1.9},
            "vertical_profile_signal": {
                "heating_setup": "supportive",
                "summary_zh": "混合层偏深，仍支持午后继续升温。",
            },
            "taf": {"signal": {"available": True, "suppression_level": "low", "summary_zh": "TAF 暂未提示强云雨压温。"}},
        }
    )

    assert "上修空间" in payload["headline"]
    assert "upside" in payload["headline_en"].lower()
    assert payload["confidence"] == "high"
    assert payload["base_case_bucket"] == "40°C"
    assert payload["next_observation_time"] == "12:30"
    assert any(item["direction"] == "support" for item in payload["signal_contributions"])
    assert all(item.get("summary_en") for item in payload["signal_contributions"])


def test_intraday_meteorology_suppressed_cloud_rain_case():
    payload = _build_intraday_meteorology(
        {
            "local_time": "13:10",
            "temp_symbol": "°C",
            "current": {"temp": 36.0, "max_so_far": 36.5},
            "deb": {"prediction": 40.2},
            "probabilities": {"distribution": [{"value": 40, "probability": 0.35}]},
            "peak": {"first_h": 14, "last_h": 15, "status": "before"},
            "deviation_monitor": {"direction": "cold", "severity": "strong", "current_delta": -2.0},
            "vertical_profile_signal": {"heating_setup": "suppressed", "suppression_risk": "high"},
            "taf": {"signal": {"available": True, "suppression_level": "high", "disruption_level": "high"}},
        }
    )

    assert "压制" in payload["headline"]
    assert "capping" in payload["headline_en"].lower()
    assert payload["confidence"] == "high"
    assert any("云雨" in rule for rule in payload["invalidation_rules"])
    assert any("cloud" in rule.lower() for rule in payload["invalidation_rules_en"])
    assert any(item["direction"] == "suppress" for item in payload["signal_contributions"])


def test_intraday_meteorology_structural_cap_does_not_claim_taf_cloud_rain():
    payload = _build_intraday_meteorology(
        {
            "local_time": "11:30",
            "temp_symbol": "°C",
            "current": {"temp": 39.0, "max_so_far": 39.0},
            "deb": {"prediction": 40.4},
            "probabilities": {"distribution": [{"value": 42, "probability": 0.35}]},
            "peak": {"first_h": 12, "last_h": 16, "status": "before"},
            "deviation_monitor": {"direction": "cold", "severity": "strong", "current_delta": -1.4},
            "vertical_profile_signal": {
                "heating_setup": "suppressed",
                "suppression_risk": "medium",
                "summary_zh": "边界层混合偏弱，午后上修需要后续观测确认。",
            },
            "taf": {
                "signal": {
                    "available": True,
                    "suppression_level": "low",
                    "disruption_level": "low",
                    "summary_zh": "TAF 在峰值窗口暂未提示明显云雨压温。",
                }
            },
        }
    )

    assert "结构信号压制" in payload["headline"]
    assert "TAF 云雨层暂未构成主压温理由" in payload["headline"]
    assert "存在云雨或结构压制" not in payload["headline"]
    assert any(item["label"] == "TAF 云雨扰动" and item["direction"] == "support" for item in payload["signal_contributions"])


def test_intraday_meteorology_handles_sparse_observations():
    payload = _build_intraday_meteorology(
        {
            "local_time": "08:00",
            "temp_symbol": "°C",
            "current": {},
            "probabilities": {"distribution": []},
            "peak": {},
            "taf": {},
            "vertical_profile_signal": {},
        }
    )

    assert payload["confidence"] == "low"
    assert payload["next_observation_time"] == "08:30"
    assert payload["signal_contributions"][0]["label"] == "数据完整性"
    assert payload["signal_contributions"][0]["label_en"] == "Data completeness"


def test_intraday_meteorology_past_peak_case():
    payload = _build_intraday_meteorology(
        {
            "local_time": "17:20",
            "temp_symbol": "°C",
            "current": {"temp": 33.0, "max_so_far": 39.0},
            "probabilities": {"distribution": [{"value": 39, "probability": 0.5}]},
            "peak": {"first_h": 13, "last_h": 15, "status": "past"},
            "deviation_monitor": {"direction": "normal", "severity": "normal", "current_delta": 0.1},
        }
    )

    assert "峰值窗口已过" in payload["headline"]
    assert "passed" in payload["headline_en"].lower()
    assert payload["base_case_bucket"] == "39°C"
    assert any("最终高点" in rule for rule in payload["invalidation_rules"])
    assert any("final" in rule.lower() for rule in payload["invalidation_rules_en"])
