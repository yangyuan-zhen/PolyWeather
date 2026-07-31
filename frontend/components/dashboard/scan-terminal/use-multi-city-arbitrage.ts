"use client";

import { useCallback, useEffect, useRef } from "react";
import { arbitrageClient } from "@/lib/arbitrage-client";
import { shouldSkipManualTerminalRefresh } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import type {
  ArbitrageBatchOverviewResponse,
  ArbitrageOverview,
} from "@/lib/arbitrage-types";

export const ARBITRAGE_AUTO_REFRESH_MS = 60_000;

type UseMultiCityArbitrageQueryOptions = {
  cities: string[]; // 城市 display_name 列表（全量）
};

// 多城市套利概览：一次批量拉取全部城市，慢城由后端 partial 降级进
// missing/errors；60s 轮询会在下一轮自动补齐缺失城市。
export function useMultiCityArbitrageQuery({
  cities,
}: UseMultiCityArbitrageQueryOptions) {
  const { data, error, loading, remote, reset, run } =
    useRemoteDataQuery<ArbitrageBatchOverviewResponse>();
  const lastForcedRefreshAtRef = useRef(0);
  const citiesRef = useRef(cities);
  citiesRef.current = cities;
  const citiesKey = cities.join(",");

  const fetchOverviewBatch = useCallback(
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
      const names = citiesRef.current;
      if (!names.length) return;
      if (forceRefresh) {
        lastForcedRefreshAtRef.current = Date.now();
      }
      await run({
        request: (signal) =>
          arbitrageClient.fetchOverviewBatch({ cities: names, forceRefresh, signal }),
        showLoading,
      });
    },
    [run],
  );

  // 首次进入 + 城市列表变化：清空旧数据后重新拉取。
  useEffect(() => {
    reset();
    void fetchOverviewBatch({ showLoading: true });
  }, [citiesKey, fetchOverviewBatch, reset]);

  // 60s 自动轮询（仅页面可见时）。
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchOverviewBatch({ showLoading: false });
    }, ARBITRAGE_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [fetchOverviewBatch]);

  const refreshManually = useCallback(() => {
    if (
      shouldSkipManualTerminalRefresh({
        hasCurrentData: Boolean(data),
        lastForcedRefreshAt: lastForcedRefreshAtRef.current,
      })
    ) {
      return;
    }
    void fetchOverviewBatch({ forceRefresh: true, showLoading: true });
  }, [data, fetchOverviewBatch]);

  const details: Record<string, ArbitrageOverview> = data?.details ?? {};
  const missing: string[] = data?.missing ?? [];
  const errors: Record<string, string> = data?.errors ?? {};
  const partial = Boolean(data?.partial);

  return {
    data,
    details,
    error,
    errors,
    loading,
    missing,
    partial,
    refreshManually,
    remote,
  };
}
