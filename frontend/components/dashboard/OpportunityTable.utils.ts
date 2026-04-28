export { getWindowPhaseMeta, type PhaseMeta } from "./opportunity-window-phase";
export { getLocalizedRowText } from "./opportunity-copy";
export {
  getAiMeta,
  getExclusionReasons,
  getOpportunityStrength,
  getRecommendationReasons,
  getRiskHints,
  getShortAiConclusion,
} from "./opportunity-ai-meta";
export {
  getDebDistanceSummary,
  getMetarConflictSummary,
  getModelSupportSummary,
} from "./opportunity-evidence-summary";
export type { V4CityForecast, V4TradeDecision } from "./opportunity-v4-types";
export {
  getForecastContractFit,
  getForecastRangeLabel,
  getPaceDecisionTail,
  getPaceDeviationRead,
  getPaceSignalLabel,
  getV4CityForecast,
  median,
} from "./opportunity-v4-forecast";
export {
  getForecastFitMeta,
  getThresholdDecision,
  getV4DecisionLabel,
  getV4TradeDecision,
} from "./opportunity-v4-decision";
export {
  getDecisionReasonItems,
  getForecastRiskItems,
} from "./opportunity-v4-risk";
export {
  getDetailForRow,
  getDetailViewDate,
  normalizeLookupKey,
} from "./opportunity-detail";
export {
  bucketMatchesRow,
  buildOpportunityGroups,
  getBucketDisplayLabel,
  getBucketText,
  getDetailBucketEventProbability,
  type OpportunityGroup,
} from "./opportunity-groups";
export {
  formatModelClusterRange,
  formatModelSources,
  getModelSourceSummary,
} from "./opportunity-model-summary";
export {
  formatAction,
  formatMinuteSpan,
  formatPercent,
  formatQuoteCents,
  formatTemperatureDelta,
  formatThreshold,
  formatTradeSide,
  formatWindowMinutes,
  normalizeProbability,
} from "./opportunity-format";
export {
  extractNumbers,
  getTargetRange,
  normalizeBucketLabel,
} from "./opportunity-target";
export {
  formatPeakWindowTiming,
  getMetarGate,
  getMetarObservationContext,
  getObservationSortMinutes,
  firstNonEmptyPoints,
  normalizeObservationPoints,
  type ObservationPoint,
} from "./opportunity-observation";
export {
  decodeMetarWeatherToken,
  decodeRawMetarCloud,
  decodeRawMetarVisibility,
  decodeRawMetarWeather,
  formatAirportReportRead,
  formatAirportWeatherRead,
  getAirportWeatherInputs,
} from "./opportunity-airport-read";
