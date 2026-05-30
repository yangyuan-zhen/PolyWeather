import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_REFRESH_POLICY_MS,
  DASHBOARD_REFRESH_POLICY_SEC,
} from "@/lib/refresh-policy";
import { scanTerminalQueryPolicy } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import {
  __shouldFetchCityDetailForChartForTest,
  __shouldPollLiveChartForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";
import {
  MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS,
  HOURLY_CACHE_TTL_MS,
  __readHourlyCacheEntryForTest,
  __resetHourlyDetailRequestQueueForTest,
  __runQueuedHourlyDetailRequestForTest,
  clearCityDetailCache,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

export async function runTests() {
  assert(DASHBOARD_REFRESH_POLICY_MS.observation === 60_000, "observation layer should refresh every 60 seconds");
  assert(DASHBOARD_REFRESH_POLICY_MS.scanRows === 5 * 60_000, "region/city rows should refresh every 5 minutes");
  assert(DASHBOARD_REFRESH_POLICY_MS.marketOverview === 10 * 60_000, "market overview should refresh every 10 minutes");
  assert(DASHBOARD_REFRESH_POLICY_MS.model === 30 * 60_000, "DEB and multi-model data should refresh every 30 minutes");
  assert(DASHBOARD_REFRESH_POLICY_SEC.metar === 5 * 60, "METAR polling should be 5 minutes");
  assert(scanTerminalQueryPolicy.autoRefreshMs === null, "scan terminal auto refresh should be disabled after SSE patch migration");

  const projectRoot = process.cwd();
  const querySource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "use-scan-terminal-query.ts"),
    "utf8",
  );
  const chartSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx"),
    "utf8",
  );
  const chartLogicSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "temperature-chart-logic.ts"),
    "utf8",
  );

  assert(
    querySource.includes("useSsePatchVersion") &&
      !querySource.includes("window.setInterval"),
    "scan list should subscribe to SSE patch state instead of running a 5-minute interval",
  );
  assert(
    chartLogicSource.includes("DASHBOARD_REFRESH_POLICY_MS.metar") &&
      !chartSource.includes("window.setInterval"),
    "selected city detail chart cache should align with 5-minute scan/metar cadence",
  );
  assert(
    chartSource.includes("useLatestPatch") &&
      chartSource.includes("latestPatch") &&
      chartSource.includes("2 * 60_000"),
    "selected city chart should consume SSE patches and use a 2-minute no-patch fallback",
  );
  assert(
    chartSource.includes("fetchHourlyForecastForCity(city, { ignoreCache: true, resolution: targetResolution })") &&
      chartSource.includes("setHourly(data)"),
    "visible chart fallback must refresh the full city detail payload at the current chart resolution when SSE patches stop",
  );
  assert(
    __shouldPollLiveChartForTest({ city: "shanghai", compact: true, isActive: false, isMaximized: false }) === true,
    "compact grid slots are visible charts and should run the no-patch fallback guard",
  );
  assert(
    __shouldPollLiveChartForTest({ city: "shanghai", compact: false, isActive: false, isMaximized: false }) === false,
    "inactive non-compact charts should not run live polling",
  );
  assert(
    chartLogicSource.includes("_hourlyRequestCache") &&
      chartLogicSource.includes("seedHourlyForecastFromRow") &&
      chartSource.includes("setHourly(seedHourlyForecastFromRow(row))"),
    "terminal charts should render from row data immediately and dedupe concurrent city detail requests",
  );
  assert(
    chartSource.includes("IntersectionObserver") &&
      chartSource.includes("shouldFetchCityDetailForChart") &&
      chartSource.includes("isChartVisible"),
    "city detail prefetch should be gated to visible chart cards instead of every mounted slot",
  );
  assert(
    chartSource.includes("allowStale: true") &&
      chartCanvasSourceIncludes(chartSource, "数据暂不可用") &&
      chartCanvasSourceIncludes(chartSource, "handleRetryDetail"),
    "city detail charts should show stale cache first and expose a retryable unavailable state",
  );
  assert(
    __shouldFetchCityDetailForChartForTest({ city: "paris", documentHidden: false, isChartVisible: true }) === true,
    "visible chart cards should fetch city detail",
  );
  assert(
    __shouldFetchCityDetailForChartForTest({ city: "paris", documentHidden: false, isChartVisible: false }) === false,
    "offscreen chart cards should not prefetch city detail",
  );
  assert(
    __shouldFetchCityDetailForChartForTest({ city: "paris", documentHidden: true, isChartVisible: true }) === false,
    "hidden browser tabs should not prefetch city detail",
  );

  __resetHourlyDetailRequestQueueForTest();
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let startedRequests = 0;
  const releases: Array<(() => void) | undefined> = [];
  const requestCount = MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS + 3;

  const requests = Array.from({ length: requestCount }, (_, index) =>
    __runQueuedHourlyDetailRequestForTest(
      () =>
        new Promise<number>((resolve) => {
          startedRequests += 1;
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          releases[index] = () => {
            activeRequests -= 1;
            resolve(index);
          };
        }),
    ),
  );

  await flushMicrotasks();
  assert(
    startedRequests === MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS,
    "city detail queue should start only the configured number of concurrent requests",
  );
  assert(
    maxActiveRequests === MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS,
    "city detail queue must cap simultaneous full-detail requests",
  );

  releases[0]?.();
  await flushMicrotasks();
  assert(
    startedRequests === MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS + 1,
    "city detail queue should start the next pending request when one active request finishes",
  );

  for (let index = 1; index < requestCount; index += 1) {
    await flushMicrotasks();
    assert(Boolean(releases[index]), `city detail queue should eventually start queued request #${index}`);
    releases[index]?.();
  }
  const results = await Promise.all(requests);
  assert(
    results.length === requestCount && results.every((value, index) => value === index),
    "city detail queue should resolve every queued request in order",
  );
  __resetHourlyDetailRequestQueueForTest();

  const originalWindow = (globalThis as any).window;
  const originalSessionStorage = (globalThis as any).sessionStorage;
  const store = new Map<string, string>();
  (globalThis as any).window = {};
  (globalThis as any).sessionStorage = {
    get length() {
      return store.size;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  try {
    clearCityDetailCache();
    const cacheKey = "paris:10m";
    store.set(
      `polyweather_city_detail_v1:${cacheKey}`,
      JSON.stringify({
        ts: Date.now() - HOURLY_CACHE_TTL_MS - 1000,
        data: {
          forecastDaily: [],
          localDate: "2026-05-31",
          multiModelDaily: {},
          probabilities: null,
          temps: [21],
          times: ["00:00"],
        },
      }),
    );
    assert(
      __readHourlyCacheEntryForTest(cacheKey) === null,
      "stale city detail cache should not suppress a fresh revalidation",
    );
    assert(
      __readHourlyCacheEntryForTest(cacheKey, { allowStale: true })?.data?.temps[0] === 21,
      "stale city detail cache should still be available for immediate chart rendering",
    );
  } finally {
    clearCityDetailCache();
    (globalThis as any).window = originalWindow;
    (globalThis as any).sessionStorage = originalSessionStorage;
  }
}

function chartCanvasSourceIncludes(source: string, pattern: string) {
  return source.includes(pattern) || fs.readFileSync(
    path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx"),
    "utf8",
  ).includes(pattern);
}
