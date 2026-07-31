"use client";

import { useCallback, useEffect, useRef } from "react";
import { arbitrageClient } from "@/lib/arbitrage-client";
import { shouldSkipManualTerminalRefresh } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import type { ArbitrageOverview } from "@/lib/arbitrage-types";

export const ARBITRAGE_AUTO_REFRESH_MS = 60_000;

export function useArbitrageQuery({ city }: { city: string }) {
  const { data, error, loading, remote, reset, run } =
    useRemoteDataQuery<ArbitrageOverview>();
  const lastForcedRefreshAtRef = useRef(0);

  const fetchOverview = useCallback(
    async ({
      forceRefresh = false,
      showLoading = false,
    }: {
      forceRefresh?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (typeof fetch !== "function" || typeof AbortController === "undefined") {
        return;
      }
      if (forceRefresh) {
        lastForcedRefreshAtRef.current = Date.now();
      }
      await run({
        request: (signal) =>
          arbitrageClient.fetchOverview({ city, forceRefresh, signal }),
        showLoading,
      });
    },
    [city, run],
  );

  // 首次进入 + 切换城市：清空旧数据后重新拉取。
  useEffect(() => {
    reset();
    void fetchOverview({ showLoading: true });
  }, [fetchOverview, reset]);

  // 60s 自动轮询（仅页面可见时）。
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchOverview({ showLoading: false });
    }, ARBITRAGE_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [fetchOverview]);

  const refreshManually = useCallback(() => {
    if (
      shouldSkipManualTerminalRefresh({
        hasCurrentData: Boolean(data),
        lastForcedRefreshAt: lastForcedRefreshAtRef.current,
      })
    ) {
      return;
    }
    void fetchOverview({ forceRefresh: true, showLoading: true });
  }, [data, fetchOverview]);

  return {
    data,
    error,
    loading,
    refreshManually,
    remote,
  };
}
