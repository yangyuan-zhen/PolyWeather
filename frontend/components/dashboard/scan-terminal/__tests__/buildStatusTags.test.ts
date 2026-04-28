import assert from "node:assert/strict";
import { buildCityDecisionState } from "@/components/dashboard/scan-terminal/city-decision-state";
import type { MarketDecisionView } from "@/components/dashboard/scan-terminal/city-card-decision-utils";

const readyMarket: MarketDecisionView = {
  bucketLabel: "--",
  confidence: "--",
  edgeText: "--",
  impliedText: "--",
  modelText: "--",
  priceText: "--",
  reason: "",
  status: "ready",
  title: "",
  tone: "neutral",
};

export function runTests() {
  const peakPassed = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: { status: "ready" },
    aiRuleEvidenceMode: false,
    isEn: false,
    isHkoObservation: false,
    marketDecisionView: readyMarket,
    modelHighlyConsistent: true,
    needsNextBulletin: false,
    observationStale: false,
    observedHighBreak: false,
    observedLowBreak: false,
    observedLowLag: false,
    peakHasPassed: true,
  });

  assert.equal(peakPassed.urgency, "past");
  assert.equal(peakPassed.recommendation, "avoid");
  assert.match(peakPassed.primaryReason, /峰值窗口已过/);
  assert.doesNotMatch(peakPassed.primaryReason, /值得关注/);
  assert.deepEqual(
    peakPassed.badges.map((badge) => badge.label),
    ["峰值窗口已过", "模型高度一致"],
  );

  const staleMetar = buildCityDecisionState({
    aiCityForecast: null,
    aiForecast: { status: "ready" },
    aiRuleEvidenceMode: false,
    isEn: false,
    isHkoObservation: false,
    marketDecisionView: readyMarket,
    modelHighlyConsistent: false,
    needsNextBulletin: false,
    observationStale: true,
    observedHighBreak: false,
    observedLowBreak: false,
    observedLowLag: false,
    peakHasPassed: false,
  });

  assert.equal(staleMetar.evidenceQuality, "stale");
  assert.equal(staleMetar.recommendation, "background");
  assert.ok(staleMetar.badges.some((badge) => badge.label === "METAR 过旧"));
}
