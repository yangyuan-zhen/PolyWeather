from starlette.datastructures import MutableHeaders

from web.services.cache_headers import (
    NO_STORE_CACHE_CONTROL,
    apply_cache_control,
    apply_no_store,
    public_edge_cache_control,
)


def test_public_edge_cache_control_separates_browser_and_edge_ttl():
    assert public_edge_cache_control(
        60,
        300,
        browser_max_age_seconds=30,
    ) == "public, max-age=30, s-maxage=60, stale-while-revalidate=300"


def test_cache_helpers_set_cloudflare_specific_header():
    headers = MutableHeaders()
    cache_control = public_edge_cache_control(300, 900)

    apply_cache_control(headers, cache_control)

    assert headers["cache-control"] == cache_control
    assert headers["cloudflare-cdn-cache-control"] == cache_control

    apply_no_store(headers)

    assert headers["cache-control"] == NO_STORE_CACHE_CONTROL
    assert headers["cloudflare-cdn-cache-control"] == NO_STORE_CACHE_CONTROL
