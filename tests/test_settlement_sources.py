import threading

import src.data_collection.settlement_sources as settlement_sources
import src.database.db_manager as db_manager
from src.data_collection.settlement_sources import SettlementSourceMixin


class _FakeResponse:
    content = b"{}"

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "records": {
                "Station": [
                    {
                        "StationId": "466920",
                        "StationName": "中央氣象署臺北站",
                        "ObsTime": {"DateTime": "2026-05-27T10:00:00+08:00"},
                        "WeatherElement": {
                            "AirTemperature": "34.2",
                            "RelativeHumidity": "60",
                            "WindSpeed": "2.0",
                            "WindDirection": "90",
                            "DailyExtreme": {
                                "DailyHigh": {
                                    "TemperatureInfo": {
                                        "AirTemperature": "34.2",
                                        "Occurred_at": {
                                            "DateTime": "2026-05-27T10:00:00+08:00"
                                        },
                                    }
                                },
                                "DailyLow": {
                                    "TemperatureInfo": {"AirTemperature": "27.1"}
                                },
                            },
                        },
                    }
                ]
            }
        }


class _FakeOfficialIntradayRepo:
    def __init__(self):
        self.rows = [{"time": "09:50", "temp": 34.0}]
        self.upserts = []

    def upsert_point(self, **kwargs):
        self.upserts.append(kwargs)
        self.rows.append(
            {
                "time": kwargs["observation_time"],
                "temp": kwargs["value"],
            }
        )

    def load_points(self, **kwargs):
        return list(self.rows)


class _FakeDBManager:
    def append_airport_obs(self, **kwargs):
        return None


class _FakeCollector(SettlementSourceMixin):
    cwa_open_data_auth = "token"
    timeout = 1
    settlement_cache_ttl_sec = 0

    def __init__(self):
        self._settlement_cache = {}
        self._settlement_cache_lock = threading.Lock()

    def _http_get(self, *args, **kwargs):
        return _FakeResponse()


def test_cwa_settlement_returns_recorded_intraday_history(monkeypatch):
    repo = _FakeOfficialIntradayRepo()
    monkeypatch.setattr(settlement_sources, "_official_intraday_repo", repo)
    monkeypatch.setattr(db_manager, "DBManager", lambda: _FakeDBManager())

    collector = _FakeCollector()
    payload = collector.fetch_cwa_taipei_settlement_current()

    assert payload is not None
    assert "cwa:466920" in collector._settlement_cache
    assert repo.upserts[0]["source_code"] == "cwa"
    assert repo.upserts[0]["station_code"] == "466920"
    assert payload["today_obs"] == [
        {"time": "09:50", "temp": 34.0},
        {"time": "10:00", "temp": 34.2},
    ]
