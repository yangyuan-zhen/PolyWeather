import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatTemperatureValue } from "@/lib/temperature-utils";

export function formatModelSources(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const sources = row.model_cluster_sources || {};
  return Object.entries(sources)
    .filter(([, value]) => value != null && Number.isFinite(Number(value)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      value: formatTemperatureValue(Number(value), tempSymbol, { digits: 1 }),
    }));
}

export function formatModelClusterRange(
  sources?: Record<string, number | null> | null,
  tempSymbol?: string | null,
) {
  const values = Object.values(sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return "--";
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (Math.abs(low - high) < 0.05) {
    return formatTemperatureValue(low, tempSymbol, { digits: 1 });
  }
  return `${formatTemperatureValue(low, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(high, tempSymbol, { digits: 1 })}`;
}

export function getModelSourceSummary(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const sources = formatModelSources(row, tempSymbol);
  if (!sources.length) {
    return locale === "en-US"
      ? "model cluster pending"
      : "模型集群暂未回传";
  }
  const shown = sources.map((item) => `${item.name} ${item.value}`).join(" / ");
  return locale === "en-US"
    ? `all models: ${shown}`
    : `全部模型：${shown}`;
}
