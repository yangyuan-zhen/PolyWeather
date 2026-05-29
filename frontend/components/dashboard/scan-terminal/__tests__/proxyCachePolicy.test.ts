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
  assert.match(cached.responseCacheControl, /s-maxage=15/);

  const scanForced = buildForceRefreshProxyCachePolicy("true", 10);
  assert.equal(scanForced.fetchMode, "no-store");

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
