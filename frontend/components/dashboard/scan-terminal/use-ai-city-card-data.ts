"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import {
  scanTerminalClient,
  type AiCityStreamProgress,
  type RemoteData,
  toRemoteError,
  toRemoteLoading,
  toRemoteSuccess,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";
import {
  buildStorageKey,
  readCachedPayload,
  removeCachedPayload,
  writeCachedPayload,
} from "@/components/dashboard/scan-terminal/scan-terminal-cache";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v6";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const CITY_MARKET_SCAN_CACHE_PREFIX = "polyWeather_cityMarketScan_v3";
const CITY_MARKET_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
type CityMarketScanStatus = "idle" | "loading" | "ready" | "failed";
const aiCityForecastStateCache = new Map<
  string,
  { state: AiCityForecastState; updatedAt: number }
>();

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
  const reasonZh = `DEB、多模型集合和最新${sourceZh}已足够给出当前方向判断；页面会在 DeepSeek 返回后合并完整机场报文解读。`;
  const reasonEn = `DEB, the model cluster and latest ${sourceEn} are enough for the current directional read; the page will merge the full airport-bulletin read when DeepSeek returns.`;

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
          observationCurrent.receipt_time,
          observationCurrent.temp,
          observationCurrent.max_so_far,
          observationCurrent.station_code,
          detail.metar_status?.stale_for_today,
          detail.metar_status?.last_observation_time,
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
    void scanTerminalClient.streamAiCityRead({
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
  const [marketRemote, setMarketRemote] = useState<RemoteData<MarketScan>>(
    detail?.market_scan ? toRemoteSuccess(detail.market_scan) : { status: "idle" },
  );

  useEffect(() => {
    if (!detail) {
      setMarketRemote({ status: "idle" });
      return;
    }
    const cacheKey = buildStorageKey(CITY_MARKET_SCAN_CACHE_PREFIX, [
      normalizeCityKey(detailCityName),
      detail.local_date || "",
      "full",
    ]);
    let cancelled = false;
    if (detail.market_scan) {
      setMarketRemote(toRemoteSuccess(detail.market_scan));
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
        setMarketRemote(toRemoteSuccess(cached));
      } else {
        setMarketRemote({ status: "idle" });
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
      setMarketRemote(toRemoteSuccess(cached));
      return () => {
        cancelled = true;
      };
    } else {
      setMarketRemote((current) => toRemoteLoading(current));
    }
    const controller = new AbortController();
    void scanTerminalClient.getMarketScan(detailCityName, {
      lite: false,
      signal: controller.signal,
      targetDate: detail.local_date || null,
    })
      .then((payload) => {
        if (cancelled) return;
        if (payload) {
          writeCachedPayload(cacheKey, payload);
        }
        const nextPayload = payload || detail.market_scan || null;
        if (nextPayload) {
          setMarketRemote(toRemoteSuccess(nextPayload));
        } else {
          setMarketRemote({ status: "idle" });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (detail.market_scan) {
          setMarketRemote(toRemoteSuccess(detail.market_scan));
        } else {
          setMarketRemote((current) => toRemoteError(error, current));
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detail, detailCityName, enabled]);

  const previousMarketScan =
    marketRemote.status === "loading" || marketRemote.status === "error"
      ? marketRemote.previous ?? null
      : null;
  const marketScan =
    marketRemote.status === "success"
      ? marketRemote.data
      : previousMarketScan ?? detail?.market_scan ?? null;
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

  return { marketRemote, marketScan, marketStatus };
}
