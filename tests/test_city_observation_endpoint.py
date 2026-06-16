from fastapi.testclient import TestClient

from web.app import app


client = TestClient(app)


def test_city_observation_endpoint_is_no_store_and_uses_live_observation_service(monkeypatch):
    from web.services import city_observation

    calls = []

    def fake_payload(name):
        calls.append(name)
        return {
            "city": "chengdu",
            "local_date": "2026-06-16",
            "local_time": "17:45",
            "current": {
                "temp": 22.2,
                "source_code": "amsc_awos",
                "obs_time": "2026-06-16T17:45:00+08:00",
            },
            "airport_current": {
                "temp": 22.2,
                "source_code": "amsc_awos",
                "obs_time": "2026-06-16T17:45:00+08:00",
            },
            "runway_plate_history": {
                "02L/20R": [
                    {
                        "time": "2026-06-16T17:45:00+08:00",
                        "tdz_temp": 22.2,
                        "end_temp": 22.0,
                    }
                ]
            },
            "metar_today_obs": [
                {
                    "time": "17:45",
                    "temp": 22.2,
                    "obs_time": "2026-06-16T17:45:00+08:00",
                    "source_code": "amsc_awos",
                }
            ],
        }

    monkeypatch.setattr(city_observation, "get_city_observation_payload", fake_payload)

    response = client.get("/api/city/chengdu/observation")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store, max-age=0"
    assert response.headers["Cloudflare-CDN-Cache-Control"] == "no-store, max-age=0"
    assert calls == ["chengdu"]
    payload = response.json()
    assert payload["airport_current"]["source_code"] == "amsc_awos"
    assert payload["runway_plate_history"]["02L/20R"][0]["tdz_temp"] == 22.2


def test_city_observation_payload_prefers_raw_latest_over_stale_city_cache(monkeypatch):
    from web.services import city_observation

    class FakeDB:
        def get_city_cache(self, kind, city):
            raise AssertionError("observation endpoint must not read city_full_cache")

        def get_latest_raw_observation(self, source, city):
            if (source, city) != ("amsc_awos", "chengdu"):
                return None
            return {
                "source": "amsc_awos",
                "city": "chengdu",
                "station_code": "ZUUU",
                "station_name": "Chengdu Shuangliu",
                "observed_at": "2026-06-16T17:45:00+08:00",
                "payload": {
                    "source": "amsc_awos",
                    "source_label": "AMSC AWOS Chengdu Shuangliu",
                    "icao": "ZUUU",
                    "temp_c": 22.2,
                    "observation_time": "2026-06-16T17:45:00+08:00",
                    "runway_obs": {
                        "point_temperatures": [
                            {
                                "runway": "02L/20R",
                                "tdz_temp": 22.2,
                                "end_temp": 22.0,
                            }
                        ]
                    },
                },
            }

        def list_latest_raw_observations_for_city(self, city, *, limit=100):
            return [self.get_latest_raw_observation("amsc_awos", city)]

        def get_airport_obs_recent(self, icao, minutes=180):
            return []

        def get_canonical_temperature(self, city):
            return None

    monkeypatch.setattr(city_observation, "_CACHE_DB", FakeDB())

    payload = city_observation.get_city_observation_payload("chengdu")

    assert payload["city"] == "chengdu"
    assert payload["airport_current"]["temp"] == 22.2
    assert payload["airport_current"]["source_code"] == "amsc_awos"
    assert payload["airport_current"]["obs_time"] == "2026-06-16T17:45:00+08:00"
    assert payload["runway_plate_history"]["02L/20R"][0]["tdz_temp"] == 22.2
    assert payload["metar_today_obs"][-1]["source_code"] == "amsc_awos"
