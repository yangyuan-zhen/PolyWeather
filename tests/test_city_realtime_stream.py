from __future__ import annotations


def test_realtime_stream_reads_canonical_latest_without_analysis(monkeypatch):
    import web.services.city_realtime_stream as stream

    stream._STREAM_BUFFERS.clear()

    class FakeDB:
        def get_canonical_temperature(self, city):
            assert city == "shanghai"
            return {
                "payload": {
                    "city": "shanghai",
                    "value": 30.5,
                    "source": "metar",
                    "source_label": "METAR runway-point air temperature",
                    "observed_at": "2026-06-14T04:00:00+00:00",
                    "freshness_status": "fresh",
                },
            }

        def get_city_cache(self, kind, city):
            assert city == "shanghai"
            if kind != "panel":
                return None
            return {
                "payload": {
                    "probabilities": {
                        "distribution": [
                            {"temp": 30.0, "label": "30°C"},
                            {"temp": 32.0, "label": "32°C"},
                        ]
                    }
                }
            }

    def fail_analyze(*_args, **_kwargs):
        raise AssertionError("realtime stream must read cache/latest instead of _analyze")

    monkeypatch.setattr(stream, "_CACHE_DB", FakeDB(), raising=False)
    monkeypatch.setattr(stream, "_analyze", fail_analyze)

    payload = stream.get_realtime_stream_payload("shanghai")

    assert payload["points"][-1] == {
        "timestamp": "2026-06-14T04:00:00+00:00",
        "temp": 30.5,
        "source": "metar",
    }
    assert [row["threshold_c"] for row in payload["thresholds"]] == [30.0, 32.0]
