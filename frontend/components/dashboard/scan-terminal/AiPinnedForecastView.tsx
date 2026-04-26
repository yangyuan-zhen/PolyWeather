"use client";

import clsx from "clsx";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelForecast } from "@/components/dashboard/PanelSections";
import { AiCityTemperatureChart } from "@/components/dashboard/scan-terminal/AiCityTemperatureChart";
import { buildMarketDecisionView, buildWeatherDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";
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

function AiPinnedCityCard({
  item,
  detail,
  row,
  locale,
  collapsed,
  removing,
  onRemove,
  onToggleCollapsed,
}: {
  item: AiPinnedCity;
  detail: CityDetail | null;
  row: ScanOpportunityRow | null;
  locale: string;
  collapsed: boolean;
  removing?: boolean;
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
  const currentTemp =
    detail?.airport_primary?.temp ??
    detail?.airport_current?.temp ??
    detail?.current?.temp ??
    row?.current_temp ??
    null;
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
  const report = detail?.current?.raw_metar || detail?.airport_current?.raw_metar || "";
  const metarReportTimeDisplay = formatMetarReportTime(detail, report, isEn);
  const airportStation =
    detail?.risk?.icao ||
    detail?.current?.station_code ||
    detail?.airport_current?.station_code ||
    detail?.airport_primary?.station_code ||
    "";
  const detailCityName = detail?.name || item.cityName;
  const { aiForecast, refreshAiForecast } = useAiCityForecast({
    detail,
    detailCityName,
    enabled: Boolean(detail && !collapsed),
    isEn,
    locale,
    report,
  });
  const { marketScan, marketStatus } = useCityMarketScan({
    detail,
    detailCityName,
    enabled: Boolean(detail && !collapsed),
  });

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
        ? `Model support is sparse: only ${modelEntries.length} sources are available${modelPreview ? ` (${modelPreview})` : ""}, so the read should lean more on DEB path and METAR.`
        : `Model support: ${modelEntries.length} sources cluster between ${modelRange}; ${modelPreview}.`
      : modelEntries.length <= 2
        ? `多模型支撑偏少：当前只有 ${modelEntries.length} 个模型${modelPreview ? `（${modelPreview}）` : ""}，需要更重视 DEB 路径和 METAR 实测。`
        : `多模型支撑：${modelEntries.length} 个模型集中在 ${modelRange}，代表模型为 ${modelPreview}。`
    : isEn
      ? "Model support is unavailable, so this city must rely on DEB path and METAR observations."
      : "暂无可用多模型支撑，需要主要参考 DEB 路径和 METAR 实测。";
  const aiPredictedMax = toFiniteDecisionNumber(aiCityForecast?.predicted_max);
  const decisionExpectedHighNumber = aiPredictedMax != null
    ? aiPredictedMax
    : paceView?.paceAdjustedHigh != null
      ? paceView.paceAdjustedHigh
      : deb;
  const decisionView = buildWeatherDecisionView({
    aiCityForecast,
    currentTemp,
    deb,
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
          <div className="scan-ai-city-pills">
            <span>{detail?.local_time || row?.local_time || "--"}</span>
            <span>
              DEB{" "}
              {deb != null
                ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
                : "--"}
            </span>
            <span>{isEn ? "Model" : "模型"} {modelRange}</span>
            <span>{isEn ? "Peak" : "峰值"} {peakWindow}</span>
          </div>
        </div>
        <div className="scan-ai-city-hero-side">
          <span>{isEn ? "Expected high" : "预计最高温"}</span>
          <strong>
            {paceView?.paceAdjustedHigh != null
              ? formatTemperatureValue(paceView.paceAdjustedHigh, tempSymbol, { digits: 1 })
              : deb != null
                ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
                : "--"}
          </strong>
          <div className="scan-ai-city-actions">
            <button
              type="button"
              className="scan-ai-city-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                refreshAiForecast();
              }}
              aria-label={isEn ? `Refresh ${displayName} analysis` : `刷新 ${displayName} 深度分析`}
              title={isEn ? "Refresh analysis" : "刷新深度分析"}
              disabled={aiForecast.status === "loading"}
            >
              <RefreshCw size={15} className={aiForecast.status === "loading" ? "spin" : undefined} />
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
                    {isEn ? "YES" : "YES 买入"} <b>{marketDecisionView.priceText}</b>
                  </small>
                  <small>
                    {isEn ? "Edge" : "概率差"} <b>{marketDecisionView.edgeText}</b>
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
                  {currentTemp != null
                    ? formatTemperatureValue(currentTemp, tempSymbol, { digits: 1 })
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
                {isEn ? "Evidence · AI airport read" : "证据 · AI 机场报文解读"}
              </div>
              {aiForecast.status === "loading" ? (
                <>
                  <p className={aiForecast.streamText ? "scan-ai-weather-summary" : undefined}>
                    {aiForecast.streamText ||
                      (isEn
                        ? "Deepseek V4 pro is reading the latest airport bulletin..."
                        : "Deepseek V4 pro 正在解读最新机场报文...")}
                  </p>
                  <p className="scan-ai-city-muted">
                    {isEn
                      ? "Non-streaming mode is enabled to avoid truncated airport reads."
                      : "已停用流式输出，改用非流式 JSON 请求，避免报文解读被截断。"}
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
                    {report
                      ? `${isEn ? "Raw METAR" : "原始 METAR"}：${`${airportStation} ${report}`.trim()}`
                      : isEn
                        ? "Raw METAR: unavailable."
                        : "原始 METAR：暂无。"}
                  </p>
                </>
              ) : aiForecast.status === "ready" ? (
                <>
                  <p>
                    {aiForecast.payload?.status === "timeout"
                      ? isEn
                        ? "Deepseek V4-Pro timed out. You can retry; city data and the right briefing were not refreshed."
                        : "Deepseek V4-Pro 本次解读超时，可稍后重试；城市数据和右侧简报不会被刷新。"
                      : fallbackAiReason ||
                        (isEn
                          ? "AI read is unavailable for this city right now."
                          : "该城市暂时没有可用的 AI 解读。")}
                  </p>
                  <ul className="scan-ai-weather-bullets">
                    <li>{localModelSupportNote}</li>
                    <li>
                      {report
                        ? `${isEn ? "Raw METAR" : "原始 METAR"}：${`${airportStation} ${report}`.trim()}`
                        : isEn
                          ? "Raw METAR is unavailable."
                          : "暂无原始 METAR。"}
                    </li>
                  </ul>
                </>
              ) : aiForecast.status === "failed" ? (
                <>
                  <p>
                    {isEn
                      ? "AI read failed. Model support and the raw METAR remain as fallback context."
                      : "AI 解读失败。下方保留多模型支撑和原始 METAR 作为兜底上下文。"}
                    {aiForecast.error ? ` ${aiForecast.error}` : ""}
                  </p>
                  <ul className="scan-ai-weather-bullets">
                    <li>{localModelSupportNote}</li>
                    <li>
                      {report
                        ? `${isEn ? "Raw METAR" : "原始 METAR"}：${`${airportStation} ${report}`.trim()}`
                        : isEn
                          ? "Raw METAR is unavailable."
                          : "暂无原始 METAR。"}
                    </li>
                  </ul>
                </>
              ) : (
                <p>
                  {isEn
                    ? "Waiting for AI to read the latest airport bulletin."
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
                ? "Hydrating today’s model stack, METAR context and market layer."
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
  onRemoveCity,
}: {
  items: AiPinnedCity[];
  rows: ScanOpportunityRow[];
  detailsByName: Record<string, CityDetail>;
  locale: string;
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
          next.add(stableKey);
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
