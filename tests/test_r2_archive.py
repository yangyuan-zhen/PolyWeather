import json

from web.r2_archive import (
    R2ArchiveConfig,
    R2ObjectStore,
    build_realtime_archive_key,
    events_to_jsonl,
)


def test_r2_config_is_disabled_until_all_required_env_is_present(monkeypatch):
    for key in (
        "POLYWEATHER_R2_ACCOUNT_ID",
        "POLYWEATHER_R2_BUCKET",
        "POLYWEATHER_R2_ACCESS_KEY_ID",
        "POLYWEATHER_R2_SECRET_ACCESS_KEY",
    ):
        monkeypatch.delenv(key, raising=False)

    assert R2ArchiveConfig.from_env() is None


def test_r2_put_object_signs_cloudflare_r2_request():
    captured = {}

    def fake_transport(request, timeout):
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["headers"] = dict(request.header_items())
        captured["body"] = request.data

        class Response:
            status = 200

            def read(self):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        return Response()

    config = R2ArchiveConfig(
        account_id="acct123",
        bucket="polyweather-archive",
        access_key_id="access",
        secret_access_key="secret",
    )
    store = R2ObjectStore(config, transport=fake_transport)

    store.put_object(
        "sse-events/2026/06/16/test.jsonl",
        b'{"ok":true}\n',
        content_type="application/x-ndjson",
    )

    assert captured["method"] == "PUT"
    assert captured["url"] == (
        "https://polyweather-archive.acct123.r2.cloudflarestorage.com/"
        "sse-events/2026/06/16/test.jsonl"
    )
    assert captured["body"] == b'{"ok":true}\n'
    assert captured["headers"]["Content-type"] == "application/x-ndjson"
    assert captured["headers"]["Host"] == "polyweather-archive.acct123.r2.cloudflarestorage.com"
    assert captured["headers"]["Authorization"].startswith("AWS4-HMAC-SHA256 ")
    assert "Credential=access/" in captured["headers"]["Authorization"]


def test_realtime_archive_key_and_jsonl_are_stable():
    key = build_realtime_archive_key("redis", "2026-06-16", "city_observation_patch")

    assert key == "sse-events/2026/06/16/city_observation_patch.redis.jsonl"

    body = events_to_jsonl(
        [
            {"revision": 2, "city": "taipei", "payload": {"temp_c": 31.2}},
            {"revision": 3, "city": "seoul", "payload": {"temp_c": 24.5}},
        ]
    )

    lines = body.decode("utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["revision"] == 2
    assert json.loads(lines[1])["city"] == "seoul"
