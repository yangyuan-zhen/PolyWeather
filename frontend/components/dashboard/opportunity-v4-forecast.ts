import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getTodayPaceView } from "@/lib/pace-utils";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import {
  formatAirportReportRead,
  formatAirportWeatherRead,
} from "./opportunity-airport-read";
import { getLocalizedRowText } from "./opportunity-copy";
import { formatPeakWindowTiming } from "./opportunity-observation";
import { getModelSourceSummary } from "./opportunity-model-summary";
import { getTargetRange } from "./opportunity-target";
import type { OpportunityGroup } from "./opportunity-groups";
import type { V4CityForecast } from "./opportunity-v4-types";

export function getPaceDeviationRead(
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
) {
  if (!detail) return null;
  const paceView = getTodayPaceView(detail, locale === "en-US" ? "en-US" : "zh-CN");
  if (!paceView) return null;
  const unit = normalizeTemperatureSymbol(tempSymbol || detail.temp_symbol);
  const observed = formatTemperatureValue(paceView.observedNow, unit, { digits: 1 });
  const expected = formatTemperatureValue(paceView.expectedNow, unit, { digits: 1 });
  const delta = `${paceView.delta > 0 ? "+" : ""}${paceView.delta.toFixed(1)}${unit}`;
  const isEn = locale === "en-US";
  const toneText =
    paceView.biasTone === "warm"
      ? isEn
        ? "running hotter"
        : "偏热"
      : paceView.biasTone === "cold"
        ? isEn
          ? "running cooler"
          : "偏冷"
        : isEn
          ? "tracking"
          : "基本跟踪";
  return {
    adjustedHigh: paceView.paceAdjustedHigh,
    delta: paceView.delta,
    label: paceView.badge,
    read: isEn
      ? `Observed path vs DEB curve: ${observed} now vs ${expected} expected, ${delta} (${toneText}).`
      : `实测路径对比 DEB 曲线：当前 ${observed}，同刻预期 ${expected}，偏差 ${delta}（${toneText}）。`,
    tone: paceView.biasTone,
  };
}

export function getPaceSignalLabel(forecast: V4CityForecast, locale: string, tempSymbol?: string | null) {
  const isEn = locale === "en-US";
  if (forecast.paceDelta == null || !Number.isFinite(Number(forecast.paceDelta))) {
    return isEn ? "Path pending" : "路径待确认";
  }
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const delta = `${forecast.paceDelta > 0 ? "+" : ""}${Number(forecast.paceDelta).toFixed(1)}${unit}`;
  if (forecast.paceTone === "warm") return isEn ? `Hot path ${delta}` : `实测偏热 ${delta}`;
  if (forecast.paceTone === "cold") return isEn ? `Cool path ${delta}` : `实测偏冷 ${delta}`;
  return isEn ? `On path ${delta}` : `路径跟踪 ${delta}`;
}

export function getPaceDecisionTail(forecast: V4CityForecast, locale: string, tempSymbol?: string | null) {
  if (forecast.paceDelta == null || !Number.isFinite(Number(forecast.paceDelta))) return "";
  const isEn = locale === "en-US";
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const delta = `${forecast.paceDelta > 0 ? "+" : ""}${Number(forecast.paceDelta).toFixed(1)}${unit}`;
  if (forecast.paceTone === "warm") {
    return isEn
      ? ` Observations are running ${delta} above the DEB path, so upside boundaries need extra caution.`
      : ` 实测比 DEB 路径偏高 ${delta}，上方阈值要额外谨慎。`;
  }
  if (forecast.paceTone === "cold") {
    return isEn
      ? ` Observations are running ${delta} below the DEB path, which weakens upside breakout odds.`
      : ` 实测比 DEB 路径偏低 ${delta}，上破概率需要下修。`;
  }
  return isEn
    ? " Observations are still tracking the DEB path."
    : " 实测仍基本跟踪 DEB 路径。";
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getV4CityForecast(
  row: ScanOpportunityRow,
  group: OpportunityGroup,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
): V4CityForecast {
  const isEn = locale === "en-US";
  const aiPredicted =
    row.ai_predicted_max != null && Number.isFinite(Number(row.ai_predicted_max))
      ? Number(row.ai_predicted_max)
      : null;
  const aiLow =
    row.ai_predicted_low != null && Number.isFinite(Number(row.ai_predicted_low))
      ? Number(row.ai_predicted_low)
      : null;
  const aiHigh =
    row.ai_predicted_high != null && Number.isFinite(Number(row.ai_predicted_high))
      ? Number(row.ai_predicted_high)
      : null;
  const modelValues = Object.values(row.model_cluster_sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const fallbackPredicted =
    aiPredicted ??
    (row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : median(modelValues));
  const fallbackLow = aiLow ?? (modelValues.length ? Math.min(...modelValues) : fallbackPredicted);
  const fallbackHigh = aiHigh ?? (modelValues.length ? Math.max(...modelValues) : fallbackPredicted);
  const peakWindow =
    getLocalizedRowText(row, locale, row.ai_peak_window_zh, row.ai_peak_window_en) ||
    formatPeakWindowTiming(row, locale);
  const airportRead =
    getLocalizedRowText(
      row,
      locale,
      row.ai_airport_metar_read_zh,
      row.ai_airport_metar_read_en,
    ) || formatAirportReportRead(row, detail, locale, tempSymbol);
  const weatherRead = formatAirportWeatherRead(row, detail, locale);
  const paceRead = getPaceDeviationRead(detail, locale, tempSymbol);
  const modelNote =
    row.ai_city_model_cluster_note ||
    row.ai_model_cluster_note ||
    getModelSourceSummary(row, locale, tempSymbol);
  const reason =
    getLocalizedRowText(row, locale, row.ai_forecast_reason_zh, row.ai_forecast_reason_en) ||
    getLocalizedRowText(row, locale, row.ai_city_thesis_zh, row.ai_city_thesis_en) ||
    (fallbackPredicted != null
      ? isEn
        ? `${group.cityName} final high is centered near ${formatTemperatureValue(fallbackPredicted, tempSymbol, { digits: 1 })}; market temperature buckets are only mapped against that forecast range.`
        : `${group.cityName} 最终最高温先以 ${formatTemperatureValue(fallbackPredicted, tempSymbol, { digits: 1 })} 附近为中枢，市场温度桶只用于对照 AI 预测区间。`
      : null);
  return {
    predicted: fallbackPredicted,
    low: fallbackLow,
    high: fallbackHigh,
    confidence: row.ai_forecast_confidence || row.ai_city_confidence,
    peakWindow,
    airportRead,
    weatherRead,
    paceRead: paceRead?.read || null,
    paceTone: paceRead?.tone || null,
    paceDelta: paceRead?.delta ?? null,
    paceAdjustedHigh: paceRead?.adjustedHigh ?? null,
    reason,
    modelNote,
    source: aiPredicted != null ? "ai" : "fallback",
  };
}

export function getForecastRangeLabel(forecast: V4CityForecast, tempSymbol?: string | null) {
  if (forecast.low == null && forecast.high == null) return "--";
  if (forecast.low != null && forecast.high != null) {
    if (Math.abs(forecast.low - forecast.high) < 0.05) {
      return formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 });
    }
    return `${formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(forecast.high, tempSymbol, { digits: 1 })}`;
  }
  if (forecast.low != null) return `>= ${formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 })}`;
  return `<= ${formatTemperatureValue(Number(forecast.high), tempSymbol, { digits: 1 })}`;
}

export function getForecastContractFit(
  row: ScanOpportunityRow,
  forecast: V4CityForecast,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const explicitMatch = String(row.ai_forecast_match || "").toLowerCase();
  const explicitReason = getLocalizedRowText(
    row,
    locale,
    row.ai_forecast_match_reason_zh,
    row.ai_forecast_match_reason_en,
  );
  if (explicitMatch && explicitReason) {
    return {
      label:
        explicitMatch === "core"
          ? isEn ? "Core bucket" : "核心桶"
          : explicitMatch === "outside"
            ? isEn ? "Outside forecast" : "预测区间外"
            : explicitMatch === "edge"
              ? isEn ? "Boundary bucket" : "边界桶"
              : isEn ? "Watch" : "观察",
      tone: explicitMatch === "core" ? "approve" : explicitMatch === "outside" ? "veto" : "watchlist",
      reason: explicitReason,
    };
  }

  const { lower, upper } = getTargetRange(row);
  const predicted = forecast.predicted;
  if (predicted == null || (lower == null && upper == null)) {
    return {
      label: isEn ? "Await forecast" : "等待预测",
      tone: "watchlist",
      reason: isEn ? "AI has no stable max-temperature center yet." : "AI 还没有稳定的最高温中枢。",
    };
  }
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const tolerance = String(unit).toUpperCase().includes("F") ? 1.0 : 0.5;
  const inside =
    (lower == null || predicted >= lower - tolerance) &&
    (upper == null || predicted <= upper + tolerance);
  const rangeOverlaps =
    forecast.low != null &&
    forecast.high != null &&
    (lower == null || forecast.high >= lower - tolerance) &&
    (upper == null || forecast.low <= upper + tolerance);
  if (inside) {
    return {
      label: isEn ? "Core bucket" : "核心桶",
      tone: "approve",
      reason: isEn
        ? `AI max-temperature center ${formatTemperatureValue(predicted, unit, { digits: 1 })} sits inside this bucket.`
        : `AI 最高温中枢 ${formatTemperatureValue(predicted, unit, { digits: 1 })} 落在这个温度桶内。`,
    };
  }
  if (rangeOverlaps) {
    return {
      label: isEn ? "Boundary bucket" : "边界桶",
      tone: "watchlist",
      reason: isEn
        ? `This bucket touches the AI interval ${getForecastRangeLabel(forecast, unit)}, but is not the center.`
        : `该桶触及 AI 区间 ${getForecastRangeLabel(forecast, unit)}，但不是预测中枢。`,
    };
  }
  return {
    label: isEn ? "Outside forecast" : "预测区间外",
    tone: "veto",
    reason: isEn
      ? `This bucket is outside the AI max-temperature interval ${getForecastRangeLabel(forecast, unit)}.`
      : `该桶位于 AI 最高温区间 ${getForecastRangeLabel(forecast, unit)} 之外。`,
  };
}
