"use client";

import { useEffect } from "react";
import { scanTerminalClient } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import { useRemoteDataQuery } from "@/components/dashboard/scan-terminal/use-remote-data-query";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import {
  deriveCityMarketScanView,
  resolveCityMarketScanSnapshot,
  writeCachedCityMarketScan,
} from "./market-scan-state";

export function useCityMarketScan({
  detail,
  detailCityName,
  enabled = true,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  enabled?: boolean;
}) {
  const {
    remote: marketRemote,
    reset: resetMarketRemote,
    run: runMarketScanQuery,
    setSuccess: setMarketScanSuccess,
  } = useRemoteDataQuery<MarketScan>();

  useEffect(() => {
    const snapshot = resolveCityMarketScanSnapshot({
      detail,
      detailCityName,
      enabled,
    });
    if (snapshot.action === "reset") {
      resetMarketRemote();
      return;
    }
    if (snapshot.action === "success") {
      setMarketScanSuccess(snapshot.payload);
      if (snapshot.shouldWriteCache) {
        writeCachedCityMarketScan(snapshot.cacheKey, snapshot.payload);
      }
      return;
    }
    void runMarketScanQuery({
      request: (signal) =>
        scanTerminalClient.getMarketScan(detailCityName, {
          lite: false,
          signal,
          targetDate: detail?.local_date || null,
        }),
      showLoading: true,
      onSuccess: (payload) => {
        if (payload) {
          writeCachedCityMarketScan(snapshot.cacheKey, payload);
        }
      },
    });
  }, [
    detail,
    detailCityName,
    enabled,
    resetMarketRemote,
    runMarketScanQuery,
    setMarketScanSuccess,
  ]);

  const { marketScan, marketStatus } = deriveCityMarketScanView({
    detailMarketScan: detail?.market_scan,
    marketRemote,
  });

  return { marketRemote, marketScan, marketStatus };
}
