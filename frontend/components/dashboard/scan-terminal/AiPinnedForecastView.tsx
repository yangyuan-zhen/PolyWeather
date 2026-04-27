"use client";

import clsx from "clsx";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelForecast } from "@/components/dashboard/PanelSections";
import { AiCityTemperatureChart } from "@/components/dashboard/scan-terminal/AiCityTemperatureChart";
import {
  buildMarketDecisionView,
  buildWeatherDecisionView,
  resolveExpectedHighCandidate,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import { findDetailForCity } from "@/components/dashboard/scan-terminal/city-detail-utils";
import { findRowForCity, getPeakWindowLabel, normalizeCityKey } from "@/components/dashboard/scan-terminal/decision-utils";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import type { AiPinnedCity } from "@/components/dashboard/scan-terminal/types";
import {
  useAiCityForecast,
  useCityMarketScan,
} from "@/components/dashboard/scan-terminal/use-ai-city-card-data";
import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatTemperatureValue, getModelView, getTodayPaceView } from "@/lib/dashboard-utils";

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

type StatusTagTone = "green" | "blue" | "amber" | "red" | "muted";

type StatusTag = {
  label: string;
  tone: StatusTagTone;
};

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

function buildObservationFreshnessLabel({
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
  const source = isHkoObservation ? (isEn ? "HKO" : "天文台") : "METAR";
  const stale = Boolean(
    detail?.metar_status?.stale_for_today ||
      detail?.airport_current?.stale_for_today ||
      detail?.current?.observation_status === "stale",
  );
  if (stale) return isEn ? `${source} stale` : `${source} 过旧`;
  const ageLabel = formatFreshnessAge(
    isHkoObservation ? detail?.current?.obs_age_min : detail?.airport_current?.obs_age_min ?? detail?.current?.obs_age_min,
    isEn,
  );
  if (ageLabel) return `${source} ${ageLabel}`;
  if (displayTime) return `${source} ${displayTime}`;
  return isEn ? `${source} time pending` : `${source} 时间待确认`;
}

function uniqueStatusTags(tags: Array<StatusTag | null | undefined>) {
  const seen = new Set<string>();
  return tags.filter((tag): tag is StatusTag => {
    if (!tag?.label || seen.has(tag.label)) return false;
    seen.add(tag.label);
    return true;
  });
}

function AiPinnedCityCard({
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
  const observationFreshnessLabel = buildObservationFreshnessLabel({
    detail,
    displayTime: metarReportTimeDisplay,
    isEn,
    isHkoObservation,
  });
  const aiStatusLabel =
    aiForecast.status === "loading"
      ? isEn
        ? "AI reading"
        : "AI 解读中"
      : aiForecast.status === "ready" && aiCityForecast
        ? aiForecast.payload?.degraded || aiMeta?.fallback
          ? isEn
            ? "Rule fallback"
            : "规则兜底"
          : isEn
            ? "AI ready"
            : "AI 已完成"
        : aiForecast.status === "failed"
          ? isEn
            ? "AI failed"
            : "AI 失败"
          : isEn
            ? "AI pending"
            : "AI 待返回";
  const aiStatusTone: StatusTagTone =
    aiForecast.status === "loading"
      ? "blue"
      : aiForecast.status === "ready" && aiCityForecast
        ? aiForecast.payload?.degraded || aiMeta?.fallback
          ? "amber"
          : "green"
        : aiForecast.status === "failed"
          ? "red"
          : "muted";
  const marketFreshnessLabel =
    marketDecisionView.status === "ready"
      ? isEn
        ? "Market synced"
        : "市场已同步"
      : marketDecisionView.status === "loading"
        ? isEn
          ? "Market loading"
          : "市场同步中"
        : isEn
          ? "No market price"
          : "暂无市场价";
  const marketStatusTone: StatusTagTone =
    marketDecisionView.status === "ready"
      ? "green"
      : marketDecisionView.status === "loading"
        ? "blue"
        : "muted";
  const statusTags = uniqueStatusTags([
    observedHighBreak
      ? {
          label: isEn ? "Observed breakout" : "实测突破",
          tone: "red",
        }
      : null,
    peakHasPassed
      ? {
          label: isEn ? "Peak window passed" : "峰值窗口已过",
          tone: "muted",
        }
      : null,
    observationStale
      ? {
          label: isEn
            ? isHkoObservation
              ? "HKO stale"
              : "METAR stale"
            : isHkoObservation
              ? "观测过旧"
              : "METAR 过旧",
          tone: "amber",
        }
      : null,
    observedLowBreak
      ? {
          label: isEn ? "Peak revised down" : "峰值下修",
          tone: "blue",
        }
      : null,
    aiForecast.status === "loading"
      ? {
          label: isEn ? "AI reading" : "AI 解读中",
          tone: aiStatusTone,
        }
      : null,
    marketDecisionView.status === "unavailable"
      ? {
          label: isEn ? "Market missing" : "市场价格缺失",
          tone: marketStatusTone,
        }
      : null,
    modelHighlyConsistent
      ? {
          label: isEn ? "Models agree" : "模型高度一致",
          tone: "green",
        }
      : null,
    observedLowLag || needsNextBulletin
      ? {
          label: isEn ? "Wait next report" : "需要等待下一报文",
          tone: "amber",
        }
      : null,
  ]).slice(0, 3);
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

  const collapseId = `ai-city-body-${normalizeCityKey(item.cityName) || item.addedAt}`;

  return (
    <article className={clsx("scan-ai-city-card", collapsed && "collapsed", removing && "removing")}>
      <header className="scan-ai-city-hero">
        <div>
          <span className="scan-ai-city-kicker">
            {isEn ? "Deep analysis" : "城市深度分析"}
          </span>
          <h3>{displayName}</h3>
          <div className="scan-ai-city-status-tags">
            {statusTags.map((tag) => (
              <span
                key={tag.label}
                className={clsx("scan-ai-city-status-tag", tag.tone)}
              >
                {tag.label}
              </span>
            ))}
          </div>
          <div className="scan-ai-city-pills">
            <span>{detail?.local_time || row?.local_time || "--"}</span>
            <span>
              DEB{" "}
              {debNumber != null
                ? formatTemperatureValue(debNumber, tempSymbol, { digits: 1 })
                : "--"}
            </span>
            <span>{isEn ? "Model" : "模型"} {modelRange}</span>
            <span>{isEn ? "Peak" : "峰值"} {peakWindow}</span>
          </div>
          <div className="scan-ai-city-freshness">
            <span>{observationFreshnessLabel}</span>
            <span>{marketFreshnessLabel}</span>
            <span>{aiStatusLabel}</span>
          </div>
        </div>
        <div className="scan-ai-city-hero-side">
          <span>{isEn ? "Expected high" : "预计最高温"}</span>
          <strong>
            {decisionExpectedHighNumber != null
              ? formatTemperatureValue(decisionExpectedHighNumber, tempSymbol, { digits: 1 })
              : "--"}
          </strong>
          <div className="scan-ai-city-actions">
            <button
              type="button"
              className="scan-ai-city-icon-button"
              onClick={(event) => {
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
              }}
              aria-label={isEn ? `Refresh ${displayName} analysis` : `刷新 ${displayName} 深度分析`}
              title={
                isEn
                  ? "Refresh city data, chart and AI analysis"
                  : "刷新城市数据、温度走势图和 AI 分析"
              }
              disabled={isRefreshing}
            >
              <RefreshCw size={15} className={isRefreshing ? "spin" : undefined} />
            </button>
            <button
              type="button"
              className="scan-ai-city-icon-button danger"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
              aria-label={isEn ? `Remove ${displayName}` : `移除 ${displayName}`}
              title={isEn ? "Remove city" : "移除城市"}
              disabled={removing}
            >
              <X size={15} />
            </button>
            <button
              type="button"
              className="scan-ai-city-collapse"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls={collapseId}
            >
              <ChevronDown size={15} />
              {collapsed ? (isEn ? "Expand" : "展开") : (isEn ? "Collapse" : "收起")}
            </button>
          </div>
        </div>
      </header>

      {detail && !collapsed ? (
        <div className="scan-ai-city-body" id={collapseId}>
          <section className={clsx("scan-ai-decision-band", decisionView.tone)}>
            <div className="scan-ai-decision-main">
              <span>{decisionView.kicker}</span>
              <strong>{decisionView.action}</strong>
              <p>{localizedFinalJudgment || paceText}</p>
              <div className="scan-ai-decision-reasons">
                {decisionView.reasons.map((reason, index) => (
                  <small key={`${reason}-${index}`}>{reason}</small>
                ))}
              </div>
              <p className="scan-ai-decision-risk">{decisionView.risk}</p>
              <div className={clsx("scan-ai-market-decision", marketDecisionView.tone)}>
                <div>
                  <span>
                    {isEn ? "Polymarket price layer" : "Polymarket 价格层"}
                  </span>
                  <strong>{marketDecisionView.title}</strong>
                  <p>{marketDecisionView.reason}</p>
                </div>
                <div className="scan-ai-market-decision-stats">
                  <small>
                    {isEn ? "Bucket" : "温度桶"} <b>{marketDecisionView.bucketLabel}</b>
                  </small>
                  <small>
                    {isEn ? "YES buy" : "YES 买价"} <b>{marketDecisionView.priceText}</b>
                  </small>
                  <small>
                    {isEn ? "Model-market" : "模型-市场差"} <b>{marketDecisionView.edgeText}</b>
                  </small>
                </div>
                {marketDecisionView.marketUrl ? (
                  <a
                    className="scan-ai-market-link"
                    href={marketDecisionView.marketUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {isEn ? "Open market" : "打开市场"}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="scan-ai-decision-metrics">
              <span>
                {isEn ? "Expected high" : "预计高点"}
                <b>{decisionView.expectedHigh}</b>
              </span>
              <span>
                {isEn ? "Weather range" : "天气区间"}
                <b>{decisionView.targetRange}</b>
              </span>
              <span>
                {isEn ? "Confidence" : "信心"}
                <b>{decisionView.confidence}</b>
              </span>
              <span>
                {isEn ? "Observed" : "实测"}
                <b>
                  {currentTempNumber != null
                    ? formatTemperatureValue(currentTempNumber, tempSymbol, { digits: 1 })
                    : "--"}
                </b>
              </span>
              <span>
                {isEn ? "Path delta" : "路径偏差"} <b>{paceView?.deltaText || "--"}</b>
              </span>
              <span>
                {isEn ? "Peak window" : "峰值窗口"} <b>{peakWindow}</b>
              </span>
              <span>
                {isEn ? "Market implied" : "市场隐含"} <b>{marketDecisionView.impliedText}</b>
              </span>
              <span>
                {isEn ? "Model prob" : "模型概率"} <b>{marketDecisionView.modelText}</b>
              </span>
              <span>
                {isEn ? "Quote status" : "报价状态"} <b>{marketDecisionView.status === "ready" ? (isEn ? "Ready" : "已同步") : marketDecisionView.status === "loading" ? (isEn ? "Loading" : "同步中") : (isEn ? "Unavailable" : "不可用")}</b>
              </span>
            </div>
          </section>

          <div className="scan-ai-city-analysis-grid">
            <AiCityTemperatureChart detail={detail} />
            <section className="scan-ai-city-section">
              <div className="scan-ai-city-section-title">
                {isHkoObservation
                  ? isEn
                    ? "Evidence · AI HKO observation read"
                    : "证据 · AI 香港天文台观测解读"
                  : isEn
                    ? "Evidence · AI airport read"
                    : "证据 · AI 机场报文解读"}
              </div>
              {aiForecast.status === "loading" ? (
                <>
                  <p className={aiForecast.streamText ? "scan-ai-weather-summary" : undefined}>
                    {localizedFinalJudgment ||
                      aiForecast.streamText ||
                      (isEn
                        ? isHkoObservation
                          ? "Fast read is ready; AI is adding HKO observation details..."
                          : "Fast read is ready; AI is adding airport bulletin details..."
                        : isHkoObservation
                          ? "快速判断已完成，AI 正在补充香港天文台观测细节…"
                          : "快速判断已完成，AI 正在补充机场报文细节…")}
                  </p>
                  <p className="scan-ai-city-muted">
                    {isEn
                      ? isHkoObservation
                        ? "Rule evidence is shown first; the full HKO AI read will merge automatically."
                        : "Rule evidence is shown first; the full airport AI read will merge automatically."
                      : isHkoObservation
                        ? "先展示规则证据，完整香港天文台 AI 解读返回后会自动合并。"
                        : "先展示规则证据，完整机场 AI 解读返回后会自动合并。"}
                  </p>
                </>
              ) : aiForecast.status === "ready" && aiCityForecast ? (
                <>
                  <p className="scan-ai-weather-summary">
                    {localizedFinalJudgment ||
                      (isEn ? "AI read returned without a final sentence." : "AI 已返回，但缺少最终判断。")}
                  </p>
                  <ul className="scan-ai-weather-bullets">
                    {aiBullets.map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ul>
                  <p className="scan-ai-raw-metar">
                    {rawObservationText}
                  </p>
                </>
              ) : aiForecast.status === "ready" ? (
                <>
                  <p>
                    {aiForecast.payload?.status === "timeout"
                      ? isEn
                        ? "DeepSeek enhancement timed out. You can retry; city data and the right briefing were not refreshed."
                        : "DeepSeek 增强本次超时，可稍后重试；城市数据和右侧简报不会被刷新。"
                      : fallbackAiReason ||
                        (isEn
                          ? "AI read is unavailable for this city right now."
                          : "该城市暂时没有可用的 AI 解读。")}
                  </p>
                  <ul className="scan-ai-weather-bullets">
                    <li>{localModelSupportNote}</li>
                    <li>{rawObservationText}</li>
                  </ul>
                </>
              ) : aiForecast.status === "failed" ? (
                <>
                  <p>
                    {isEn
                      ? isHkoObservation
                        ? "AI read failed. Model support and the HKO observation remain as fallback context."
                        : "AI read failed. Model support and the raw METAR remain as fallback context."
                      : isHkoObservation
                        ? "AI 解读失败。下方保留多模型支撑和香港天文台观测作为兜底上下文。"
                        : "AI 解读失败。下方保留多模型支撑和原始 METAR 作为兜底上下文。"}
                    {aiForecast.error ? ` ${aiForecast.error}` : ""}
                  </p>
                  <ul className="scan-ai-weather-bullets">
                    <li>{localModelSupportNote}</li>
                    <li>{rawObservationText}</li>
                  </ul>
                </>
              ) : (
                <p>
                  {isEn
                    ? isHkoObservation
                      ? "Waiting for AI to read the latest HKO observation."
                      : "Waiting for AI to read the latest airport bulletin."
                    : isHkoObservation
                      ? "等待 AI 解读最新香港天文台观测。"
                      : "等待 AI 解读最新机场报文。"}
                </p>
              )}
            </section>
          </div>

          <section className="scan-ai-city-section models">
            <div className="scan-ai-city-section-title">
              {isEn ? "Evidence · multi-model support" : "证据 · 多模型支撑"}
            </div>
            <ModelForecast detail={detail} targetDate={detail.local_date} hideTitle />
          </section>

        </div>
      ) : !detail ? (
        <div className="scan-ai-city-loading">
          <LoadingSignal
            title={isEn ? "Loading city decision data" : "正在加载城市决策数据"}
            description={
              isEn
                ? isHkoObservation
                  ? "Hydrating today’s model stack, HKO observation context and market layer."
                  : "Hydrating today’s model stack, METAR context and market layer."
                : isHkoObservation
                  ? "正在补全今日模型、香港天文台观测和市场价格层。"
                  : "正在补全今日模型、机场报文和市场价格层。"
            }
            compact
          />
        </div>
      ) : null}
    </article>
  );
}

export function AiPinnedForecastView({
  items,
  rows,
  detailsByName,
  locale,
  onRefreshCityDetail,
  onRemoveCity,
}: {
  items: AiPinnedCity[];
  rows: ScanOpportunityRow[];
  detailsByName: Record<string, CityDetail>;
  locale: string;
  onRefreshCityDetail: (cityName: string) => Promise<void>;
  onRemoveCity: (cityName: string) => void;
}) {
  const isEn = locale === "en-US";
  const [collapsedCities, setCollapsedCities] = useState<Set<string>>(
    () => new Set(),
  );
  const [removingCities, setRemovingCities] = useState<Set<string>>(
    () => new Set(),
  );
  const knownCityKeysRef = useRef<Set<string>>(new Set());
  const removeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const activeKeys = new Set(
      items.map((item) => normalizeCityKey(item.cityName) || item.cityName),
    );
    setCollapsedCities((current) => {
      const next = new Set<string>();
      let changed = false;
      current.forEach((key) => {
        if (activeKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      items.forEach((item) => {
        const stableKey = normalizeCityKey(item.cityName) || item.cityName;
        if (!knownCityKeysRef.current.has(stableKey)) {
          changed = true;
        }
      });
      return changed ? next : current;
    });
    knownCityKeysRef.current = activeKeys;
  }, [items]);

  useEffect(() => {
    return () => {
      removeTimersRef.current.forEach((timer) => clearTimeout(timer));
      removeTimersRef.current.clear();
    };
  }, []);

  const removeCityWithMotion = useCallback(
    (item: AiPinnedCity, stableKey: string) => {
      if (removeTimersRef.current.has(stableKey)) return;
      setRemovingCities((current) => {
        const next = new Set(current);
        next.add(stableKey);
        return next;
      });
      const timer = setTimeout(() => {
        onRemoveCity(item.cityName);
        setRemovingCities((current) => {
          const next = new Set(current);
          next.delete(stableKey);
          return next;
        });
        removeTimersRef.current.delete(stableKey);
      }, 260);
      removeTimersRef.current.set(stableKey, timer);
    },
    [onRemoveCity],
  );

  if (!items.length) {
    return (
      <div className="scan-ai-workspace empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "Click a city on the map" : "从分布视图点击城市"}
          </div>
          <div className="scan-empty-copy">
            {isEn
              ? "Selected cities will appear here as deep analysis blocks."
              : "被点击的城市会加入深度分析页，并保留为城市分析区块。"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-ai-workspace">
      <div className="scan-ai-workspace-head">
        <div>
          <span>{isEn ? "Selected city workspace" : "城市分析工作区"}</span>
          <strong>
            {isEn
              ? `${items.length} cities under deep analysis`
              : `${items.length} 个城市正在深度分析`}
          </strong>
        </div>
        <p>
          {isEn
            ? "Map clicks add cities here. City analysis stays here until you remove it."
            : "地图点击会把城市加入这里；城市分析会保留，直到你手动移除。"}
        </p>
      </div>
      <div className="scan-ai-city-stack">
        {items.map((item) => {
          const detail = findDetailForCity(detailsByName, item.cityName);
          const row = findRowForCity(rows, item.cityName);
          const key = normalizeCityKey(item.cityName);
          const stableKey = key || item.cityName;
          const isKnownCity = knownCityKeysRef.current.has(stableKey);
          return (
            <AiPinnedCityCard
              key={stableKey}
              item={item}
              detail={detail}
              row={row}
              locale={locale}
              collapsed={!isKnownCity || collapsedCities.has(stableKey)}
              removing={removingCities.has(stableKey)}
              onRefreshCityDetail={onRefreshCityDetail}
              onRemove={() => removeCityWithMotion(item, stableKey)}
              onToggleCollapsed={() => {
                setCollapsedCities((current) => {
                  const next = new Set(current);
                  if (next.has(stableKey)) {
                    next.delete(stableKey);
                  } else {
                    next.add(stableKey);
                  }
                  return next;
                });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
