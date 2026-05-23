import type { AiCityStreamProgress } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import {
  buildStorageKey,
  readCachedPayload,
  removeCachedPayload,
  writeCachedPayload,
} from "@/components/dashboard/scan-terminal/scan-terminal-cache";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { getDisplayAirportPrimary } from "@/lib/airport-observation-display";
import type { CityDetail } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

const AI_CITY_FORECAST_CACHE_PREFIX = "polyWeather_aiCityForecast_v6";
const AI_CITY_FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;

const aiCityForecastStateCache = new Map<
  string,
  { state: AiCityForecastState; updatedAt: number }
>();
const MAX_AI_FORECAST_CACHE_SIZE = 40;

function trimAiForecastCache() {
  if (aiCityForecastStateCache.size <= MAX_AI_FORECAST_CACHE_SIZE) return;
  const excess = aiCityForecastStateCache.size - MAX_AI_FORECAST_CACHE_SIZE;
  const keys = Array.from(aiCityForecastStateCache.keys());
  for (let i = 0; i < excess && i < keys.length; i++) {
    aiCityForecastStateCache.delete(keys[i]);
  }
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

export function buildAiCityForecastKey({
  detail,
  detailCityName,
  locale,
  report,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  locale: string;
  report: string;
}) {
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
}

export function buildAiCityForecastCacheKey(aiForecastKey: string) {
  return buildStorageKey(AI_CITY_FORECAST_CACHE_PREFIX, [aiForecastKey]);
}

export function buildAiCityForecastRequestKey(cacheKey: string, refreshToken: number) {
  return `${cacheKey}:${refreshToken > 0 ? `refresh:${refreshToken}` : "normal"}`;
}

export function readCachedAiForecastState(key: string) {
  const cached = aiCityForecastStateCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > AI_CITY_FORECAST_CACHE_TTL_MS) {
    aiCityForecastStateCache.delete(key);
    return null;
  }
  return cached.state;
}

export function writeCachedAiForecastState(
  key: string,
  state: AiCityForecastState,
) {
  if (!key || state.status === "idle") return;
  aiCityForecastStateCache.set(key, {
    state,
    updatedAt: Date.now(),
  });
  trimAiForecastCache();
}

export function readReadyCachedAiForecastState(cacheKey: string, refreshToken: number) {
  if (refreshToken > 0) return null;
  const cachedPayload = readCachedPayload<AiCityForecastPayload>(
    cacheKey,
    AI_CITY_FORECAST_CACHE_TTL_MS,
  );
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
      return readyState;
    }
    removeCachedPayload(cacheKey);
  }
  const cachedState = readCachedAiForecastState(cacheKey);
  return cachedState?.status === "ready" ? cachedState : null;
}

function getAiCityStreamProgressText(
  progress: AiCityStreamProgress,
  isEn: boolean,
) {
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

function computeFallbackPredictedMax(detail: CityDetail | null): number | null {
  if (!detail) return null;
  const multiModel = detail.multi_model ?? {};
  const entries = Object.entries(multiModel).filter(
    ([, v]) => v != null && Number.isFinite(v),
  ) as [string, number][];
  const values = entries.map(([, v]) => v);
  const debValue = detail.deb?.prediction ?? null;
  const nonDebValues = entries
    .filter(([name]) => !name.toLowerCase().includes("deb"))
    .map(([, v]) => v);
  const sorted = [...nonDebValues].sort((a, b) => a - b);
  const clusterMedian =
    sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  let predicted = clusterMedian;
  if (predicted == null && debValue != null && Number.isFinite(debValue))
    predicted = debValue;
  if (predicted == null && values.length > 0)
    predicted = values.reduce((a, b) => a + b, 0) / values.length;
  if (predicted == null) {
    const isHkoObservation = isHkoObservationCity(detail);
    const displayAirportPrimary = getDisplayAirportPrimary(detail);
    const currentTemp =
      (isHkoObservation
        ? detail?.current?.temp
        : detail?.airport_current?.temp ??
          displayAirportPrimary?.temp ??
          detail?.current?.temp) ?? null;
    predicted = currentTemp != null && Number.isFinite(currentTemp)
      ? currentTemp
      : null;
  }
  return predicted;
}

export function buildAiCityFallbackPayload({
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
  const displayAirportPrimary = getDisplayAirportPrimary(detail);
  const currentTemp =
    (isHkoObservation
      ? detail?.current?.temp
      : detail?.airport_current?.temp ??
        displayAirportPrimary?.temp ??
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

  const fallbackPredictedMax = computeFallbackPredictedMax(detail);
  const multiModel = detail?.multi_model ?? {};
  const modelValues = Object.values(multiModel).filter(
    (v): v is number => v != null && Number.isFinite(v),
  );

  return {
    city_forecast: {
      confidence: "low",
      final_judgment_en: finalEn,
      final_judgment_zh: finalZh,
      metar_read_en: metarEn,
      metar_read_zh: metarZh,
      model_cluster_note_en: "",
      model_cluster_note_zh: "",
      predicted_max: fallbackPredictedMax,
      range_high: modelValues.length > 0 ? Math.max(...modelValues) : null,
      range_low: modelValues.length > 0 ? Math.min(...modelValues) : null,
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

export function buildAiCityLoadingForecastState({
  cacheKey,
  detail,
  isEn,
  report,
}: {
  cacheKey: string;
  detail: CityDetail | null;
  isEn: boolean;
  report: string;
}) {
  const cachedState = readCachedAiForecastState(cacheKey);
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
  return loadingState;
}

function hasPreviewQuantFields(progress: AiCityStreamProgress) {
  return (
    progress.predicted_max != null ||
    progress.range_low != null ||
    progress.range_high != null
  );
}

function mergePreviewQuantPayload(
  current: AiCityForecastState,
  progress: AiCityStreamProgress,
): AiCityForecastPayload {
  const prev = current.payload ?? {};
  const prevCf = prev.city_forecast ?? {};
  return {
    ...prev,
    status: prev.status ?? "ready",
    city_forecast: {
      ...prevCf,
      ...(progress.predicted_max != null
        ? { predicted_max: progress.predicted_max }
        : {}),
      ...(progress.range_low != null
        ? { range_low: progress.range_low }
        : {}),
      ...(progress.range_high != null
        ? { range_high: progress.range_high }
        : {}),
      ...(progress.confidence != null
        ? { confidence: progress.confidence }
        : {}),
      ...(progress.unit != null ? { unit: progress.unit } : {}),
      ...(progress.metar_read_zh != null
        ? { metar_read_zh: progress.metar_read_zh }
        : {}),
      ...(progress.metar_read_en != null
        ? { metar_read_en: progress.metar_read_en }
        : {}),
      ...(progress.final_judgment_zh != null
        ? { final_judgment_zh: progress.final_judgment_zh }
        : {}),
      ...(progress.final_judgment_en != null
        ? { final_judgment_en: progress.final_judgment_en }
        : {}),
      ...(progress.model_cluster_note_zh != null
        ? { model_cluster_note_zh: progress.model_cluster_note_zh }
        : {}),
      ...(progress.model_cluster_note_en != null
        ? { model_cluster_note_en: progress.model_cluster_note_en }
        : {}),
    },
  };
}

export function buildAiCityProgressForecastState({
  cacheKey,
  current,
  isEn,
  progress,
}: {
  cacheKey: string;
  current: AiCityForecastState;
  isEn: boolean;
  progress: AiCityStreamProgress;
}) {
  const progressText = getAiCityStreamProgressText(progress, isEn);
  const hasQuant = hasPreviewQuantFields(progress);
  if (!progressText && !hasQuant) return null;
  const cachedProgressState = readCachedAiForecastState(cacheKey);
  const nextStreamText =
    progress.stage === "calling_ai" && cachedProgressState?.streamText
      ? cachedProgressState.streamText
      : progressText || cachedProgressState?.streamText || "";
  const nextPayload = hasQuant
    ? mergePreviewQuantPayload(
        cachedProgressState ?? current,
        progress,
      )
    : cachedProgressState?.payload ?? current.payload;
  const cachedNextState: AiCityForecastState = {
    ...cachedProgressState,
    status: "loading",
    streamText: nextStreamText,
    payload: nextPayload,
  };
  writeCachedAiForecastState(cacheKey, cachedNextState);
  return {
    ...current,
    status: "loading" as const,
    streamText:
      progress.stage === "calling_ai" && current.streamText
        ? current.streamText
        : progressText || current.streamText || "",
    payload: hasQuant
      ? mergePreviewQuantPayload(current, progress)
      : current.payload,
  } satisfies AiCityForecastState;
}

export function buildAiCityReadyForecastState({
  cacheKey,
  detail,
  isEn,
  payload,
  report,
}: {
  cacheKey: string;
  detail: CityDetail | null;
  isEn: boolean;
  payload: AiCityForecastPayload;
  report: string;
}) {
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
  const readyState: AiCityForecastState = {
    payload: usablePayload,
    status: "ready",
  };
  writeCachedAiForecastState(cacheKey, readyState);
  return readyState;
}

export function buildAiCityErrorForecastState({
  cacheKey,
  detail,
  error,
  isEn,
  report,
}: {
  cacheKey: string;
  detail: CityDetail | null;
  error: unknown;
  isEn: boolean;
  report: string;
}) {
  const fallbackPayload = buildAiCityFallbackPayload({
    detail,
    error,
    isEn,
    report,
  });
  const readyState: AiCityForecastState = {
    payload: fallbackPayload,
    status: "ready",
  };
  writeCachedAiForecastState(cacheKey, readyState);
  return readyState;
}
