from scripts.configure_cloudflare_free import (
    MANAGED_RULE_REF_PREFIX,
    build_managed_cache_rules,
    merge_managed_rules,
    resolve_zone_id,
)


def test_cloudflare_managed_rules_apply_path_specific_edge_ttls_then_bypass_sensitive_requests():
    rules = build_managed_cache_rules()

    assert [rule["ref"] for rule in rules] == [
        f"{MANAGED_RULE_REF_PREFIX}static",
        f"{MANAGED_RULE_REF_PREFIX}pages",
        f"{MANAGED_RULE_REF_PREFIX}cities",
        f"{MANAGED_RULE_REF_PREFIX}city_detail",
        f"{MANAGED_RULE_REF_PREFIX}scan",
        f"{MANAGED_RULE_REF_PREFIX}bypass",
    ]
    assert [
        rule["action_parameters"]["edge_ttl"]["status_code_ttl"][0]["value"]
        for rule in rules[:3]
    ] == [31536000, 600, 300]
    for rule in rules[:3]:
        assert rule["action_parameters"]["cache"] is True
        assert rule["action_parameters"]["browser_ttl"] == {"mode": "respect_origin"}
        assert rule["action_parameters"]["edge_ttl"]["mode"] == "respect_origin"
        assert rule["action_parameters"]["edge_ttl"]["status_code_ttl"][1]["value"] == 0
    for rule in rules[3:-1]:
        assert rule["action_parameters"] == {
            "cache": True,
            "browser_ttl": {"mode": "respect_origin"},
        }
    assert rules[-1]["action_parameters"]["cache"] is False
    assert 'http.host eq "api.polyweather.top"' in rules[-1]["expression"]
    assert 'http.request.uri.query contains "force_refresh=true"' in rules[-1]["expression"]


def test_cloudflare_rule_merge_preserves_unmanaged_rules_and_puts_bypass_last():
    existing = [
        {
            "ref": "existing_rule",
            "description": "keep me",
            "expression": 'http.host eq "example.com"',
            "action": "set_cache_settings",
            "action_parameters": {"cache": True},
            "enabled": True,
        },
        {
            "ref": f"{MANAGED_RULE_REF_PREFIX}old",
            "description": "replace me",
            "expression": "true",
            "action": "set_cache_settings",
            "action_parameters": {"cache": False},
            "enabled": True,
        },
    ]

    merged = merge_managed_rules(existing, build_managed_cache_rules())

    assert [rule["ref"] for rule in merged] == [
        "existing_rule",
        f"{MANAGED_RULE_REF_PREFIX}static",
        f"{MANAGED_RULE_REF_PREFIX}pages",
        f"{MANAGED_RULE_REF_PREFIX}cities",
        f"{MANAGED_RULE_REF_PREFIX}city_detail",
        f"{MANAGED_RULE_REF_PREFIX}scan",
        f"{MANAGED_RULE_REF_PREFIX}bypass",
    ]
    assert merged[-1]["action_parameters"]["cache"] is False


def test_resolve_zone_id_uses_explicit_zone_id_without_listing_zones():
    class FailingApi:
        def request(self, *_args, **_kwargs):
            raise AssertionError("explicit zone id should not require zone list access")

    assert resolve_zone_id(FailingApi(), "polyweather.top", "zone_123") == "zone_123"
