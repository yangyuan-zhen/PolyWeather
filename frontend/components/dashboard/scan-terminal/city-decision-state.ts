import type { MarketDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";

export type CityDecisionUrgency = "now" | "soon" | "later" | "past";
export type CityDecisionRecommendation = "watch" | "wait" | "avoid" | "background";
export type CityDecisionEvidenceQuality = "fresh" | "mixed" | "stale";
export type CityDecisionAiStatus =
  | "fast-ready"
  | "deepseek-loading"
  | "complete"
  | "fallback";
export type CityDecisionMarketStatus = "ready" | "loading" | "unavailable";
export type StatusBadgeTone = "green" | "blue" | "amber" | "red" | "muted";

export type StatusBadge = {
  label: string;
  tone: StatusBadgeTone;
};

export type CityDecisionState = {
  urgency: CityDecisionUrgency;
  recommendation: CityDecisionRecommendation;
  evidenceQuality: CityDecisionEvidenceQuality;
  aiStatus: CityDecisionAiStatus;
  aiStatusLabel: string;
  aiStatusTone: StatusBadgeTone;
  marketStatus: CityDecisionMarketStatus;
  marketStatusTone: StatusBadgeTone;
  badges: StatusBadge[];
  primaryReason: string;
};

function uniqueStatusBadges(badges: Array<StatusBadge | null | undefined>) {
  const seen = new Set<string>();
  return badges.filter((badge): badge is StatusBadge => {
    if (!badge?.label || seen.has(badge.label)) return false;
    seen.add(badge.label);
    return true;
  });
}

function resolveAiStatus({
  aiCityForecast,
  aiForecast,
  aiRuleEvidenceMode,
}: {
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  aiForecast: AiCityForecastState;
  aiRuleEvidenceMode: boolean;
}): CityDecisionAiStatus {
  if (aiRuleEvidenceMode || aiForecast.status === "failed") return "fallback";
  if (aiForecast.status === "loading") return "deepseek-loading";
  if (aiForecast.status === "ready" && aiCityForecast) return "complete";
  return "fast-ready";
}

function resolveAiStatusView(aiStatus: CityDecisionAiStatus, isEn: boolean) {
  if (aiStatus === "deepseek-loading") {
    return {
      label: isEn ? "Fast read ready" : "快速判断已完成",
      tone: "blue" as const,
    };
  }
  if (aiStatus === "complete") {
    return {
      label: isEn ? "AI read complete" : "AI 解读已完成",
      tone: "green" as const,
    };
  }
  if (aiStatus === "fallback") {
    return {
      label: isEn ? "Rule evidence" : "规则证据模式",
      tone: "amber" as const,
    };
  }
  return {
    label: isEn ? "AI pending" : "AI 待返回",
    tone: "muted" as const,
  };
}

function resolveMarketTone(status: CityDecisionMarketStatus): StatusBadgeTone {
  if (status === "ready") return "green";
  if (status === "loading") return "blue";
  return "muted";
}

export function buildCityDecisionState({
  aiCityForecast,
  aiForecast,
  aiRuleEvidenceMode,
  isEn,
  isHkoObservation,
  marketDecisionView,
  modelHighlyConsistent,
  needsNextBulletin,
  observationStale,
  observedHighBreak,
  observedLowBreak,
  observedLowLag,
  peakHasPassed,
}: {
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  aiForecast: AiCityForecastState;
  aiRuleEvidenceMode: boolean;
  isEn: boolean;
  isHkoObservation: boolean;
  marketDecisionView: MarketDecisionView;
  modelHighlyConsistent: boolean;
  needsNextBulletin: boolean;
  observationStale: boolean;
  observedHighBreak: boolean;
  observedLowBreak: boolean;
  observedLowLag: boolean;
  peakHasPassed: boolean;
}): CityDecisionState {
  const aiStatus = resolveAiStatus({ aiCityForecast, aiForecast, aiRuleEvidenceMode });
  const aiStatusView = resolveAiStatusView(aiStatus, isEn);
  const marketStatus = marketDecisionView.status;
  const marketStatusTone = resolveMarketTone(marketStatus);
  const evidenceQuality: CityDecisionEvidenceQuality = observationStale
    ? "stale"
    : aiStatus === "fallback" || marketStatus === "unavailable"
      ? "mixed"
      : "fresh";
  const urgency: CityDecisionUrgency = peakHasPassed
    ? "past"
    : observedHighBreak
      ? "now"
      : needsNextBulletin
        ? "soon"
        : "later";
  const recommendation: CityDecisionRecommendation = peakHasPassed
    ? "avoid"
    : observationStale
      ? "background"
      : needsNextBulletin
        ? "wait"
        : "watch";
  const primaryReason = observedHighBreak
    ? isEn
      ? "Observation has broken above the model range."
      : "实测已突破模型上沿。"
    : peakHasPassed
      ? isEn
        ? "Peak window has passed; confirm whether a new high can still form."
        : "峰值窗口已过，确认是否还会出现新高。"
      : observationStale
        ? isEn
          ? "Observation is stale and needs the next report."
          : "观测已过旧，需要下一报文确认。"
        : marketStatus === "unavailable"
          ? isEn
            ? "Weather evidence is usable, but no tradable quote is available yet."
            : "天气证据可参考，但暂无可交易价格。"
          : modelHighlyConsistent
            ? isEn
              ? "Models are aligned; wait for observation confirmation."
              : "模型高度一致，等待实测确认。"
            : needsNextBulletin
              ? isEn
                ? "The next bulletin is more likely to decide direction."
                : "下一报文更可能决定方向。"
              : isEn
                ? "Compare new observations with the expected high through the peak window."
                : "在峰值窗口内继续对照实测与预计高点。";

  const badges = uniqueStatusBadges([
    observedHighBreak
      ? {
          label: isEn ? "Observed breakout" : "实测突破",
          tone: "red",
        }
      : null,
    peakHasPassed
      ? {
          label: isEn ? "Peak window passed" : "峰值窗口已过",
          tone: "muted",
        }
      : null,
    observationStale
      ? {
          label: isEn
            ? isHkoObservation
              ? "HKO stale"
              : "METAR stale"
            : isHkoObservation
              ? "观测过旧"
              : "METAR 过旧",
          tone: "amber",
        }
      : null,
    observedLowBreak
      ? {
          label: isEn ? "Peak revised down" : "峰值下修",
          tone: "blue",
        }
      : null,
    aiStatus === "deepseek-loading"
      ? {
          label: isEn ? "Fast read ready" : "快速判断已完成",
          tone: aiStatusView.tone,
        }
      : null,
    marketStatus === "unavailable"
      ? {
          label: isEn ? "Market unavailable" : "市场价暂不可用",
          tone: marketStatusTone,
        }
      : null,
    modelHighlyConsistent
      ? {
          label: isEn ? "Models agree" : "模型高度一致",
          tone: "green",
        }
      : null,
    observedLowLag || needsNextBulletin
      ? {
          label: isEn ? "Wait next report" : "需要等待下一报文",
          tone: "amber",
        }
      : null,
  ]).slice(0, 3);

  return {
    urgency,
    recommendation,
    evidenceQuality,
    aiStatus,
    aiStatusLabel: aiStatusView.label,
    aiStatusTone: aiStatusView.tone,
    marketStatus,
    marketStatusTone,
    badges,
    primaryReason,
  };
}
