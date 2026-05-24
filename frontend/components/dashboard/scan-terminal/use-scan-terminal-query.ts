"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  scanTerminalQueryPolicy,
  scanTerminalClient,
  shouldRunAutoTerminalRefresh,
  shouldSkipManualTerminalRefresh,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import type { ScanTerminalResponse } from "@/lib/dashboard-types";

export function useScanTerminalQuery({
  isPro,
  proAccessLoading,
}: {
  isPro: boolean;
  proAccessLoading: boolean;
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
          }),
        showLoading,
      });
    },
    [isPro, proAccessLoading, run],
  );

  useEffect(() => {
    if (proAccessLoading) return;
    if (!isPro) {
      reset();
      return;
    }
    void fetchScanTerminal({ forceRefresh: false, showLoading: true });
  }, [fetchScanTerminal, isPro, proAccessLoading, reset]);

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
    terminalData,
  };
}
