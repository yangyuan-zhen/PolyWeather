import assert from "node:assert/strict";
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
}
