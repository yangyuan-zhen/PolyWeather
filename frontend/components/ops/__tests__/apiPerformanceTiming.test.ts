import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readFrontend(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

export function runTests() {
  const timingSource = readFrontend("lib", "proxy-timing.ts");
  assert.match(
    timingSource,
    /createProxyTimer/,
    "shared proxy timing helper should create timers for slow API proxies",
  );
  assert.match(
    timingSource,
    /Server-Timing/,
    "shared proxy timing helper should write Server-Timing headers for HAR inspection",
  );
  assert.doesNotMatch(
    timingSource,
    /authUserId|authEmail|userId|email/,
    "proxy timing logs must avoid raw user ids or emails",
  );

  const apiProxySource = readFrontend("lib", "api-proxy.ts");
  assert.match(
    apiProxySource,
    /timing\?: ProxyTimer/,
    "generic backend JSON proxy should accept an optional timer",
  );
  for (const stage of ["auth_headers", "backend_fetch", "backend_read"]) {
    assert.match(
      apiProxySource,
      new RegExp(stage),
      `generic backend JSON proxy should measure ${stage}`,
    );
  }

  const detailBatchProxy = readFrontend("app", "api", "cities", "detail-batch", "route.ts");
  assert.match(detailBatchProxy, /createProxyTimer\(req,\s*"city_detail_batch"\)/);
  assert.match(detailBatchProxy, /timing:\s*timer/);
  assert.match(
    detailBatchProxy,
    /POLYWEATHER_CITY_DETAIL_BATCH_PROXY_TIMEOUT_MS\s*\|\|\s*"15000"/,
    "city detail batch proxy should leave room for backend partial responses instead of aborting at the chart fetch deadline",
  );
  assert.match(
    detailBatchProxy,
    /fetchCache:\s*"no-store"/,
    "city detail batch proxy should avoid caching partial backend fetches in the Next data cache",
  );
  assert.match(
    detailBatchProxy,
    /cacheControlForData/,
    "city detail batch proxy should be able to suppress response caching for partial payloads",
  );
  assert.match(
    detailBatchProxy,
    /buildCityDetailBatchTimeoutPayload/,
    "city detail batch proxy should degrade proxy timeouts into the same partial payload shape the chart client already tolerates",
  );
  assert.match(
    detailBatchProxy,
    /missing:\s*requestedCities/,
    "city detail batch proxy timeout fallback should mark requested cities as missing instead of surfacing a browser 504",
  );
  assert.match(
    detailBatchProxy,
    /partial:\s*true/,
    "city detail batch proxy timeout fallback should preserve partial response semantics",
  );
  assert.match(
    detailBatchProxy,
    /diagnostics:\s*{/,
    "city detail batch proxy timeout fallback should include structured diagnostics",
  );
  assert.match(
    detailBatchProxy,
    /response_source:\s*"next_proxy_timeout"/,
    "city detail batch proxy timeout diagnostics should identify the proxy timeout layer",
  );
  assert.match(
    detailBatchProxy,
    /partial_reason:\s*"proxy_timeout"/,
    "city detail batch proxy timeout diagnostics should distinguish proxy timeout from backend partial timeout",
  );
  assert.match(
    detailBatchProxy,
    /city_status/,
    "city detail batch proxy timeout diagnostics should include per-city status",
  );
  assert.match(
    detailBatchProxy,
    /status:\s*200/,
    "city detail batch proxy timeout fallback should avoid red 504 fetch failures for optional chart enrichment",
  );
  assert.match(
    apiProxySource,
    /cacheControlForData\?:/,
    "generic backend JSON proxy should allow response cache policy to depend on parsed data",
  );
  assert.match(
    apiProxySource,
    /Cloudflare-CDN-Cache-Control/,
    "generic backend JSON proxy should expose Cloudflare-specific cache directives",
  );
  assert.match(
    apiProxySource,
    /NO_STORE_CACHE_CONTROL/,
    "generic backend JSON proxy errors must remain non-cacheable when Cache Everything is enabled",
  );

  const scanTerminalProxy = readFrontend("app", "api", "scan", "terminal", "route.ts");
  assert.match(scanTerminalProxy, /createProxyTimer\(req,\s*"scan_terminal"\)/);
  assert.match(scanTerminalProxy, /timing:\s*timer/);
  assert.match(
    scanTerminalProxy,
    /POLYWEATHER_SCAN_TERMINAL_PROXY_TIMEOUT_MS\s*\|\|\s*"35000"/,
    "scan terminal proxy should allow the production backend enough time to return before the 45 second route cap",
  );
  assert.match(
    scanTerminalProxy,
    /export const maxDuration = 45/,
    "scan terminal proxy timeout budget should remain below the Next route execution cap",
  );

  const cityDetailProxy = readFrontend("app", "api", "city", "[name]", "detail", "route.ts");
  assert.match(cityDetailProxy, /createProxyTimer\(req,\s*"city_detail"\)/);
  for (const stage of ["auth_headers", "backend_fetch", "backend_read"]) {
    assert.match(cityDetailProxy, new RegExp(stage));
  }

  const onlineUsersProxy = readFrontend("app", "api", "ops", "online-users", "route.ts");
  assert.match(onlineUsersProxy, /createProxyTimer\(req,\s*"ops_online_users"\)/);
  for (const stage of ["auth_headers", "ops_auth", "backend_fetch", "backend_read"]) {
    assert.match(onlineUsersProxy, new RegExp(stage));
  }

  const analyticsProxy = readFrontend("app", "api", "analytics", "events", "route.ts");
  assert.match(
    analyticsProxy,
    /ANALYTICS_PROXY_TIMEOUT_MS/,
    "analytics event proxy should use a short dedicated timeout instead of waiting for long backend stalls",
  );
  assert.match(
    analyticsProxy,
    /createProxyTimer\(req,\s*"analytics_events"\)/,
    "analytics event proxy should expose Server-Timing for HAR inspection",
  );
  assert.match(
    analyticsProxy,
    /AbortController/,
    "analytics event proxy should abort slow upstream tracking requests",
  );
  assert.match(
    analyticsProxy,
    /status:\s*202/,
    "analytics event proxy timeout should stay non-blocking for the fire-and-forget client event",
  );
}
