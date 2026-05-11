"use client";

import clsx from "clsx";
import type {
  MarketDecisionView,
  WeatherDecisionView,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import { MarketDecisionLine } from "@/components/dashboard/scan-terminal/MarketDecisionLine";

export function WeatherDecisionBand({
  decisionView,
  decisionWhyText,
  isEn,
  marketDecisionView,
  marketLineText,
  paceDeltaText,
}: {
  decisionView: WeatherDecisionView;
  decisionWhyText: string;
  isEn: boolean;
  marketDecisionView: MarketDecisionView;
  marketLineText: string;
  paceDeltaText: string;
}) {
  return (
    <section className={clsx("scan-ai-decision-band", decisionView.tone)}>
      <div className="scan-ai-decision-main">
        <span>{decisionView.kicker}</span>
        <strong>{decisionView.action}</strong>
        <p className="scan-ai-decision-why">{decisionWhyText}</p>
        <MarketDecisionLine
          isEn={isEn}
          marketDecisionView={marketDecisionView}
          marketLineText={marketLineText}
        />
      </div>
      <div className="scan-ai-decision-metrics">
        <span>
          {isEn ? "Weather range" : "天气区间"}
          <b>{decisionView.targetRange}</b>
        </span>
        <span>
          {isEn ? "Path delta" : "路径偏差"} <b>{paceDeltaText}</b>
        </span>
        <span>
          {isEn ? "Quote status" : "报价状态"}{" "}
          <b>{marketDecisionView.status === "ready" ? (isEn ? "Ready" : "已同步") : marketDecisionView.status === "loading" ? (isEn ? "Loading" : "同步中") : (isEn ? "Unavailable" : "不可用")}</b>
        </span>
      </div>
    </section>
  );
}
