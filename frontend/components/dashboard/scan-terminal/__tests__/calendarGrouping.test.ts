import assert from "node:assert/strict";
import {
  buildCalendarCoreReason,
  buildCalendarMeta,
  getCalendarActionGroup,
} from "@/components/dashboard/scan-terminal/calendar-action-utils";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";

function row(overrides: Partial<ScanOpportunityRow>): ScanOpportunityRow {
  return {
    city: "London",
    city_display_name: "London",
    current_temp: 21,
    deb_prediction: 24,
    id: "london-2026-04-27",
    local_date: "2026-04-27",
    local_time: "4/27·00:01",
    selected_date: "2026-04-27",
    temp_symbol: "°C",
    ...overrides,
  } as ScanOpportunityRow;
}

export function runTests() {
  const snapshotMs = Date.UTC(2026, 3, 27, 16, 1);
  const sameNow = snapshotMs;
  const localTimeCase = row({
    minutes_until_peak_end: 119,
    minutes_until_peak_start: 0,
    window_phase: "active_peak",
  });
  const meta = buildCalendarMeta(localTimeCase, "zh-CN", snapshotMs, sameNow);

  assert.equal(meta.startAtMs, snapshotMs);
  assert.ok(meta.localWindowLabel, "should expose the user's local peak window");
  assert.notEqual(meta.localWindowLabel, localTimeCase.local_time);
  assert.doesNotMatch(meta.localWindowLabel || "", /4\/27·00:01/);

  const activeGroup = getCalendarActionGroup(localTimeCase, meta, sameNow, "zh-CN");
  assert.equal(activeGroup.key, "now");

  const breakoutReason = buildCalendarCoreReason(
    row({
      cluster_core_high: 24.7,
      cluster_core_low: 23.1,
      cluster_model_count: 6,
      current_temp: 25.2,
      model_cluster_sources: {
        ecmwf: 24.4,
        gfs: 24.7,
      },
    }),
    activeGroup,
    "zh-CN",
  );
  assert.match(breakoutReason, /实测已高于模型上沿/);
  assert.doesNotMatch(breakoutReason, /等待下一报文确认方向/);

  const pastMeta = buildCalendarMeta(
    row({
      minutes_until_peak_end: -20,
      minutes_until_peak_start: -120,
      window_phase: "post_peak",
    }),
    "zh-CN",
    snapshotMs,
    sameNow,
  );
  const pastGroup = getCalendarActionGroup(
    row({ minutes_until_peak_end: -20, minutes_until_peak_start: -120, window_phase: "post_peak" }),
    pastMeta,
    sameNow,
    "zh-CN",
  );

  assert.equal(pastGroup.key, "past");
  assert.match(
    buildCalendarCoreReason(row({}), pastGroup, "zh-CN"),
    /峰值窗口已过，若无新高应避免追高/,
  );
}
