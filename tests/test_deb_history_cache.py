"""Tests for load_history SQLite cache behavior (invalidation safety)."""


def _reset_history_cache():
    from src.analysis import deb_algorithm

    deb_algorithm._history_cache = {}
    deb_algorithm._history_mtime = None


def test_load_history_sqlite_caches_across_calls(monkeypatch):
    from src.analysis import deb_algorithm

    _reset_history_cache()

    calls = []

    class FakeRepo:
        def load_all(self, fields=None):
            calls.append(fields)
            return {"beijing": {"2026-08-10": {"deb_prediction": 30.0}}}

    monkeypatch.setattr(deb_algorithm, "_daily_record_repo", FakeRepo())
    monkeypatch.setattr(
        deb_algorithm, "get_state_storage_mode", lambda: "sqlite"
    )
    monkeypatch.setattr(deb_algorithm, "STATE_STORAGE_SQLITE", "sqlite")

    first = deb_algorithm.load_history("/tmp/nonexistent.json")
    second = deb_algorithm.load_history("/tmp/nonexistent.json")

    # Only one DB load for N calls: concurrent analysis paths (city forecast
    # workers) must not each re-scan the full daily_records_store.
    assert len(calls) == 1
    assert second is first
    assert second["beijing"]["2026-08-10"]["deb_prediction"] == 30.0


def test_load_history_cache_invalidated_after_direct_upsert(monkeypatch):
    from src.analysis import deb_algorithm

    _reset_history_cache()

    calls = []
    latest_data = {"beijing": {"2026-08-10": {"deb_prediction": 30.0}}}

    class FakeRepo:
        def load_all(self, fields=None):
            calls.append(fields)
            return latest_data

        def load_city(self, city):
            return dict(latest_data.get(city) or {})

        def upsert_record(self, city, day, payload):
            latest_data.setdefault(city, {})[day] = payload

    monkeypatch.setattr(deb_algorithm, "_daily_record_repo", FakeRepo())
    monkeypatch.setattr(
        deb_algorithm, "get_state_storage_mode", lambda: "sqlite"
    )
    monkeypatch.setattr(deb_algorithm, "STATE_STORAGE_SQLITE", "sqlite")

    # Prime the cache, then simulate a reconcile-style direct upsert which
    # must invalidate it so the next load sees the corrected row.
    deb_algorithm.load_history("/tmp/nonexistent.json")
    deb_algorithm._daily_record_repo.upsert_record(
        "beijing", "2026-08-10", {"deb_prediction": 31.5}
    )
    deb_algorithm._history_cache = {}
    refreshed = deb_algorithm.load_history("/tmp/nonexistent.json")

    assert len(calls) >= 2
    assert refreshed["beijing"]["2026-08-10"]["deb_prediction"] == 31.5
