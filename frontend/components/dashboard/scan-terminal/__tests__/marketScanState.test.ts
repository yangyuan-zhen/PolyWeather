import assert from "node:assert/strict";
import {
  buildCityMarketScanCacheKey,
  deriveCityMarketScanView,
  resolveCityMarketScanSnapshot,
  writeCachedCityMarketScan,
} from "@/components/dashboard/scan-terminal/market-scan-state";
import type { RemoteData } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorage = {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
  return localStorage;
}

function marketScan(label = "cached"): MarketScan {
  return {
    generated_at: "2026-04-28T00:00:00Z",
    label,
  } as unknown as MarketScan;
}

function cityDetail(extra: Partial<CityDetail> = {}): CityDetail {
  return {
    local_date: "2026-04-28",
    name: "Test City",
    ...extra,
  } as CityDetail;
}

export function runTests() {
  const storage = installLocalStorageMock();
  storage.clear();

  const embeddedScan = marketScan("embedded");
  const embeddedSnapshot = resolveCityMarketScanSnapshot({
    detail: cityDetail({ market_scan: embeddedScan }),
    detailCityName: "Test City",
    enabled: true,
  });
  assert.equal(embeddedSnapshot.action, "success");
  if (embeddedSnapshot.action === "success") {
    assert.equal(embeddedSnapshot.payload, embeddedScan);
    assert.equal(embeddedSnapshot.shouldWriteCache, true);
  }

  const cacheKey = buildCityMarketScanCacheKey({
    detailCityName: "Test City",
    localDate: "2026-04-28",
  });
  const cachedScan = marketScan("cached");
  writeCachedCityMarketScan(cacheKey, cachedScan);
  const cachedSnapshot = resolveCityMarketScanSnapshot({
    detail: cityDetail(),
    detailCityName: "Test City",
    enabled: false,
  });
  assert.equal(cachedSnapshot.action, "success");
  if (cachedSnapshot.action === "success") {
    assert.equal((cachedSnapshot.payload as unknown as { label: string }).label, "cached");
  }

  storage.clear();
  assert.equal(
    resolveCityMarketScanSnapshot({
      detail: cityDetail(),
      detailCityName: "Test City",
      enabled: false,
    }).action,
    "reset",
  );
  assert.equal(
    resolveCityMarketScanSnapshot({
      detail: cityDetail(),
      detailCityName: "Test City",
      enabled: true,
    }).action,
    "fetch",
  );

  const previous = marketScan("previous");
  const loadingRemote: RemoteData<MarketScan> = {
    previous,
    status: "loading",
  };
  const loadingView = deriveCityMarketScanView({
    detailMarketScan: null,
    marketRemote: loadingRemote,
  });
  assert.equal(loadingView.marketStatus, "loading");
  assert.equal(loadingView.marketScan, previous);

  const errorWithPrevious = deriveCityMarketScanView({
    detailMarketScan: null,
    marketRemote: {
      error: "network",
      previous,
      status: "error",
    },
  });
  assert.equal(errorWithPrevious.marketStatus, "ready");
  assert.equal(errorWithPrevious.marketScan, previous);

  const errorWithoutPrevious = deriveCityMarketScanView({
    detailMarketScan: null,
    marketRemote: {
      error: "network",
      status: "error",
    },
  });
  assert.equal(errorWithoutPrevious.marketStatus, "failed");
  assert.equal(errorWithoutPrevious.marketScan, null);
}
