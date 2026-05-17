import assert from "node:assert/strict";
import {
  buildAiCityErrorForecastState,
  buildAiCityForecastCacheKey,
  buildAiCityForecastKey,
  buildAiCityProgressForecastState,
  buildAiCityReadyForecastState,
  readReadyCachedAiForecastState,
} from "@/components/dashboard/scan-terminal/ai-city-forecast-stream-state";
import { readCachedPayload, writeCachedPayload } from "@/components/dashboard/scan-terminal/scan-terminal-cache";
import type { AiCityForecastPayload, AiCityForecastState } from "@/components/dashboard/scan-terminal/types";
import type { CityDetail } from "@/lib/dashboard-types";

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

function cityDetail(extra: Partial<CityDetail> = {}): CityDetail {
  return {
    airport_current: {
      raw_metar: "METAR TEST 010000Z 34004KT CAVOK 21/10 Q1012",
      temp: 21,
    },
    current: {
      temp: 21,
    },
    local_date: "2026-04-28",
    metar_status: {
      last_observation_time: "2026-04-28T00:00:00Z",
      stale_for_today: false,
    },
    name: "Test City",
    temp_symbol: "°C",
    ...extra,
  } as CityDetail;
}

function readyPayload(extra: Partial<AiCityForecastPayload> = {}): AiCityForecastPayload {
  return {
    city_forecast: {
      confidence: "medium",
      final_judgment_en: "Centered near 25°C.",
      final_judgment_zh: "预计最高温以 25°C 为中枢。",
      metar_read_en: "Latest METAR supports the path.",
      metar_read_zh: "最新 METAR 支撑当前路径。",
      model_cluster_note_en: "Models are clustered.",
      model_cluster_note_zh: "模型较集中。",
      predicted_max: 25,
      range_high: 26,
      range_low: 24,
      reasoning_en: "Evidence is aligned.",
      reasoning_zh: "证据一致。",
      risks_en: [],
      risks_zh: [],
      unit: "°C",
    },
    status: "ready",
    ...extra,
  };
}

export function runTests() {
  const storage = installLocalStorageMock();
  storage.clear();

  const forecastKey = buildAiCityForecastKey({
    detail: cityDetail(),
    detailCityName: "Test City",
    locale: "zh-CN",
    report: "METAR TEST 010000Z 34004KT CAVOK 21/10 Q1012",
  });
  const cacheKey = buildAiCityForecastCacheKey(forecastKey);
  const payload = readyPayload();
  writeCachedPayload(cacheKey, payload);

  const cachedReady = readReadyCachedAiForecastState(cacheKey, 0);
  assert.equal(cachedReady?.status, "ready");
  assert.equal(cachedReady?.payload?.city_forecast?.predicted_max, 25);

  const degradedCacheKey = `${cacheKey}:degraded`;
  writeCachedPayload(degradedCacheKey, readyPayload({ degraded: true }));
  assert.equal(readReadyCachedAiForecastState(degradedCacheKey, 0), null);
  assert.equal(readCachedPayload(degradedCacheKey, 60 * 60 * 1000), null);

  const currentLoading: AiCityForecastState = {
    status: "loading",
    streamText: "已有快速判断",
  };
  const callingAiProgress = buildAiCityProgressForecastState({
    cacheKey: `${cacheKey}:progress`,
    current: currentLoading,
    isEn: false,
    progress: {
      message_zh: "DeepSeek 正在补充机场报文细节",
      stage: "calling_ai",
    },
  });
  assert.equal(callingAiProgress?.streamText, "已有快速判断");

  const errorState = buildAiCityErrorForecastState({
    cacheKey: `${cacheKey}:error`,
    detail: cityDetail(),
    error: new Error("timeout"),
    isEn: false,
    report: "METAR TEST 010000Z 34004KT CAVOK 21/10 Q1012",
  });
  assert.equal(errorState.status, "ready");
  assert.equal(errorState.payload?.status, "timeout_fallback");
  assert.match(errorState.payload?.reason_zh || "", /DeepSeek|DEB|METAR/);

  const modelFallbackState = buildAiCityErrorForecastState({
    cacheKey: `${cacheKey}:models`,
    detail: cityDetail({
      deb: { prediction: 29 },
      multi_model: { ECMWF: 30, GFS: 32, ICON: 31 },
    } as unknown as Partial<CityDetail>),
    error: new Error("timeout"),
    isEn: false,
    report: "",
  });
  assert.equal(modelFallbackState.payload?.city_forecast?.predicted_max, 31);
  assert.equal(modelFallbackState.payload?.city_forecast?.range_low, 30);
  assert.equal(modelFallbackState.payload?.city_forecast?.range_high, 32);

  const hkoState = buildAiCityErrorForecastState({
    cacheKey: `${cacheKey}:hko`,
    detail: cityDetail({
      airport_current: null,
      current: {
        settlement_source: "hko",
        temp: 30,
      },
      settlement_station: {
        settlement_source: "hko",
      },
    } as unknown as Partial<CityDetail>),
    error: new Error("timeout"),
    isEn: false,
    report: "",
  });
  const hkoRead = hkoState.payload?.city_forecast?.metar_read_zh || "";
  assert.doesNotMatch(hkoRead, /METAR|机场报文/);
  assert.match(hkoRead, /官方观测|30\.0°C/);

  const degradedReadyState = buildAiCityReadyForecastState({
    cacheKey: `${cacheKey}:ready-degraded`,
    detail: cityDetail(),
    isEn: false,
    payload: readyPayload({ degraded: true }),
    report: "METAR TEST 010000Z 34004KT CAVOK 21/10 Q1012",
  });
  assert.equal(degradedReadyState.status, "ready");
  assert.equal(readCachedPayload(`${cacheKey}:ready-degraded`, 60 * 60 * 1000), null);
}
