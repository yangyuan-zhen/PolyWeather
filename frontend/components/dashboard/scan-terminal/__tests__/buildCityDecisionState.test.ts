import assert from "node:assert/strict";
import { buildCityDecisionState } from "@/components/dashboard/scan-terminal/city-decision-state";
import type { MarketDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import type { AiCityForecastState } from "@/components/dashboard/scan-terminal/types";

function market(status: MarketDecisionView["status"]): MarketDecisionView {
  return {
    bucketLabel: "--",
    confidence: "--",
    edgeText: "--",
    impliedText: "--",
    modelText: "--",
    priceText: "--",
    reason: "",
    status,
    title: "",
    tone: "watch",
  };
}

function ai(status: AiCityForecastState["status"], extra: Partial<AiCityForecastState> = {}): AiCityForecastState {
  return { status, ...extra };
}

export function runTests() {
  const breakout = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: ai("ready"),
    aiRuleEvidenceMode: false,
    isEn: false,
    isHkoObservation: false,
    modelHighlyConsistent: true,
    needsNextBulletin: false,
    observationStale: false,
    observedHighBreak: true,
    observedLowBreak: false,
    observedLowLag: false,
    peakHasPassed: false,
  });

  assert.equal(breakout.urgency, "now");
  assert.equal(breakout.recommendation, "watch");
  assert.match(breakout.primaryReason, /实测已突破模型上沿/);
  assert.match(breakout.primaryReason, /建议关注偏高温/);
  assert.ok(breakout.badges.some((badge) => badge.label === "实测突破"));

  const marketUnavailable = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: ai("ready"),
    aiRuleEvidenceMode: false,
    isEn: false,
    isHkoObservation: false,
    modelHighlyConsistent: false,
    needsNextBulletin: false,
    observationStale: false,
    observedHighBreak: false,
    observedLowBreak: false,
    observedLowLag: false,
    peakHasPassed: false,
  });


  const fallback = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: ai("ready", { payload: { degraded: true } }),
    aiRuleEvidenceMode: true,
    isEn: false,
    isHkoObservation: false,
    modelHighlyConsistent: false,
    needsNextBulletin: false,
    observationStale: false,
    observedHighBreak: false,
    observedLowBreak: false,
    observedLowLag: false,
    peakHasPassed: false,
  });

  assert.equal(fallback.aiStatus, "fallback");
  assert.equal(fallback.aiStatusLabel, "规则证据模式");
  assert.notEqual(fallback.aiStatusLabel, "AI 解读已完成");

  const partialStream = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: ai("loading", { streamText: "partial" }),
    aiRuleEvidenceMode: false,
    isEn: false,
    isHkoObservation: false,
    modelHighlyConsistent: false,
    needsNextBulletin: true,
    observationStale: false,
    observedHighBreak: false,
    observedLowBreak: false,
    observedLowLag: true,
    peakHasPassed: false,
  });

  assert.equal(partialStream.aiStatus, "deepseek-loading");
  assert.equal(partialStream.aiStatusLabel, "快速判断已完成");
}
