"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  enqueueAiCityFetch,
  extractStreamingAirportRead,
  parseSseBlock,
} from "@/components/dashboard/scan-terminal/ai-city-stream";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v1";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v1";
const CITY_MARKET_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;

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

function buildPartialAiStreamPayload({
  fallbackText,
  isEn,
  tempSymbol,
}: {
  fallbackText?: string | null;
  isEn: boolean;
  tempSymbol?: string | null;
}): AiCityForecastPayload {
  const preservedText =
    String(fallbackText || "").trim() ||
    (isEn
      ? "The AI airport read stream was interrupted after partial output."
      : "AI 机场报文解读已输出部分内容，但最终载荷未返回。");
  const retryHint = isEn
    ? "The streaming connection ended before the final structured payload. The partial airport read above is preserved; refresh once if you need the full JSON-backed conclusion."
    : "流式连接在最终结构化载荷返回前结束。上方已保留已输出的机场报文解读；如需完整 JSON 结论可刷新一次。";

  return {
    city_forecast: {
      confidence: "low",
      final_judgment_en: isEn
        ? preservedText
        : "Partial AI airport read was preserved after the stream ended early.",
      final_judgment_zh: isEn
        ? "AI 机场报文解读已保留部分输出，但流式连接提前结束。"
        : preservedText,
      metar_read_en: isEn ? preservedText : "",
      metar_read_zh: isEn ? "" : preservedText,
      model_cluster_note_en: "",
      model_cluster_note_zh: "",
      predicted_max: null,
      range_high: null,
      range_low: null,
      reasoning_en: retryHint,
      reasoning_zh: retryHint,
      risks_en: isEn ? [retryHint] : [],
      risks_zh: isEn ? [] : [retryHint],
      unit: tempSymbol || "°C",
    },
    raw_reason: "partial_ai_stream_without_final_payload",
    reason: retryHint,
    reason_en: isEn
      ? retryHint
      : "AI stream ended before the final payload; partial text was preserved.",
    reason_zh: isEn ? "AI 流在最终载荷前结束；已保留部分文本。" : retryHint,
    status: "partial_stream",
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
    () =>
      detail
        ? `${normalizeCityKey(detailCityName)}:${detail.local_date || ""}:${locale}:${report || ""}`
        : "",
    [detail, detailCityName, locale, report],
  );
  const aiTempSymbol = detail?.temp_symbol || "°C";

  useEffect(() => {
    if (!enabled || !aiForecastKey) {
      setAiForecast({ status: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const cacheKey = buildStorageKey(AI_CITY_FORECAST_CACHE_PREFIX, [aiForecastKey]);
    const cachedPayload =
      aiRefreshToken <= 0
        ? readCachedPayload<AiCityForecastPayload>(
            cacheKey,
            AI_CITY_FORECAST_CACHE_TTL_MS,
          )
        : null;
    if (cachedPayload) {
      setAiForecast({ payload: cachedPayload, status: "ready" });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    setAiForecast({ status: "loading", streamText: null, streamRaw: "" });
    enqueueAiCityFetch(
      () =>
        fetch("/api/scan/terminal/ai-city/stream", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            city: detailCityName,
            force_refresh: aiRefreshToken > 0,
            locale,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            let detailMessage = "";
            try {
              const errorPayload = await response.json();
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
          const contentType = response.headers.get("content-type") || "";
          if (!response.body || !contentType.includes("text/event-stream")) {
            return response.json() as Promise<AiCityForecastPayload>;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let rawStream = "";
          let finalPayload: AiCityForecastPayload | null = null;
          let latestReadableText = "";
          const rememberReadableText = (value?: string | null) => {
            const text = String(value || "").trim();
            if (text) {
              latestReadableText = text;
            }
          };
          const handleBlock = (block: string) => {
            const message = parseSseBlock(block);
            if (!message || !message.data || typeof message.data !== "object") {
              return;
            }
            const data = message.data as Record<string, unknown>;
            if (message.event === "progress") {
              const progressText =
                String(
                  locale === "en-US" ? data.message_en || "" : data.message_zh || "",
                ).trim() || String(data.message || "").trim();
              if (progressText && !cancelled) {
                rememberReadableText(progressText);
                setAiForecast((current) =>
                  current.status === "loading"
                    ? { ...current, streamText: current.streamText || progressText }
                    : current,
                );
              }
            } else if (message.event === "preview") {
              const previewText =
                String(
                  locale === "en-US"
                    ? data.metar_read_en || ""
                    : data.metar_read_zh || "",
                ).trim() ||
                String(data.metar_read_zh || data.metar_read_en || "").trim() ||
                String(
                  locale === "en-US"
                    ? data.final_judgment_en || ""
                    : data.final_judgment_zh || "",
                ).trim() ||
                String(data.final_judgment_zh || data.final_judgment_en || "").trim();
              if (previewText && !cancelled) {
                rememberReadableText(previewText);
                setAiForecast((current) =>
                  current.status === "loading"
                    ? {
                        ...current,
                        streamText: previewText,
                      }
                    : current,
                );
              }
            } else if (message.event === "delta") {
              const content = String(data.content || "");
              if (!content) return;
              rawStream += content;
              const airportRead = extractStreamingAirportRead(rawStream, locale);
              const streamingText =
                airportRead ||
                (rawStream.trim()
                  ? isEn
                    ? "AI has started streaming; parsing the METAR read field…"
                    : "AI 已开始流式输出，正在解析机场报文字段…"
                  : "");
              rememberReadableText(airportRead || streamingText);
              if (!cancelled) {
                setAiForecast((current) =>
                  current.status === "loading"
                    ? {
                        ...current,
                        streamRaw: rawStream,
                        streamText: streamingText || current.streamText || null,
                      }
                    : current,
                );
              }
            } else if (message.event === "final") {
              finalPayload = data as AiCityForecastPayload;
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\n\n|\r\n\r\n/);
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              handleBlock(block);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) {
            handleBlock(buffer);
          }
          if (!finalPayload) {
            const fallbackText =
              extractStreamingAirportRead(rawStream, locale) ||
              latestReadableText;
            const partialPayload = buildPartialAiStreamPayload({
              fallbackText,
              isEn,
              tempSymbol: aiTempSymbol,
            });
            writeCachedPayload(cacheKey, partialPayload);
            return partialPayload;
          }
          return finalPayload;
        }),
      controller.signal,
      {
        onQueued: () => {
          if (cancelled) return;
          setAiForecast((current) =>
            current.status === "loading"
              ? {
                  ...current,
                  streamText: isEn
                    ? "Waiting for the AI airport read queue..."
                    : "正在等待 AI 机场报文解读队列...",
                }
              : current,
          );
        },
        onStart: () => {
          if (cancelled) return;
          setAiForecast((current) =>
            current.status === "loading"
              ? {
                  ...current,
                  streamText: current.streamRaw
                    ? current.streamText
                    : isEn
                      ? "Connecting to DeepSeek V4-Pro for airport bulletin streaming..."
                      : "正在连接 DeepSeek V4-Pro，准备流式解读机场报文...",
                }
              : current,
          );
        },
      },
    )
      .then((payload) => {
        if (!cancelled) {
          writeCachedPayload(cacheKey, payload);
          setAiForecast({ payload, status: "ready" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          const message = String(error);
          if (message.includes("AI stream ended before final payload")) {
            setAiForecast((current) => {
              const partialPayload = buildPartialAiStreamPayload({
                fallbackText: current.streamText,
                isEn,
                tempSymbol: aiTempSymbol,
              });
              writeCachedPayload(cacheKey, partialPayload);
              return {
                payload: partialPayload,
                status: "ready",
              };
            });
            return;
          }
          setAiForecast({ error: String(error), status: "failed" });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [aiForecastKey, aiRefreshToken, aiTempSymbol, detailCityName, enabled, isEn, locale]);

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
      lite: true,
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
