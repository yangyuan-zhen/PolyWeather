import pytest

from src.utils.telegram_push import (
    HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_ICAO,
    _AIRPORT_PUSH_INTERVAL,
    _build_airport_status_message,
    _compute_slope_15m,
    _due_airport_cities,
    normalize_airport_push_city,
    _parse_observation_time_epoch,
    _run_high_freq_airport_cycle,
    _telegram_push_language,
)
from pathlib import Path


def test_airport_status_message_defaults_to_bilingual_runway_copy(monkeypatch):
    monkeypatch.delenv("TELEGRAM_AIRPORT_PUSH_LANGUAGE", raising=False)
    monkeypatch.delenv("TELEGRAM_PUSH_LANGUAGE", raising=False)
    monkeypatch.delenv("POLYWEATHER_TELEGRAM_PUSH_LANGUAGE", raising=False)

    text = _build_airport_status_message(
        "qingdao",
        {
            "current": {"temp": 22.8},
            "deb": {"prediction": 24.0},
            "airport_current": {"max_so_far": 23.1, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "observation_time": "2026-05-15T05:00:00Z",
                "runway_obs": {
                    "runway_pairs": [("17", "35"), ("16", "34")],
                    "temperatures": [(23.0, None), (23.2, None)],
                    "point_temperatures": [
                        {"runway": "17/35", "tdz_temp": 23.0, "mid_temp": None, "end_temp": 23.1, "target_runway_max": 23.1, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                        {"runway": "16/34", "tdz_temp": 23.2, "mid_temp": None, "end_temp": 23.3, "target_runway_max": 23.3, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                    ],
                },
            },
        },
        24.0,
        "13:00",
    )

    first_line = text.splitlines()[0]
    assert _telegram_push_language() == "both"
    assert first_line == "#RunwayObs #跑道观测 #Qingdao"
    assert "Qingdao / Jiaodong" in text
    assert "TDZ:23.0" in text
    assert "Settlement runway now / 结算跑道当前:" in text
    assert "Today's runway high / 今日跑道高点:" in text
    assert "max:" not in text
    assert "DEB: 24.0°C" in text


def test_airport_status_hides_non_focus_runways_for_key_airports():
    text = _build_airport_status_message(
        "chongqing",
        {
            "current": {"temp": 28.0},
            "airport_current": {"max_so_far": 30.0, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("20R", "02L"), ("02R", "20L")],
                    "temperatures": [(31.1, None), (34.9, None)],
                    "point_temperatures": [
                        {"runway": "20R/02L", "tdz_temp": 33.8, "mid_temp": 34.5, "end_temp": 31.2, "target_runway_max": 34.5, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                        {"runway": "02R/20L", "tdz_temp": 34.8, "mid_temp": 34.9, "end_temp": 35.0, "target_runway_max": 35.0, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                    ],
                },
            },
        },
        32.0,
        "13:00",
    )

    assert "20R/02L" in text
    assert "02R/20L" in text
    assert "Settlement runway now / 结算跑道当前: 31.2°C" in text
    assert "max:34.5" not in text


def test_airport_status_uses_tdz_when_settlement_target_is_first_runway():
    text = _build_airport_status_message(
        "chengdu",
        {
            "current": {"temp": 28.0},
            "airport_current": {"max_so_far": 30.0, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("02L", "20R")],
                    "temperatures": [(27.9, None)],
                    "point_temperatures": [
                        {"runway": "02L/20R", "tdz_temp": 24.4, "mid_temp": 26.1, "end_temp": 27.9, "target_runway_max": 27.9, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                    ],
                },
            },
        },
        32.0,
        "13:00",
    )

    assert "02L/20R ★Settlement / ★结算  TDZ:24.4  MID:26.1  END:27.9  settle:24.4" in text
    assert "Settlement runway now / 结算跑道当前: 24.4°C" in text
    assert "Settlement runway now / 结算跑道当前: 27.9°C" not in text
    assert "max:" not in text


def test_airport_status_removes_max_when_runway_endpoints_are_shown():
    text = _build_airport_status_message(
        "shanghai",
        {
            "current": {"temp": 24.0},
            "airport_current": {"max_so_far": 25.0, "max_temp_time": "07:00"},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("35R", "17L"), ("34L", "16R")],
                    "temperatures": [(25.2, None), (25.4, None)],
                    "point_temperatures": [
                        {"runway": "35R/17L", "tdz_temp": 25.2, "mid_temp": None, "end_temp": 24.6, "target_runway_max": 25.2},
                        {"runway": "34L/16R", "tdz_temp": 25.4, "mid_temp": None, "end_temp": 24.8, "target_runway_max": 25.4},
                    ],
                },
            },
        },
        27.2,
        "10:58",
    )

    assert "35R/17L ★Settlement / ★结算  TDZ:25.2  MID:--  END:24.6  settle:25.2" in text
    assert "34L/16R  TDZ:25.4  MID:--  END:24.8" in text
    assert "max:" not in text


def test_telegram_slope_uses_settlement_endpoint_not_runway_max(monkeypatch):
    import src.utils.telegram_push as telegram_push

    class FakeDB:
        def get_runway_obs_recent(self, icao, minutes=20):
            return [
                {
                    "runway": "20R/02L",
                    "tdz_temp": 33.7,
                    "mid_temp": 34.1,
                    "end_temp": 30.8,
                    "target_runway_max": 34.1,
                },
                {
                    "runway": "20R/02L",
                    "tdz_temp": 33.8,
                    "mid_temp": 34.5,
                    "end_temp": 31.2,
                    "target_runway_max": 34.5,
                },
            ]

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())

    assert _compute_slope_15m("ZUCK", 31.2, "chongqing") == 0.4


def test_singapore_is_in_telegram_push_city_lists():
    assert "singapore" in HIGH_FREQ_AIRPORT_CITIES
    assert HIGH_FREQ_AIRPORT_ICAO["singapore"] == "WSSS"


def test_shenzhen_lau_fau_shan_topic_is_in_airport_push_city_lists():
    assert normalize_airport_push_city("LauFauShan") == "shenzhen"
    assert normalize_airport_push_city("HongKong") == "hong kong"
    assert normalize_airport_push_city("NewYork") == "new york"
    assert normalize_airport_push_city("LosAngeles") == "los angeles"
    assert normalize_airport_push_city("SanFrancisco") == "san francisco"
    assert "shenzhen" in HIGH_FREQ_AIRPORT_CITIES
    assert HIGH_FREQ_AIRPORT_ICAO["shenzhen"] == "LFS"


def test_china_airport_push_defaults_to_one_minute_city_interval():
    assert _AIRPORT_PUSH_INTERVAL["seoul"] == 60
    assert _AIRPORT_PUSH_INTERVAL["busan"] == 60
    assert _AIRPORT_PUSH_INTERVAL["shanghai"] == 60
    assert _AIRPORT_PUSH_INTERVAL["beijing"] == 60
    assert _AIRPORT_PUSH_INTERVAL["guangzhou"] == 60
    assert _AIRPORT_PUSH_INTERVAL["qingdao"] == 60
    assert _AIRPORT_PUSH_INTERVAL["chengdu"] == 60
    assert _AIRPORT_PUSH_INTERVAL["chongqing"] == 60
    assert _AIRPORT_PUSH_INTERVAL["wuhan"] == 60


def test_shenzhen_lau_fau_shan_push_uses_hko_ten_minute_interval():
    assert _AIRPORT_PUSH_INTERVAL["shenzhen"] == 600


def test_airport_push_prioritizes_china_markets():
    due = _due_airport_cities(
        {"paris", "shanghai", "wuhan", "ankara", "beijing"},
        now_ts=1000,
        last_by_city={},
    )

    assert due[:3] == ["beijing", "shanghai", "wuhan"]


def test_airport_push_normalizes_observation_times_for_stale_rejection():
    assert _parse_observation_time_epoch("1781161200") == 1781161200
    assert _parse_observation_time_epoch("2026-06-11T07:10:00+00:00") == 1781161800


def test_high_freq_airport_push_prefers_fresh_city_cache(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import web.app as web_app

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("airport Telegram push should read fresh city cache before _analyze")

    class FakeDB:
        def get_city_cache(self, kind, city):
            if city != "qingdao" or kind != "full":
                return None
            return {
                "updated_at_ts": telegram_push.time.time(),
                "payload": {
                    "local_time": "12:00",
                    "current": {"temp": 31.0},
                    "deb": {"prediction": 29.0},
                    "airport_current": {"max_so_far": 30.0, "max_temp_time": "11:50", "obs_time": "12:00"},
                    "mgm_nearby": [
                        {"icao": "ZSQD", "temp": 31.0, "obs_time": "2026-05-17T04:00:00Z"},
                    ],
                },
            }

    class Bot:
        def __init__(self):
            self.messages = []

        def send_message(self, chat_id, message):
            self.messages.append((chat_id, message))

    bot = Bot()
    monkeypatch.setattr(telegram_push, "HIGH_FREQ_AIRPORT_CITIES", {"qingdao"})
    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(
        telegram_push,
        "_rate_limited_send",
        lambda bot, chat_id, message, **_kwargs: bot.send_message(chat_id, message),
    )
    monkeypatch.setattr(web_app, "_analyze", fail_analyze)

    sent = _run_high_freq_airport_cycle(
        bot=bot,
        config={},
        chat_ids=["chat-1"],
        state={"last_by_city": {}},
    )

    assert sent is True
    assert bot.messages


def test_airport_push_prefers_cache_with_newest_observation(monkeypatch):
    import src.utils.telegram_push as telegram_push

    now = telegram_push.time.time()

    class FakeDB:
        def get_city_cache(self, kind, city):
            assert city == "shanghai"
            if kind == "full":
                return {
                    "updated_at_ts": now,
                    "payload": {
                        "current": {"temp": 31.0},
                        "airport_primary": {"temp": 31.0, "obs_time": "15:00"},
                    },
                }
            return {
                "updated_at_ts": now - 120,
                "payload": {
                    "current": {"temp": 31.4},
                    "amos": {"observation_time": "2026-06-11T07:42:00+00:00"},
                    "airport_primary": {
                        "temp": 31.4,
                        "obs_time": "2026-06-11T07:42:00+00:00",
                    },
                },
            }

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())

    city_weather = telegram_push._read_cached_airport_city_weather("shanghai")

    assert city_weather["airport_primary"]["temp"] == 31.4


def test_airport_push_without_cache_uses_canonical_latest_not_analysis(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import web.app as web_app

    class FakeDB:
        def get_city_cache(self, kind, city):
            return None

        def get_canonical_temperature(self, city):
            assert city == "qingdao"
            return {
                "payload": {
                    "city": "qingdao",
                    "value": 31.0,
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T04:00:00+00:00",
                    "observed_at_local": "12:00",
                    "freshness_sec": 45,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T04:00:45+00:00",
                    "confidence": 0.92,
                },
            }

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("Telegram push must not call _analyze when canonical latest exists")

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(web_app, "_analyze", fail_analyze)

    city_weather = telegram_push._load_airport_city_weather_for_push("qingdao")

    assert city_weather["current"]["temp"] == 31.0
    assert city_weather["airport_primary"]["obs_time"] == "2026-06-14T04:00:00+00:00"
    assert city_weather["current"]["freshness"]["freshness_status"] == "fresh"


def test_airport_push_prefers_newer_amsc_canonical_over_stale_cache(monkeypatch):
    import src.utils.telegram_push as telegram_push

    class FakeDB:
        def get_city_cache(self, kind, city):
            if kind != "panel":
                return None
            assert city == "qingdao"
            return {
                "updated_at_ts": 1000.0,
                "payload": {
                    "local_time": "12:00",
                    "current": {
                        "temp": 29.0,
                        "source_code": "metar",
                        "observed_at": "2026-06-14T04:00:00+00:00",
                    },
                    "airport_primary": {
                        "temp": 29.0,
                        "source_code": "metar",
                        "obs_time": "2026-06-14T04:00:00+00:00",
                    },
                    "deb": {"prediction": 31.5},
                },
            }

        def get_canonical_temperature(self, city):
            assert city == "qingdao"
            return {
                "payload": {
                    "city": "qingdao",
                    "value": 30.8,
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS runway-point air temperature",
                    "source_role": "settlement_proxy",
                    "observed_at": "2026-06-14T10:44:00+00:00",
                    "observed_at_local": "18:44",
                    "freshness_sec": 30,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T10:44:30+00:00",
                    "confidence": 0.92,
                },
            }

        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "qingdao")
            return {
                "payload": {
                    "source": "amsc_awos",
                    "temp_c": 30.8,
                    "observation_time": "2026-06-14T18:44:00+08:00",
                    "runway_obs": {
                        "runway_pairs": [("16", "34")],
                        "temperatures": [(30.8, None)],
                        "point_temperatures": [
                            {
                                "runway": "16/34",
                                "tdz_temp": 30.2,
                                "mid_temp": 30.8,
                                "end_temp": 30.6,
                                "target_runway_max": 30.6,
                            }
                        ],
                    },
                }
            }

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())

    city_weather = telegram_push._load_airport_city_weather_for_push("qingdao")

    assert city_weather["current"]["source_code"] == "amsc_awos"
    assert city_weather["current"]["temp"] == 30.8
    assert city_weather["deb"]["prediction"] == 31.5
    assert city_weather["amos"]["source"] == "amsc_awos"
    assert city_weather["amos"]["runway_obs"]["point_temperatures"][0]["runway"] == "16/34"


def test_airport_push_overlays_latest_amsc_raw_when_canonical_is_stale(monkeypatch):
    import src.utils.telegram_push as telegram_push

    class FakeDB:
        def get_city_cache(self, kind, city):
            if kind != "panel":
                return None
            assert city == "shanghai"
            return {
                "updated_at_ts": 1000.0,
                "payload": {
                    "current": {
                        "temp": 21.8,
                        "source_code": "metar",
                        "observed_at": "2026-06-14T10:30:00+00:00",
                    },
                    "airport_primary": {
                        "temp": 21.8,
                        "source_code": "metar",
                        "obs_time": "2026-06-14T10:30:00+00:00",
                    },
                    "amos": {
                        "source": "amsc_awos",
                        "temp_c": 22.2,
                        "observation_time": "2026-06-14T10:44:00+00:00",
                    },
                    "deb": {"prediction": 24.5},
                },
            }

        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 21.8,
                    "source": "metar",
                    "source_label": "METAR",
                    "source_role": "airport_official",
                    "observed_at": "2026-06-14T10:30:00+00:00",
                    "observed_at_local": "18:30",
                    "freshness_sec": 120,
                    "freshness_status": "fresh",
                    "fetched_at": "2026-06-14T10:30:05+00:00",
                    "confidence": 0.78,
                },
            }

        def get_latest_raw_observation(self, source, city):
            assert (source, city) == ("amsc_awos", "shanghai")
            return {
                "observed_at": "2026-06-14T15:43:00+00:00",
                "fetched_at": "2026-06-14T15:43:30+00:00",
                "payload": {
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS Shanghai Pudong (ZSPD)",
                    "icao": "ZSPD",
                    "temp_c": 25.4,
                    "observation_time": "2026-06-14T15:43:00+00:00",
                    "observation_time_local": "2026-06-14 23:43:00",
                    "runway_obs": {
                        "runway_pairs": [("17L", "35R")],
                        "temperatures": [(25.4, None)],
                        "point_temperatures": [
                            {
                                "runway": "17L/35R",
                                "tdz_temp": 25.0,
                                "mid_temp": 25.2,
                                "end_temp": 25.4,
                                "target_runway_max": 25.4,
                            }
                        ],
                    },
                },
            }

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())

    city_weather = telegram_push._load_airport_city_weather_for_push("shanghai")

    assert city_weather["amos"]["observation_time"] == "2026-06-14T15:43:00+00:00"
    assert city_weather["current"]["source_code"] == "amsc_awos"
    assert city_weather["current"]["temp"] == 25.4
    assert city_weather["deb"]["prediction"] == 24.5


def test_airport_push_without_cache_or_canonical_skips_analysis(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import web.app as web_app

    class FakeDB:
        def get_city_cache(self, kind, city):
            return None

        def get_canonical_temperature(self, city):
            return None

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("Telegram push must not call _analyze on cold cache")

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(web_app, "_analyze", fail_analyze)

    with pytest.raises(RuntimeError, match="no cached city weather"):
        telegram_push._load_airport_city_weather_for_push("qingdao")


def test_airport_push_uses_stale_cache_before_fallback_analysis(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import web.app as web_app

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("stale city cache should still prevent Telegram fallback analysis")

    class FakeDB:
        def get_city_cache(self, kind, city):
            if kind != "panel":
                return None
            return {
                "updated_at_ts": 1.0,
                "payload": {
                    "local_time": "12:00",
                    "current": {"temp": 31.0},
                    "deb": {"prediction": 29.0},
                    "airport_current": {"max_so_far": 30.0, "max_temp_time": "11:50", "obs_time": "12:00"},
                    "mgm_nearby": [
                        {"icao": "ZSQD", "temp": 31.0, "obs_time": "2026-05-17T04:00:00Z"},
                    ],
                },
            }

    monkeypatch.setattr(telegram_push, "DBManager", lambda: FakeDB())
    monkeypatch.setattr(web_app, "_analyze", fail_analyze)

    city_weather = telegram_push._load_airport_city_weather_for_push("qingdao")

    assert city_weather["current"]["temp"] == 31.0


def test_high_freq_airport_cycle_skips_cities_before_interval(monkeypatch):
    import src.utils.telegram_push as telegram_push

    calls = []
    monkeypatch.setattr(telegram_push, "HIGH_FREQ_AIRPORT_CITIES", {"shanghai"})
    monkeypatch.setattr(telegram_push.time, "time", lambda: 1000.0)
    monkeypatch.setattr(
        telegram_push,
        "_process_airport_city",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    dirty = telegram_push._run_high_freq_airport_cycle(
        bot=object(),
        config={},
        chat_ids=["chat-1"],
        state={"last_by_city": {"shanghai": {"ts": 999}}},
    )

    assert dirty is False
    assert calls == []


def test_airport_push_rejects_observation_older_than_last_push(monkeypatch):
    import src.utils.telegram_push as telegram_push

    monkeypatch.setattr(
        telegram_push,
        "_load_airport_city_weather_for_push",
        lambda _city: {
            "local_time": "15:22",
            "current": {"temp": 31.0},
            "deb": {"prediction": 32.0},
            "airport_primary": {
                "temp": 31.0,
                "obs_time": "2026-06-11T06:56:00+00:00",
            },
        },
    )

    result = telegram_push._process_airport_city(
        "shanghai",
        now_ts=1781162600,
        last_city={
            "ts": 1781161800,
            "obs_time": "2026-06-11T07:10:00+00:00",
            "obs_ts": 1781161800,
        },
        chat_ids=["chat-1"],
        bot=object(),
    )

    assert result is None


def test_airport_push_does_not_retry_general_when_forum_thread_is_missing(monkeypatch):
    import src.utils.telegram_push as telegram_push

    calls = []

    monkeypatch.setattr(
        telegram_push,
        "_load_airport_city_weather_for_push",
        lambda _city: {
            "local_time": "15:22",
            "current": {"temp": 30.0},
            "deb": {"prediction": 31.0},
            "airport_primary": {
                "temp": 30.0,
                "obs_time": "2026-06-11T07:52:00+00:00",
            },
        },
    )
    monkeypatch.setattr(telegram_push, "_resolve_thread_id", lambda _chat, _city: 99)

    def fake_send(_bot, chat_id, _message, **kwargs):
        calls.append((chat_id, kwargs))
        if kwargs.get("message_thread_id"):
            raise RuntimeError("Bad Request: message thread not found")

    monkeypatch.setattr(telegram_push, "_rate_limited_send", fake_send)

    result = telegram_push._process_airport_city(
        "hong kong",
        now_ts=1781164400,
        last_city={},
        chat_ids=["chat-1"],
        bot=object(),
    )

    assert result is None
    assert calls == [("chat-1", {"message_thread_id": 99})]


def test_airport_push_does_not_fall_back_to_general_when_forum_mapping_is_missing(monkeypatch):
    import src.utils.telegram_push as telegram_push

    calls = []

    monkeypatch.setattr(
        telegram_push,
        "_load_airport_city_weather_for_push",
        lambda _city: {
            "local_time": "15:22",
            "current": {"temp": 30.0},
            "deb": {"prediction": 31.0},
            "airport_primary": {
                "temp": 30.0,
                "obs_time": "2026-06-11T07:52:00+00:00",
            },
        },
    )
    monkeypatch.setattr(telegram_push, "_resolve_thread_id", lambda _chat, _city: 0)
    monkeypatch.setattr(telegram_push, "_is_forum_chat_id", lambda _chat: True)
    monkeypatch.setattr(
        telegram_push,
        "_rate_limited_send",
        lambda _bot, chat_id, _message, **kwargs: calls.append((chat_id, kwargs)),
    )

    result = telegram_push._process_airport_city(
        "chengdu",
        now_ts=1781164400,
        last_city={},
        chat_ids=["-1003927451869"],
        bot=object(),
    )

    assert result is None
    assert calls == []


def test_high_freq_airport_push_workers_default_to_one_for_shared_cpu(monkeypatch):
    source = Path("src/utils/telegram_push.py").read_text(encoding="utf-8")
    assert 'TELEGRAM_AIRPORT_PUSH_MAX_WORKERS", 1' in source
    assert "max(1, min(4" in source
    assert "ThreadPoolExecutor(max_workers=max_workers)" in source
