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

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v3";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v2";
const CITY_MARKET_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
const pendingAiCityForecastRequests = new Map<
  string,
  Promise<AiCityForecastPayload>
>();

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

  const request = buildBrowserBackendHeaders({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  })
    .then((headers) =>
      fetchBackendApi("/api/scan/terminal/ai-city/stream", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          city,
          force_refresh: forceRefresh,
          locale,
        }),
      }),
    )
    .then(async (response) => {
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
      ? `DeepSeek is streaming the airport-bulletin enhancement... ${Math.round(rawLength)} chars received.`
      : `DeepSeek 正在流式增强机场报文解读... 已收到 ${Math.round(rawLength)} 字符。`;
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
  const currentTemp =
    detail?.airport_current?.temp ??
    detail?.airport_primary?.temp ??
    detail?.current?.temp ??
    null;
  const currentText =
    currentTemp != null && Number.isFinite(Number(currentTemp))
      ? `${Number(currentTemp).toFixed(1)}${tempSymbol}`
      : isEn
        ? "the latest observed temperature"
        : "最新实测温度";
  const timeoutLike = /timeout|timed out|504|aborted|超时/i.test(String(error || ""));
  const rawMetar = String(report || detail?.airport_current?.raw_metar || detail?.current?.raw_metar || "").trim();

  const finalZh = timeoutLike
    ? "DeepSeek 增强暂未返回；当前先以多模型集中度和最新 METAR 实况快速判断。"
    : "当前先以多模型集中度和最新 METAR 实况快速判断。";
  const finalEn = timeoutLike
    ? "DeepSeek enhancement is not back yet; use the model cluster and latest METAR as the fast working read."
    : "Use the model cluster and latest METAR as the fast working read.";
  const metarZh = rawMetar
    ? `最新 METAR 显示 ${currentText}；当前先作为实况锚点，并结合后续报文确认温度路径。`
    : `当前可先参考 ${currentText} 与多模型路径，等待下一次机场报文更新。`;
  const metarEn = rawMetar
    ? `Latest METAR shows ${currentText}; use it as the live anchor while later reports confirm the path.`
    : `Use ${currentText} and the model path for now while waiting for the next airport bulletin.`;
  const reasonZh = "DEB、多模型集合和最新 METAR 已足够给出当前方向判断；DeepSeek 增强可作为后续补充。";
  const reasonEn = "DEB, the model cluster and latest METAR are enough for the current directional read; DeepSeek enhancement can be added later.";

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
      const airportCurrent = detail.airport_current || detail.current || {};
      const metarSignature =
        String(report || "").trim() ||
        [
          airportCurrent.report_time,
          airportCurrent.obs_time_epoch,
          airportCurrent.obs_time,
          airportCurrent.temp,
        ]
          .filter((part) => part != null && part !== "")
          .join("|");
      return [
        normalizeCityKey(detailCityName),
        detail.local_date || "",
        locale,
        metarSignature,
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
        setAiForecast({ payload: cachedPayload, status: "ready" });
        return () => {
          cancelled = true;
        };
      }
      removeCachedPayload(cacheKey);
    }
    const initialFallback = buildAiCityFallbackPayload({ detail, isEn, report });
    setAiForecast({
      status: "loading",
      streamText:
        (isEn
          ? initialFallback.city_forecast?.metar_read_en
          : initialFallback.city_forecast?.metar_read_zh) ||
        (isEn
          ? "Reading the latest airport bulletin with model/METAR fallback ready..."
          : "已先用最新 METAR 给出兜底解读，正在等待 DeepSeek 补充…"),
    });
    void requestAiCityForecast({
        city: detailCityName,
        forceRefresh: aiRefreshToken > 0,
        locale,
        onProgress: (progress) => {
          if (cancelled) return;
          const progressText = getAiCityStreamProgressText(progress, isEn);
          if (!progressText) return;
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
        if (!cancelled) {
          setAiForecast({ payload: usablePayload, status: "ready" });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const fallbackPayload = buildAiCityFallbackPayload({
            detail,
            error,
            isEn,
            report,
          });
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
      "lite",
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
