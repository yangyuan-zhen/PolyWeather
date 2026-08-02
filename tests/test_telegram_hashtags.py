import pytest

from src.utils.telegram_push import (
    HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_ICAO,
    _AIRPORT_PUSH_INTERVAL,
    _build_airport_status_message,
    _due_airport_cities,
    normalize_airport_push_city,
    _parse_observation_time_epoch,
    _run_high_freq_airport_cycle,
    _telegram_push_language,
)
from pathlib import Path


def test_airport_status_message_defaults_to_bilingual_copy(monkeypatch):
    monkeypatch.delenv("TELEGRAM_AIRPORT_PUSH_LANGUAGE", raising=False)
    monkeypatch.delenv("TELEGRAM_PUSH_LANGUAGE", raising=False)
    monkeypatch.delenv("POLYWEATHER_TELEGRAM_PUSH_LANGUAGE", raising=False)

    text = _build_airport_status_message(
        "qingdao",
        {
            "current": {"temp": 22.8},
            "deb": {"prediction": 24.0},
            "airport_current": {"max_so_far": 23.1, "max_temp_time": "13:00"},
        },
        24.0,
        "13:00",
    )

    first_line = text.splitlines()[0]
    assert _telegram_push_language() == "both"
    assert first_line == "#AirportObs #机场观测 #Qingdao"
    assert "Qingdao / Jiaodong" in text
    assert "Current / 当前: 22.8°C" in text
    assert "Today's high / 日高: 23.1°C (13:00)" in text
    assert "DEB: 24.0°C" in text


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


def test_shenzhen_lau_fau_shan_push_uses_hko_ten_minute_interval():
    assert _AIRPORT_PUSH_INTERVAL["shenzhen"] == 600


def test_airport_push_prioritizes_china_markets():
    due = _due_airport_cities(
        {"paris", "shanghai", "wuhan", "ankara", "beijing"},
        now_ts=1000,
        last_by_city={},
    )

    assert due[:3] == ["ankara", "beijing", "paris"]


def test_airport_push_normalizes_observation_times_for_stale_rejection():
    assert _parse_observation_time_epoch("1781161200") == 1781161200
    assert _parse_observation_time_epoch("2026-06-11T07:10:00+00:00") == 1781161800


def test_high_freq_airport_push_prefers_fresh_city_cache(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import src.utils.telegram._airport_push as _airport_push
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
    monkeypatch.setattr(_airport_push, "HIGH_FREQ_AIRPORT_CITIES", {"qingdao"})
    monkeypatch.setattr("src.database.db_manager.DBManager", lambda: FakeDB())
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
                    "airport_primary": {
                        "temp": 31.4,
                        "obs_time": "2026-06-11T07:42:00+00:00",
                    },
                },
            }

    monkeypatch.setattr("src.database.db_manager.DBManager", lambda: FakeDB())

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
                    "source": "metar",
                    "source_label": "METAR airport temperature",
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

    monkeypatch.setattr("src.database.db_manager.DBManager", lambda: FakeDB())
    monkeypatch.setattr(web_app, "_analyze", fail_analyze)

    city_weather = telegram_push._load_airport_city_weather_for_push("qingdao")

    assert city_weather["current"]["temp"] == 31.0
    assert city_weather["airport_primary"]["obs_time"] == "2026-06-14T04:00:00+00:00"
    assert city_weather["current"]["freshness"]["freshness_status"] == "fresh"


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

    monkeypatch.setattr("src.database.db_manager.DBManager", lambda: FakeDB())
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

    monkeypatch.setattr("src.database.db_manager.DBManager", lambda: FakeDB())
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
    import src.utils.telegram._airport_push as _airport_push

    calls = []

    monkeypatch.setattr(
        _airport_push,
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
    monkeypatch.setattr(_airport_push, "_resolve_thread_id", lambda _chat, _city: 99)

    def fake_send(_bot, chat_id, _message, **kwargs):
        calls.append((chat_id, kwargs))
        if kwargs.get("message_thread_id"):
            raise RuntimeError("Bad Request: message thread not found")

    monkeypatch.setattr(_airport_push, "_rate_limited_send", fake_send)

    result = _airport_push._process_airport_city(
        "hong kong",
        now_ts=1781164400,
        last_city={},
        chat_ids=["chat-1"],
        bot=object(),
    )

    assert result is None
    assert calls == [("chat-1", {"message_thread_id": 99})]


def test_airport_push_does_not_fall_back_to_general_when_forum_mapping_is_missing(monkeypatch):
    import src.utils.telegram._airport_push as _airport_push

    calls = []

    monkeypatch.setattr(
        _airport_push,
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
    monkeypatch.setattr(_airport_push, "_resolve_thread_id", lambda _chat, _city: 0)
    monkeypatch.setattr(_airport_push, "_is_forum_chat_id", lambda _chat: True)
    monkeypatch.setattr(
        _airport_push,
        "_rate_limited_send",
        lambda _bot, chat_id, _message, **kwargs: calls.append((chat_id, kwargs)),
    )

    result = _airport_push._process_airport_city(
        "chengdu",
        now_ts=1781164400,
        last_city={},
        chat_ids=["-1003927451869"],
        bot=object(),
    )

    assert result is None
    assert calls == []


def test_high_freq_airport_push_workers_default_to_one_for_shared_cpu(monkeypatch):
    source = Path("src/utils/telegram/_airport_push.py").read_text(encoding="utf-8")
    helpers_source = Path("src/utils/telegram/_helpers.py").read_text(encoding="utf-8")
    assert 'TELEGRAM_AIRPORT_PUSH_MAX_WORKERS", 1' in source
    assert "max(1, min(4" in source
    assert "ThreadPoolExecutor(max_workers=max_workers)" in helpers_source
