"use client";

import clsx from "clsx";
import type {
  MarketDecisionView,
  WeatherDecisionView,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import { MarketDecisionLine } from "@/components/dashboard/scan-terminal/MarketDecisionLine";

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
        <MarketDecisionLine
          isEn={isEn}
          marketDecisionView={marketDecisionView}
          marketLineText={marketLineText}
        />
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
