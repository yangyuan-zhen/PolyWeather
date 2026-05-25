export type CityDecisionUrgency = "now" | "soon" | "later" | "past";
export type CityDecisionRecommendation = "watch" | "wait" | "avoid" | "background";
export type CityDecisionEvidenceQuality = "fresh" | "mixed" | "stale";
export type CityDecisionAiStatus =
  | "fast-ready"
  | "ready";
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

export function buildCityDecisionState({
  isEn,
  isHkoObservation,
  modelHighlyConsistent,
  needsNextBulletin,
  observationStale,
  observedHighBreak,
  observedLowBreak,
  observedLowLag,
  peakHasPassed,
}: {
  isEn: boolean;
  isHkoObservation: boolean;
  modelHighlyConsistent: boolean;
  needsNextBulletin: boolean;
  observationStale: boolean;
  observedHighBreak: boolean;
  observedLowBreak: boolean;
  observedLowLag: boolean;
  peakHasPassed: boolean;
}): CityDecisionState {
  const evidenceQuality: CityDecisionEvidenceQuality = observationStale
    ? "stale"
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
      ? "Observation has broken above the model range. Consider the upside scenario; wait for the next bulletin to confirm the breakout."
      : "实测已突破模型上沿。建议关注偏高温区间，等待下一报文确认突破是否持续。"
    : peakHasPassed
      ? isEn
        ? "Peak window has passed; confirm whether a new high can still form. Avoid chasing if no new high prints."
        : "峰值窗口已过，确认是否还会出现新高。若无新高，建议避免追高。"
      : observationStale
        ? isEn
          ? "Observation is stale and needs the next report. Use only as background reference until fresh data arrives."
          : "观测已过旧，需要下一报文确认。当前数据仅作背景参考，建议等待新报文后再做判断。"
        : modelHighlyConsistent
            ? isEn
              ? "Models are aligned; wait for observation confirmation. A clear direction should emerge after the next report."
              : "模型高度一致，等待实测确认。下一报文后方向会更明确。"
            : needsNextBulletin
              ? isEn
                ? "The next bulletin is more likely to decide direction. Hold until the picture clears."
                : "下一报文更可能决定方向。建议等待信号明确后再做决策。"
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
    aiStatus: "ready",
    aiStatusLabel: isEn ? "AI ready" : "AI 就绪",
    aiStatusTone: "blue",
    badges,
    primaryReason,
  };
}
