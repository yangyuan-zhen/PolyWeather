import assert from "node:assert/strict";
import {
  buildObservationFreshness,
  getMonitorFreshnessLevel,
  getMonitorRefreshCadenceMs,
  getObservationSourceProfile,
  shouldRefreshMonitorCity,
} from "@/lib/source-freshness";
import type { CityDetail } from "@/lib/dashboard-types";

function detail(extra: Partial<CityDetail>): CityDetail {
  return {
    current: { temp: null },
    display_name: "Test",
    lat: 0,
    local_date: "2026-05-14",
    local_time: "12:00",
    lon: 0,
    name: "test",
    risk: { level: "low" },
    temp_symbol: "°C",
    ...extra,
  } as CityDetail;
}

export function runTests() {
  const now = new Date("2026-05-14T12:00:00Z");

  assert.equal(getObservationSourceProfile("amos").nativeUpdateIntervalSec, 60);
  assert.equal(getObservationSourceProfile("metar").nativeUpdateIntervalSec, 900);

  const amosFresh = buildObservationFreshness({
    now,
    observedAt: "2026-05-14T11:59:10Z",
    sourceCode: "amos",
    sourceLabel: "AMOS",
  });
  assert.equal(amosFresh.freshness_status, "fresh");
  assert.equal(getMonitorFreshnessLevel(amosFresh, null), "fresh");
  assert.equal(
    shouldRefreshMonitorCity({
      detail: detail({ airport_current: { freshness: amosFresh, obs_time: "11:59", temp: 20 } }),
      now,
      trigger: "interval",
    }),
    false,
  );

  const metarStillExpected = buildObservationFreshness({
    now,
    observedAt: "2026-05-14T11:48:00Z",
    sourceCode: "metar",
    sourceLabel: "METAR",
  });
  assert.equal(metarStillExpected.freshness_status, "expected_wait");
  assert.equal(getMonitorFreshnessLevel(metarStillExpected, null), "aging");

  const metarOld = buildObservationFreshness({
    now,
    observedAt: "2026-05-14T10:50:00Z",
    sourceCode: "metar",
    sourceLabel: "METAR",
  });
  assert.equal(metarOld.freshness_status, "stale");
  assert.equal(getMonitorFreshnessLevel(metarOld, null), "stale");
  assert.equal(
    shouldRefreshMonitorCity({
      detail: detail({ airport_current: { freshness: metarOld, obs_time: "10:50", temp: 20 } }),
      now,
      trigger: "interval",
    }),
    true,
  );

  assert.equal(
    shouldRefreshMonitorCity({ detail: undefined, now, trigger: "interval" }),
    true,
    "missing city detail should always be fetched",
  );
  assert.equal(
    shouldRefreshMonitorCity({
      detail: detail({ airport_current: { obs_age_min: 5, obs_time: "11:55", temp: 20 } }),
      now,
      trigger: "interval",
    }),
    false,
    "legacy METAR age under native cadence should not be force-refreshed every minute",
  );

  assert.equal(getMonitorRefreshCadenceMs(["amos", "metar"]), 60_000);
  assert.equal(getMonitorRefreshCadenceMs(["metar"]), 300_000);
}
