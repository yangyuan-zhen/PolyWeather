from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_frontend_cache_validator_checks_cloudflare_edge_hits():
    script = (ROOT / "scripts" / "validate_frontend_cache.sh").read_text(encoding="utf-8")

    assert "REQUIRE_CF_CACHE" in script
    assert "CF-Cache-Status" in script
    assert "cf_cache_status" in script
    assert "HIT" in script
    assert "MISS" in script
    assert "REVALIDATED" in script
    assert 'check_cloudflare_cache_hit "/api/cities" "cities edge cache"' in script
    assert "/api/scan/terminal?limit=1" not in script
