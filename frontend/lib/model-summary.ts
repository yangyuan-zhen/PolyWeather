import type { ScanOpportunityRow } from "@/lib/dashboard-types";

export const MODEL_SUMMARY_MODEL_COLUMNS = [
  { key: "ECMWF", label: "ECMWF" },
  { key: "ECMWF AIFS", label: "ECMWF AIFS" },
  { key: "GFS", label: "GFS" },
  { key: "ICON", label: "ICON" },
  { key: "ICON-EU", label: "ICON-EU" },
  { key: "GEM", label: "GEM" },
  { key: "GDPS", label: "GDPS" },
  { key: "JMA", label: "JMA" },
  { key: "AROME HD", label: "AROME HD" },
  { key: "HRRR", label: "HRRR" },
  { key: "NAM", label: "NAM" },
] as const;

export type ModelSummaryColumnKey = (typeof MODEL_SUMMARY_MODEL_COLUMNS)[number]["key"];

export type ModelSummaryRow = {
  cityKey: string;
  cityName: string;
  regionLabel: string;
  regionLabelZh: string;
  regionSort: number;
  tempSymbol: string;
  currentHigh: number | null;
  debPrediction: number | null;
  models: Record<ModelSummaryColumnKey, number | null>;
  modelMedian: number | null;
  modelSpread: number | null;
  updatedAt: string;
  searchText: string;
};

export type ModelSummaryFilters = {
  query: string;
  debOnly: boolean;
  wideSpreadOnly: boolean;
};

const WIDE_SPREAD_THRESHOLD = 2;

function finiteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return roundToOneDecimal(sorted[mid]);
  return roundToOneDecimal((sorted[mid - 1] + sorted[mid]) / 2);
}

function spread(values: number[]) {
  if (!values.length) return null;
  return roundToOneDecimal(Math.max(...values) - Math.min(...values));
}

function normalizeCityKey(row: ScanOpportunityRow, index: number) {
  const rawKey = row.city || row.city_display_name || row.display_name || `row-${index}`;
  return String(rawKey).trim().toLowerCase();
}

export function formatModelSummaryTemp(value: number | null | undefined, symbol = "°C") {
  const numericValue = finiteNumber(value);
  if (numericValue == null) return "—";
  return `${numericValue.toFixed(1)}${symbol || "°C"}`;
}

export function buildModelSummaryRows(
  rows: ScanOpportunityRow[],
  isEn: boolean,
): ModelSummaryRow[] {
  const byCity = new Map<string, ModelSummaryRow>();

  rows.forEach((row, index) => {
    const cityKey = normalizeCityKey(row, index);
    if (byCity.has(cityKey)) return;

    const cityName = row.city_display_name || row.display_name || row.city || "—";
    const regionLabel = row.trading_region_label || row.trading_region_label_zh || "—";
    const regionLabelZh = row.trading_region_label_zh || row.trading_region_label || "—";
    const displayRegionLabel = isEn ? regionLabel : regionLabelZh;
    const rawModelSources = row.model_cluster_sources || {};
    const models = MODEL_SUMMARY_MODEL_COLUMNS.reduce(
      (acc, column) => {
        acc[column.key] = finiteNumber(rawModelSources[column.key]);
        return acc;
      },
      {} as Record<ModelSummaryColumnKey, number | null>,
    );
    const modelValues = MODEL_SUMMARY_MODEL_COLUMNS.map((column) => models[column.key]).filter(
      (value): value is number => value != null,
    );
    const modelSearchText = MODEL_SUMMARY_MODEL_COLUMNS.filter(
      (column) => models[column.key] != null,
    )
      .map((column) => column.label)
      .join(" ");

    byCity.set(cityKey, {
      cityKey,
      cityName,
      regionLabel: displayRegionLabel,
      regionLabelZh,
      regionSort: finiteNumber(row.trading_region_sort) ?? 999,
      tempSymbol: row.temp_symbol || "°C",
      currentHigh: finiteNumber(row.current_max_so_far),
      debPrediction: finiteNumber(row.deb_prediction),
      models,
      modelMedian: median(modelValues),
      modelSpread: spread(modelValues),
      updatedAt: row.local_time || row.local_date || row.selected_date || "",
      searchText: `${cityName} ${row.city || ""} ${regionLabel} ${regionLabelZh} ${modelSearchText}`.toLowerCase(),
    });
  });

  return [...byCity.values()].sort((a, b) => {
    if (a.regionSort !== b.regionSort) return a.regionSort - b.regionSort;
    return a.cityName.localeCompare(b.cityName, isEn ? "en" : "zh-CN", {
      sensitivity: "base",
    });
  });
}

export function filterModelSummaryRows(
  rows: ModelSummaryRow[],
  filters: ModelSummaryFilters,
): ModelSummaryRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (query && !row.searchText.includes(query)) return false;
    if (filters.debOnly && row.debPrediction == null) return false;
    if (
      filters.wideSpreadOnly &&
      (row.modelSpread == null || row.modelSpread < WIDE_SPREAD_THRESHOLD)
    ) {
      return false;
    }
    return true;
  });
}
