import {
  buildStorageKey,
  readCachedPayload,
  writeCachedPayload,
} from "@/components/dashboard/scan-terminal/scan-terminal-cache";
import type { RemoteData } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v4";
const CITY_MARKET_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;

export type CityMarketScanStatus = "idle" | "loading" | "ready" | "failed";

export type CityMarketScanApiPayload =
  | MarketScan
  | {
      fetched_at?: string | null;
      market_scan?: MarketScan | null;
      selected_date?: string | null;
    };

export type CityMarketScanSnapshot =
  | { action: "reset"; cacheKey?: string }
  | { action: "success"; cacheKey: string; payload: MarketScan; shouldWriteCache?: boolean }
  | { action: "fetch"; cacheKey: string };

export function buildCityMarketScanCacheKey({
  detailCityName,
  localDate,
}: {
  detailCityName: string;
  localDate?: string | null;
}) {
  return buildStorageKey(CITY_MARKET_SCAN_CACHE_PREFIX, [
    normalizeCityKey(detailCityName),
    localDate || "",
    "full",
  ]);
}

export function readCachedCityMarketScan(cacheKey: string) {
  return normalizeCityMarketScanPayload(
    readCachedPayload<CityMarketScanApiPayload>(cacheKey, CITY_MARKET_SCAN_CACHE_TTL_MS),
  );
}

export function writeCachedCityMarketScan(cacheKey: string, payload: MarketScan) {
  writeCachedPayload(cacheKey, payload);
}

export function normalizeCityMarketScanPayload(
  payload: CityMarketScanApiPayload | null | undefined,
): MarketScan | null {
  if (!payload || typeof payload !== "object") return null;
  if ("market_scan" in payload) {
    const scan = payload.market_scan;
    if (!scan || typeof scan !== "object") return null;
    return {
      ...scan,
      selected_date: scan.selected_date ?? payload.selected_date ?? null,
    };
  }
  return payload as MarketScan;
}

export function resolveCityMarketScanSnapshot({
  detail,
  detailCityName,
  enabled,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  enabled: boolean;
}): CityMarketScanSnapshot {
  if (!detail) return { action: "reset" };
  const cacheKey = buildCityMarketScanCacheKey({
    detailCityName,
    localDate: detail.local_date || "",
  });
  if (detail.market_scan) {
    return {
      action: "success",
      cacheKey,
      payload: detail.market_scan,
      shouldWriteCache: true,
    };
  }
  const cached = readCachedCityMarketScan(cacheKey);
  if (cached) {
    return {
      action: "success",
      cacheKey,
      payload: cached,
    };
  }
  return enabled ? { action: "fetch", cacheKey } : { action: "reset", cacheKey };
}

export function deriveCityMarketScanView({
  detailMarketScan,
  marketRemote,
}: {
  detailMarketScan?: MarketScan | null;
  marketRemote: RemoteData<MarketScan>;
}) {
  const previousMarketScan =
    marketRemote.status === "loading" || marketRemote.status === "error"
      ? marketRemote.previous ?? null
      : null;
  const marketScan =
    marketRemote.status === "success"
      ? marketRemote.data
      : previousMarketScan ?? detailMarketScan ?? null;
  const marketStatus: CityMarketScanStatus =
    marketRemote.status === "success"
      ? "ready"
      : marketRemote.status === "loading"
        ? "loading"
        : marketRemote.status === "error"
          ? marketScan
            ? "ready"
            : "failed"
          : "idle";

  return { marketScan, marketStatus };
}
