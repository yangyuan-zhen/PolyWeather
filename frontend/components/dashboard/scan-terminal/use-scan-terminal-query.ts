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
import type { ScanTerminalResponse } from "@/lib/dashboard-types";

const SCAN_CACHE_PREFIX = "polyweather_scan_v2";
const SCAN_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.scanRows;

function scanCacheKey(tradingRegion: string): string {
  return `${SCAN_CACHE_PREFIX}:${tradingRegion || "all"}`;
}

function readScanCache(tradingRegion: string): ScanTerminalResponse | null {
  try {
    const raw = localStorage.getItem(scanCacheKey(tradingRegion));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.ts && Date.now() - cached.ts < SCAN_CACHE_TTL_MS && cached.data?.rows) {
      return cached.data;
    }
  } catch { /* ignore */ }
  return null;
}

function writeScanCache(data: ScanTerminalResponse, tradingRegion: string) {
  try { localStorage.setItem(scanCacheKey(tradingRegion), JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
}

function normalizeCityKey(city: string | null | undefined) {
  return String(city || "").trim().toLowerCase();
}

function applyPatchToScanRow(row: any, patch: CityPatch) {
  const temp = typeof patch.changes.temp === "number" && Number.isFinite(patch.changes.temp)
    ? patch.changes.temp
    : null;
  if (temp === null) return row;
  return {
    ...row,
    current_temp: temp,
    current_max_so_far: Math.max(
      temp,
      typeof row.current_max_so_far === "number" && Number.isFinite(row.current_max_so_far)
        ? row.current_max_so_far
        : temp,
    ),
    local_time: typeof patch.changes.obs_time === "string" ? patch.changes.obs_time : row.local_time,
    sse_revision: patch.revision,
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

export function useScanTerminalQuery({
  isPro,
  proAccessLoading,
  timezoneOffsetSeconds,
  tradingRegion,
}: {
  isPro: boolean;
  proAccessLoading: boolean;
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
  const patchVersion = useSsePatchVersion();
  const [cachedRows, setCachedRows] = useState<ScanTerminalResponse | null>(() => {
    if (typeof window !== "undefined") return readScanCache(tradingRegion || "");
    return null;
  });

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
        request: (signal) =>
          scanTerminalClient.getTerminal({
            forceRefresh,
            signal,
            timezoneOffsetSeconds,
            tradingRegion,
          }),
        showLoading,
        onSuccess: (data) => { writeScanCache(data, tradingRegion || ""); setCachedRows(data); },
      });
    },
    [isPro, proAccessLoading, run, timezoneOffsetSeconds, tradingRegion],
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
      if (readScanCache(region)) return; // already cached
      const idleFn = (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 5000));
      const handle = idleFn(() => {
        void scanTerminalClient.getTerminal({
          forceRefresh: false,
          signal: new AbortController().signal,
          tradingRegion: region,
        }).then((data) => { writeScanCache(data, region); });
      });
      return handle;
    };

    const handles = neighbors.map(preloadOne).filter(Boolean);
    return () => {
      const cancelFn = (window as any).cancelIdleCallback || clearTimeout;
      handles.forEach((h) => { try { cancelFn(h); } catch { /* */ } });
    };
  }, [tradingRegion, isPro]);

  return {
    refreshScanTerminalManually,
    scanError,
    scanLoading,
    scanRemote,
    terminalData: effectiveData,
  };
}
