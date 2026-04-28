import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatTemperatureValue,
  normalizeTemperatureLabel,
} from "@/lib/temperature-utils";
import { getTargetRange } from "./opportunity-target";

export function formatPercent(value?: number | null, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  return `${signed && numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

export function normalizeProbability(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

export function formatWindowMinutes(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m left`;
    return `${hours}h ${remains}m left`;
  }
  if (hours <= 0) return `剩余 ${remains} 分钟`;
  return `剩余 ${hours}h ${remains}m`;
}

export function formatMinuteSpan(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m`;
    return `${hours}h ${remains}m`;
  }
  if (hours <= 0) return `${remains} 分钟`;
  return `${hours}h ${remains}m`;
}

export function formatAction(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  return formatTradeSide(row, locale, tempSymbol);
}

export function formatQuoteCents(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const cents = Number(value) * 100;
  const text =
    cents < 1 || cents >= 99 || Math.abs(cents - Math.round(cents)) >= 0.05
      ? cents.toFixed(1)
      : Math.round(cents).toFixed(0);
  return `${text.replace(/\.0$/, "")}¢`;
}

export function formatTradeSide(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const side = String(row.side || "").toLowerCase();
  const isEn = locale === "en-US";
  const { lower, upper } = getTargetRange(row);
  const threshold =
    lower != null && upper == null
      ? formatTemperatureValue(lower, tempSymbol)
      : upper != null && lower == null
        ? formatTemperatureValue(upper, tempSymbol)
        : null;
  if (threshold && lower != null && upper == null) {
    if (side === "yes") return isEn ? `High reaches ${threshold}` : `最高温达到 ${threshold}`;
    if (side === "no") return isEn ? `High stays below ${threshold}` : `最高温低于 ${threshold}`;
  }
  if (threshold && upper != null && lower == null) {
    if (side === "yes") return isEn ? `High stays at/below ${threshold}` : `最高温不高于 ${threshold}`;
    if (side === "no") return isEn ? `High exceeds ${threshold}` : `最高温高于 ${threshold}`;
  }
  if (lower != null && upper != null && Math.abs(lower - upper) > 0.01) {
    const range = `${formatTemperatureValue(lower, tempSymbol)} ~ ${formatTemperatureValue(upper, tempSymbol)}`;
    if (side === "yes") return isEn ? `High lands in ${range}` : `最高温落在 ${range}`;
    if (side === "no") return isEn ? `High avoids ${range}` : `最高温不在 ${range}`;
  }
  const bucket = formatThreshold(row, tempSymbol);
  if (side === "yes") return isEn ? `High lands on ${bucket}` : `最高温落在 ${bucket} 桶`;
  if (side === "no") return isEn ? `High avoids ${bucket}` : `最高温不落在 ${bucket} 桶`;
  if (row.action) {
    return normalizeTemperatureLabel(
      String(row.action).replace(String(row.target_label || ""), ""),
      tempSymbol,
    )
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }
  return locale === "en-US" ? "WATCH" : "观察";
}

export function formatThreshold(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const targetLabel = normalizeTemperatureLabel(row.target_label, tempSymbol);
  if (targetLabel) return targetLabel;
  if (row.target_lower != null && row.target_upper != null) {
    return `${formatTemperatureValue(Number(row.target_lower), tempSymbol)} ~ ${formatTemperatureValue(Number(row.target_upper), tempSymbol)}`;
  }
  if (row.target_threshold != null) {
    return formatTemperatureValue(Number(row.target_threshold), tempSymbol);
  }
  if (row.target_value != null) {
    return formatTemperatureValue(Number(row.target_value), tempSymbol);
  }
  return "--";
}

export function formatTemperatureDelta(value: number, tempSymbol?: string | null) {
  return formatTemperatureValue(Math.abs(value), tempSymbol, { digits: 1 });
}
