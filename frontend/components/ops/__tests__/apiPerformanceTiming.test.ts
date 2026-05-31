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
    /fetchCache:\s*"no-store"/,
    "city detail batch proxy should avoid caching partial backend fetches in the Next data cache",
  );
  assert.match(
    detailBatchProxy,
    /cacheControlForData/,
    "city detail batch proxy should be able to suppress response caching for partial payloads",
  );
  assert.match(
    apiProxySource,
    /cacheControlForData\?:/,
    "generic backend JSON proxy should allow response cache policy to depend on parsed data",
  );

  const scanTerminalProxy = readFrontend("app", "api", "scan", "terminal", "route.ts");
  assert.match(scanTerminalProxy, /createProxyTimer\(req,\s*"scan_terminal"\)/);
  assert.match(scanTerminalProxy, /timing:\s*timer/);

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
