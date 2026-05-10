"use client";

import clsx from "clsx";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { AiCityTemperatureChart } from "@/components/dashboard/scan-terminal/AiCityTemperatureChart";
import { AiEvidencePanel } from "@/components/dashboard/scan-terminal/AiEvidencePanel";
import { AmosRunwayPanel } from "@/components/dashboard/scan-terminal/AmosRunwayPanel";
import { CityCardHeader } from "@/components/dashboard/scan-terminal/CityCardHeader";
import { MobileDecisionCard } from "@/components/dashboard/scan-terminal/MobileDecisionCard";
import { ModelEvidencePanel } from "@/components/dashboard/scan-terminal/ModelEvidencePanel";
import { WeatherDecisionBand } from "@/components/dashboard/scan-terminal/WeatherDecisionBand";
import {
  buildMarketDecisionView,
  buildWeatherDecisionView,
  resolveExpectedHighCandidate,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import { buildCityDecisionState } from "@/components/dashboard/scan-terminal/city-decision-state";
import {
  getAiReadCopy,
  getCityLoadingCopy,
} from "@/components/dashboard/scan-terminal/decision-copy";
import { getPeakWindowLabel, normalizeCityKey } from "@/components/dashboard/scan-terminal/decision-utils";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import type { AiPinnedCity } from "@/components/dashboard/scan-terminal/types";
import {
  useAiCityForecast,
  useCityMarketScan,
} from "@/components/dashboard/scan-terminal/use-ai-city-card-data";
import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getModelView } from "@/lib/model-utils";
import { getTodayPaceView } from "@/lib/pace-utils";
import { formatTemperatureValue } from "@/lib/temperature-utils";

function toFiniteDecisionNumber(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseEpochMs(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatMetarReportTime(detail: CityDetail | null, report: string, isEn: boolean) {
  const offsetSeconds = Number(detail?.utc_offset_seconds);
  const epochMs =
    parseEpochMs(detail?.airport_current?.report_time) ??
    parseEpochMs(detail?.airport_current?.obs_time_epoch) ??
    parseEpochMs(detail?.airport_current?.obs_time) ??
    parseEpochMs(detail?.current?.report_time) ??
    parseEpochMs(detail?.current?.obs_time_epoch) ??
    parseEpochMs(detail?.current?.obs_time);
  if (epochMs != null) {
    const utc = new Date(epochMs);
    const zText = `${String(utc.getUTCHours()).padStart(2, "0")}:${String(
      utc.getUTCMinutes(),
    ).padStart(2, "0")}Z`;
    if (Number.isFinite(offsetSeconds)) {
      const local = new Date(epochMs + offsetSeconds * 1000);
      const localText = `${String(local.getUTCHours()).padStart(2, "0")}:${String(
        local.getUTCMinutes(),
      ).padStart(2, "0")}`;
      return isEn ? `${zText} / local ${localText}` : `${zText} / 当地 ${localText}`;
    }
    return zText;
  }

  const rawToken = String(report || "").match(/\b(\d{2})(\d{2})(\d{2})Z\b/i);
  if (!rawToken) return "";
  const zText = `${rawToken[2]}:${rawToken[3]}Z`;
  if (!Number.isFinite(offsetSeconds)) return zText;
  const utcMinutes = Number(rawToken[2]) * 60 + Number(rawToken[3]);
  if (!Number.isFinite(utcMinutes)) return zText;
  const localMinutes = Math.round(
    ((utcMinutes + offsetSeconds / 60) % 1440 + 1440) % 1440,
  );
  const localText = `${String(Math.floor(localMinutes / 60)).padStart(2, "0")}:${String(
    localMinutes % 60,
  ).padStart(2, "0")}`;
  return isEn ? `${zText} / local ${localText}` : `${zText} / 当地 ${localText}`;
}

function normalizeMetarReadTime(text: string, displayTime: string, isEn: boolean) {
  if (!text || !displayTime) return text;
  const timeLabel = isEn ? `report time ${displayTime}` : `报文时间 ${displayTime}`;
  return text
    .replace(/报文时间\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gi, timeLabel)
    .replace(/report time\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gi, timeLabel)
    .replace(/\bat\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gi, `at ${displayTime}`);
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

function formatFreshnessAge(value: unknown, isEn: boolean) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 1) return isEn ? "just now" : "刚刚";
  if (minutes < 60) {
    const rounded = Math.max(1, Math.round(minutes));
    return isEn ? `${rounded}m ago` : `${rounded} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  if (remaining <= 0) return isEn ? `${hours}h ago` : `${hours} 小时前`;
  return isEn ? `${hours}h ${remaining}m ago` : `${hours} 小时 ${remaining} 分钟前`;
}

function formatUpdateTime(value: unknown, locale: string) {
  const epochMs = parseEpochMs(value);
  if (epochMs == null) return "";
  const date = new Date(epochMs);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(locale === "en-US" ? "en-US" : "zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (locale === "en-US") {
    const day = sameDay
      ? "today"
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${day} ${time} updated`;
  }
  const day = sameDay
    ? "今日"
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  return `${day} ${time} 更新`;
}

function buildObservationFreshnessValue({
  detail,
  displayTime,
  isEn,
  isHkoObservation,
}: {
  detail: CityDetail | null;
  displayTime: string;
  isEn: boolean;
  isHkoObservation: boolean;
}) {
  const stale = Boolean(
    detail?.metar_status?.stale_for_today ||
      detail?.airport_current?.stale_for_today ||
      detail?.current?.observation_status === "stale",
  );
  if (stale) {
    return isEn ? "stale; background only" : "已过旧，仅作背景参考";
  }
  const ageLabel = formatFreshnessAge(
    isHkoObservation ? detail?.current?.obs_age_min : detail?.airport_current?.obs_age_min ?? detail?.current?.obs_age_min,
    isEn,
  );
  if (ageLabel) return ageLabel;
  if (displayTime) return displayTime;
  return isEn ? "time pending" : "时间待确认";
}

function buildModelFreshnessValue(detail: CityDetail | null, locale: string, isEn: boolean) {
  return (
    formatUpdateTime(detail?.updated_at, locale) ||
    (isEn ? "latest run loaded" : "已加载最新模型")
  );
}

function buildMarketFreshnessValue({
  isEn,
  marketScan,
  marketStatus,
}: {
  isEn: boolean;
  marketScan: ReturnType<typeof useCityMarketScan>["marketScan"];
  marketStatus: ReturnType<typeof useCityMarketScan>["marketStatus"];
}) {
  if (marketStatus === "loading") return isEn ? "syncing" : "同步中";
  if (!marketScan?.available) return isEn ? "temporarily unavailable" : "暂不可用";
  const quoteAgeMs = Number(
    marketScan.quote_age_ms ??
      marketScan.yes_token?.quote_age_ms ??
      marketScan.no_token?.quote_age_ms,
  );
  if (Number.isFinite(quoteAgeMs) && quoteAgeMs >= 0) {
    return formatFreshnessAge(quoteAgeMs / 60_000, isEn);
  }
  return isEn ? "synced" : "已同步";
}

export function AiPinnedCityCard({
  item,
  detail,
  row,
  locale,
  collapsed,
  removing,
  onRefreshCityDetail,
  onRemove,
  onToggleCollapsed,
}: {
  item: AiPinnedCity;
  detail: CityDetail | null;
  row: ScanOpportunityRow | null;
  locale: string;
  collapsed: boolean;
  removing?: boolean;
  onRefreshCityDetail: (cityName: string) => Promise<void>;
  onRemove: () => void;
  onToggleCollapsed: () => void;
}) {
  const isEn = locale === "en-US";
  const displayName =
    detail?.display_name ||
    row?.city_display_name ||
    row?.display_name ||
    item.displayName ||
    item.cityName;
  const tempSymbol = detail?.temp_symbol || row?.temp_symbol || "°C";
  const modelView = detail ? getModelView(detail, detail.local_date) : null;
  const modelEntries = modelView
    ? Object.entries(modelView.models || {})
        .map(([name, value]) => [name, Number(value)] as const)
        .filter(([, value]) => Number.isFinite(value))
    : [];
  const modelValues = modelEntries.map(([, value]) => value);
  const modelMin = modelValues.length ? Math.min(...modelValues) : null;
  const modelMax = modelValues.length ? Math.max(...modelValues) : null;
  const paceView = detail ? getTodayPaceView(detail, locale as "zh-CN" | "en-US") : null;
  const peakWindow =
    paceView?.peakWindowText ||
    (row ? getPeakWindowLabel(row) : null) ||
    "--";
  const deb = detail?.deb?.prediction ?? row?.deb_prediction ?? null;
  const isHkoObservation = isHkoObservationCity(detail);
  const currentTemp =
    (isHkoObservation
      ? detail?.current?.temp ?? row?.current_temp
      : detail?.airport_primary?.temp ??
        detail?.airport_current?.temp ??
        detail?.current?.temp ??
        row?.current_temp) ?? null;
  const debNumber = toFiniteDecisionNumber(deb);
  const currentTempNumber = toFiniteDecisionNumber(currentTemp);
  const modelRange =
    modelMin != null && modelMax != null
      ? `${formatTemperatureValue(modelMin, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(modelMax, tempSymbol, { digits: 1 })}`
      : "--";
  const paceTone = paceView?.biasTone || "neutral";
  const paceText =
    paceView?.summary ||
    (isEn
      ? "Waiting for intraday observations to compare against the DEB path."
      : "等待更多日内实测，用来对照 DEB 预测路径。");
  const report = isHkoObservation
    ? ""
    : detail?.current?.raw_metar || detail?.airport_current?.raw_metar || "";
  const metarReportTimeDisplay = formatMetarReportTime(detail, report, isEn);
  const observationStation = isHkoObservation
    ? detail?.current?.station_name ||
      detail?.current?.station_code ||
      detail?.settlement_station?.settlement_station_label ||
      detail?.settlement_station?.settlement_station_code ||
      "香港天文台"
    : detail?.risk?.icao ||
      detail?.current?.station_code ||
      detail?.airport_current?.station_code ||
      detail?.airport_primary?.station_code ||
      "";
  const observationSourceZh = isHkoObservation ? "香港天文台观测" : "METAR 实测";
  const observationSourceEn = isHkoObservation ? "HKO observations" : "METAR observations";
  const rawObservationText = isHkoObservation
    ? `${isEn ? "Observation source" : "观测来源"}：${observationStation || (isEn ? "Hong Kong Observatory" : "香港天文台")}${metarReportTimeDisplay ? `，${metarReportTimeDisplay}` : ""}`
    : report
      ? `${isEn ? "Raw METAR" : "原始 METAR"}：${`${observationStation} ${report}`.trim()}`
      : isEn
        ? "Raw METAR: unavailable."
        : "原始 METAR：暂无。";
  const detailCityName = detail?.name || item.cityName;
  const [refreshingDetail, setRefreshingDetail] = useState(false);
  const { aiForecast, refreshAiForecast } = useAiCityForecast({
    detail,
    detailCityName,
    enabled: Boolean(detail),
    isEn,
    locale,
    report,
  });
  const { marketScan, marketStatus } = useCityMarketScan({
    detail,
    detailCityName,
    enabled: Boolean(detail),
  });
  const isRefreshing = refreshingDetail || aiForecast.status === "loading";
  const [isCompactCard, setIsCompactCard] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 820px)");
    const syncCompactMode = () => setIsCompactCard(media.matches);
    syncCompactMode();
    media.addEventListener("change", syncCompactMode);
    return () => media.removeEventListener("change", syncCompactMode);
  }, []);

  const aiCityForecast = aiForecast.payload?.city_forecast || null;
  const localizedFinalJudgmentRaw =
    (isEn ? aiCityForecast?.final_judgment_en : aiCityForecast?.final_judgment_zh) ||
    (isEn ? aiCityForecast?.reasoning_en : aiCityForecast?.reasoning_zh) ||
    "";
  const localizedMetarReadRaw =
    (isEn ? aiCityForecast?.metar_read_en : aiCityForecast?.metar_read_zh) ||
    "";
  const localizedReasoningRaw =
    (isEn ? aiCityForecast?.reasoning_en : aiCityForecast?.reasoning_zh) ||
    "";
  const localizedFinalJudgment = normalizeMetarReadTime(
    localizedFinalJudgmentRaw,
    metarReportTimeDisplay,
    isEn,
  );
  const localizedMetarRead = normalizeMetarReadTime(
    localizedMetarReadRaw,
    metarReportTimeDisplay,
    isEn,
  );
  const localizedReasoning = normalizeMetarReadTime(
    localizedReasoningRaw,
    metarReportTimeDisplay,
    isEn,
  );
  const localizedModelNote =
    (isEn
      ? aiCityForecast?.model_cluster_note_en
      : aiCityForecast?.model_cluster_note_zh) || "";
  const modelPreview = modelEntries
    .slice(0, 4)
    .map(([name, value]) => `${name} ${formatTemperatureValue(value, tempSymbol, { digits: 1 })}`)
    .join(isEn ? " / " : " / ");
  const localModelSupportNote = modelEntries.length
    ? isEn
      ? modelEntries.length <= 2
        ? `Model support is sparse: only ${modelEntries.length} sources are available${modelPreview ? ` (${modelPreview})` : ""}, so the read should lean more on DEB path and ${observationSourceEn}.`
        : `Model support: ${modelEntries.length} sources cluster between ${modelRange}; ${modelPreview}.`
      : modelEntries.length <= 2
        ? `多模型支撑偏少：当前只有 ${modelEntries.length} 个模型${modelPreview ? `（${modelPreview}）` : ""}，需要更重视 DEB 路径和${observationSourceZh}。`
        : `多模型支撑：${modelEntries.length} 个模型集中在 ${modelRange}，代表模型为 ${modelPreview}。`
    : isEn
      ? `Model support is unavailable, so this city must rely on DEB path and ${observationSourceEn}.`
      : `暂无可用多模型支撑，需要主要参考 DEB 路径和${observationSourceZh}。`;
  const aiPredictedMax = toFiniteDecisionNumber(aiCityForecast?.predicted_max);
  const aiRangeLow = toFiniteDecisionNumber(aiCityForecast?.range_low);
  const aiRangeHigh = toFiniteDecisionNumber(aiCityForecast?.range_high);
  const aiConfidence = String(aiCityForecast?.confidence || "").trim() || null;
  const decisionExpectedHighNumber = resolveExpectedHighCandidate({
    aiPredictedMax,
    currentTemp: currentTempNumber,
    deb: debNumber,
    modelMax,
    modelMin,
    paceAdjustedHigh: paceView?.paceAdjustedHigh ?? null,
  });
  const decisionView = buildWeatherDecisionView({
    aiCityForecast,
    currentTemp: currentTempNumber,
    deb: debNumber,
    isEn,
    localModelSupportNote,
    modelEntries,
    modelMax,
    modelMin,
    paceTone,
    paceView,
    peakWindow,
    tempSymbol,
  });
  const expectedHighText =
    decisionExpectedHighNumber != null
      ? formatTemperatureValue(decisionExpectedHighNumber, tempSymbol, { digits: 1 })
      : "--";
  const amosRange = detail?.amos?.runway_temp_range;
  const observedLabel = amosRange ? (isEn ? "Runway" : "跑道实况") : undefined;
  const currentTempText = amosRange
    ? `${amosRange[0].toFixed(1)}~${amosRange[1].toFixed(1)}${tempSymbol}`
    : currentTempNumber != null
      ? formatTemperatureValue(currentTempNumber, tempSymbol, { digits: 1 })
      : "--";
  const debText =
    debNumber != null
      ? formatTemperatureValue(debNumber, tempSymbol, { digits: 1 })
      : "--";
  const marketDecisionView = buildMarketDecisionView({
    expectedHigh: decisionExpectedHighNumber,
    isEn,
    marketScan,
    marketStatus,
    tempSymbol,
  });
  const aiMeta = aiCityForecast?._polyweather_meta || null;
  const guardReason = aiMeta?.deterministic_guard_reason || {};
  const observationStale = Boolean(
    detail?.metar_status?.stale_for_today ||
      detail?.airport_current?.stale_for_today ||
      detail?.current?.observation_status === "stale" ||
      guardReason.observation_stale,
  );
  const observedHighBreak = Boolean(
    guardReason.observed_high_break ||
      (currentTempNumber != null &&
        modelMax != null &&
        currentTempNumber > modelMax + 0.2),
  );
  const observedLowBreak = Boolean(guardReason.observed_low_break);
  const observedLowLag = Boolean(guardReason.observed_low_lag);
  const peakHasPassed = Boolean(
    guardReason.peak_has_passed ||
      ["past", "post_peak", "after_peak"].includes(
        String((row as { window_phase?: string | null } | null)?.window_phase || "").toLowerCase(),
      ),
  );
  const modelSpread = modelMax != null && modelMin != null ? modelMax - modelMin : null;
  const modelHighlyConsistent =
    modelEntries.length >= 4 && modelSpread != null && modelSpread <= 2;
  const needsNextBulletin =
    !observationStale &&
    !observedHighBreak &&
    !observedLowBreak &&
    !peakHasPassed &&
    (observedLowLag || paceTone === "neutral" || aiForecast.status === "loading");
  const aiRuleEvidenceMode = Boolean(
    aiForecast.status === "failed" ||
      (aiForecast.status === "ready" && !aiCityForecast) ||
      aiForecast.payload?.degraded ||
      aiMeta?.fallback,
  );
  const aiReadCopy = getAiReadCopy({ isEn, isHkoObservation });
  const aiReadInProgressText = aiReadCopy.inProgress;
  const aiReadCompleteText = aiReadCopy.complete;
  const aiRuleEvidenceText = aiReadCopy.ruleEvidence;
  const decisionState = buildCityDecisionState({
    aiCityForecast,
    aiForecast,
    aiRuleEvidenceMode,
    isEn,
    isHkoObservation,
    marketDecisionView,
    modelHighlyConsistent,
    needsNextBulletin,
    observationStale,
    observedHighBreak,
    observedLowBreak,
    observedLowLag,
    peakHasPassed,
  });
  const dataFreshnessRows = [
    {
      label: isHkoObservation ? (isEn ? "HKO" : "天文台") : "METAR",
      labelTitle: isHkoObservation
        ? (isEn ? "Hong Kong Observatory official readings" : "香港天文台官方实测")
        : (isEn ? "Meteorological Aerodrome Report — airport weather observation" : "机场气象观测报文"),
      value: buildObservationFreshnessValue({
        detail,
        displayTime: metarReportTimeDisplay,
        isEn,
        isHkoObservation,
      }),
      tone: observationStale ? "stale" : "fresh",
    },
    {
      label: isEn ? "Models" : "模型",
      value: buildModelFreshnessValue(detail, locale, isEn),
      tone: "fresh",
    },
    {
      label: isEn ? "Market" : "市场价格",
      value: buildMarketFreshnessValue({ isEn, marketScan, marketStatus }),
      tone:
        marketDecisionView.status === "ready"
          ? "fresh"
          : marketDecisionView.status === "loading"
            ? "loading"
            : "stale",
    },
  ];
  const freshnessSeparator = isEn ? ": " : "：";
  const localizedRisksRaw =
    (isEn ? aiCityForecast?.risks_en : aiCityForecast?.risks_zh) || [];
  const localizedRisks = Array.isArray(localizedRisksRaw)
    ? localizedRisksRaw
    : localizedRisksRaw
      ? [String(localizedRisksRaw)]
      : [];
  const aiBullets = [
    localizedMetarRead,
    localizedReasoning !== localizedFinalJudgment ? localizedReasoning : "",
    localizedModelNote || localModelSupportNote,
    ...localizedRisks,
  ].filter((line) => String(line || "").trim());
  const fallbackAiReason =
    (isEn ? aiForecast.payload?.reason_en : aiForecast.payload?.reason_zh) ||
    aiForecast.payload?.reason ||
    "";
  const marketLineText =
    marketDecisionView.status === "ready"
      ? `${marketDecisionView.bucketLabel} · ${marketDecisionView.priceText}`
      : marketDecisionView.status === "loading"
        ? isEn
          ? "syncing"
          : "同步中"
        : isEn
          ? "temporarily unavailable"
          : "暂不可用";

  const collapseId = `ai-city-body-${normalizeCityKey(item.cityName) || item.addedAt}`;
  const loadingCopy = getCityLoadingCopy({ isEn, isHkoObservation });
  const handleRefresh = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (refreshingDetail) return;
    setRefreshingDetail(true);
    void onRefreshCityDetail(detailCityName)
      .catch(() => {})
      .finally(() => {
        refreshAiForecast();
        setRefreshingDetail(false);
      });
  };
  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  };

  return (
    <article
      className={clsx(
        "scan-ai-city-card",
        isCompactCard && "scan-mobile-decision-card",
        collapsed && !isCompactCard && "collapsed",
        removing && "removing",
      )}
      tabIndex={-1}
      data-ai-status={decisionState.aiStatus}
      data-evidence-quality={decisionState.evidenceQuality}
      data-market-status={decisionState.marketStatus}
      data-recommendation={decisionState.recommendation}
      data-urgency={decisionState.urgency}
    >
      {isCompactCard ? (
        <MobileDecisionCard
          aiBullets={aiBullets}
          aiCityForecast={aiCityForecast}
          aiConfidence={aiConfidence}
          aiForecast={aiForecast}
          aiPredictedMax={aiPredictedMax}
          aiRangeHigh={aiRangeHigh}
          aiRangeLow={aiRangeLow}
          aiReadCompleteText={aiReadCompleteText}
          aiReadInProgressText={aiReadInProgressText}
          aiRuleEvidenceMode={aiRuleEvidenceMode}
          aiRuleEvidenceText={aiRuleEvidenceText}
          currentTempText={currentTempText}
          dataFreshnessRows={dataFreshnessRows}
          debPrediction={debNumber}
          decisionState={decisionState}
          detail={detail}
          displayName={displayName}
          expectedHighText={expectedHighText}
          fallbackAiReason={fallbackAiReason}
          freshnessSeparator={freshnessSeparator}
          isEn={isEn}
          isHkoObservation={isHkoObservation}
          isRefreshing={isRefreshing}
          localModelSupportNote={localModelSupportNote}
          localizedFinalJudgment={localizedFinalJudgment}
          marketDecisionView={marketDecisionView}
          marketLineText={marketLineText}
          onRefresh={handleRefresh}
          onRemove={handleRemove}
          peakWindow={peakWindow}
          rawObservationText={rawObservationText}
          removing={removing}
          tempSymbol={tempSymbol}
        />
      ) : (
        <>
          <CityCardHeader
            aiStatusLabel={decisionState.aiStatusLabel}
            aiStatusTone={decisionState.aiStatusTone}
            collapseId={collapseId}
            collapsed={collapsed}
            currentTempText={currentTempText}
            observedLabel={observedLabel}
            dataFreshnessRows={dataFreshnessRows}
            debText={debText}
            detailLocalTime={detail?.local_time}
            displayName={displayName}
            expectedHighText={expectedHighText}
            freshnessSeparator={freshnessSeparator}
            isEn={isEn}
            isRefreshing={isRefreshing}
            modelRange={modelRange}
            onRefresh={handleRefresh}
            onRemove={handleRemove}
            onToggleCollapsed={onToggleCollapsed}
            peakWindow={peakWindow}
            removing={removing}
            rowLocalTime={row?.local_time}
            statusTags={decisionState.badges}
          />

          {detail && !collapsed ? (
            <div className="scan-ai-city-body" id={collapseId}>
              <WeatherDecisionBand
                decisionView={decisionView}
                decisionWhyText={decisionState.primaryReason}
                isEn={isEn}
                marketDecisionView={marketDecisionView}
                marketLineText={marketLineText}
                paceDeltaText={paceView?.deltaText || "--"}
              />

              <div className="scan-ai-city-analysis-grid">
                <AiCityTemperatureChart detail={detail} />
                <AiEvidencePanel
                  aiBullets={aiBullets}
                  aiCityForecast={aiCityForecast}
                  aiConfidence={aiConfidence}
                  aiForecast={aiForecast}
                  aiPredictedMax={aiPredictedMax}
                  aiRangeHigh={aiRangeHigh}
                  aiRangeLow={aiRangeLow}
                  aiReadCompleteText={aiReadCompleteText}
                  aiReadInProgressText={aiReadInProgressText}
                  aiRuleEvidenceMode={aiRuleEvidenceMode}
                  aiRuleEvidenceText={aiRuleEvidenceText}
                  debPrediction={debNumber}
                  fallbackAiReason={fallbackAiReason}
                  isEn={isEn}
                  isHkoObservation={isHkoObservation}
                  localModelSupportNote={localModelSupportNote}
                  localizedFinalJudgment={localizedFinalJudgment}
                  rawObservationText={rawObservationText}
                  tempSymbol={tempSymbol}
                />
              </div>

              <AmosRunwayPanel
                amos={detail?.amos}
                isEn={isEn}
                tempSymbol={tempSymbol}
                airportCurrent={detail?.airport_current ?? null}
              />

              <ModelEvidencePanel detail={detail} isEn={isEn} />
            </div>
          ) : !detail ? (
            <div className="scan-ai-city-loading">
              <LoadingSignal
                title={loadingCopy.title}
                description={loadingCopy.description}
                compact
              />
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
