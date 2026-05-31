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
}
