"use client";

import clsx from "clsx";
import type { MarketDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";

export function MarketDecisionLine({
  isEn,
  marketDecisionView,
  marketLineText,
}: {
  isEn: boolean;
  marketDecisionView: MarketDecisionView;
  marketLineText: string;
}) {
  return (
    <>
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
    </>
  );
}
