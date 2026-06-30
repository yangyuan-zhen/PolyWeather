import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildCityListCacheControl,
  buildCityDetailProxyCachePolicy,
  buildForceRefreshProxyCachePolicy,
  buildPublicEdgeCacheControl,
  isForceRefreshValue,
  NO_STORE_CACHE_CONTROL,
} from "@/lib/proxy-cache-policy";

export function runTests() {
  assert.equal(isForceRefreshValue("true"), true);
  assert.equal(isForceRefreshValue("false"), false);
  assert.equal(isForceRefreshValue(null), false);

  const forced = buildCityDetailProxyCachePolicy("true");
  assert.equal(forced.fetchMode, "no-store");
  assert.match(forced.responseCacheControl, /no-store/);
  assert.equal(forced.revalidateSeconds, undefined);

  const cached = buildCityDetailProxyCachePolicy("false");
  assert.equal(cached.fetchMode, "revalidate");
  assert.equal(cached.revalidateSeconds, 60);
  assert.match(cached.responseCacheControl, /max-age=30/);
  assert.match(cached.responseCacheControl, /s-maxage=60/);
  assert.match(cached.responseCacheControl, /stale-while-revalidate=300/);

  assert.equal(
    buildPublicEdgeCacheControl(60, 300),
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  assert.equal(
    buildCityListCacheControl(),
    "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
  );

  const scanForced = buildForceRefreshProxyCachePolicy("true", 10);
  assert.equal(scanForced.fetchMode, "no-store");

  const scanTerminalProxySource = fs.readFileSync(
    path.join(process.cwd(), "app", "api", "scan", "terminal", "route.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    scanTerminalProxySource,
    /buildForceRefreshProxyCachePolicy/,
    "scan terminal proxy must not use public edge cache because rows depend on user entitlement and live scan state",
  );
  assert.match(
    scanTerminalProxySource,
    /cacheControlForData:\s*\(\)\s*=>\s*NO_STORE_CACHE_CONTROL/,
    "scan terminal proxy must keep all scan payloads out of shared CDN caches",
  );
  assert.match(
    scanTerminalProxySource,
    /fetchCache:\s*"no-store"/,
    "scan terminal proxy must not put failed or initializing payloads into the Next data cache",
  );
  assert.match(
    scanTerminalProxySource,
    /"since_snapshot_id"/,
    "scan terminal proxy should forward incremental scan diff snapshot ids to the backend",
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
  assert.match(
    scanTerminalClientSource,
    /SCAN_TERMINAL_PAYLOAD_VERSION/,
    "scan terminal client should include a stable payload version in the URL so CDN caches roll forward after response-shape optimizations",
  );
  assert.match(
    scanTerminalClientSource,
    /params\.set\("_v",\s*SCAN_TERMINAL_PAYLOAD_VERSION\)/,
    "scan terminal client should vary the CDN cache key without changing backend scan filters",
  );
  assert.match(
    scanTerminalClientSource,
    /params\.set\("diff",\s*"true"\)/,
    "scan terminal client should request incremental scan diffs when it has a previous snapshot",
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
