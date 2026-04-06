import threading

from src.data_collection.nmc_sources import NmcSourceMixin


class _DummyResponse:
    def __init__(self, *, text="", payload=None, status_code=200):
        self.text = text
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _DummySession:
    def __init__(self, mapping):
        self.mapping = mapping

    def get(self, url, timeout=None):
        if url not in self.mapping:
            raise AssertionError(f"unexpected url {url}")
        return self.mapping[url]


class _DummyCollector(NmcSourceMixin):
    CITY_REGISTRY = {
        "shanghai": {"lat": 31.1434, "lon": 121.8052},
    }

    def __init__(self, mapping):
        self.session = _DummySession(mapping)
        self.timeout = 5
        self.nmc_cache_ttl_sec = 300
        self._nmc_cache = {}
        self._nmc_cache_lock = threading.Lock()


def test_fetch_nmc_region_current_parses_rest_payload():
    collector = _DummyCollector(
        {
            "https://www.nmc.cn/rest/real/atcMf": _DummyResponse(
                payload={
                    "station": {"code": "atcMf", "city": "浦东"},
                    "publish_time": "2026-04-06 06:50",
                    "weather": {
                        "temperature": 17.9,
                        "humidity": 83.0,
                        "rain": 0.0,
                        "airpressure": 9999.0,
                        "info": "多云",
                    },
                    "wind": {"direct": "东北风", "power": "3级"},
                }
            )
        }
    )

    out = collector.fetch_nmc_region_current("shanghai")

    assert out is not None
    assert out["source"] == "nmc"
    assert out["station_code"] == "atcMf"
    assert out["current"]["temp"] == 17.9
    assert out["current"]["humidity"] == 83.0
    assert out["current"]["airpressure"] is None


def test_fetch_nmc_official_nearby_returns_normalized_row():
    collector = _DummyCollector(
        {
            "https://www.nmc.cn/rest/real/atcMf": _DummyResponse(
                payload={
                    "station": {"code": "atcMf", "city": "浦东"},
                    "publish_time": "2026-04-06 06:50",
                    "weather": {
                        "temperature": 17.9,
                        "humidity": 83.0,
                        "rain": 0.0,
                        "airpressure": 9999.0,
                        "info": "多云",
                    },
                    "wind": {"direct": "东北风", "power": "3级"},
                }
            )
        }
    )

    rows = collector.fetch_nmc_official_nearby("shanghai")

    assert len(rows) == 1
    assert rows[0]["source"] == "nmc"
    assert rows[0]["temp"] == 17.9
    assert rows[0]["name"] == "浦东区域实况 (NMC)"
    assert rows[0]["station_label"] == "浦东区域实况 (NMC)"
    assert rows[0]["lat"] == 31.1434
