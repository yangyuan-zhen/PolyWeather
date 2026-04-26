"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
} from "@/lib/backend-api";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { extractStreamingAirportRead } from "./ai-city-stream";
import { normalizeCityKey } from "./decision-utils";

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v4";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const AI_CITY_FORECAST_MAX_CONCURRENT_STREAMS = 2;
const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v3";
const CITY_MARKET_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
const pendingAiCityForecastRequests = new Map<
  string,
  Promise<AiCityForecastPayload>
>();
const queuedAiCityForecastTasks: Array<() => void> = [];
const aiCityForecastStateCache = new Map<
  string,
  { state: AiCityForecastState; updatedAt: number }
>();
let activeAiCityForecastStreams = 0;

type AiCityStreamProgress = {
  stage?: string | null;
  message_en?: string | null;
  message_zh?: string | null;
  final_judgment_en?: string | null;
  final_judgment_zh?: string | null;
  metar_read_en?: string | null;
  metar_read_zh?: string | null;
  raw_length?: number | null;
};

type AiCityStreamEvent = {
  data: Record<string, unknown>;
  event: string;
};

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function buildStorageKey(prefix: string, parts: Array<string | null | undefined>) {
  return `${prefix}:${parts
    .map((part) => encodeURIComponent(String(part || "").trim()))
    .join(":")}`;
}

function isHkoObservationCity(detail?: CityDetail | null) {
  const source = String(
    detail?.current?.settlement_source ||
      detail?.settlement_station?.settlement_source ||
      "",
  )
    .trim()
    .toLowerCase();
  return source === "hko";
}

function readCachedPayload<T>(key: string, ttlMs: number): T | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; payload?: T };
    if (!parsed?.payload) return null;
    if (Date.now() - Number(parsed.cachedAt || 0) > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

function writeCachedPayload<T>(key: string, payload: T) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ cachedAt: Date.now(), payload }));
  } catch {
    // Ignore quota/privacy-mode failures; network fallbacks still work.
  }
}

function removeCachedPayload(key: string) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore privacy-mode failures; the next network request can still proceed.
  }
}

function readCachedAiForecastState(key: string, ttlMs: number) {
  const cached = aiCityForecastStateCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > ttlMs) {
    aiCityForecastStateCache.delete(key);
    return null;
  }
  return cached.state;
}

function writeCachedAiForecastState(key: string, state: AiCityForecastState) {
  if (!key || state.status === "idle") return;
  aiCityForecastStateCache.set(key, {
    state,
    updatedAt: Date.now(),
  });
}

function runQueuedAiCityForecastTask<T>(
  task: () => Promise<T>,
  onQueued?: () => void,
) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeAiCityForecastStreams += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeAiCityForecastStreams = Math.max(
            0,
            activeAiCityForecastStreams - 1,
          );
          const next = queuedAiCityForecastTasks.shift();
          if (next) next();
        });
    };
    if (activeAiCityForecastStreams < AI_CITY_FORECAST_MAX_CONCURRENT_STREAMS) {
      run();
    } else {
      onQueued?.();
      queuedAiCityForecastTasks.push(run);
    }
  });
}

function parseAiCityStreamBlock(block: string): AiCityStreamEvent | null {
  const eventLines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  let event = "message";
  const dataLines: string[] = [];
  eventLines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || event;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  });
  if (!dataLines.length) return null;
  try {
    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    return { data, event };
  } catch {
    return null;
  }
}

async function readAiCityForecastStream(
  response: Response,
  locale: string,
  onProgress?: (progress: AiCityStreamProgress) => void,
) {
  if (!response.body) {
    return response.json() as Promise<AiCityForecastPayload>;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedRaw = "";
  let finalPayload: AiCityForecastPayload | null = null;

  const consumeBlock = (block: string) => {
    const parsed = parseAiCityStreamBlock(block);
    if (!parsed) return;
    const { data, event } = parsed;
    if (event === "final") {
      finalPayload = data as AiCityForecastPayload;
      return;
    }
    if (event === "progress" || event === "preview") {
      onProgress?.(data as AiCityStreamProgress);
      return;
    }
    if (event === "delta") {
      const content = String(data.content || "");
      const rawLength = Number(data.raw_length);
      if (content) {
        accumulatedRaw += content;
      }
      const streamingAirportRead = extractStreamingAirportRead(
        accumulatedRaw,
        locale,
      );
      const progress: AiCityStreamProgress = {
        raw_length: Number.isFinite(rawLength) ? rawLength : null,
      };
      if (streamingAirportRead) {
        if (locale === "en-US") {
          progress.metar_read_en = streamingAirportRead;
        } else {
          progress.metar_read_zh = streamingAirportRead;
        }
      }
      onProgress?.(progress);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(consumeBlock);
    if (done) break;
  }
  if (buffer.trim()) {
    consumeBlock(buffer);
  }
  if (!finalPayload) {
    throw new Error("AI stream ended before final payload");
  }
  return finalPayload;
}

function requestAiCityForecast({
  city,
  forceRefresh,
  locale,
  onProgress,
  requestKey,
}: {
  city: string;
  forceRefresh: boolean;
  locale: string;
  onProgress?: (progress: AiCityStreamProgress) => void;
  requestKey: string;
}) {
  const pending = pendingAiCityForecastRequests.get(requestKey);
  if (pending) return pending;

  const request = runQueuedAiCityForecastTask(async () => {
    const headers = await buildBrowserBackendHeaders({
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    });
    const response = await fetchBackendApi("/api/scan/terminal/ai-city/stream", {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        city,
        force_refresh: forceRefresh,
        locale,
      }),
    });
    if (!response.ok) {
      let detailMessage = "";
      try {
        const raw = await response.text();
        const errorPayload = JSON.parse(raw);
        const message = String(errorPayload?.error || "").trim();
        const rawDetail = String(errorPayload?.detail || "").trim();
        const elapsed = Number(errorPayload?.elapsed_ms);
        const timeout = Number(errorPayload?.timeout_ms);
        detailMessage = [
          message,
          rawDetail,
          Number.isFinite(elapsed) && Number.isFinite(timeout)
            ? `elapsed ${Math.round(elapsed / 1000)}s / timeout ${Math.round(timeout / 1000)}s`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
      } catch {
        detailMessage = "";
      }
      throw new Error(
        detailMessage
          ? `HTTP ${response.status} · ${detailMessage}`
          : `HTTP ${response.status}`,
      );
    }
    return readAiCityForecastStream(response, locale, onProgress);
  }, () => {
    onProgress?.({
      stage: "queued",
      message_en:
        "AI observation read is queued behind the cities already streaming...",
      message_zh: "AI 观测解读已排队，正在等待前面的城市完成流式生成…",
    });
  })
    .finally(() => {
      pendingAiCityForecastRequests.delete(requestKey);
    });

  pendingAiCityForecastRequests.set(requestKey, request);
  return request;
}

function getAiCityStreamProgressText(progress: AiCityStreamProgress, isEn: boolean) {
  const localizedMessage = String(
    (isEn ? progress.message_en : progress.message_zh) ||
      (isEn ? progress.final_judgment_en : progress.final_judgment_zh) ||
      (isEn ? progress.metar_read_en : progress.metar_read_zh) ||
      "",
  ).trim();
  if (localizedMessage) return localizedMessage;
  const rawLength = Number(progress.raw_length);
  if (Number.isFinite(rawLength) && rawLength > 0) {
    return isEn
      ? `DeepSeek is streaming the observation enhancement... ${Math.round(rawLength)} chars received.`
      : `DeepSeek 正在流式增强观测解读... 已收到 ${Math.round(rawLength)} 字符。`;
  }
  return "";
}

function buildAiCityFallbackPayload({
  detail,
  error,
  isEn,
  report,
}: {
  detail: CityDetail | null;
  error?: unknown;
  isEn: boolean;
  report: string;
}): AiCityForecastPayload {
  const tempSymbol = detail?.temp_symbol || "°C";
  const isHkoObservation = isHkoObservationCity(detail);
  const currentTemp =
    (isHkoObservation
      ? detail?.current?.temp
      : detail?.airport_current?.temp ??
        detail?.airport_primary?.temp ??
        detail?.current?.temp) ?? null;
  const currentText =
    currentTemp != null && Number.isFinite(Number(currentTemp))
      ? `${Number(currentTemp).toFixed(1)}${tempSymbol}`
      : isEn
        ? "the latest observed temperature"
        : "最新实测温度";
  const timeoutLike = /timeout|timed out|504|aborted|超时/i.test(String(error || ""));
  const rawMetar = isHkoObservation
    ? ""
    : String(report || detail?.airport_current?.raw_metar || detail?.current?.raw_metar || "").trim();
  const sourceZh = isHkoObservation ? "香港天文台观测" : "METAR";
  const sourceEn = isHkoObservation ? "Hong Kong Observatory observation" : "METAR";
  const bulletinZh = isHkoObservation ? "官方观测" : "机场报文";
  const bulletinEn = isHkoObservation ? "official observation" : "airport bulletin";

  const finalZh = timeoutLike
    ? `DeepSeek 增强暂未返回；当前先以多模型集中度和最新${sourceZh}快速判断。`
    : `当前先以多模型集中度和最新${sourceZh}快速判断。`;
  const finalEn = timeoutLike
    ? `DeepSeek enhancement is not back yet; use the model cluster and latest ${sourceEn} as the fast working read.`
    : `Use the model cluster and latest ${sourceEn} as the fast working read.`;
  const metarZh = rawMetar
    ? `最新 METAR 显示 ${currentText}；当前先作为实况锚点，并结合后续报文确认温度路径。`
    : `当前可先参考 ${currentText} 与多模型路径，等待下一次${bulletinZh}更新。`;
  const metarEn = rawMetar
    ? `Latest METAR shows ${currentText}; use it as the live anchor while later reports confirm the path.`
    : `Use ${currentText} and the model path for now while waiting for the next ${bulletinEn}.`;
  const reasonZh = `DEB、多模型集合和最新${sourceZh}已足够给出当前方向判断；DeepSeek 增强可作为后续补充。`;
  const reasonEn = `DEB, the model cluster and latest ${sourceEn} are enough for the current directional read; DeepSeek enhancement can be added later.`;

  return {
    city_forecast: {
      confidence: "low",
      final_judgment_en: finalEn,
      final_judgment_zh: finalZh,
      metar_read_en: metarEn,
      metar_read_zh: metarZh,
      model_cluster_note_en: "",
      model_cluster_note_zh: "",
      predicted_max: null,
      range_high: null,
      range_low: null,
      reasoning_en: reasonEn,
      reasoning_zh: reasonZh,
      risks_en: [],
      risks_zh: [],
      unit: tempSymbol,
    },
    raw_reason: timeoutLike ? "ai_timeout_fallback" : "ai_unavailable_fallback",
    reason: isEn ? reasonEn : reasonZh,
    reason_en: reasonEn,
    reason_zh: reasonZh,
    status: timeoutLike ? "timeout_fallback" : "fallback",
  };
}

export function useAiCityForecast({
  detail,
  detailCityName,
  isEn,
  locale,
  report,
  enabled = true,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  enabled?: boolean;
  isEn: boolean;
  locale: string;
  report: string;
}) {
  const [aiForecast, setAiForecast] = useState<AiCityForecastState>({
    status: "idle",
  });
  const [aiRefreshToken, setAiRefreshToken] = useState(0);
  const aiForecastKey = useMemo(
    () => {
      if (!detail) return "";
      const isHkoObservation = isHkoObservationCity(detail);
      const observationSource = isHkoObservation ? "hko" : "metar";
      const observationCurrent = isHkoObservation
        ? detail.current || {}
        : detail.airport_current || detail.current || {};
      const observationSignature =
        (!isHkoObservation ? String(report || "").trim() : "") ||
        [
          observationSource,
          observationCurrent.report_time,
          observationCurrent.obs_time_epoch,
          observationCurrent.obs_time,
          observationCurrent.temp,
          observationCurrent.station_code,
        ]
          .filter((part) => part != null && part !== "")
          .join("|");
      return [
        normalizeCityKey(detailCityName),
        detail.local_date || "",
        locale,
        observationSignature,
      ].join(":");
    },
    [detail, detailCityName, locale, report],
  );
  useEffect(() => {
    if (!enabled || !aiForecastKey) {
      setAiForecast({ status: "idle" });
      return;
    }
    let cancelled = false;
    const cacheKey = buildStorageKey(AI_CITY_FORECAST_CACHE_PREFIX, [aiForecastKey]);
    const requestKey = `${cacheKey}:${aiRefreshToken > 0 ? `refresh:${aiRefreshToken}` : "normal"}`;
    const cachedPayload =
      aiRefreshToken <= 0
        ? readCachedPayload<AiCityForecastPayload>(
            cacheKey,
            AI_CITY_FORECAST_CACHE_TTL_MS,
          )
        : null;
    if (cachedPayload) {
      if (
        cachedPayload.status === "ready" &&
        !cachedPayload.degraded &&
        cachedPayload.city_forecast
      ) {
        const readyState: AiCityForecastState = {
          payload: cachedPayload,
          status: "ready",
        };
        writeCachedAiForecastState(cacheKey, readyState);
        setAiForecast(readyState);
        return () => {
          cancelled = true;
        };
      }
      removeCachedPayload(cacheKey);
    }
    const cachedState =
      aiRefreshToken <= 0
        ? readCachedAiForecastState(cacheKey, AI_CITY_FORECAST_CACHE_TTL_MS)
        : null;
    if (cachedState?.status === "ready") {
      setAiForecast(cachedState);
      return () => {
        cancelled = true;
      };
    }
    const initialFallback = buildAiCityFallbackPayload({ detail, isEn, report });
    const loadingState: AiCityForecastState =
      cachedState?.status === "loading"
        ? cachedState
        : {
            status: "loading",
            streamText:
              (isEn
                ? initialFallback.city_forecast?.metar_read_en
                : initialFallback.city_forecast?.metar_read_zh) ||
              (isEn
                ? "Reading the latest observation with model fallback ready..."
                : "已先用最新观测给出兜底解读，正在等待 DeepSeek 补充…"),
          };
    writeCachedAiForecastState(cacheKey, loadingState);
    setAiForecast(loadingState);
    void requestAiCityForecast({
        city: detailCityName,
        forceRefresh: aiRefreshToken > 0,
        locale,
        onProgress: (progress) => {
          const progressText = getAiCityStreamProgressText(progress, isEn);
          if (!progressText) return;
          const cachedProgressState = readCachedAiForecastState(
            cacheKey,
            AI_CITY_FORECAST_CACHE_TTL_MS,
          );
          const nextStreamText =
            progress.stage === "calling_ai" && cachedProgressState?.streamText
              ? cachedProgressState.streamText
              : progressText;
          writeCachedAiForecastState(cacheKey, {
            ...cachedProgressState,
            status: "loading",
            streamText: nextStreamText,
          });
          if (cancelled) return;
          setAiForecast((current) => ({
            ...current,
            status: "loading",
            streamText:
              progress.stage === "calling_ai" && current.streamText
                ? current.streamText
                : progressText,
          }));
        },
        requestKey,
      })
      .then((payload) => {
        if (!payload) return;
        const usablePayload =
          payload?.city_forecast
            ? payload
            : buildAiCityFallbackPayload({
                detail,
                error: payload?.reason || payload?.raw_reason || payload?.status,
                isEn,
                report,
              });
        if (usablePayload.status === "ready" && !usablePayload.degraded) {
          writeCachedPayload(cacheKey, usablePayload);
        }
        writeCachedAiForecastState(cacheKey, {
          payload: usablePayload,
          status: "ready",
        });
        if (!cancelled) {
          setAiForecast({ payload: usablePayload, status: "ready" });
        }
      })
      .catch((error) => {
        const fallbackPayload = buildAiCityFallbackPayload({
          detail,
          error,
          isEn,
          report,
        });
        writeCachedAiForecastState(cacheKey, {
          payload: fallbackPayload,
          status: "ready",
        });
        if (!cancelled) {
          setAiForecast({ payload: fallbackPayload, status: "ready" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiForecastKey, aiRefreshToken, detail, detailCityName, enabled, isEn, locale, report]);

  const refreshAiForecast = useCallback(() => {
    setAiRefreshToken((current) => current + 1);
  }, []);

  return { aiForecast, refreshAiForecast };
}

export function useCityMarketScan({
  detail,
  detailCityName,
  enabled = true,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  enabled?: boolean;
}) {
  const ensureCityMarketScan = useDashboardStore().ensureCityMarketScan;
  const [marketScan, setMarketScan] = useState<MarketScan | null>(
    detail?.market_scan || null,
  );
  const [marketStatus, setMarketStatus] = useState<
    "idle" | "loading" | "ready" | "failed"
  >(detail?.market_scan ? "ready" : "idle");

  useEffect(() => {
    if (!detail) {
      setMarketScan(null);
      setMarketStatus("idle");
      return;
    }
    const cacheKey = buildStorageKey(CITY_MARKET_SCAN_CACHE_PREFIX, [
      normalizeCityKey(detailCityName),
      detail.local_date || "",
      "full",
    ]);
    let cancelled = false;
    if (detail.market_scan) {
      setMarketScan(detail.market_scan);
      setMarketStatus("ready");
      writeCachedPayload(cacheKey, detail.market_scan);
      return () => {
        cancelled = true;
      };
    }
    if (!enabled) {
      const cached = readCachedPayload<MarketScan>(
        cacheKey,
        CITY_MARKET_SCAN_CACHE_TTL_MS,
      );
      if (cached) {
        setMarketScan(cached);
        setMarketStatus("ready");
      } else {
        setMarketScan(null);
        setMarketStatus("idle");
      }
      return () => {
        cancelled = true;
      };
    }
    const cached = readCachedPayload<MarketScan>(
      cacheKey,
      CITY_MARKET_SCAN_CACHE_TTL_MS,
    );
    if (cached) {
      setMarketScan(cached);
      setMarketStatus("ready");
      return () => {
        cancelled = true;
      };
    } else {
      setMarketStatus("loading");
    }
    void ensureCityMarketScan(detailCityName, false, {
      lite: false,
      targetDate: detail.local_date || null,
    })
      .then((payload) => {
        if (cancelled) return;
        if (payload) {
          writeCachedPayload(cacheKey, payload);
        }
        setMarketScan(payload || detail.market_scan || null);
        setMarketStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMarketScan(detail.market_scan || null);
        setMarketStatus(detail.market_scan ? "ready" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [detail, detailCityName, enabled, ensureCityMarketScan]);

  return { marketScan, marketStatus };
}
