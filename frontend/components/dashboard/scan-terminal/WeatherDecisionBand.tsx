"use client";

import clsx from "clsx";
import type { WeatherDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";

export function WeatherDecisionBand({
  decisionView,
  decisionWhyText,
  isEn,
  paceDeltaText,
}: {
  decisionView: WeatherDecisionView;
  decisionWhyText: string;
  isEn: boolean;
  paceDeltaText: string;
}) {
  return (
    <section className={clsx("scan-ai-decision-band", decisionView.tone)}>
      <div className="scan-ai-decision-main">
        <span>{decisionView.kicker}</span>
        <strong>{decisionView.action}</strong>
        <p className="scan-ai-decision-why">{decisionWhyText}</p>
      </div>
      <div className="scan-ai-decision-metrics">
        <span>
          {isEn ? "Weather range" : "天气区间"}
          <b>{decisionView.targetRange}</b>
        </span>
        <span>
          {isEn ? "Path delta" : "路径偏差"} <b>{paceDeltaText}</b>
        </span>
      </div>
    </section>
  );
}
