"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  scanTerminalClient,
  shouldSkipManualTerminalRefresh,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import { REGIONS } from "@/components/dashboard/scan-terminal/continent-grouping";
import { DASHBOARD_REFRESH_POLICY_MS } from "@/lib/refresh-policy";
import {
  getLatestPatchesSnapshot,
  useSsePatchVersion,
  type CityPatch,
} from "@/hooks/use-sse-patches";
import type {
  ScanOpportunityRow,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";

const SCAN_CACHE_PREFIX = "polyweather_scan_v3";
const SCAN_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.scanRows;
const FOREGROUND_SCAN_REFRESH_AFTER_SUCCESS_MS = 60_000;
const MAX_STALE_SCAN_CACHE_MS = 6 * 60 * 60 * 1000;
const DERIVED_SCAN_PATCH_NUMBER_FIELDS = [
  "signed_gap",
  "gap_to_target",
  "touch_distance",
  "current_reference",
  "edge",
  "edge_percent",
  "deb_prediction",
] as const;

function scanCacheKey(tradingRegion: string, cacheScope: string): string {
  return `${SCAN_CACHE_PREFIX}:${cacheScope || "terminal"}:${tradingRegion || "all"}`;
}

function readScanCache(
  tradingRegion: string,
  cacheScope: string,
  options?: { allowStale?: boolean },
): ScanTerminalResponse | null {
  try {
    const raw = localStorage.getItem(scanCacheKey(tradingRegion, cacheScope));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const age = Date.now() - Number(cached.ts || 0);
    const maxAge = options?.allowStale ? MAX_STALE_SCAN_CACHE_MS : SCAN_CACHE_TTL_MS;
    if (cached.ts && age >= 0 && age < maxAge && cached.data?.rows) {
      return cached.data;
    }
  } catch { /* ignore */ }
  return null;
}

function writeScanCache(data: ScanTerminalResponse, tradingRegion: string, cacheScope: string) {
  try { localStorage.setItem(scanCacheKey(tradingRegion, cacheScope), JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
}

function normalizeCityKey(city: string | null | undefined) {
  return String(city || "").trim().toLowerCase();
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function isBelowTargetRow(row: any) {
  const text = String(
    row?.market_direction ||
      row?.temperature_direction ||
      row?.market_question ||
      row?.target_label ||
      row?.action ||
      "",
  ).toLowerCase();
  return /\b(below|under|lte|less)\b|<=|≤|以下/.test(text);
}

function deriveTargetGapFields(row: any, maxSoFar: number | null) {
  const target = firstFiniteNumber(
    row?.target_threshold,
    row?.target_value,
    row?.target_lower,
    row?.target_upper,
  );
  if (target === null || maxSoFar === null) return null;

  const belowTargetRow = isBelowTargetRow(row);
  const signedGap = belowTargetRow ? target - maxSoFar : maxSoFar - target;
  const touchDistance = belowTargetRow
    ? Math.max(0, maxSoFar - target)
    : Math.max(0, target - maxSoFar);
  return {
    signed_gap: Number(signedGap.toFixed(2)),
    gap_to_target: Number((-signedGap).toFixed(2)),
    touch_distance: Number(touchDistance.toFixed(2)),
  };
}

function applyPatchToScanRow(row: any, patch: CityPatch) {
  const temp = finiteNumber(patch.changes.temp);
  const patchMaxSoFar = finiteNumber(patch.changes.max_so_far);
  if (temp === null) return row;
  const currentMaxSoFar = firstFiniteNumber(row.current_max_so_far, temp) ?? temp;
  const maxSoFar = patchMaxSoFar ?? Math.max(temp, currentMaxSoFar);
  const derivedGapFields = deriveTargetGapFields(row, maxSoFar);
  const nextRow: any = {
    ...row,
    current_temp: temp,
    current_max_so_far: maxSoFar,
    local_time: typeof patch.changes.obs_time === "string" ? patch.changes.obs_time : row.local_time,
    sse_revision: patch.revision,
  };
  for (const key of DERIVED_SCAN_PATCH_NUMBER_FIELDS) {
    const value = finiteNumber(patch.changes[key]);
    if (value !== null) {
      nextRow[key] = value;
    }
  }
  if (derivedGapFields) {
    for (const key of ["signed_gap", "gap_to_target", "touch_distance"] as const) {
      if (finiteNumber(patch.changes[key]) === null) {
        nextRow[key] = derivedGapFields[key];
      }
    }
  }
  return {
    ...nextRow,
  };
}

function applyTerminalPatches(
  data: ScanTerminalResponse | null | undefined,
  patches: Map<string, CityPatch>,
): ScanTerminalResponse | null | undefined {
  if (!data?.rows?.length || !patches.size) return data;
  let changed = false;
  const rows = data.rows.map((row: any) => {
    const patch = patches.get(normalizeCityKey(row.city));
    if (!patch) return row;
    changed = true;
    return applyPatchToScanRow(row, patch);
  });
  return changed ? { ...data, rows } : data;
}

function scanRowId(row: ScanOpportunityRow | null | undefined) {
  const id = row?.id;
  return typeof id === "string" && id ? id : null;
}

function sortScanRowsByRank(rows: ScanOpportunityRow[]) {
  return [...rows].sort((a, b) => {
    const rankA = finiteNumber(a.rank);
    const rankB = finiteNumber(b.rank);
    if (rankA !== null && rankB !== null && rankA !== rankB) {
      return rankA - rankB;
    }
    if (rankA !== null && rankB === null) return -1;
    if (rankA === null && rankB !== null) return 1;
    return 0;
  });
}

function mergeScanTerminalIncrementalResponse(
  previous: ScanTerminalResponse | null | undefined,
  next: ScanTerminalResponse,
): ScanTerminalResponse {
  const diff = next.diff;
  if (!diff || diff.mode === "full") return next;
  if (!previous?.snapshot_id) return next;

  const baseSnapshotId = diff.base_snapshot_id || next.snapshot_id;
  if (previous.snapshot_id !== baseSnapshotId) return next;

  if (diff.mode === "not_modified") {
    return {
      ...previous,
      ...next,
      status: "ready",
      stale: false,
      rows: previous.rows,
    };
  }

  if (diff.mode !== "row_delta") return next;

  const removedIds = new Set((diff.removed_row_ids || []).map((id) => String(id)));
  const changedRows = new Map<string, ScanOpportunityRow>();
  for (const row of diff.rows_changed || []) {
    const id = scanRowId(row);
    if (id) changedRows.set(id, row);
  }

  const seenIds = new Set<string>();
  const mergedRows: ScanOpportunityRow[] = [];
  for (const row of previous.rows || []) {
    const id = scanRowId(row);
    if (!id || removedIds.has(id)) continue;
    const replacement = changedRows.get(id);
    mergedRows.push(replacement || row);
    seenIds.add(id);
  }
  for (const [id, row] of changedRows.entries()) {
    if (!seenIds.has(id) && !removedIds.has(id)) {
      mergedRows.push(row);
    }
  }

  return {
    ...previous,
    ...next,
    rows: sortScanRowsByRank(mergedRows),
  };
}

export function useScanTerminalQuery({
  cacheScope = "terminal",
  isPro,
  modelSummary = false,
  proAccessLoading,
  terminalActivationRefreshKey = 0,
  timezoneOffsetSeconds,
  tradingRegion,
}: {
  cacheScope?: string;
  isPro: boolean;
  modelSummary?: boolean;
  proAccessLoading: boolean;
  terminalActivationRefreshKey?: number;
  timezoneOffsetSeconds?: number | null;
  tradingRegion?: string;
}) {
  const {
    data: terminalData,
    error: scanError,
    loading: scanLoading,
    remote: scanRemote,
    reset,
    run,
  } = useRemoteDataQuery<ScanTerminalResponse>();

  const lastForcedScanRefreshAtRef = useRef(0);
  const lastForegroundScanRefreshAtRef = useRef(0);
  const lastScanSuccessAtRef = useRef(0);
  const patchVersion = useSsePatchVersion();
  const [cachedRows, setCachedRows] = useState<ScanTerminalResponse | null>(() => {
    if (typeof window !== "undefined") {
      return readScanCache(tradingRegion || "", cacheScope, { allowStale: true });
    }
    return null;
  });
  const latestScanDataRef = useRef<ScanTerminalResponse | null>(null);

  useEffect(() => {
    latestScanDataRef.current = terminalData || cachedRows;
  }, [terminalData, cachedRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCachedRows(readScanCache(tradingRegion || "", cacheScope, { allowStale: true }));
  }, [cacheScope, tradingRegion]);

  const fetchScanTerminal = useCallback(
    async ({
      forceRefresh = false,
      showLoading = false,
    }: {
      forceRefresh?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (proAccessLoading || !isPro) return;
      if (typeof fetch !== "function" || typeof AbortController === "undefined") {
        return;
      }
      if (forceRefresh) {
        lastForcedScanRefreshAtRef.current = Date.now();
      }
      await run({
        request: async (signal) => {
          const previous = latestScanDataRef.current;
          const next = await scanTerminalClient.getTerminal({
            forceRefresh,
            modelSummary,
            signal,
            sinceSnapshotId: !forceRefresh ? previous?.snapshot_id : null,
            timezoneOffsetSeconds,
            tradingRegion,
          });
          return mergeScanTerminalIncrementalResponse(previous, next);
        },
        showLoading,
        onSuccess: (data) => {
          lastScanSuccessAtRef.current = Date.now();
          writeScanCache(data, tradingRegion || "", cacheScope);
          setCachedRows(data);
        },
      });
    },
    [cacheScope, isPro, modelSummary, proAccessLoading, run, timezoneOffsetSeconds, tradingRegion],
  );

  useEffect(() => {
    if (proAccessLoading) return;
    if (!isPro) {
      reset();
      return;
    }
    void fetchScanTerminal({ forceRefresh: false, showLoading: true });
  }, [fetchScanTerminal, isPro, proAccessLoading, reset, timezoneOffsetSeconds, tradingRegion]);

  const effectiveData = useMemo(
    () => applyTerminalPatches(terminalData || cachedRows, getLatestPatchesSnapshot()),
    [terminalData, cachedRows, patchVersion],
  );

  const refreshScanTerminalManually = useCallback(() => {
    if (
      shouldSkipManualTerminalRefresh({
        hasCurrentData: Boolean(terminalData),
        lastForcedRefreshAt: lastForcedScanRefreshAtRef.current,
      })
    ) {
      return;
    }
    void fetchScanTerminal({ forceRefresh: true, showLoading: true });
  }, [fetchScanTerminal, terminalData]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (proAccessLoading || !isPro) return;

    const handleForegroundScanRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (scanRemote.status === "loading") return;
      const now = Date.now();
      if (now - lastForegroundScanRefreshAtRef.current < 30_000) return;
      if (
        lastScanSuccessAtRef.current > 0 &&
        now - lastScanSuccessAtRef.current < FOREGROUND_SCAN_REFRESH_AFTER_SUCCESS_MS
      ) {
        return;
      }

      lastForegroundScanRefreshAtRef.current = now;
      void fetchScanTerminal({ forceRefresh: false, showLoading: false });
    };

    document.addEventListener("visibilitychange", handleForegroundScanRefresh);
    window.addEventListener("focus", handleForegroundScanRefresh);
    return () => {
      document.removeEventListener("visibilitychange", handleForegroundScanRefresh);
      window.removeEventListener("focus", handleForegroundScanRefresh);
    };
  }, [fetchScanTerminal, isPro, proAccessLoading, scanRemote.status]);

  useEffect(() => {
    if (!terminalActivationRefreshKey) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (proAccessLoading || !isPro || scanRemote.status === "loading") return;

    const handleTerminalActivationRefresh = () => {
      const now = Date.now();
      if (now - lastForegroundScanRefreshAtRef.current < 10_000) return;
      lastForegroundScanRefreshAtRef.current = now;
      void fetchScanTerminal({ forceRefresh: false, showLoading: false });
    };

    handleTerminalActivationRefresh();
  }, [
    fetchScanTerminal,
    isPro,
    proAccessLoading,
    scanRemote.status,
    terminalActivationRefreshKey,
  ]);

  // Preload adjacent regions in idle time for instant tab switches
  useEffect(() => {
    if (typeof window === "undefined" || !tradingRegion || !isPro) return;
    const sorted = [...REGIONS].sort((a, b) => a.sort - b.sort);
    const idx = sorted.findIndex((r) => r.key === tradingRegion);
    if (idx < 0) return;
    const neighbors = [idx - 1, idx + 1]
      .filter((i) => i >= 0 && i < sorted.length)
      .map((i) => sorted[i].key);
    if (!neighbors.length) return;

    const preloadOne = (region: string) => {
      if (readScanCache(region, cacheScope)) return; // already cached
      const idleFn = (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 5000));
      const handle = idleFn(() => {
        void scanTerminalClient.getTerminal({
          forceRefresh: false,
          signal: new AbortController().signal,
          tradingRegion: region,
        }).then((data) => { writeScanCache(data, region, cacheScope); });
      });
      return handle;
    };

    const handles = neighbors.map(preloadOne).filter(Boolean);
    return () => {
      const cancelFn = (window as any).cancelIdleCallback || clearTimeout;
      handles.forEach((h) => { try { cancelFn(h); } catch { /* */ } });
    };
  }, [cacheScope, tradingRegion, isPro]);

  return {
    refreshScanTerminalManually,
    scanError,
    scanLoading,
    scanRemote,
    terminalData: effectiveData,
  };
}

export const __applyPatchToScanRowForTest = applyPatchToScanRow;
export const __mergeScanTerminalIncrementalResponseForTest =
  mergeScanTerminalIncrementalResponse;
