from datetime import datetime, timezone

from web.services.observation_freshness import build_observation_freshness


def test_amsc_awos_freshness_uses_three_minute_native_cadence():
    freshness = build_observation_freshness(
        source_code="amsc_awos",
        source_label="AMSC AWOS",
        observed_at="2026-06-06T13:01:00Z",
        now_utc=datetime(2026, 6, 6, 13, 4, 0, tzinfo=timezone.utc),
    )

    assert freshness["source_code"] == "amsc_awos"
    assert freshness["native_update_interval_sec"] == 180
    assert freshness["expected_next_update_at"] == "2026-06-06T13:04:00+00:00"
    assert freshness["freshness_status"] == "fresh"
