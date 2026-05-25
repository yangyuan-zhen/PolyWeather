"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  scanTerminalQueryPolicy,
  scanTerminalClient,
  shouldRunAutoTerminalRefresh,
  shouldSkipManualTerminalRefresh,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import type { ScanTerminalResponse } from "@/lib/dashboard-types";

const SCAN_CACHE_PREFIX = "polyweather_scan_v2";
const SCAN_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — cities list instant on revisit

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
    isLoading,
    loading: scanLoading,
    remote: scanRemote,
    reset,
    run,
  } = useRemoteDataQuery<ScanTerminalResponse>();

  const lastForcedScanRefreshAtRef = useRef(0);
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

  const effectiveData = terminalData || cachedRows;

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
    if (proAccessLoading || !isPro) return;
    if (
      typeof window === "undefined" ||
      typeof window.setInterval !== "function" ||
      typeof window.clearInterval !== "function"
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (
        !shouldRunAutoTerminalRefresh({
          documentHidden: document.hidden,
          isLoading: isLoading(),
        })
      ) {
        return;
      }
      void fetchScanTerminal({ forceRefresh: false, showLoading: false });
    }, scanTerminalQueryPolicy.autoRefreshMs);
    return () => window.clearInterval(intervalId);
  }, [fetchScanTerminal, isLoading, isPro, proAccessLoading]);

  return {
    refreshScanTerminalManually,
    scanError,
    scanLoading,
    scanRemote,
    terminalData: effectiveData,
  };
}
