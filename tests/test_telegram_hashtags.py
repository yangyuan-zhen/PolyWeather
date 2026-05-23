from src.utils.telegram_push import (
    HIGH_FREQ_AIRPORT_CITIES,
    HIGH_FREQ_AIRPORT_ICAO,
    _build_airport_status_message,
    _run_high_freq_airport_cycle,
)
from pathlib import Path


def test_airport_status_message_starts_with_runway_city_and_station_hashtags():
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
    assert first_line == "#跑道观测 #Qingdao"
    assert "Qingdao / Jiaodong" in text
    assert "TDZ:23.0" in text
    assert "DEB" in text and "24.0" in text


def test_airport_status_hides_non_focus_runways_for_key_airports():
    text = _build_airport_status_message(
        "chongqing",
        {
            "current": {"temp": 28.0},
            "airport_current": {"max_so_far": 30.0, "max_temp_time": "13:00"},
            "amos": {
                "source": "amsc_awos",
                "runway_obs": {
                    "runway_pairs": [("02L", "20R"), ("02R", "20L")],
                    "temperatures": [(31.1, None), (34.9, None)],
                    "point_temperatures": [
                        {"runway": "02L/20R", "tdz_temp": 31.0, "mid_temp": 31.1, "end_temp": 31.2, "target_runway_max": 31.2, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                        {"runway": "02R/20L", "tdz_temp": 34.8, "mid_temp": 34.9, "end_temp": 35.0, "target_runway_max": 35.0, "wind_dir": None, "wind_speed": None, "rvr": None, "mor": None, "humidity": None},
                    ],
                },
            },
        },
        32.0,
        "13:00",
    )

    assert "02L/20R" in text
    assert "02R/20L" in text
    assert "结算跑道当前：31.2°C" in text


def test_singapore_is_in_telegram_push_city_lists():
    assert "singapore" in HIGH_FREQ_AIRPORT_CITIES
    assert HIGH_FREQ_AIRPORT_ICAO["singapore"] == "WSSS"


def test_shenzhen_is_removed_from_telegram_push_city_lists():
    assert "shenzhen" not in HIGH_FREQ_AIRPORT_CITIES
    assert "shenzhen" not in HIGH_FREQ_AIRPORT_ICAO


def test_high_freq_airport_push_forces_analysis_refresh(monkeypatch):
    import src.utils.telegram_push as telegram_push
    import web.app as web_app

    calls = []

    def fake_analyze(city, force_refresh=False, force_refresh_observations_only=False, **_kwargs):
        calls.append((city, force_refresh, force_refresh_observations_only))
        return {
            "local_time": "12:00",
            "current": {"temp": 31.0},
            "deb": {"prediction": 29.0},
            "airport_current": {"max_so_far": 30.0, "max_temp_time": "11:50", "obs_time": "12:00"},
            "mgm_nearby": [
                {"icao": "ZSQD", "temp": 31.0, "obs_time": "2026-05-17T04:00:00Z"},
            ],
        }

    class Bot:
        def __init__(self):
            self.messages = []

        def send_message(self, chat_id, message):
            self.messages.append((chat_id, message))

    bot = Bot()
    monkeypatch.setattr(telegram_push, "HIGH_FREQ_AIRPORT_CITIES", {"qingdao"})
    monkeypatch.setattr(web_app, "_analyze", fake_analyze)

    sent = _run_high_freq_airport_cycle(
        bot=bot,
        config={},
        chat_ids=["chat-1"],
        state={"last_by_city": {}},
    )

    assert sent is True
    # All cities processed with force_refresh_observations_only=True
    assert len(calls) >= 1
    assert all(c[2] is True for c in calls)
    assert ("qingdao", False, True) in calls
    assert bot.messages


def test_high_freq_airport_push_workers_default_to_one_for_shared_cpu(monkeypatch):
    source = Path("src/utils/telegram_push.py").read_text(encoding="utf-8")
    assert 'TELEGRAM_AIRPORT_PUSH_MAX_WORKERS", 1' in source
    assert "max(1, min(4" in source
    assert "ThreadPoolExecutor(max_workers=max_workers)" in source
