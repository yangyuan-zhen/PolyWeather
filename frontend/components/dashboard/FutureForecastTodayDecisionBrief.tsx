"use client";

import { formatConfidenceLabel } from "./FutureForecastModal.utils";

export function FutureForecastTodayDecisionBrief({
  anchorRuleText,
  anchorSourceLabel,
  baseCaseBucket,
  confidence,
  displayName,
  downsideBucket,
  gapToBaseText,
  locale,
  meteorologyHeadline,
  nextObservationLabel,
  nextObservationTime,
  pathStatus,
  settlementStationName,
  upsideBucket,
}: {
  anchorRuleText: string;
  anchorSourceLabel: string;
  baseCaseBucket: string;
  confidence: string | null | undefined;
  displayName: string;
  downsideBucket: string | null | undefined;
  gapToBaseText: string;
  locale: string;
  meteorologyHeadline: string;
  nextObservationLabel: string;
  nextObservationTime: string;
  pathStatus: string;
  settlementStationName: string;
  upsideBucket: string | null | undefined;
}) {
  return (
    <section className="future-v2-meteorology-brief">
      <div className="future-v2-meteorology-copy">
        <div className="future-v2-anchor-row">
          <div className="modal-section-kicker">
            {locale === "en-US" ? "Professional meteorology read" : "专业气象判断"}
          </div>
          <span className="future-v2-anchor-source">{anchorSourceLabel}</span>
        </div>
        <h3>{meteorologyHeadline}</h3>
        <p className="future-v2-anchor-rule">{anchorRuleText}</p>
        <div className="future-v2-meteorology-meta">
          <span>
            {locale === "en-US" ? "Confidence" : "置信度"} ·{" "}
            {formatConfidenceLabel(confidence, locale)}
          </span>
          <span>
            {locale === "en-US" ? "Path state" : "路径状态"} · {pathStatus}
          </span>
          <span>
            {nextObservationLabel} · {nextObservationTime}
          </span>
        </div>
      </div>
      <div className="future-v2-decision-rail" aria-label={displayName}>
        <div className="future-v2-decision-anchor">
          <span>{locale === "en-US" ? "Anchor" : "锚点"}</span>
          <strong>{settlementStationName}</strong>
          <small>{anchorSourceLabel}</small>
        </div>
        <div className="future-v2-decision-grid">
          <div>
            <span>{locale === "en-US" ? "Base" : "基准"}</span>
            <strong>{baseCaseBucket || "--"}</strong>
          </div>
          <div>
            <span>{locale === "en-US" ? "Upside" : "上修"}</span>
            <strong>{upsideBucket || "--"}</strong>
          </div>
          <div>
            <span>{locale === "en-US" ? "Downside" : "下修"}</span>
            <strong>{downsideBucket || "--"}</strong>
          </div>
          <div>
            <span>{locale === "en-US" ? "Gap to base" : "距基准还差"}</span>
            <strong>{gapToBaseText}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
