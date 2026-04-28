"use client";

import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";

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
