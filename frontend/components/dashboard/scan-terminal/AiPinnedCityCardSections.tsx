"use client";

import clsx from "clsx";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";
import type {
  MarketDecisionView,
  WeatherDecisionView,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";

type StatusTone = "green" | "blue" | "amber" | "red" | "muted";

export type CityStatusTag = {
  label: string;
  tone: StatusTone;
};

export type DataFreshnessRow = {
  label: string;
  value: string;
  tone: string;
};

export function CityCardHeader({
  aiStatusLabel,
  aiStatusTone,
  collapseId,
  collapsed,
  currentTempText,
  dataFreshnessRows,
  debText,
  detailLocalTime,
  displayName,
  expectedHighText,
  freshnessSeparator,
  isEn,
  isRefreshing,
  modelRange,
  onRefresh,
  onRemove,
  onToggleCollapsed,
  peakWindow,
  removing,
  rowLocalTime,
  statusTags,
}: {
  aiStatusLabel: string;
  aiStatusTone: StatusTone;
  collapseId: string;
  collapsed: boolean;
  currentTempText: string;
  dataFreshnessRows: DataFreshnessRow[];
  debText: string;
  detailLocalTime?: string | null;
  displayName: string;
  expectedHighText: string;
  freshnessSeparator: string;
  isEn: boolean;
  isRefreshing: boolean;
  modelRange: string;
  onRefresh: (event: MouseEvent<HTMLButtonElement>) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggleCollapsed: () => void;
  peakWindow: string;
  removing?: boolean;
  rowLocalTime?: string | null;
  statusTags: CityStatusTag[];
}) {
  return (
    <header className="scan-ai-city-hero">
      <div>
        <span className="scan-ai-city-kicker">
          {isEn ? "Deep analysis" : "城市深度分析"}
        </span>
        <h3>{displayName}</h3>
        <div className="scan-ai-city-mobile-priority" aria-label={isEn ? "Key city decision metrics" : "城市决策重点"}>
          <span>
            <small>{isEn ? "Observed" : "当前温度"}</small>
            <b>{currentTempText}</b>
          </span>
          <span>
            <small>{isEn ? "Expected high" : "预测高点"}</small>
            <b>{expectedHighText}</b>
          </span>
          <span>
            <small>{isEn ? "Peak" : "峰值时间"}</small>
            <b>{peakWindow}</b>
          </span>
        </div>
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
          <span>{detailLocalTime || rowLocalTime || "--"}</span>
          <span>DEB {debText}</span>
          <span>{isEn ? "Model" : "模型"} {modelRange}</span>
          <span>{isEn ? "Peak" : "峰值"} {peakWindow}</span>
        </div>
        <div className="scan-ai-city-freshness" aria-label={isEn ? "Data freshness" : "数据新鲜度"}>
          <strong>{isEn ? "Data freshness" : "数据新鲜度"}</strong>
          {dataFreshnessRows.map((freshness) => (
            <span key={freshness.label} className={freshness.tone}>
              <b>{freshness.label}{freshnessSeparator}</b>
              <em>{freshness.value}</em>
            </span>
          ))}
          <span className={aiStatusTone}>
            <b>AI{freshnessSeparator}</b>
            <em>{aiStatusLabel}</em>
          </span>
        </div>
      </div>
      <div className="scan-ai-city-hero-side">
        <span>{isEn ? "Expected high" : "预计最高温"}</span>
        <strong>{expectedHighText}</strong>
        <div className="scan-ai-city-actions">
          <button
            type="button"
            className="scan-ai-city-icon-button"
            onClick={onRefresh}
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
            onClick={onRemove}
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
  );
}

export function WeatherDecisionBand({
  currentTempText,
  decisionView,
  decisionWhyText,
  isEn,
  longText,
  marketDecisionView,
  marketLineText,
  paceDeltaText,
  peakWindow,
}: {
  currentTempText: string;
  decisionView: WeatherDecisionView;
  decisionWhyText: string;
  isEn: boolean;
  longText: string;
  marketDecisionView: MarketDecisionView;
  marketLineText: string;
  paceDeltaText: string;
  peakWindow: string;
}) {
  return (
    <section className={clsx("scan-ai-decision-band", decisionView.tone)}>
      <div className="scan-ai-decision-main">
        <span>{decisionView.kicker}</span>
        <strong>{decisionView.action}</strong>
        <p className="scan-ai-decision-why">{decisionWhyText}</p>
        <p className="scan-ai-decision-long">{longText}</p>
        <div className="scan-ai-decision-reasons">
          {decisionView.reasons.map((reason, index) => (
            <small key={`${reason}-${index}`}>{reason}</small>
          ))}
        </div>
        <p className="scan-ai-decision-risk">{decisionView.risk}</p>
        <div className={clsx("scan-ai-market-mobile-line", marketDecisionView.tone)}>
          <span>{isEn ? "Market price" : "市场价格"}</span>
          <b>{marketLineText}</b>
        </div>
        <div className={clsx("scan-ai-market-decision", marketDecisionView.tone)}>
          <div>
            <span>{isEn ? "Polymarket price layer" : "Polymarket 价格层"}</span>
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
          <b>{currentTempText}</b>
        </span>
        <span>
          {isEn ? "Path delta" : "路径偏差"} <b>{paceDeltaText}</b>
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
          {isEn ? "Quote status" : "报价状态"}{" "}
          <b>{marketDecisionView.status === "ready" ? (isEn ? "Ready" : "已同步") : marketDecisionView.status === "loading" ? (isEn ? "Loading" : "同步中") : (isEn ? "Unavailable" : "不可用")}</b>
        </span>
      </div>
    </section>
  );
}

export function AiEvidencePanel({
  aiBullets,
  aiCityForecast,
  aiForecast,
  aiReadCompleteText,
  aiReadInProgressText,
  aiRuleEvidenceMode,
  aiRuleEvidenceText,
  fallbackAiReason,
  isCompactCard,
  isEn,
  isHkoObservation,
  localModelSupportNote,
  localizedFinalJudgment,
  rawObservationText,
}: {
  aiBullets: string[];
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  aiForecast: AiCityForecastState;
  aiReadCompleteText: string;
  aiReadInProgressText: string;
  aiRuleEvidenceMode: boolean;
  aiRuleEvidenceText: string;
  fallbackAiReason: string;
  isCompactCard: boolean;
  isEn: boolean;
  isHkoObservation: boolean;
  localModelSupportNote: string;
  localizedFinalJudgment: string;
  rawObservationText: string;
}) {
  return (
    <details className="scan-ai-city-section scan-ai-city-ai-read" open={!isCompactCard}>
      <summary className="scan-ai-city-section-title">
        {isHkoObservation
          ? isEn
            ? "Evidence · AI HKO observation read"
            : "证据 · AI 香港天文台观测解读"
          : isEn
            ? "Evidence · AI airport read"
            : "证据 · AI 机场报文解读"}
      </summary>
      <div className="scan-ai-city-section-body">
        {aiForecast.status === "loading" ? (
          <>
            <p className="scan-ai-weather-summary">{aiReadInProgressText}</p>
            {localizedFinalJudgment || aiForecast.streamText ? (
              <p className="scan-ai-city-muted">
                {localizedFinalJudgment || aiForecast.streamText}
              </p>
            ) : null}
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
              {aiRuleEvidenceMode ? aiRuleEvidenceText : aiReadCompleteText}
            </p>
            <ul className="scan-ai-weather-bullets">
              {[localizedFinalJudgment, ...aiBullets]
                .filter((line) => String(line || "").trim())
                .map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
            </ul>
            <p className="scan-ai-raw-metar">{rawObservationText}</p>
          </>
        ) : aiForecast.status === "ready" ? (
          <>
            <p className="scan-ai-weather-summary">{aiRuleEvidenceText}</p>
            <ul className="scan-ai-weather-bullets">
              {fallbackAiReason ? <li>{fallbackAiReason}</li> : null}
              <li>{localModelSupportNote}</li>
              <li>{rawObservationText}</li>
            </ul>
          </>
        ) : aiForecast.status === "failed" ? (
          <>
            <p className="scan-ai-weather-summary">{aiRuleEvidenceText}</p>
            <ul className="scan-ai-weather-bullets">
              {aiForecast.error ? <li>{aiForecast.error}</li> : null}
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
      </div>
    </details>
  );
}
