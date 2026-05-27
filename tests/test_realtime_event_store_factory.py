import pytest

from web.realtime_event_store import RealtimeEventStore
from web.realtime_event_store_factory import create_realtime_event_store
from web.redis_realtime_event_store import RedisRealtimeEventStore


class FakeRedis:
    pass


def test_event_store_factory_uses_sqlite_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv("POLYWEATHER_EVENT_STORE", raising=False)

    store = create_realtime_event_store(db_path=str(tmp_path / "polyweather.db"))

    assert isinstance(store, RealtimeEventStore)


def test_event_store_factory_uses_redis_when_configured(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_EVENT_STORE", "redis")

    store = create_realtime_event_store(redis_client=FakeRedis())

    assert isinstance(store, RedisRealtimeEventStore)


def test_event_store_factory_falls_back_to_sqlite_when_redis_is_optional(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_EVENT_STORE", "redis")
    monkeypatch.setenv("POLYWEATHER_REDIS_REQUIRED", "false")

    def broken_redis_store(**_kwargs):
        raise RuntimeError("redis down")

    store = create_realtime_event_store(
        db_path=str(tmp_path / "polyweather.db"),
        redis_store_builder=broken_redis_store,
    )

    assert isinstance(store, RealtimeEventStore)
    assert getattr(store, "degraded_from", None) == "redis"


def test_event_store_factory_raises_when_redis_is_required(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYWEATHER_EVENT_STORE", "redis")
    monkeypatch.setenv("POLYWEATHER_REDIS_REQUIRED", "true")

    def broken_redis_store(**_kwargs):
        raise RuntimeError("redis down")

    with pytest.raises(RuntimeError, match="redis down"):
        create_realtime_event_store(
            db_path=str(tmp_path / "polyweather.db"),
            redis_store_builder=broken_redis_store,
        )
