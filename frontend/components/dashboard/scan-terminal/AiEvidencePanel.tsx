"use client";

import { useEffect, useState } from "react";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { formatTemperatureValue } from "@/lib/temperature-utils";

function confidenceBadge(confidence: string | null, isEn: boolean) {
  const c = String(confidence || "").toLowerCase();
  if (c === "high") return { label: isEn ? "High" : "高", tone: "high" };
  if (c === "medium") return { label: isEn ? "Medium" : "中", tone: "medium" };
  return { label: isEn ? "Low" : "低", tone: "low" };
}

function useTransitionMarker(status: string, hasContent: boolean) {
  const [showUpdated, setShowUpdated] = useState(false);
  useEffect(() => {
    if (status === "ready" && hasContent) {
      setShowUpdated(true);
      const id = setTimeout(() => setShowUpdated(false), 4000);
      return () => clearTimeout(id);
    }
  }, [status, hasContent]);
  return showUpdated;
}

export function AiEvidencePanel({
  aiBullets,
  aiCityForecast,
  aiForecast,
  aiPredictedMax,
  aiRangeLow,
  aiRangeHigh,
  aiConfidence,
  aiReadCompleteText,
  aiReadInProgressText,
  aiRuleEvidenceMode,
  aiRuleEvidenceText,
  debPrediction,
  fallbackAiReason,
  isEn,
  isHkoObservation,
  localModelSupportNote,
  localizedFinalJudgment,
  rawObservationText,
  tempSymbol,
}: {
  aiBullets: string[];
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  aiForecast: AiCityForecastState;
  aiPredictedMax: number | null;
  aiRangeLow: number | null;
  aiRangeHigh: number | null;
  aiConfidence: string | null;
  aiReadCompleteText: string;
  aiReadInProgressText: string;
  aiRuleEvidenceMode: boolean;
  aiRuleEvidenceText: string;
  debPrediction: number | null;
  fallbackAiReason: string;
  isEn: boolean;
  isHkoObservation: boolean;
  localModelSupportNote: string;
  localizedFinalJudgment: string;
  rawObservationText: string;
  tempSymbol: string;
}) {
  const aiConfidenceMeta = confidenceBadge(aiConfidence, isEn);
  const hasAiPrediction = aiPredictedMax != null;
  const hasDebPrediction = debPrediction != null;
  const aiRangeText =
    aiRangeLow != null && aiRangeHigh != null
      ? `${formatTemperatureValue(aiRangeLow, tempSymbol, { digits: 0 })} ~ ${formatTemperatureValue(aiRangeHigh, tempSymbol, { digits: 0 })}`
      : null;

  const showUpdatedBadge = useTransitionMarker(aiForecast.status, Boolean(aiCityForecast));

  return (
    <section className="scan-ai-city-section scan-ai-city-ai-read">
      <div className="scan-ai-city-section-title">
        {isHkoObservation
          ? isEn
            ? "Evidence · AI HKO observation read"
            : "证据 · AI 香港天文台观测解读"
          : isEn
            ? "Evidence · AI airport read"
            : "证据 · AI 机场报文解读"}
      </div>
      <div className="scan-ai-city-section-body">
          {hasAiPrediction || hasDebPrediction ? (
            <div className="scan-ai-prediction-dual">
              {hasAiPrediction ? (
                <div className="scan-ai-prediction-card ai">
                  <small>{isEn ? "AI predicted high" : "AI 预测最高温"}</small>
                  <strong>{formatTemperatureValue(aiPredictedMax!, tempSymbol, { digits: 1 })}</strong>
                  <span className={`scan-ai-confidence ${aiConfidenceMeta.tone}`}>
                    {aiConfidenceMeta.label}
                  </span>
                  {aiRangeText ? <em>{aiRangeText}</em> : null}
                </div>
              ) : aiForecast.status === "loading" && hasDebPrediction ? (
                <div className="scan-ai-prediction-card ai pending">
                  <small>{isEn ? "AI predicted high" : "AI 预测最高温"}</small>
                  <strong>{isEn ? "..." : "…"}</strong>
                  <span className="scan-ai-confidence low">
                    {isEn ? "Predicting" : "预测中"}
                  </span>
                </div>
              ) : null}
              {hasDebPrediction ? (
                <div className="scan-ai-prediction-card deb">
                  <small>{isEn ? "DEB fusion" : "DEB 融合"}</small>
                  <strong>{formatTemperatureValue(debPrediction!, tempSymbol, { digits: 1 })}</strong>
                  <span className="scan-ai-confidence neutral">
                    {isEn ? "Reference" : "参考"}
                  </span>
                </div>
              ) : null}
            </div>
          ) : hasDebPrediction ? (
            <div className="scan-ai-prediction-dual">
              <div className="scan-ai-prediction-card deb">
                <small>{isEn ? "DEB fusion" : "DEB 融合"}</small>
                <strong>{formatTemperatureValue(debPrediction!, tempSymbol, { digits: 1 })}</strong>
                <span className="scan-ai-confidence neutral">
                  {isEn ? "Reference" : "参考"}
                </span>
              </div>
              <div className="scan-ai-prediction-card ai pending">
                <small>{isEn ? "AI predicted high" : "AI 预测最高温"}</small>
                <strong>{isEn ? "..." : "…"}</strong>
                <span className="scan-ai-confidence low">
                  {isEn ? "Predicting" : "预测中"}
                </span>
              </div>
            </div>
          ) : null}

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
              {showUpdatedBadge ? (
                <span className="scan-ai-updated-badge">
                  {isEn ? "✓ Updated" : "✓ 已更新"}
                </span>
              ) : null}
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
    </section>
  );
}
