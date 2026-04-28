import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import { formatAirportReportRead } from "./opportunity-airport-read";
import { getLocalizedRowText } from "./opportunity-copy";
import { getBucketDisplayLabel } from "./opportunity-groups";
import { getMetarGate } from "./opportunity-observation";
import { getTargetRange } from "./opportunity-target";
import {
  getForecastContractFit,
  getForecastRangeLabel,
  getPaceDecisionTail,
} from "./opportunity-v4-forecast";
import type { V4CityForecast, V4TradeDecision } from "./opportunity-v4-types";

export function getV4DecisionLabel(
  decision: V4TradeDecision["decision"],
  locale: string,
) {
  if (locale === "en-US") {
    if (decision === "approve") return "AI Confirmed";
    if (decision === "veto") return "AI Outside";
    if (decision === "downgrade") return "AI Downgrade";
    return "AI Watch";
  }
  if (decision === "approve") return "AI 确认";
  if (decision === "veto") return "AI 区间外";
  if (decision === "downgrade") return "AI 降级";
  return "AI 观察";
}

export function getV4TradeDecision(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  edgePercent?: number | null,
  tempSymbol?: string | null,
): V4TradeDecision {
  const isEn = locale === "en-US";
  const backendMetarDecision = String(row.v4_metar_decision || "").toLowerCase();
  const backendMetarReason =
    getLocalizedRowText(row, locale, row.v4_metar_reason_zh, row.v4_metar_reason_en) ||
    null;
  const metarGate = getMetarGate(row, detail, locale, tempSymbol);
  const aiDecision = String(row.ai_decision || "").toLowerCase();
  const aiReason =
    getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
    getLocalizedRowText(
      row,
      locale,
      row.ai_watchlist_reason_zh,
      row.ai_watchlist_reason_en,
    );

  let decision: V4TradeDecision["decision"] =
    backendMetarDecision === "veto" ||
    backendMetarDecision === "downgrade" ||
    backendMetarDecision === "approve" ||
    backendMetarDecision === "watchlist"
      ? (backendMetarDecision as V4TradeDecision["decision"])
      : metarGate?.decision ||
        (aiDecision === "veto" || aiDecision === "downgrade" || aiDecision === "approve" || aiDecision === "watchlist"
          ? (aiDecision as V4TradeDecision["decision"])
          : Number(edgePercent || 0) >= 20
            ? "watchlist"
            : "watchlist");

  if (metarGate?.decision === "veto") decision = "veto";
  if (metarGate?.decision === "watchlist" && backendMetarDecision === "downgrade") {
    decision = "watchlist";
  }
  if (metarGate?.decision === "downgrade" && decision !== "veto") decision = "downgrade";
  if (metarGate?.decision === "approve" && decision !== "veto" && decision !== "downgrade") {
    decision = "approve";
  }

  const reason =
    (metarGate?.decision === "watchlist" ? metarGate.reason : null) ||
    backendMetarReason ||
    metarGate?.reason ||
    aiReason ||
    (isEn
      ? "AI keeps this on watch until METAR and the full weather-model cluster align."
      : "AI 会等 METAR 与全量天气模型集群对齐后再确认。");
  const airportReport = formatAirportReportRead(
    row,
    detail,
    locale,
    normalizeTemperatureSymbol(tempSymbol),
  );
  const metarSummary =
    metarGate?.evidence?.filter((item) => item !== airportReport).join(" · ") || null;
  return {
    decision,
    label: getV4DecisionLabel(decision, locale),
    tone: decision,
    reason,
    metarSummary,
    airportReport,
    metarEvidence: metarGate?.evidence || [],
  };
}

export function getForecastFitMeta(
  fit: ReturnType<typeof getForecastContractFit>,
  locale: string,
) {
  const isEn = locale === "en-US";
  const tone = String(fit.tone || "watchlist");
  if (tone === "approve" || tone === "core") {
    return {
      label: isEn ? "Clear signal" : "方向明确",
      tone: "approve",
    };
  }
  if (tone === "veto" || tone === "outside") {
    return {
      label: isEn ? "Outside AI range" : "偏离 AI 区间",
      tone: "veto",
    };
  }
  if (tone === "downgrade") {
    return {
      label: isEn ? "Downgraded" : "降级观察",
      tone: "downgrade",
    };
  }
  return {
    label: isEn ? "Need peak confirmation" : "等待峰值确认",
    tone: "watchlist",
  };
}

export function getThresholdDecision(
  row: ScanOpportunityRow,
  forecast: V4CityForecast,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const { lower, upper } = getTargetRange(row);
  const predicted = forecast.predicted;
  const low = forecast.low;
  const high = forecast.high;
  const tolerance = unit === "°F" ? 1 : 0.5;
  const cautionBand = unit === "°F" ? 2 : 1;
  const format = (value: number) => formatTemperatureValue(value, unit, { digits: 0 });
  const paceTolerance = unit === "°F" ? 1 : 0.6;
  const paceTail = getPaceDecisionTail(forecast, locale, unit);
  const paceAdjustedHigh =
    forecast.paceAdjustedHigh != null && Number.isFinite(Number(forecast.paceAdjustedHigh))
      ? Number(forecast.paceAdjustedHigh)
      : null;
  const runningHot =
    forecast.paceDelta != null && Number(forecast.paceDelta) >= paceTolerance;
  const runningCold =
    forecast.paceDelta != null && Number(forecast.paceDelta) <= -paceTolerance;
  const confidence = (() => {
    const values = Object.values(row.model_cluster_sources || {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!values.length || predicted == null) return isEn ? "Medium" : "中";
    const near = values.filter((value) => Math.abs(value - predicted) <= cautionBand).length;
    const ratio = near / values.length;
    if (ratio >= 0.75) return isEn ? "High" : "高";
    if (ratio >= 0.45) return isEn ? "Medium" : "中";
    return isEn ? "Low" : "低";
  })();

  if (predicted == null || (lower == null && upper == null)) {
    return {
      confidence,
      headline: isEn ? "Conclusion pending" : "结论待确认",
      relation: isEn ? "Await stable forecast" : "等待稳定预测",
      summary: isEn
        ? "AI does not have a stable high-temperature center yet."
        : "AI 还没有稳定的最高温中枢，先不输出边界结论。",
      tone: "watchlist" as const,
    };
  }

  if (lower != null && upper == null) {
    const threshold = format(lower);
    if (
      predicted < lower - cautionBand &&
      (high == null || high < lower + tolerance) &&
      (paceAdjustedHigh == null || paceAdjustedHigh < lower - tolerance)
    ) {
      return {
        confidence,
        headline: isEn ? `Unlikely to reach ${threshold}` : `不太可能达到 ${threshold}`,
        relation: isEn ? "Clearly below threshold" : "明显低于阈值",
        summary: isEn
          ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}, below the ${threshold} boundary with no clear breakout signal.${paceTail}`
          : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，低于 ${threshold} 阈值，暂时缺乏明显突破信号。${paceTail}`,
        tone: "veto" as const,
      };
    }
    if (
      predicted >= lower + tolerance &&
      (low == null || low >= lower - tolerance) &&
      !runningCold &&
      (paceAdjustedHigh == null || paceAdjustedHigh >= lower - tolerance)
    ) {
      return {
        confidence,
        headline: isEn ? `Likely to reach ${threshold}` : `大概率达到 ${threshold}`,
        relation: isEn ? "Above threshold" : "高于阈值",
        summary: isEn
          ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}, already above the ${threshold} boundary.${paceTail}`
          : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，已经高于 ${threshold} 阈值。${paceTail}`,
        tone: "approve" as const,
      };
    }
    return {
      confidence,
      headline: isEn ? `${threshold} boundary is risky` : `${threshold} 边界偏危险`,
      relation: isEn ? "Near threshold" : "接近阈值（存在突破风险）",
      summary: isEn
        ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}; the ${threshold} boundary still needs peak-window confirmation.${paceTail}`
        : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，接近 ${threshold} 阈值，仍要等峰值窗口确认。${paceTail}`,
      tone: "watchlist" as const,
    };
  }

  if (upper != null && lower == null) {
    const threshold = format(upper);
    if (
      predicted <= upper - tolerance &&
      (high == null || high <= upper + tolerance) &&
      !runningHot &&
      (paceAdjustedHigh == null || paceAdjustedHigh <= upper + tolerance)
    ) {
      return {
        confidence,
        headline: isEn ? `Likely to stay below ${threshold}` : `大概率不超过 ${threshold}`,
        relation: isEn ? "Clearly below threshold" : "明显低于阈值",
        summary: isEn
          ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}, below the ${threshold} boundary.${paceTail}`
          : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，低于 ${threshold} 阈值。${paceTail}`,
        tone: "approve" as const,
      };
    }
    if (
      predicted > upper + cautionBand &&
      (low == null || low > upper - tolerance) &&
      (paceAdjustedHigh == null || paceAdjustedHigh > upper + tolerance)
    ) {
      return {
        confidence,
        headline: isEn ? `Likely above ${threshold}` : `大概率超过 ${threshold}`,
        relation: isEn ? "Above threshold" : "高于阈值",
        summary: isEn
          ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}, above the ${threshold} boundary.${paceTail}`
          : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，高于 ${threshold} 阈值。${paceTail}`,
        tone: "veto" as const,
      };
    }
    return {
      confidence,
      headline: isEn ? `${threshold} boundary is risky` : `${threshold} 边界偏危险`,
      relation: isEn ? "Near threshold" : "接近阈值（存在突破风险）",
      summary: isEn
        ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}; the boundary still needs peak-window confirmation.${paceTail}`
        : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，仍需等待峰值窗口确认边界。${paceTail}`,
      tone: "watchlist" as const,
    };
  }

  const bucket = getBucketDisplayLabel(row, locale, unit);
  const bucketReference = paceAdjustedHigh ?? predicted;
  const inside =
    (lower == null || bucketReference >= lower - tolerance) &&
    (upper == null || bucketReference <= upper + tolerance);
  return {
    confidence,
    headline: inside
      ? isEn
        ? `Likely inside ${bucket}`
        : `大概率落在 ${bucket}`
      : isEn
        ? `Unlikely inside ${bucket}`
        : `不太可能落在 ${bucket}`,
    relation: inside ? (isEn ? "Inside target bucket" : "处于目标桶") : (isEn ? "Outside target bucket" : "偏离目标桶"),
    summary: isEn
      ? `Forecast center is ${formatTemperatureValue(predicted, unit, { digits: 1 })}; use this bucket only as the market mapping of the city high.${paceTail}`
      : `温度中枢约 ${formatTemperatureValue(predicted, unit, { digits: 1 })}，该温度桶只用于映射城市最高温判断。${paceTail}`,
    tone: inside ? ("approve" as const) : ("veto" as const),
  };
}
