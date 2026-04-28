"use client";

import { RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { AiCityTemperatureChart } from "@/components/dashboard/scan-terminal/AiCityTemperatureChart";
import { AiEvidencePanel } from "@/components/dashboard/scan-terminal/AiEvidencePanel";
import {
  CityStatusTags,
  type CityStatusTag,
  type StatusTone,
} from "@/components/dashboard/scan-terminal/CityStatusTags";
import {
  DataFreshnessBar,
  type DataFreshnessRow,
} from "@/components/dashboard/scan-terminal/DataFreshnessBar";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import { MarketDecisionLine } from "@/components/dashboard/scan-terminal/MarketDecisionLine";
import { ModelEvidencePanel } from "@/components/dashboard/scan-terminal/ModelEvidencePanel";
import type { MarketDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import type { CityDecisionState } from "@/components/dashboard/scan-terminal/city-decision-state";
import {
  getCityLoadingCopy,
  getMobileDecisionCopy,
} from "@/components/dashboard/scan-terminal/decision-copy";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import type { CityDetail } from "@/lib/dashboard-types";

export function MobileDecisionCard({
  aiBullets,
  aiCityForecast,
  aiForecast,
  aiReadCompleteText,
  aiReadInProgressText,
  aiRuleEvidenceMode,
  aiRuleEvidenceText,
  currentTempText,
  dataFreshnessRows,
  decisionState,
  detail,
  displayName,
  expectedHighText,
  fallbackAiReason,
  freshnessSeparator,
  isEn,
  isHkoObservation,
  isRefreshing,
  localModelSupportNote,
  localizedFinalJudgment,
  marketDecisionView,
  marketLineText,
  onRefresh,
  onRemove,
  peakWindow,
  rawObservationText,
  removing,
}: {
  aiBullets: string[];
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  aiForecast: AiCityForecastState;
  aiReadCompleteText: string;
  aiReadInProgressText: string;
  aiRuleEvidenceMode: boolean;
  aiRuleEvidenceText: string;
  currentTempText: string;
  dataFreshnessRows: DataFreshnessRow[];
  decisionState: CityDecisionState;
  detail: CityDetail | null;
  displayName: string;
  expectedHighText: string;
  fallbackAiReason: string;
  freshnessSeparator: string;
  isEn: boolean;
  isHkoObservation: boolean;
  isRefreshing: boolean;
  localModelSupportNote: string;
  localizedFinalJudgment: string;
  marketDecisionView: MarketDecisionView;
  marketLineText: string;
  onRefresh: (event: MouseEvent<HTMLButtonElement>) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
  peakWindow: string;
  rawObservationText: string;
  removing?: boolean;
}) {
  const copy = getMobileDecisionCopy(isEn);
  const loadingCopy = getCityLoadingCopy({ isEn, isHkoObservation });
  const [modelOpen, setModelOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const statusTags: CityStatusTag[] = decisionState.badges.length
    ? decisionState.badges
    : [{ label: decisionState.aiStatusLabel, tone: decisionState.aiStatusTone as StatusTone }];

  return (
    <>
      <header className="scan-mobile-decision-head">
        <div>
          <span className="scan-ai-city-kicker">
            {isEn ? "Mobile action card" : "移动端行动卡"}
          </span>
          <h3>{displayName}</h3>
        </div>
        <div className="scan-ai-city-actions">
          <button
            type="button"
            className="scan-ai-city-icon-button"
            onClick={onRefresh}
            aria-label={`${copy.refresh} ${displayName}`}
            title={copy.refresh}
            disabled={isRefreshing}
          >
            <RefreshCw size={15} className={isRefreshing ? "spin" : undefined} />
          </button>
          <button
            type="button"
            className="scan-ai-city-icon-button danger"
            onClick={onRemove}
            aria-label={`${copy.remove} ${displayName}`}
            title={copy.remove}
            disabled={removing}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="scan-mobile-decision-metrics">
        <span>
          <small>{copy.currentTemp}</small>
          <b>{currentTempText}</b>
        </span>
        <span>
          <small>{copy.expectedHigh}</small>
          <b>{expectedHighText}</b>
        </span>
        <span>
          <small>{copy.peakWindow}</small>
          <b>{peakWindow}</b>
        </span>
      </div>

      <p className="scan-mobile-decision-reason">{decisionState.primaryReason}</p>
      <CityStatusTags tags={statusTags} />
      <DataFreshnessBar
        aiStatusLabel={decisionState.aiStatusLabel}
        aiStatusTone={decisionState.aiStatusTone}
        freshnessSeparator={freshnessSeparator}
        isEn={isEn}
        rows={dataFreshnessRows}
      />
      <MarketDecisionLine
        isEn={isEn}
        marketDecisionView={marketDecisionView}
        marketLineText={marketLineText}
      />

      {!detail ? (
        <div className="scan-ai-city-loading">
          <LoadingSignal
            title={loadingCopy.title}
            description={loadingCopy.description}
            compact
          />
        </div>
      ) : (
        <div className="scan-mobile-decision-folds">
          <AiEvidencePanel
            aiBullets={aiBullets}
            aiCityForecast={aiCityForecast}
            aiForecast={aiForecast}
            aiReadCompleteText={aiReadCompleteText}
            aiReadInProgressText={aiReadInProgressText}
            aiRuleEvidenceMode={aiRuleEvidenceMode}
            aiRuleEvidenceText={aiRuleEvidenceText}
            fallbackAiReason={fallbackAiReason}
            isCompactCard
            isEn={isEn}
            isHkoObservation={isHkoObservation}
            localModelSupportNote={localModelSupportNote}
            localizedFinalJudgment={localizedFinalJudgment}
            rawObservationText={rawObservationText}
          />

          <details
            className="scan-ai-city-section scan-mobile-fold"
            open={modelOpen}
            onToggle={(event) => setModelOpen(event.currentTarget.open)}
          >
            <summary className="scan-ai-city-section-title">{copy.modelEvidence}</summary>
            {modelOpen ? <ModelEvidencePanel detail={detail} isEn={isEn} /> : null}
          </details>

          <details
            className="scan-ai-city-section scan-mobile-fold"
            open={chartOpen}
            onToggle={(event) => setChartOpen(event.currentTarget.open)}
          >
            <summary className="scan-ai-city-section-title">{copy.chart}</summary>
            {chartOpen ? <AiCityTemperatureChart detail={detail} /> : null}
          </details>
        </div>
      )}
    </>
  );
}
