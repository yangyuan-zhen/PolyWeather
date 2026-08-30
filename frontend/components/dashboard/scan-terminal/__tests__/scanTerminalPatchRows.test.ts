import {
  __applyPatchToScanRowForTest,
  __mergeScanTerminalIncrementalResponseForTest,
} from "@/components/dashboard/scan-terminal/use-scan-terminal-query";
import type { ScanTerminalResponse } from "@/lib/dashboard-types";
import type { CityPatch } from "@/hooks/use-sse-patches";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const patch: CityPatch = {
    type: "city_observation_patch.v1",
    city: "shenzhen",
    revision: 42,
    changes: {
      temp: 30.2,
      max_so_far: 30.4,
      signed_gap: 1.4,
      gap_to_target: -1.4,
      touch_distance: 0,
      current_reference: 30.4,
      edge: 0.06,
      edge_percent: 6,
      obs_time: "2026-06-14T06:30:00Z",
    },
  };

  const next = __applyPatchToScanRowForTest(
    {
      city: "shenzhen",
      current_temp: 29.8,
      current_max_so_far: 30.0,
      signed_gap: 1.0,
      gap_to_target: -1.0,
      touch_distance: 0.2,
      current_reference: 30.0,
      edge: 0.04,
      edge_percent: 4,
      local_time: "old",
      target_threshold: 29,
    },
    patch,
  ) as any;

  assert(next.current_temp === 30.2, "SSE patch should update scan row current temperature");
  assert(next.current_max_so_far === 30.4, "SSE patch should use backend max_so_far instead of only Math.max(row, temp)");
  assert(next.signed_gap === 1.4, "SSE patch should update signed_gap when backend sends it");
  assert(next.gap_to_target === -1.4, "SSE patch should update gap_to_target when backend sends it");
  assert(next.touch_distance === 0, "SSE patch should update touch_distance when backend sends it");
  assert(next.current_reference === 30.4, "SSE patch should update current_reference when backend sends it");
  assert(next.edge === 0.06 && next.edge_percent === 6, "SSE patch should update edge fields when backend sends them");
  assert(next.local_time === "2026-06-14T06:30:00Z", "SSE patch should update observation time");
  assert(next.sse_revision === 42, "SSE patch should record the applied revision");

  const derived = __applyPatchToScanRowForTest(
    {
      city: "shenzhen",
      current_temp: 28,
      current_max_so_far: 28,
      target_threshold: 30,
      target_label: "30+",
    },
    {
      type: "city_observation_patch.v1",
      city: "shenzhen",
      revision: 43,
      changes: {
        temp: 30.5,
      },
    },
  ) as any;

  assert(derived.current_max_so_far === 30.5, "SSE patch should still derive max_so_far from temp when backend omits it");
  assert(derived.signed_gap === 0.5, "SSE patch should derive signed_gap from updated max and row threshold");
  assert(derived.gap_to_target === -0.5, "SSE patch should derive gap_to_target from updated max and row threshold");
  assert(derived.touch_distance === 0, "SSE patch should derive zero touch_distance once threshold is reached");

  const previous: ScanTerminalResponse = {
    generated_at: "2026-06-14T00:00:00Z",
    snapshot_id: "scan-old",
    status: "ready",
    stale: false,
    filters: {
      scan_mode: "tradable",
      min_price: 0.05,
      max_price: 0.95,
      min_edge_pct: 2,
      min_liquidity: 500,
      high_liquidity_only: false,
      market_type: "maxtemp",
      time_range: "today",
      limit: 180,
    },
    summary: {
      recommended_count: 2,
      visible_count: 2,
      candidate_total: 2,
      tradable_market_count: 2,
      total_volume: 1000,
    },
    top_signal: null,
    rows: [
      { id: "row-1", rank: 1, city: "shenzhen", edge_percent: 4 },
      { id: "row-removed", rank: 2, city: "paris", edge_percent: 3 },
    ],
  };

  const notModified = __mergeScanTerminalIncrementalResponseForTest(previous, {
    generated_at: "2026-06-14T00:01:00Z",
    snapshot_id: "scan-old",
    status: "not_modified",
    stale: false,
    filters: previous.filters,
    summary: previous.summary,
    top_signal: previous.top_signal,
    rows: [],
    diff: {
      mode: "not_modified",
      base_snapshot_id: "scan-old",
      snapshot_id: "scan-old",
      rows_changed: [],
      removed_row_ids: [],
    },
  });

  assert(notModified.rows.length === 2, "not_modified scan diff should keep the previous rows");
  assert(notModified.status === "ready", "not_modified scan diff should normalize to a renderable ready payload");

  const delta = __mergeScanTerminalIncrementalResponseForTest(previous, {
    generated_at: "2026-06-14T00:02:00Z",
    snapshot_id: "scan-new",
    status: "ready",
    stale: false,
    filters: previous.filters,
    summary: { ...previous.summary, recommended_count: 2 },
    top_signal: { id: "row-added", city: "tokyo" } as any,
    rows: [],
    diff: {
      mode: "row_delta",
      base_snapshot_id: "scan-old",
      snapshot_id: "scan-new",
      rows_changed: [
        { id: "row-1", rank: 1, city: "shenzhen", edge_percent: 6 },
        { id: "row-added", rank: 2, city: "tokyo", edge_percent: 5 },
      ],
      removed_row_ids: ["row-removed"],
    },
  });

  assert(delta.snapshot_id === "scan-new", "row_delta scan diff should advance snapshot_id");
  assert(delta.rows.length === 2, "row_delta scan diff should merge changed, added, and removed rows");
  assert(delta.rows[0].id === "row-1" && delta.rows[0].edge_percent === 6, "row_delta scan diff should replace changed rows");
  assert(delta.rows[1].id === "row-added", "row_delta scan diff should append new rows in rank order");
}
