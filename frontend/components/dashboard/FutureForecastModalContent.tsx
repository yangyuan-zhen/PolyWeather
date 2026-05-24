"use client";

import clsx from "clsx";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { getFutureModalView } from "@/lib/dashboard-utils";
import { getModelView, getProbabilityView } from "@/lib/model-utils";
import { getTodayPaceView } from "@/lib/pace-utils";
import { dashboardClient } from "@/lib/dashboard-client";
import { getWeatherSummary } from "@/lib/weather-summary-utils";
import {
  normalizeObservationSourceCode,
  normalizeObservationSourceLabel,
} from "@/lib/source-labels";
import type {
  CityDetail,
  ForecastModalMode,
  LoadingState,
  MarketScan,
  ProAccessState,
} from "@/lib/dashboard-types";
import { FutureForecastForwardView } from "./FutureForecastForwardView";
import { FutureForecastTodayDecisionBrief } from "./FutureForecastTodayDecisionBrief";
import { FutureForecastTodayLayout } from "./FutureForecastTodayLayout";
import { FutureForecastModalHeader } from "./FutureForecastModalHeader";
import {
  FutureRefreshLock,
  FutureSyncStatusStrip,
  type FutureSyncStatusItem,
} from "./FutureForecastModalStatus";
import { type FuturePaceSignalItem } from "./FutureForecastTodayCards";
import {
  TODAY_MARKET_SCAN_AUTO_REFRESH_MS,
  clamp,
  formatBucketLabel,
  formatMarketPercent,
  getTrendMetricVisual,
  localizedList,
  localizedText,
  parseBucketBoundaries,
  parseClockMinutes,
  parseLeadingNumber,
} from "./FutureForecastModal.utils";

type FutureForecastModalControls = {
  closeFutureModal: () => void;
  forecastModalMode: ForecastModalMode | null;
  futureModalDate: string | null;
  loadingState: LoadingState;
  openFutureModal: (dateStr: string, forceRefresh?: boolean) => Promise<void>;
  openTodayModal: (forceRefresh?: boolean) => Promise<void>;
};

export function FutureForecastModalContent({
  modal,
  proAccess,
  locale,
  t,
  detail,
  dateStr,
}: {
  modal: FutureForecastModalControls;
  proAccess: ProAccessState;
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  detail: CityDetail;
  dateStr: string;
}) {
  const isPro = proAccess.subscriptionActive;
  const isProLoading = proAccess.loading;
  const hasModalContext = true;
  const [showDeferredTodaySections, setShowDeferredTodaySections] =
    useState(false);
  const [freshMarketScan, setFreshMarketScan] = useState<MarketScan | null>(
    null,
  );

  useEffect(() => {
    if (!hasModalContext) {
      setShowDeferredTodaySections(false);
      return;
    }
    setShowDeferredTodaySections(false);
    if (typeof window === "undefined") {
      setShowDeferredTodaySections(true);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const reveal = () => {
      if (!cancelled) {
        setShowDeferredTodaySections(true);
      }
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(reveal, { timeout: 600 });
    } else {
      timeoutId = setTimeout(reveal, 120);
    }

    return () => {
      cancelled = true;
      if (idleId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    };
  }, [dateStr, detail, hasModalContext]);

  const isToday =
    modal.forecastModalMode === "today" ||
    (modal.forecastModalMode == null && dateStr === detail?.local_date);
  const detailDepth = detail?.detail_depth || "full";
  const isFullDetailReady = detailDepth === "full";
  const isStructureSyncing =
    modal.loadingState.futureDeep || !isFullDetailReady;
  const isAnyLayerSyncing = isStructureSyncing;
  const isTodayBlockingRefresh = isToday && isStructureSyncing;
  const activeMarketScan = freshMarketScan || detail?.market_scan || null;

  useEffect(() => {
    setFreshMarketScan(null);
    if (!hasModalContext || !isToday || !isFullDetailReady || !isPro) return;
    const cityName = String(detail?.name || detail?.display_name || "").trim();
    if (!cityName || !dateStr) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refreshMarketScan = () => {
      dashboardClient
        .getCityMarketScan(cityName, {
          force: false,
          lite: false,
          marketSlug: detail?.market_scan?.primary_market?.slug || null,
          targetDate: dateStr,
        })
        .then((payload) => {
          if (cancelled) return;
          setFreshMarketScan(payload.market_scan || null);
        })
        .catch(() => {
          if (!cancelled) {
            setFreshMarketScan(null);
          }
        });
    };

    refreshMarketScan();
    intervalId = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      refreshMarketScan();
    }, TODAY_MARKET_SCAN_AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      if (intervalId != null) {
        clearInterval(intervalId);
      }
    };
  }, [
    dateStr,
    detail?.display_name,
    detail?.local_date,
    detail?.market_scan?.primary_market?.slug,
    detail?.name,
    detail?.updated_at,
    hasModalContext,
    isFullDetailReady,
    isPro,
    isToday,
  ]);

  const view = getFutureModalView(detail, dateStr, locale);
  const scorePosition = `${50 + view.front.score / 2}%`;
  const barStyle = {
    "--score-position": scorePosition,
  } as CSSProperties & { "--score-position": string };
  const weatherSummary = getWeatherSummary(detail, locale);
  const paceView = useMemo(
    () =>
      isToday && showDeferredTodaySections
        ? getTodayPaceView(detail, locale)
        : null,
    [detail, isToday, locale, showDeferredTodaySections],
  );
  const probabilityView = useMemo(
    () => getProbabilityView(detail, dateStr),
    [dateStr, detail],
  );
  const modelView = useMemo(
    () => getModelView(detail, dateStr),
    [dateStr, detail],
  );
  const probabilityEngineKey = String(probabilityView?.engine || "")
    .trim()
    .toLowerCase();
  const probabilityCalibrationMode = String(
    probabilityView?.calibrationMode || "",
  )
    .trim()
    .toLowerCase();
  const hasLgbmProbability = useMemo(
    () =>
      Object.keys(modelView?.models || {}).some((name) =>
        String(name || "")
          .toLowerCase()
          .replace(/[\s_/-]/g, "")
          .includes("lgbm"),
      ),
    [modelView],
  );
  const hasEmosProbability =
    probabilityEngineKey === "emos" ||
    probabilityCalibrationMode.includes("emos");
  const probabilityEngineLabel = hasLgbmProbability
    ? locale === "en-US"
      ? "LGBM"
      : "LGBM"
    : hasEmosProbability
      ? "EMOS"
      : locale === "en-US"
        ? "Calibrated model"
        : "校准模型";
  const probabilityTitle = hasLgbmProbability
    ? locale === "en-US"
      ? "LGBM-Calibrated Probability"
      : "LGBM 校准概率"
    : hasEmosProbability
      ? locale === "en-US"
        ? "EMOS-Calibrated Probability"
        : "EMOS 校准概率"
      : locale === "en-US"
        ? "Calibrated Model Probability"
        : "校准模型概率";
  const topProbabilityBucket = useMemo(() => {
    const buckets = Array.isArray(probabilityView?.probabilities)
      ? probabilityView.probabilities
      : [];
    return [...buckets]
      .filter((bucket) => Number.isFinite(Number(bucket?.probability)))
      .sort((a, b) => Number(b?.probability) - Number(a?.probability))[0];
  }, [probabilityView]);
  const modelSpreadView = useMemo(() => {
    const values = Object.values(modelView?.models || {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    return {
      count: values.length,
      max,
      min,
      spread,
    };
  }, [modelView]);
  const boundaryRiskView = useMemo(() => {
    if (!showDeferredTodaySections) return null;
    if (!isToday || !paceView) return null;
    const selectedBucket = topProbabilityBucket || null;
    const bounds = parseBucketBoundaries(selectedBucket);
    if (!bounds) return null;
    const projected =
      paceView.paceAdjustedHigh ??
      (detail.deb?.prediction != null ? Number(detail.deb.prediction) : null);
    if (projected == null || !Number.isFinite(projected)) return null;

    const distances = [bounds.lower, bounds.upper]
      .filter(
        (value): value is number => value != null && Number.isFinite(value),
      )
      .map((value) => ({
        boundary: value,
        gap: Math.abs(projected - value),
      }))
      .sort((a, b) => a.gap - b.gap);
    if (!distances.length) return null;

    const nearest = distances[0];
    const tone =
      nearest.gap <= 0.4 ? "amber" : nearest.gap <= 0.8 ? "blue" : "cyan";
    const status =
      nearest.gap <= 0.4
        ? locale === "en-US"
          ? "High boundary risk"
          : "边界风险高"
        : nearest.gap <= 0.8
          ? locale === "en-US"
            ? "Watch boundary"
            : "边界需观察"
          : locale === "en-US"
            ? "Boundary buffer"
            : "边界缓冲";
    const note =
      locale === "en-US"
        ? `${projected.toFixed(1)}${detail.temp_symbol} is ${nearest.gap.toFixed(1)}${detail.temp_symbol} from the nearest boundary ${nearest.boundary.toFixed(1)}°C.`
        : `${projected.toFixed(1)}${detail.temp_symbol} 距最近边界 ${nearest.boundary.toFixed(1)}°C 还有 ${nearest.gap.toFixed(1)}${detail.temp_symbol}。`;
    return {
      label: locale === "en-US" ? "Boundary risk" : "边界风险",
      note,
      status,
      tone,
      value: `${nearest.gap.toFixed(1)}${detail.temp_symbol}`,
    };
  }, [
    detail.deb?.prediction,
    detail.temp_symbol,
    isToday,
    locale,
    paceView,
    showDeferredTodaySections,
    topProbabilityBucket,
  ]);
  const peakWindowStateView = useMemo(() => {
    if (!showDeferredTodaySections) return null;
    if (!isToday || !paceView) return null;
    const firstHour = Number(detail.peak?.first_h);
    const lastHour = Number(detail.peak?.last_h);
    if (
      !Number.isFinite(firstHour) ||
      !Number.isFinite(lastHour) ||
      firstHour < 0 ||
      lastHour < firstHour
    ) {
      return null;
    }
    const currentMinutes = parseClockMinutes(detail.local_time);
    const startMinutes = firstHour * 60;
    const endMinutes = (lastHour + 1) * 60;
    let status = locale === "en-US" ? "Awaiting peak" : "未进入峰值";
    let tone: "amber" | "blue" | "cyan" = "blue";
    if (currentMinutes != null && currentMinutes >= endMinutes) {
      status = locale === "en-US" ? "Past peak" : "已过峰值";
      tone = "cyan";
    } else if (currentMinutes != null && currentMinutes >= startMinutes) {
      status = locale === "en-US" ? "Peak window live" : "峰值窗口进行中";
      tone = "amber";
    }
    const note =
      locale === "en-US"
        ? `Primary peak window ${paceView.peakWindowText}.`
        : `核心峰值窗口 ${paceView.peakWindowText}。`;
    return {
      label: locale === "en-US" ? "Peak window" : "峰值窗口状态",
      note,
      status,
      tone,
      value: paceView.peakWindowText,
    };
  }, [
    detail.local_time,
    detail.peak?.first_h,
    detail.peak?.last_h,
    isToday,
    locale,
    paceView,
    showDeferredTodaySections,
  ]);
  const networkLeadView = useMemo(() => {
    if (!showDeferredTodaySections) return null;
    if (!isToday) return null;
    const delta = Number(detail.airport_vs_network_delta);
    const leadSignal = detail.network_lead_signal;
    if (!Number.isFinite(delta)) return null;
    const leaderLabel =
      String(leadSignal?.leader_station_label || "").trim() ||
      String(leadSignal?.leader_station_code || "").trim();
    const leaderSyncStatus = String(leadSignal?.leader_sync_status || "")
      .trim()
      .toLowerCase();
    const leaderSyncDelta = Number(
      leadSignal?.leader_time_delta_vs_anchor_minutes,
    );
    const syncNote =
      leaderSyncStatus === "near_realtime" || leaderSyncStatus === "lagged"
        ? Number.isFinite(leaderSyncDelta)
          ? locale === "en-US"
            ? ` Timing offset versus the airport anchor is about ${Math.round(leaderSyncDelta)} minutes.`
            : ` 与机场锚点存在约 ${Math.round(leaderSyncDelta)} 分钟时间差。`
          : locale === "en-US"
            ? " Nearby observations are not fully synchronized."
            : " 周边观测并非完全同步。"
        : leaderSyncStatus === "unknown"
          ? locale === "en-US"
            ? " Nearby station timing is not fully verified."
            : " 周边站观测时间尚未完全校验。"
          : "";
    const absDelta = Math.abs(delta);
    const status =
      delta <= -0.4
        ? locale === "en-US"
          ? "Airport trailing"
          : "机场落后"
        : delta >= 0.4
          ? locale === "en-US"
            ? "Airport leading"
            : "机场领先"
          : locale === "en-US"
            ? "Tracking network"
            : "与站网齐平";
    const tone = delta <= -0.4 ? "amber" : delta >= 0.4 ? "cyan" : "blue";
    const note =
      delta <= -0.4
        ? locale === "en-US"
          ? `Airport anchor is ${absDelta.toFixed(1)}${detail.temp_symbol} cooler than the nearby official network${leaderLabel ? `, led by ${leaderLabel}` : ""}.${syncNote}`
          : `机场主站当前比周边官方站网低 ${absDelta.toFixed(1)}${detail.temp_symbol}${leaderLabel ? `，领先点位是 ${leaderLabel}` : ""}。${syncNote}`
        : delta >= 0.4
          ? locale === "en-US"
            ? `Airport anchor is ${absDelta.toFixed(1)}${detail.temp_symbol} hotter than the nearby official network.${syncNote}`
            : `机场主站当前比周边官方站网高 ${absDelta.toFixed(1)}${detail.temp_symbol}。${syncNote}`
          : locale === "en-US"
            ? "Airport anchor and nearby official network are broadly aligned."
            : "机场主站与周边官方站网当前大体齐平。";
    return {
      label: locale === "en-US" ? "Airport vs network" : "机场 vs 周边站",
      note,
      status,
      tone,
      value: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${detail.temp_symbol}`,
    };
  }, [
    detail.airport_vs_network_delta,
    detail.network_lead_signal,
    detail.temp_symbol,
    isToday,
    locale,
    showDeferredTodaySections,
  ]);
  const paceSignalItems = useMemo(
    () =>
      [boundaryRiskView, peakWindowStateView, networkLeadView]
        .filter((item) => item != null)
        .map((item) => ({
          label: item.label,
          note: item.note,
          status: item.status,
          tone: item.tone,
          value: item.value,
        })) as FuturePaceSignalItem[],
    [boundaryRiskView, networkLeadView, peakWindowStateView],
  );
  const isNoaaSettlement =
    detail.current?.settlement_source === "noaa" ||
    detail.current?.settlement_source_label === "NOAA";
  const noaaStationCode = String(
    detail.current?.station_code || detail.risk?.icao || "NOAA",
  )
    .trim()
    .toUpperCase();
  const noaaStationName =
    String(detail.current?.station_name || "").trim() ||
    String(detail.risk?.airport || "").trim() ||
    noaaStationCode;
  const hottestBucketLabel = formatBucketLabel(topProbabilityBucket);
  const probabilitySummary = (() => {
    if (!topProbabilityBucket) {
      return locale === "en-US"
        ? "Probability mass is still too dispersed; avoid over-reading a single bracket."
        : "当前概率还比较分散，不要只盯单一区间。";
    }
    const bucketLabel = formatBucketLabel(topProbabilityBucket);
    const bucketProb = formatMarketPercent(topProbabilityBucket.probability);
    if (!isToday) {
      return locale === "en-US"
        ? `Target-day model probability reference puts the leading bucket at ${bucketLabel} (${bucketProb}). EMOS is reserved for intraday analysis after live anchor observations arrive.`
        : `目标日模型概率参考显示领先温度桶为 ${bucketLabel}（${bucketProb}）。EMOS 仅用于有实时锚点观测后的日内分析。`;
    }
    if (hasLgbmProbability) {
      return locale === "en-US"
        ? `LGBM-calibrated read puts the leading bucket at ${bucketLabel} (${bucketProb}). Treat this as the base case, not the final settlement.`
        : `LGBM 校准后领先温度桶为 ${bucketLabel}（${bucketProb}）。可作为基准情形，但不要直接等同于最终结算。`;
    }
    if (hasEmosProbability) {
      return locale === "en-US"
        ? `EMOS-calibrated probability puts the leading bucket at ${bucketLabel} (${bucketProb}). It is the primary calibrated probability layer, not the final settlement.`
        : `EMOS 校准概率显示领先温度桶为 ${bucketLabel}（${bucketProb}）。这是当前主概率层，但不要直接等同于最终结算。`;
    }
    return locale === "en-US"
      ? `Calibrated model probability puts the leading bucket at ${bucketLabel} (${bucketProb}). Treat this as the base case, not the final settlement.`
      : `校准模型概率显示领先温度桶为 ${bucketLabel}（${bucketProb}）。可作为基准情形，但不要直接等同于最终结算。`;
  })();
  const modelSummary = (() => {
    if (!modelSpreadView) {
      return locale === "en-US"
        ? "Model spread is unavailable right now."
        : "当前拿不到可用的模型分歧。";
    }
    const modelEntries = Object.entries(modelView?.models || {}).filter(
      ([, value]) =>
        value !== null && value !== undefined && Number.isFinite(Number(value)),
    );
    if (modelEntries.length === 1) {
      const [singleModelName, singleModelValue] = modelEntries[0];
      return locale === "en-US"
        ? `Only ${singleModelName} is available right now at ${Number(singleModelValue).toFixed(1)}${detail.temp_symbol}; multi-model spread is temporarily unavailable.`
        : `当前只收到 ${singleModelName} ${Number(singleModelValue).toFixed(1)}${detail.temp_symbol}，其他多模型暂未回传，所以这里先不判断模型分歧。`;
    }
    return locale === "en-US"
      ? `Model range runs from ${modelSpreadView.min.toFixed(1)}${detail.temp_symbol} to ${modelSpreadView.max.toFixed(1)}${detail.temp_symbol}; spread ${modelSpreadView.spread.toFixed(1)}${detail.temp_symbol}.`
      : `当前模型区间在 ${modelSpreadView.min.toFixed(1)}${detail.temp_symbol} 到 ${modelSpreadView.max.toFixed(1)}${detail.temp_symbol}，分歧 ${modelSpreadView.spread.toFixed(1)}${detail.temp_symbol}。`;
  })();
  const upperAirSignal = detail.vertical_profile_signal || {};
  const tafSignal = detail.taf?.signal || {};
  const upperAirCue = useMemo(() => {
    if (!showDeferredTodaySections) return null;
    if (!isToday || (!upperAirSignal.source && !tafSignal.available))
      return null;

    const setup = String(
      upperAirSignal.heating_setup || "neutral",
    ).toLowerCase();
    const tafSuppression = String(
      tafSignal.suppression_level || "low",
    ).toLowerCase();
    const tafDisruption = String(
      tafSignal.disruption_level || "low",
    ).toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    if (setup === "supportive") {
      score += 2;
      reasons.push(
        locale === "en-US"
          ? "upper-air structure still supports daytime heating"
          : "高空结构仍偏支持白天冲高",
      );
    } else if (setup === "suppressed") {
      score -= 2;
      reasons.push(
        locale === "en-US"
          ? "upper-air structure still leans toward capping the peak"
          : "高空结构更偏向压住峰值",
      );
    }

    if (tafSuppression === "high") {
      score -= 2;
      reasons.push(
        locale === "en-US"
          ? "TAF flags meaningful cloud/rain suppression near the peak window"
          : "TAF 在峰值窗口提示云雨压温风险偏高",
      );
    } else if (tafSuppression === "medium") {
      score -= 1;
      reasons.push(
        locale === "en-US"
          ? "TAF keeps some cloud/rain suppression risk on the table"
          : "TAF 仍提示一定的云雨压温风险",
      );
    }

    if (tafDisruption === "high") {
      score -= 1;
      reasons.push(
        locale === "en-US"
          ? "TAF also suggests a noisier afternoon regime"
          : "TAF 还提示午后扰动偏强",
      );
    } else if (tafDisruption === "medium") {
      score -= 0.5;
      reasons.push(
        locale === "en-US"
          ? "TAF keeps some afternoon timing noise in play"
          : "TAF 提示午后仍可能有时段性扰动",
      );
    }

    if (score >= 1.5) {
      return {
        summary:
          locale === "en-US"
            ? "The combined upper-air and TAF read still leans warmer. Do not fade lower buckets too early."
            : "高空和 TAF 两层信号合并后仍偏暖侧，不宜过早做更低温区间。",
        note:
          locale === "en-US"
            ? `${reasons.slice(0, 2).join("; ")}.`
            : `${reasons.slice(0, 2).join("；")}。`,
        tone: "warm",
        value: locale === "en-US" ? "Lean warmer" : "偏暖侧",
      };
    }

    if (score <= -1.5) {
      return {
        summary:
          locale === "en-US"
            ? "The combined upper-air and TAF read leans more defensive. Be more careful chasing higher buckets."
            : "高空和 TAF 两层信号合并后更偏防守，追更高温区间要更谨慎。",
        note:
          locale === "en-US"
            ? `${reasons.slice(0, 2).join("; ")}.`
            : `${reasons.slice(0, 2).join("；")}。`,
        tone: "cold",
        value: locale === "en-US" ? "Lean cautious" : "偏谨慎",
      };
    }

    return {
      summary:
        locale === "en-US"
          ? "The combined upper-air and TAF read is mixed. Let surface structure decide before taking a side."
          : "高空和 TAF 两层信号目前偏混合，先看近地面结构变化，不急着站边。",
      note:
        locale === "en-US"
          ? `${reasons.slice(0, 2).join("; ") || "No clean edge from the upper-air layer alone"}.`
          : `${reasons.slice(0, 2).join("；") || "单看高空层还没有干净的交易边"}。`,
      tone: "",
      value: locale === "en-US" ? "Wait / confirm" : "先观察",
    };
  }, [
    tafSignal.available,
    tafSignal.disruption_level,
    tafSignal.suppression_level,
    isToday,
    locale,
    upperAirSignal.heating_setup,
    upperAirSignal.source,
    showDeferredTodaySections,
  ]);
  const topObservedTemp =
    detail.current?.max_so_far != null
      ? detail.current.max_so_far
      : detail.current?.temp;
  const currentTempText =
    detail.current?.temp != null
      ? `${detail.current.temp}${detail.temp_symbol}`
      : "--";
  const daylightProgress = (() => {
    const now = parseClockMinutes(detail.current?.obs_time);
    const sunrise = parseClockMinutes(detail.forecast?.sunrise);
    const sunset = parseClockMinutes(detail.forecast?.sunset);
    if (now == null || sunrise == null || sunset == null || sunset <= sunrise) {
      return null;
    }
    const percent = clamp(((now - sunrise) / (sunset - sunrise)) * 100, 0, 100);
    const phase =
      now < sunrise ? "夜间" : now > sunset ? "已日落" : "白昼进行中";
    return {
      phase,
      percent,
    };
  })();
  const displayedUpperAirSummary = showDeferredTodaySections
    ? upperAirCue?.summary || view.front.upperAirSummary
    : "";
  const displayedUpperAirMetrics = showDeferredTodaySections
    ? (view.front.upperAirMetrics || []).map((metric, index) =>
        index === 0 &&
        (metric.label === "Trade cue" || metric.label === "交易动作") &&
        upperAirCue
          ? {
              ...metric,
              note: upperAirCue.note,
              tone: upperAirCue.tone,
              value: upperAirCue.value,
            }
          : metric,
      )
    : [];
  const localizedAiCommentaryLines = useMemo(() => {
    if (!showDeferredTodaySections) return [] as string[];
    const commentary = detail.dynamic_commentary || {};
    const headline = String(
      locale === "en-US"
        ? commentary.headline_en || ""
        : commentary.headline_zh || "",
    ).trim();
    const bullets = (
      locale === "en-US" ? commentary.bullets_en : commentary.bullets_zh
    ) as string[] | null | undefined;
    const cleanedBullets = Array.isArray(bullets)
      ? bullets.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return [headline, ...cleanedBullets].filter(Boolean).slice(0, 3);
  }, [detail.dynamic_commentary, locale, showDeferredTodaySections]);
  const todayTradeSummaryLines = useMemo(() => {
    if (!showDeferredTodaySections) return [] as string[];
    if (!isToday) return [] as string[];
    if (localizedAiCommentaryLines.length > 0) {
      return localizedAiCommentaryLines;
    }
    const lines: string[] = [];
    if (paceView) {
      const headline =
        paceView.biasTone === "warm"
          ? locale === "en-US"
            ? `Pace is running hot by ${paceView.deltaText}; the day high still leans above the base curve.`
            : `节奏偏热 ${paceView.deltaText}，日高仍偏向落在基础曲线之上。`
          : paceView.biasTone === "cold"
            ? locale === "en-US"
              ? `Pace is trailing by ${paceView.deltaText}; chasing higher buckets needs caution.`
              : `节奏落后 ${paceView.deltaText}，继续追更高温区间要更谨慎。`
            : locale === "en-US"
              ? "Pace is still on curve; the next move depends on the peak-window push."
              : "节奏目前贴着曲线走，下一步主要看峰值窗口还有没有上冲。";
      lines.push(headline);
    }
    if (boundaryRiskView) {
      lines.push(
        locale === "en-US"
          ? `${boundaryRiskView.label}: ${boundaryRiskView.note}`
          : `${boundaryRiskView.label}：${boundaryRiskView.note}`,
      );
    }
    if (networkLeadView) {
      lines.push(
        locale === "en-US"
          ? `${networkLeadView.label}: ${networkLeadView.note}`
          : `${networkLeadView.label}：${networkLeadView.note}`,
      );
    }
    return lines.slice(0, 3);
  }, [
    boundaryRiskView,
    isToday,
    locale,
    localizedAiCommentaryLines,
    networkLeadView,
    paceView,
    showDeferredTodaySections,
  ]);
  const intradayMeteorology = detail.intraday_meteorology || {};
  const meteorologySignals = Array.isArray(
    intradayMeteorology.signal_contributions,
  )
    ? intradayMeteorology.signal_contributions
    : [];
  const invalidationRules = localizedList(
    locale,
    intradayMeteorology.invalidation_rules,
    intradayMeteorology.invalidation_rules_en,
  );
  const confirmationRules = localizedList(
    locale,
    intradayMeteorology.confirmation_rules,
    intradayMeteorology.confirmation_rules_en,
  );
  const meteorologyHeadline =
    localizedText(
      locale,
      intradayMeteorology.headline,
      intradayMeteorology.headline_en,
    ) ||
    todayTradeSummaryLines[0] ||
    (locale === "en-US"
      ? "Intraday meteorology layers are still syncing; use the next observation as the anchor."
      : "关键日内气象层仍在同步，先以下一次观测作为判断锚点。");
  const baseCaseBucket =
    String(intradayMeteorology.base_case_bucket || "").trim() ||
    formatBucketLabel(topProbabilityBucket);
  const nextObservationTime =
    String(intradayMeteorology.next_observation_time || "").trim() || "--";
  const baseBucketNumber = parseLeadingNumber(baseCaseBucket);
  const referenceObservedTemp =
    topObservedTemp != null && Number.isFinite(Number(topObservedTemp))
      ? Number(topObservedTemp)
      : detail.current?.temp != null
        ? Number(detail.current.temp)
        : null;
  const gapToBaseBucket =
    baseBucketNumber != null && referenceObservedTemp != null
      ? Math.max(0, baseBucketNumber - referenceObservedTemp)
      : null;
  const pathStatus =
    gapToBaseBucket == null
      ? locale === "en-US"
        ? "Awaiting anchor"
        : "等待锚点"
      : gapToBaseBucket <= 0.05
        ? locale === "en-US"
          ? "Base path touched"
          : "基准路径已触达"
        : gapToBaseBucket <= 1.0
          ? locale === "en-US"
            ? "Base path open"
            : "基准路径开放"
          : locale === "en-US"
            ? "Needs peak push"
            : "需要峰值推动";
  const peakWindowText =
    String(intradayMeteorology.peak_window || "").trim() ||
    paceView?.peakWindowText ||
    "--";
  const settlementSourceCode = normalizeObservationSourceCode(
    detail.current?.settlement_source || "",
  );
  const settlementStationCode = String(
    detail.current?.station_code || detail.risk?.icao || "",
  )
    .trim()
    .toUpperCase();
  const settlementStationName =
    String(detail.current?.station_name || detail.risk?.airport || "").trim() ||
    settlementStationCode ||
    (locale === "en-US" ? "Anchor station" : "锚点站");
  const airportMetarAnchor =
    settlementSourceCode === "metar" ||
    Boolean(settlementStationCode && /^[A-Z]{4}$/.test(settlementStationCode));
  const anchorSourceLabel = airportMetarAnchor
    ? settlementStationCode
      ? `${settlementStationCode} METAR`
      : "METAR"
    : normalizeObservationSourceLabel(
        detail.current?.settlement_source_label ||
          detail.current?.settlement_source,
        locale === "en-US" ? "Official observation" : "官方观测",
      );
  const anchorRuleText = airportMetarAnchor
    ? locale === "en-US"
      ? `Airport contract anchor: use the ${anchorSourceLabel} reports. Third-party history pages are display-only when present.`
      : `机场合约锚点：以 ${anchorSourceLabel} 报文为准；第三方历史页只作为展示入口。`
    : locale === "en-US"
      ? `Official anchor: use ${anchorSourceLabel} observations for this contract.`
      : `官方锚点：该合约按 ${anchorSourceLabel} 观测口径判断。`;
  const nextObservationLabel = airportMetarAnchor
    ? locale === "en-US"
      ? "Next METAR watch"
      : "下一次 METAR 观察"
    : locale === "en-US"
      ? "Next anchor watch"
      : "下一次锚点观察";
  const gapToBaseText =
    gapToBaseBucket == null
      ? "--"
      : `${gapToBaseBucket.toFixed(1)}${detail.temp_symbol || "°C"}`;
  const syncStatusItems = [
    {
      key: "base",
      state: isAnyLayerSyncing ? "syncing" : "ready",
      label: isAnyLayerSyncing
        ? locale === "en-US"
          ? "Refreshing base analysis"
          : "正在刷新基础分析"
        : locale === "en-US"
          ? "Base analysis ready"
          : "基础分析已加载",
      note: isAnyLayerSyncing
        ? locale === "en-US"
          ? "Latest anchor readings and forecast curve are being rebuilt."
          : "正在重建最新锚点读数和预测曲线。"
        : locale === "en-US"
          ? "Forecast curve, anchor state, and the core intraday view are available."
          : "预测曲线、锚点状态和核心日内视图已经可用。",
    },
    {
      key: "market",
      state: isAnyLayerSyncing ? "syncing" : "ready",
      label: isAnyLayerSyncing
        ? locale === "en-US"
          ? "Refreshing probability layer"
          : "正在刷新概率层"
        : locale === "en-US"
          ? "Probability layer ready"
          : "概率层已加载",
      note: isAnyLayerSyncing
        ? locale === "en-US"
          ? "Model spread and calibrated buckets are updating."
          : "模型分歧和校准概率桶正在更新。"
        : locale === "en-US"
          ? `Probability buckets are derived from the ${probabilityEngineLabel} layer.`
          : `概率桶当前由 ${probabilityEngineLabel} 层推导。`,
    },
  ] satisfies FutureSyncStatusItem[];

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="future-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          modal.closeFutureModal();
        }
      }}
    >
      {isProLoading ? (
        <div
          className="modal-content large"
          style={{ padding: "40px", textAlign: "center" }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            {t("dashboard.loading")}
          </div>
        </div>
      ) : !isPro ? (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <LockKeyhole size={32} className="mx-auto mb-3 text-slate-400" />
            <p className="text-sm font-bold text-slate-700">
              {locale === "en-US" ? "Pro subscription required" : "需要 Pro 订阅"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {locale === "en-US"
                ? "Subscribe in Account Center to unlock full analysis."
                : "请在账户中心订阅以解锁完整分析功能。"}
            </p>
            <Link
              href="/account"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              {locale === "en-US" ? "Subscribe" : "去订阅"}
            </Link>
          </div>
        </div>
      ) : (
        <div className="modal-content large future-modal">
          <FutureForecastModalHeader
            cityDisplayName={detail.display_name}
            dateStr={dateStr}
            isAnyLayerSyncing={isAnyLayerSyncing}
            isPro={isPro}
            isProLoading={isProLoading}
            isToday={isToday}
            locale={locale}
            onClose={modal.closeFutureModal}
            onRefresh={() => {
              if (isToday) {
                void modal.openTodayModal(true);
                return;
              }
              modal.openFutureModal(dateStr, true);
            }}
            t={t}
          />
          <div
            className={clsx(
              "modal-body future-modal-body",
              isTodayBlockingRefresh && "future-modal-body-refreshing",
            )}
          >
            {isTodayBlockingRefresh && <FutureRefreshLock locale={locale} />}
            {isToday && (
              <FutureForecastTodayDecisionBrief
                anchorRuleText={anchorRuleText}
                anchorSourceLabel={anchorSourceLabel}
                baseCaseBucket={baseCaseBucket}
                confidence={intradayMeteorology.confidence}
                displayName={detail.display_name}
                downsideBucket={intradayMeteorology.downside_bucket}
                gapToBaseText={gapToBaseText}
                locale={locale}
                meteorologyHeadline={meteorologyHeadline}
                nextObservationLabel={nextObservationLabel}
                nextObservationTime={nextObservationTime}
                pathStatus={pathStatus}
                settlementStationName={settlementStationName}
                upsideBucket={intradayMeteorology.upside_bucket}
              />
            )}
            <FutureSyncStatusStrip items={syncStatusItems} compact={isToday} />
            {isNoaaSettlement && (
              <div className="modal-callout modal-callout-info">
                {locale === "en-US"
                  ? `${detail.display_name} now settles against NOAA ${noaaStationCode} (${noaaStationName}). The market uses the highest rounded whole-degree Celsius reading in the Temp column after the day is finalized.`
                  : `${detail.display_name} 当前按 NOAA ${noaaStationCode}（${noaaStationName}）结算。市场最终采用该日 Temp 列完成质控后的最高整度摄氏值，不按小数温度结算。`}
              </div>
            )}
            {isToday ? (
              <FutureForecastTodayLayout
                locale={locale}
                isToday={isToday}
                dateStr={dateStr}
                detail={detail}
                currentTempText={currentTempText}
                weatherSummary={weatherSummary}
                daylightProgress={daylightProgress}
                topObservedTemp={topObservedTemp}
                gapToBaseBucket={gapToBaseBucket}
                pathStatus={pathStatus}
                showDeferredTodaySections={showDeferredTodaySections}
                paceView={paceView}
                paceSignalItems={paceSignalItems}
                baseCaseBucket={baseCaseBucket}
                upsideBucket={intradayMeteorology.upside_bucket}
                nextObservationTime={nextObservationTime}
                airportMetarAnchor={airportMetarAnchor}
                confirmationRules={confirmationRules}
                invalidationRules={invalidationRules}
                meteorologySignals={meteorologySignals}
                modelSummary={modelSummary}
                probabilityTitle={probabilityTitle}
                probabilitySummary={probabilitySummary}
                activeMarketScan={activeMarketScan}
              />
            ) : (
              <FutureForecastForwardView
                dateStr={dateStr}
                detail={detail}
                t={t}
                view={view}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

