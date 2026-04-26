"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v2";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v2";
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
    ? "AI 解读暂未返回；先以多模型集中度和最新 METAR 实况作为判断依据。"
    : "AI 解读暂不可用；先以多模型集中度和最新 METAR 实况作为判断依据。";
  const finalEn = timeoutLike
    ? "The AI read is not back yet; use the model cluster and latest METAR as the working read."
    : "The AI read is temporarily unavailable; use the model cluster and latest METAR as the working read.";
  const metarZh = rawMetar
    ? `最新 METAR 显示 ${currentText}；原始报文已保留，可继续结合后续报文确认温度路径。`
    : `当前可先参考 ${currentText} 与多模型路径，等待下一次机场报文更新。`;
  const metarEn = rawMetar
    ? `Latest METAR shows ${currentText}; the raw bulletin is preserved and later reports should confirm the path.`
    : `Use ${currentText} and the model path for now while waiting for the next airport bulletin.`;
  const reasonZh = timeoutLike
    ? "AI 服务响应较慢，本次未在页面等待窗口内完成；页面已自动降级为天气证据模式。"
    : "AI 服务本次没有返回可用解读；页面已自动降级为天气证据模式。";
  const reasonEn = timeoutLike
    ? "The AI service was slow and did not finish within the page wait window; the card fell back to weather evidence mode."
    : "The AI service did not return a usable read; the card fell back to weather evidence mode.";

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
    () =>
      detail
        ? `${normalizeCityKey(detailCityName)}:${detail.local_date || ""}:${locale}:${report || ""}`
        : "",
    [detail, detailCityName, locale, report],
  );
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
    setAiForecast({
      status: "loading",
      streamText: isEn
        ? "DeepSeek V4-Pro is reading the latest airport bulletin..."
        : "DeepSeek V4-Pro 正在解读最新机场报文...",
    });
    fetch("/api/scan/terminal/ai-city", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        city: detailCityName,
        force_refresh: aiRefreshToken > 0,
        locale,
      }),
    })
      .then(async (response) => {
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
        return response.json() as Promise<AiCityForecastPayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          const usablePayload =
            payload?.city_forecast
              ? payload
              : buildAiCityFallbackPayload({
                  detail,
                  error: payload?.reason || payload?.raw_reason || payload?.status,
                  isEn,
                  report,
                });
          writeCachedPayload(cacheKey, usablePayload);
          setAiForecast({ payload: usablePayload, status: "ready" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          const fallbackPayload = buildAiCityFallbackPayload({
            detail,
            error,
            isEn,
            report,
          });
          writeCachedPayload(cacheKey, fallbackPayload);
          setAiForecast({ payload: fallbackPayload, status: "ready" });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
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
