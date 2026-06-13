from datetime import datetime, timezone

from web.cache_warmer_service import CacheWarmer, build_priority_city_batch


def test_priority_city_batch_prefers_local_active_hours_over_night():
    cities = {
        "alpha day": {"tz": 0},
        "beta night": {"tz": 12 * 3600},
        "gamma morning": {"tz": -4 * 3600},
    }

    selected = build_priority_city_batch(
        cities,
        now_utc=datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc),
        batch_size=2,
    )

    assert selected == ["alpha day", "gamma morning"]


def test_cache_warmer_warms_scan_and_city_panel_without_force_refresh():
    now_ts = datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc).timestamp()
    scan_calls = []
    city_calls = []

    def scan_warmer(filters, *, force_refresh):
        scan_calls.append((filters, force_refresh))
        return {"status": "ready"}

    def city_panel_warmer(city, *, force_refresh):
        city_calls.append((city, force_refresh))
        return {"city": city}

    warmer = CacheWarmer(
        city_provider=lambda: {
            "alpha day": {"tz": 0},
            "beta night": {"tz": 12 * 3600},
        },
        scan_warmer=scan_warmer,
        city_panel_warmer=city_panel_warmer,
        scan_interval_sec=300,
        city_interval_sec=60,
        city_batch_size=1,
    )

    completed = warmer.run_due_once(now_ts=now_ts)

    assert completed == 2
    assert scan_calls == [({}, False)]
    assert city_calls == [("alpha day", False)]


def test_cache_warmer_skips_work_when_intervals_are_not_due():
    now_ts = datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc).timestamp()
    scan_calls = []
    city_calls = []
    warmer = CacheWarmer(
        city_provider=lambda: {"alpha day": {"tz": 0}},
        scan_warmer=lambda filters, *, force_refresh: scan_calls.append(True),
        city_panel_warmer=lambda city, *, force_refresh: city_calls.append(city),
        scan_interval_sec=300,
        city_interval_sec=60,
        city_batch_size=1,
    )

    warmer.run_due_once(now_ts=now_ts)
    scan_calls.clear()
    city_calls.clear()

    completed = warmer.run_due_once(now_ts=now_ts + 20)

    assert completed == 0
    assert scan_calls == []
    assert city_calls == []
