from scripts.configure_cloudflare_free import (
    MANAGED_RULE_REF_PREFIX,
    build_managed_cache_rules,
    merge_managed_rules,
)


def test_cloudflare_managed_rules_cache_public_content_then_bypass_sensitive_requests():
    rules = build_managed_cache_rules()

    assert [rule["ref"] for rule in rules] == [
        f"{MANAGED_RULE_REF_PREFIX}public",
        f"{MANAGED_RULE_REF_PREFIX}bypass",
    ]
    assert rules[0]["action_parameters"]["cache"] is True
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
        f"{MANAGED_RULE_REF_PREFIX}public",
        f"{MANAGED_RULE_REF_PREFIX}bypass",
    ]
    assert merged[-1]["action_parameters"]["cache"] is False
