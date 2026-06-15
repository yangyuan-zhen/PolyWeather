#!/usr/bin/env bash

set -u

BASE_URL="${1:-https://polyweather.top}"
CURL_BIN="${CURL_BIN:-curl}"
REQUIRE_CF_CACHE="${REQUIRE_CF_CACHE:-false}"

PASS_COUNT=0
FAIL_COUNT=0

print_line() {
  printf '%s\n' "$1"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  print_line "PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  print_line "FAIL: $1"
}

header_dump() {
  local url="$1"
  "$CURL_BIN" -sS -D - -o /dev/null "$url"
}

status_code() {
  local headers="$1"
  printf '%s\n' "$headers" | awk 'NR==1 { print $2 }'
}

header_value() {
  local headers="$1"
  local key="$2"
  printf '%s\n' "$headers" \
    | tr -d '\r' \
    | awk -F': ' -v k="$key" 'tolower($1)==tolower(k) { print $2; exit }'
}

cf_cache_status() {
  local headers="$1"
  header_value "$headers" "CF-Cache-Status"
}

contains_ci() {
  local haystack="$1"
  local needle="$2"
  printf '%s' "$haystack" | grep -qi -- "$needle"
}

check_reachable() {
  local url="${BASE_URL%/}/api/cities"
  local headers
  if ! headers="$(header_dump "$url")"; then
    fail "cannot connect to $url"
    return 1
  fi
  local code
  code="$(status_code "$headers")"
  if [ "$code" = "200" ] || [ "$code" = "304" ]; then
    pass "service reachable at $BASE_URL"
    return 0
  fi
  fail "service reachable but unexpected status for /api/cities: $code"
  return 1
}

check_cached_endpoint() {
  local endpoint="$1"
  local label="$2"
  local url="${BASE_URL%/}${endpoint}"
  local headers
  if ! headers="$(header_dump "$url")"; then
    fail "$label request failed: $url"
    return
  fi

  local code cache_control etag
  code="$(status_code "$headers")"
  cache_control="$(header_value "$headers" "Cache-Control")"
  etag="$(header_value "$headers" "ETag")"

  if [ "$code" != "200" ]; then
    fail "$label status expected 200, got $code"
  else
    pass "$label status 200"
  fi

  if [ -n "$cache_control" ] && ! contains_ci "$cache_control" "no-store"; then
    pass "$label Cache-Control is cacheable: $cache_control"
  else
    fail "$label Cache-Control invalid: ${cache_control:-<empty>}"
  fi

  if [ -n "$etag" ]; then
    pass "$label has ETag: $etag"
  else
    fail "$label missing ETag"
  fi
}

check_cloudflare_cache_hit() {
  local endpoint="$1"
  local label="$2"
  local url="${BASE_URL%/}${endpoint}"
  local headers1 headers2
  if ! headers1="$(header_dump "$url")"; then
    fail "$label first Cloudflare cache request failed: $url"
    return
  fi
  if ! headers2="$(header_dump "$url")"; then
    fail "$label second Cloudflare cache request failed: $url"
    return
  fi

  local code2 status1 status2
  code2="$(status_code "$headers2")"
  status1="$(cf_cache_status "$headers1")"
  status2="$(cf_cache_status "$headers2")"

  if [ "$code2" != "200" ]; then
    fail "$label Cloudflare cache status check expected HTTP 200, got $code2"
    return
  fi

  case "$status1" in
    HIT|MISS|REVALIDATED|STALE|UPDATING|EXPIRED)
      pass "$label Cloudflare first status observable: $status1"
      ;;
    "")
      if [ "$REQUIRE_CF_CACHE" = "true" ]; then
        fail "$label missing CF-Cache-Status on first request"
      else
        pass "$label CF-Cache-Status unavailable; set REQUIRE_CF_CACHE=true to enforce"
      fi
      ;;
    *)
      if [ "$REQUIRE_CF_CACHE" = "true" ]; then
        fail "$label unexpected first CF-Cache-Status: $status1"
      else
        pass "$label Cloudflare first status non-cacheable but observed: $status1"
      fi
      ;;
  esac

  case "$status2" in
    HIT|REVALIDATED)
      pass "$label Cloudflare edge cache hit: $status2"
      ;;
    MISS)
      if [ "$REQUIRE_CF_CACHE" = "true" ]; then
        fail "$label Cloudflare edge cache expected HIT or REVALIDATED, got MISS"
      else
        pass "$label Cloudflare returned MISS; cache rule may still be warming"
      fi
      ;;
    "")
      if [ "$REQUIRE_CF_CACHE" = "true" ]; then
        fail "$label missing CF-Cache-Status on second request"
      else
        pass "$label CF-Cache-Status missing on second request; enforcement disabled"
      fi
      ;;
    *)
      if [ "$REQUIRE_CF_CACHE" = "true" ]; then
        fail "$label Cloudflare edge cache expected HIT or REVALIDATED, got $status2"
      else
        pass "$label Cloudflare edge cache not enforced, got $status2"
      fi
      ;;
  esac
}

check_force_refresh_nostore() {
  local endpoint="$1"
  local label="$2"
  local url="${BASE_URL%/}${endpoint}"
  local headers
  if ! headers="$(header_dump "$url")"; then
    fail "$label request failed: $url"
    return
  fi

  local code cache_control
  code="$(status_code "$headers")"
  cache_control="$(header_value "$headers" "Cache-Control")"

  if [ "$code" != "200" ]; then
    fail "$label status expected 200, got $code"
  else
    pass "$label status 200"
  fi

  if contains_ci "$cache_control" "no-store"; then
    pass "$label Cache-Control is no-store"
  else
    fail "$label Cache-Control expected no-store, got: ${cache_control:-<empty>}"
  fi
}

check_if_none_match_304() {
  local endpoint="$1"
  local label="$2"
  local url="${BASE_URL%/}${endpoint}"

  local headers1
  if ! headers1="$(header_dump "$url")"; then
    fail "$label first request failed: $url"
    return
  fi

  local etag
  etag="$(header_value "$headers1" "ETag")"
  if [ -z "$etag" ]; then
    fail "$label cannot run 304 check: missing ETag"
    return
  fi

  local headers2 code2
  if ! headers2="$("$CURL_BIN" -sS -D - -o /dev/null -H "If-None-Match: $etag" "$url")"; then
    fail "$label second request failed: $url"
    return
  fi
  code2="$(status_code "$headers2")"
  if [ "$code2" = "304" ]; then
    pass "$label If-None-Match returns 304"
  else
    fail "$label expected 304, got $code2"
  fi
}

main() {
  print_line "=== PolyWeather Frontend Cache Validation ==="
  print_line "Base URL: $BASE_URL"
  print_line ""

  if ! check_reachable; then
    print_line ""
    print_line "Result: FAIL ($FAIL_COUNT failed, $PASS_COUNT passed)"
    exit 1
  fi

  check_cached_endpoint "/api/cities" "cities"
  check_if_none_match_304 "/api/cities" "cities"
  check_cloudflare_cache_hit "/api/cities" "cities edge cache"

  check_cached_endpoint "/api/city/ankara/summary" "city summary"
  check_force_refresh_nostore "/api/city/ankara/summary?force_refresh=true" "city summary force_refresh"

  check_cached_endpoint "/api/history/ankara" "history"
  check_if_none_match_304 "/api/history/ankara" "history"
  check_cloudflare_cache_hit "/api/scan/terminal?limit=1" "scan terminal edge cache"

  print_line ""
  if [ "$FAIL_COUNT" -gt 0 ]; then
    print_line "Result: FAIL ($FAIL_COUNT failed, $PASS_COUNT passed)"
    exit 1
  fi
  print_line "Result: PASS ($PASS_COUNT passed)"
}

main "$@"
