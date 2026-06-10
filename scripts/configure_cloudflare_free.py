"""Configure PolyWeather's Cloudflare Free cache rules.

The script is intentionally conservative:
- It preserves rules that it does not own.
- It keeps the sensitive-request bypass rule last because the last matching
  Cloudflare Cache Rule wins.
- It only mutates Cloudflare when --apply is provided.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Iterable, List
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_BASE = "https://api.cloudflare.com/client/v4"
MANAGED_RULE_REF_PREFIX = "polyweather_free_cache_"
PHASE = "http_request_cache_settings"

STATIC_CACHE_EXPRESSION = """(
  http.host eq "polyweather.top"
  and http.request.method in {"GET" "HEAD"}
  and (
    starts_with(http.request.uri.path, "/_next/static/")
    or lower(http.request.uri.path.extension) in {
      "js" "css" "woff" "woff2" "png" "jpg" "jpeg" "webp" "avif" "svg" "ico"
    }
  )
)"""

PUBLIC_PAGES_EXPRESSION = """(
  http.host eq "polyweather.top"
  and http.request.method in {"GET" "HEAD"}
  and (
    http.request.uri.path eq "/"
    or starts_with(http.request.uri.path, "/docs/")
    or starts_with(http.request.uri.path, "/modern/")
    or starts_with(http.request.uri.path, "/probabilities/")
    or starts_with(http.request.uri.path, "/subscription-help/")
  )
)"""

CITIES_EXPRESSION = """(
  http.host eq "polyweather.top"
  and http.request.method in {"GET" "HEAD"}
  and http.request.uri.path eq "/api/cities"
)"""

CITY_DETAIL_EXPRESSION = """(
  http.host eq "polyweather.top"
  and http.request.method in {"GET" "HEAD"}
  and (
    http.request.uri.path eq "/api/cities/detail-batch"
    or starts_with(http.request.uri.path, "/api/city/")
  )
)"""

SCAN_EXPRESSION = """(
  http.host eq "polyweather.top"
  and http.request.method in {"GET" "HEAD"}
  and (
    http.request.uri.path eq "/api/scan/terminal"
    or http.request.uri.path eq "/api/system/status"
  )
)"""

BYPASS_CACHE_EXPRESSION = """(
  http.host eq "api.polyweather.top"
  or (
    http.host eq "polyweather.top"
    and (
      (http.request.method ne "GET" and http.request.method ne "HEAD")
      or starts_with(http.request.uri.path, "/api/auth/")
      or starts_with(http.request.uri.path, "/api/feedback")
      or starts_with(http.request.uri.path, "/api/events")
      or starts_with(http.request.uri.path, "/api/internal/")
      or starts_with(http.request.uri.path, "/api/ops/")
      or starts_with(http.request.uri.path, "/api/payments/")
      or starts_with(http.request.uri.path, "/account")
      or starts_with(http.request.uri.path, "/auth")
      or starts_with(http.request.uri.path, "/ops")
      or starts_with(http.request.uri.path, "/terminal")
      or http.request.uri.query contains "force_refresh=true"
    )
  )
)"""

_RULE_FIELDS = {
    "action",
    "action_parameters",
    "description",
    "enabled",
    "expression",
    "logging",
    "ratelimit",
    "ref",
}


def _compact_expression(expression: str) -> str:
    return " ".join(line.strip() for line in expression.splitlines() if line.strip())


def _cache_rule(ref: str, description: str, expression: str, ttl: int | None = None) -> Dict[str, Any]:
    action_parameters: Dict[str, Any] = {
        "cache": True,
        "browser_ttl": {"mode": "respect_origin"},
    }
    if ttl is not None:
        action_parameters["edge_ttl"] = {
            "mode": "respect_origin",
            "status_code_ttl": [
                {"status_code_range": {"from": 200, "to": 299}, "value": ttl},
                {"status_code_range": {"from": 300}, "value": 0},
            ],
        }
    return {
        "ref": f"{MANAGED_RULE_REF_PREFIX}{ref}",
        "description": description,
        "expression": _compact_expression(expression),
        "action": "set_cache_settings",
        "action_parameters": action_parameters,
        "enabled": True,
    }


def build_managed_cache_rules() -> List[Dict[str, Any]]:
    return [
        _cache_rule("static", "PolyWeather: cache immutable static assets for one year", STATIC_CACHE_EXPRESSION, 31536000),
        _cache_rule("pages", "PolyWeather: cache public pages for ten minutes", PUBLIC_PAGES_EXPRESSION, 600),
        _cache_rule("cities", "PolyWeather: cache the public city list for five minutes", CITIES_EXPRESSION, 300),
        _cache_rule("city_detail", "PolyWeather: cache public city detail when the origin allows it", CITY_DETAIL_EXPRESSION),
        _cache_rule("scan", "PolyWeather: cache scan and system status when the origin allows it", SCAN_EXPRESSION),
        {
            "ref": f"{MANAGED_RULE_REF_PREFIX}bypass",
            "description": "PolyWeather: bypass backend, sensitive, realtime, and force-refresh requests",
            "expression": _compact_expression(BYPASS_CACHE_EXPRESSION),
            "action": "set_cache_settings",
            "action_parameters": {"cache": False},
            "enabled": True,
        },
    ]


def _portable_rule(rule: Dict[str, Any]) -> Dict[str, Any]:
    return {key: rule[key] for key in _RULE_FIELDS if key in rule}


def merge_managed_rules(
    existing_rules: Iterable[Dict[str, Any]],
    managed_rules: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    unmanaged = [
        _portable_rule(rule)
        for rule in existing_rules
        if not str(rule.get("ref") or "").startswith(MANAGED_RULE_REF_PREFIX)
    ]
    return [*unmanaged, *[_portable_rule(rule) for rule in managed_rules]]


class CloudflareApi:
    def __init__(self, token: str):
        self.token = token

    def request(
        self,
        method: str,
        path: str,
        payload: Dict[str, Any] | None = None,
        *,
        allow_not_found: bool = False,
    ) -> Dict[str, Any] | None:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{API_BASE}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "polyweather-cloudflare-config/1.0",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if allow_not_found and exc.code == 404:
                return None
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Cloudflare API {method} {path} failed: {exc.code} {detail}") from exc
        if not result.get("success"):
            raise RuntimeError(f"Cloudflare API {method} {path} failed: {result.get('errors')}")
        return result


def resolve_zone_id(api: CloudflareApi, zone_name: str, explicit_zone_id: str) -> str:
    if explicit_zone_id:
        return explicit_zone_id
    result = api.request("GET", f"/zones?{urlencode({'name': zone_name, 'status': 'active'})}")
    zones = list((result or {}).get("result") or [])
    if len(zones) != 1:
        raise RuntimeError(f"Expected one active Cloudflare zone named {zone_name}, found {len(zones)}")
    return str(zones[0]["id"])


def apply_cache_rules(api: CloudflareApi, zone_id: str) -> List[Dict[str, Any]]:
    path = f"/zones/{zone_id}/rulesets/phases/{PHASE}/entrypoint"
    current = api.request("GET", path, allow_not_found=True) or {}
    existing_rules = list((current.get("result") or {}).get("rules") or [])
    merged_rules = merge_managed_rules(existing_rules, build_managed_cache_rules())
    api.request(
        "PUT",
        path,
        {
            "description": "PolyWeather zone-level cache rules",
            "rules": merged_rules,
        },
    )
    return merged_rules


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply rules to Cloudflare")
    parser.add_argument("--zone-name", default="polyweather.top")
    parser.add_argument("--zone-id", default=os.getenv("CLOUDFLARE_ZONE_ID", ""))
    parser.add_argument("--api-token", default=os.getenv("CLOUDFLARE_API_TOKEN", ""))
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    managed_rules = build_managed_cache_rules()
    if not args.apply:
        print(json.dumps({"mode": "plan", "managed_rules": managed_rules}, indent=2))
        return 0
    if not args.api_token:
        print("CLOUDFLARE_API_TOKEN or --api-token is required with --apply", file=sys.stderr)
        return 2
    api = CloudflareApi(args.api_token)
    zone_id = resolve_zone_id(api, args.zone_name, args.zone_id)
    merged_rules = apply_cache_rules(api, zone_id)
    print(
        json.dumps(
            {
                "mode": "applied",
                "zone_id": zone_id,
                "managed_rule_count": len(managed_rules),
                "total_rule_count": len(merged_rules),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
