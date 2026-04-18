from src.data_collection.russia_station_sources import (
    RUSSIA_MOSCOW_MAP_STATION_LIMIT,
    RUSSIA_MOSCOW_STATIONS,
    RussiaStationSourceMixin,
)


def test_moscow_station_registry_includes_vnukovo_nearby_ring():
    assert "27524" in RUSSIA_MOSCOW_STATIONS
    assert "27500" in RUSSIA_MOSCOW_STATIONS
    assert RUSSIA_MOSCOW_STATIONS["27500"]["station_label"] == "Tolstopaltsevo"
    assert RUSSIA_MOSCOW_MAP_STATION_LIMIT == 10


def test_fetch_moscow_official_nearby_keeps_nearest_ten_station_rows():
    class FakeRussiaSource(RussiaStationSourceMixin):
        CITY_REGISTRY = {
            "moscow": {
                "lat": 55.5915,
                "lon": 37.2615,
            }
        }

        def _ru_cached_station_current(self, station_code, station_meta, use_fahrenheit=False):
            return {
                "station_code": station_code,
                "station_label": station_meta["station_label"],
                "name": station_meta["station_label"],
                "lat": station_meta["lat"],
                "lon": station_meta["lon"],
                "temp": 10.0,
                "source_code": "ru_station_web",
            }

    rows = FakeRussiaSource().fetch_russia_moscow_official_nearby("moscow")

    assert len(rows) == RUSSIA_MOSCOW_MAP_STATION_LIMIT
    assert rows[0]["station_code"] == "27524"
    assert rows[1]["station_code"] == "27500"
    assert all(row["distance_km"] is not None for row in rows)
