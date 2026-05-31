import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildCityDetailProxyCachePolicy,
  buildForceRefreshProxyCachePolicy,
  isForceRefreshValue,
} from "@/lib/proxy-cache-policy";

export function runTests() {
  assert.equal(isForceRefreshValue("true"), true);
  assert.equal(isForceRefreshValue("false"), false);
  assert.equal(isForceRefreshValue(null), false);

  const forced = buildCityDetailProxyCachePolicy("true");
  assert.equal(forced.fetchMode, "no-store");
  assert.match(forced.responseCacheControl, /no-store/);
  assert.equal(forced.revalidateSeconds, undefined);

  const cached = buildCityDetailProxyCachePolicy("false", 15);
  assert.equal(cached.fetchMode, "revalidate");
  assert.equal(cached.revalidateSeconds, 15);
  assert.match(cached.responseCacheControl, /max-age=15/);
  assert.match(cached.responseCacheControl, /s-maxage=15/);

  const scanForced = buildForceRefreshProxyCachePolicy("true", 10);
  assert.equal(scanForced.fetchMode, "no-store");

  const scanTerminalProxySource = fs.readFileSync(
    path.join(process.cwd(), "app", "api", "scan", "terminal", "route.ts"),
    "utf8",
  );
  assert.match(
    scanTerminalProxySource,
    /DASHBOARD_REFRESH_POLICY_SEC\.scanRows/,
    "scan terminal proxy cache TTL should match the dashboard scan refresh cadence instead of a short literal TTL",
  );
  assert.doesNotMatch(
    scanTerminalProxySource,
    /buildForceRefreshProxyCachePolicy\(forceRefresh,\s*10\)/,
    "scan terminal proxy must not use the old 10 second edge cache because it over-drives the slow scan endpoint",
  );

  const scanTerminalClientSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "components",
      "dashboard",
      "scan-terminal",
      "scan-terminal-client.ts",
    ),
    "utf8",
  );
  assert.match(
    scanTerminalClientSource,
    /hasDirectBackendApiBaseUrl/,
    "public scan terminal requests should only attach user auth in direct-backend mode so CDN caches can be shared through the Next proxy",
  );

  const overviewProxySource = fs.readFileSync(
    path.join(
      process.cwd(),
      "app",
      "api",
      "scan",
      "terminal",
      "overview",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(
    overviewProxySource,
    /buildBackendRequestHeaders\(req,\s*\{\s*includeSupabaseIdentity:\s*false,\s*\}\)/s,
    "scan terminal overview proxy must not read Supabase sessions for public overview payloads",
  );

  const priorityWarmProxySource = fs.readFileSync(
    path.join(process.cwd(), "lib", "system-priority-proxy.ts"),
    "utf8",
  );
  assert.match(
    priorityWarmProxySource,
    /buildBackendRequestHeaders\(req,\s*\{\s*includeSupabaseIdentity:\s*false,\s*\}\)/s,
    "priority warm proxy must not read Supabase sessions for backend-token warm hints",
  );
}
