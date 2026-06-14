import pytest


def test_daily_weather_report_reads_city_cache_without_external_fetch(monkeypatch):
    from src.utils import daily_weather_report

    class FailCollector:
        def fetch_all_sources(self, *_args, **_kwargs):
            raise AssertionError("daily report must not fetch external weather sources")

    class FakeDB:
        def __init__(self):
            self.enqueued = []

        def get_city_cache(self, kind, city):
            if (kind, city) != ("panel", "beijing"):
                return None
            return {
                "payload": {
                    "display_name": "Beijing",
                    "local_date": "2026-06-14",
                    "current": {"temp": 27.0, "max_so_far": 28.0},
                    "deb": {"prediction": 31.5},
                }
            }

        def enqueue_observation_refresh_request(self, **kwargs):
            self.enqueued.append(kwargs)
            return True

    fake_db = FakeDB()
    monkeypatch.setattr(daily_weather_report, "_DAILY_REPORT_DB", fake_db, raising=False)
    monkeypatch.setattr(
        daily_weather_report.httpx,
        "get",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("daily report must not scrape CMA from business path")
        ),
    )

    data = daily_weather_report._fetch_city_data(FailCollector(), "beijing")

    assert data == {
        "city": "beijing",
        "name": "北京",
        "name_en": "Beijing",
        "weather": "?",
        "forecast_high": 31.5,
    }
    assert fake_db.enqueued == []


def test_daily_weather_report_cold_cache_enqueues_refresh_without_fetch(monkeypatch):
    from src.utils import daily_weather_report

    class FailCollector:
        def fetch_all_sources(self, *_args, **_kwargs):
            raise AssertionError("daily report must not fetch external weather sources")

    class FakeDB:
        def __init__(self):
            self.enqueued = []

        def get_city_cache(self, _kind, _city):
            return None

        def get_canonical_temperature(self, _city):
            return None

        def enqueue_observation_refresh_request(self, **kwargs):
            self.enqueued.append(kwargs)
            return True

    fake_db = FakeDB()
    monkeypatch.setattr(daily_weather_report, "_DAILY_REPORT_DB", fake_db, raising=False)
    monkeypatch.setattr(
        daily_weather_report.httpx,
        "get",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("daily report must not scrape CMA from business path")
        ),
    )

    assert daily_weather_report._fetch_city_data(FailCollector(), "beijing") is None
    assert fake_db.enqueued == [
        {
            "city": "beijing",
            "kind": "panel",
            "priority": "normal",
            "reason": "daily_weather_report",
        }
    ]


def test_city_analysis_service_builds_report_from_cached_payload_without_fetch():
    from src.bot.analysis.city_analysis_service import CityAnalysisService

    class FailWeather:
        def get_coordinates(self, city_name):
            assert city_name == "shanghai"
            return {"lat": 31.1434, "lon": 121.8052}

        def fetch_all_sources(self, *_args, **_kwargs):
            raise AssertionError("city report must not fetch external weather sources")

    class FakeDB:
        def __init__(self):
            self.enqueued = []

        def get_city_cache(self, kind, city):
            if (kind, city) != ("panel", "shanghai"):
                return None
            return {
                "payload": {
                    "local_date": "2026-06-14",
                    "current": {
                        "temp": 29.2,
                        "max_so_far": 30.1,
                        "observed_at": "2026-06-14T05:00:00+00:00",
                    },
                    "airport_current": {
                        "temp": 29.2,
                        "max_so_far": 30.1,
                        "observation_time": "2026-06-14T05:00:00+00:00",
                    },
                    "deb": {"prediction": 32.4},
                }
            }

        def enqueue_observation_refresh_request(self, **kwargs):
            self.enqueued.append(kwargs)
            return True

    service = CityAnalysisService(weather=FailWeather(), cache_db=FakeDB())

    report = service.build_city_report("shanghai", 3)

    assert "Shanghai" in report
    assert "32.4°C" in report
    assert "29.2°C" in report
    assert "本次消耗 <b>3</b> 积分" in report


def test_city_analysis_service_cold_cache_enqueues_and_asks_to_retry():
    from src.bot.analysis.city_analysis_service import CityAnalysisService

    class FailWeather:
        def get_coordinates(self, _city_name):
            return {"lat": 31.1434, "lon": 121.8052}

        def fetch_all_sources(self, *_args, **_kwargs):
            raise AssertionError("city report must not fetch external weather sources")

    class FakeDB:
        def __init__(self):
            self.enqueued = []

        def get_city_cache(self, _kind, _city):
            return None

        def get_canonical_temperature(self, _city):
            return None

        def enqueue_observation_refresh_request(self, **kwargs):
            self.enqueued.append(kwargs)
            return True

    fake_db = FakeDB()
    service = CityAnalysisService(weather=FailWeather(), cache_db=fake_db)

    with pytest.raises(RuntimeError, match="缓存正在初始化"):
        service.build_city_report("shanghai", 3)

    assert fake_db.enqueued == [
        {
            "city": "shanghai",
            "kind": "panel",
            "priority": "high",
            "reason": "bot_city_report",
        }
    ]
