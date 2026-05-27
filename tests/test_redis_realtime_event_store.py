from web.redis_realtime_event_store import RedisRealtimeEventStore
from web.realtime_patch_schema import normalize_observation_patch


class FakeRedis:
    def __init__(self):
        self.counter = 0
        self.entries = []

    def eval(self, _script, _numkeys, stream_key, counter_key, *args):
        (
            maxlen,
            event_type,
            schema_type,
            schema_version,
            city,
            source,
            obs_time,
            payload_json,
            created_at_ms,
            ts,
            producer_id,
        ) = args
        self.counter += 1
        stream_id = f"{created_at_ms}-{self.counter}"
        fields = {
            "revision": str(self.counter),
            "type": event_type,
            "schema_type": schema_type,
            "schema_version": str(schema_version),
            "city": city,
            "source": source,
            "obs_time": obs_time,
            "payload_json": payload_json,
            "created_at_ms": str(created_at_ms),
            "ts": str(ts),
            "producer_id": producer_id,
        }
        self.entries.append((stream_id, fields))
        trim_to = int(maxlen)
        if trim_to > 0 and len(self.entries) > trim_to:
            self.entries = self.entries[-trim_to:]
        return [self.counter, stream_id]

    def get(self, key):
        if key == "counter:city_observation_revision":
            return str(self.counter)
        return None

    def xrange(self, stream_key, min="-", max="+", count=None):
        rows = list(self.entries)
        if count is not None:
            rows = rows[: int(count)]
        return rows


def _event(city: str, temp: float, source: str = "cwa"):
    return normalize_observation_patch(
        {
            "city": city,
            "changes": {
                "temp": temp,
                "obs_time": "2026-05-27T10:00:00+08:00",
                "source": source,
            },
        }
    )


def test_redis_event_store_appends_monotonic_revisions_and_replays_by_city():
    store = RedisRealtimeEventStore(redis_client=FakeRedis(), maxlen=10, producer_id="test")

    taipei = store.append_event(_event("taipei", 34.2))
    seoul = store.append_event(_event("seoul", 21.5, source="amos"))
    taipei_next = store.append_event(_event("taipei", 34.4))

    assert taipei["revision"] == 1
    assert seoul["revision"] == 2
    assert taipei_next["revision"] == 3
    assert store.latest_revision() == 3

    replay = store.replay_events(cities={"taipei"}, since_revision=1, limit=10)

    assert [event["revision"] for event in replay] == [3]
    assert replay[0]["city"] == "taipei"
    assert replay[0]["payload"]["temp"] == 34.4


def test_redis_event_store_preserves_time_contract_on_replay():
    store = RedisRealtimeEventStore(redis_client=FakeRedis(), maxlen=10, producer_id="test")

    stored = store.append_event(
        normalize_observation_patch(
            {
                "city": "toronto",
                "changes": {
                    "temp": 26,
                    "obs_time": "2026-05-27T23:16:00Z",
                    "source": "metar",
                },
            }
        )
    )
    replayed = store.replay_events(cities={"toronto"}, since_revision=0, limit=10)[0]

    assert stored["observed_at_utc"] == "2026-05-27T23:16:00Z"
    assert replayed["observed_at_local"] == "2026-05-27T19:16:00-04:00"
    assert replayed["city_timezone"] == "America/Toronto"


def test_redis_event_store_reports_replay_gap_when_limit_is_exceeded():
    store = RedisRealtimeEventStore(redis_client=FakeRedis(), maxlen=10, producer_id="test")

    for temp in [30.0, 30.5, 31.0]:
        store.append_event(_event("hong kong", temp, source="hko"))

    replay = store.replay_events(cities={"hong kong"}, since_revision=0, limit=2)

    assert [event["revision"] for event in replay] == [1, 2]
    assert store.replay_requires_resync(
        cities={"hong kong"},
        since_revision=0,
        replay_count=len(replay),
        limit=2,
    )
