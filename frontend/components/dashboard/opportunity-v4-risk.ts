import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import { formatModelClusterRange } from "./opportunity-model-summary";
import { getMetarObservationContext } from "./opportunity-observation";
import type { V4CityForecast } from "./opportunity-v4-types";

export function getForecastRiskItems(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  forecast: V4CityForecast,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const obs = getMetarObservationContext(row, detail);
  const risks: string[] = [];
  const phase = String(row.window_phase || "").toLowerCase();
  if (
    phase === "early_today" ||
    phase === "setup_today" ||
    (row.minutes_until_peak_start != null && Number(row.minutes_until_peak_start) > 0)
  ) {
    risks.push(
      isEn
        ? "Peak window has not arrived; current METAR is only path evidence."
        : "峰值窗口尚未到达，当前 METAR 只能作为路径证据。",
    );
  }
  if (row.trend_alignment === false) {
    risks.push(
      isEn
        ? "Intraday observation path does not fully support the forecast center."
        : "日内实况路径还没有完全支持预测中枢。",
    );
  }
  if (forecast.paceRead && forecast.paceTone !== "neutral") {
    risks.push(
      isEn
        ? `Observed pace is deviating from the DEB curve: ${forecast.paceRead}`
        : `实测节奏正在偏离 DEB 曲线：${forecast.paceRead}`,
    );
  }
  if (obs.stale || obs.lastTemp == null) {
    risks.push(
      isEn
        ? "Same-day METAR confirmation is still weak."
        : "同日 METAR 确认仍然偏弱。",
    );
  }
  if (forecast.low != null && forecast.high != null) {
    const spread = Math.abs(forecast.high - forecast.low);
    const wide = String(normalizeTemperatureSymbol(tempSymbol)).toUpperCase().includes("F")
      ? spread > 2
      : spread > 1;
    if (wide) {
      risks.push(
        isEn
          ? "Model range is wide; treat boundary buckets conservatively."
          : "模型区间偏宽，边界温度桶需要保守处理。",
      );
    }
  }
  if (!risks.length) {
    risks.push(
      isEn
        ? "Residual risk is late METAR revision or a shifted afternoon peak."
        : "残余风险主要是后续 METAR 修订或峰值窗口漂移。",
    );
  }
  return Array.from(new Set(risks)).slice(0, 3);
}

export function getDecisionReasonItems(
  row: ScanOpportunityRow,
  forecast: V4CityForecast,
  modelSupportText: string,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const modelRange = formatModelClusterRange(row.model_cluster_sources, tempSymbol);
  const reasons: string[] = [];
  if (modelRange !== "--") {
    reasons.push(
      isEn
        ? `Model cluster sits around ${modelRange}; ${modelSupportText}.`
        : `模型区间集中在 ${modelRange}，${modelSupportText}。`,
    );
  }
  if (forecast.predicted != null) {
    reasons.push(
      isEn
        ? `AI high-temperature center is ${formatTemperatureValue(forecast.predicted, tempSymbol, { digits: 1 })}.`
        : `AI 最高温中枢约 ${formatTemperatureValue(forecast.predicted, tempSymbol, { digits: 1 })}。`,
    );
  }
  if (forecast.paceRead) reasons.push(forecast.paceRead);
  if (forecast.peakWindow) reasons.push(forecast.peakWindow);
  if (forecast.weatherRead) reasons.push(forecast.weatherRead);
  return Array.from(new Set(reasons)).slice(0, 3);
}
