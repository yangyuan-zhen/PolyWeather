import assert from "node:assert/strict";
import {
  getMonitorRefreshRequest,
  MONITOR_CITY_DETAIL_DEPTH,
} from "@/components/dashboard/monitoring/monitor-refresh-policy";

export function runTests() {
  const initial = getMonitorRefreshRequest("initial");
  assert.equal(
    initial.force,
    true,
    "monitor initial load must force refresh instead of showing 30-minute session cache",
  );
  assert.equal(initial.depth, MONITOR_CITY_DETAIL_DEPTH);

  const interval = getMonitorRefreshRequest("interval");
  assert.equal(interval.force, true);
  assert.equal(interval.depth, MONITOR_CITY_DETAIL_DEPTH);
}
