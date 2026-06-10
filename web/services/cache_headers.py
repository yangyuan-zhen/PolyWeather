"""Shared public-cache headers for Cloudflare and other CDNs."""

from __future__ import annotations

from typing import MutableMapping

NO_STORE_CACHE_CONTROL = "no-store, max-age=0"


def public_edge_cache_control(
    s_maxage_seconds: int,
    stale_while_revalidate_seconds: int,
    *,
    browser_max_age_seconds: int = 0,
) -> str:
    return (
        f"public, max-age={max(0, int(browser_max_age_seconds))}, "
        f"s-maxage={max(1, int(s_maxage_seconds))}, "
        f"stale-while-revalidate={max(0, int(stale_while_revalidate_seconds))}"
    )


def apply_cache_control(headers: MutableMapping[str, str], cache_control: str) -> None:
    headers["Cache-Control"] = cache_control
    headers["Cloudflare-CDN-Cache-Control"] = cache_control


def apply_no_store(headers: MutableMapping[str, str]) -> None:
    apply_cache_control(headers, NO_STORE_CACHE_CONTROL)
