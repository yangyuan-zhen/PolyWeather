import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  REGIONS,
  getCityRegion,
} from "@/components/dashboard/scan-terminal/continent-grouping";

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
  localTime: string;
  timezoneOffsetSeconds: number | null;
  debPrediction: number | null;
  models: Record<ModelSummaryColumnKey, number | null>;
  modelMedian: number | null;
  modelSpread: number | null;
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

function normalizeLocalTime(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function resolveRegion(row: ScanOpportunityRow, isEn: boolean) {
  const configuredRegionKey = getCityRegion(row);
  const configuredRegion = configuredRegionKey
    ? REGIONS.find((region) => region.key === configuredRegionKey)
    : null;
  if (configuredRegion) {
    return {
      label: isEn ? configuredRegion.labelEn : configuredRegion.labelZh,
      labelEn: configuredRegion.labelEn,
      labelZh: configuredRegion.labelZh,
      sort: configuredRegion.sort,
    };
  }

  const labelEn = row.trading_region_label || row.trading_region_label_zh || "—";
  const labelZh = row.trading_region_label_zh || row.trading_region_label || "—";
  return {
    label: isEn ? labelEn : labelZh,
    labelEn,
    labelZh,
    sort: finiteNumber(row.trading_region_sort) ?? 999,
  };
}

export function formatModelSummaryTemp(value: number | null | undefined, symbol = "°C") {
  const numericValue = finiteNumber(value);
  if (numericValue == null) return "—";
  return `${numericValue.toFixed(1)}${symbol || "°C"}`;
}

export function formatModelSummaryLocalTime(
  row: Pick<ModelSummaryRow, "localTime" | "timezoneOffsetSeconds">,
  nowMs: number | null | undefined = Date.now(),
) {
  const offsetSeconds = finiteNumber(row.timezoneOffsetSeconds);
  const timestampMs = finiteNumber(nowMs);
  if (offsetSeconds == null || timestampMs == null) return row.localTime || "—";
  const localDate = new Date(timestampMs + offsetSeconds * 1000);
  const hours = String(localDate.getUTCHours()).padStart(2, "0");
  const minutes = String(localDate.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
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
    const region = resolveRegion(row, isEn);
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
      regionLabel: region.label,
      regionLabelZh: region.labelZh,
      regionSort: region.sort,
      tempSymbol: row.temp_symbol || "°C",
      localTime: normalizeLocalTime(row.local_time),
      timezoneOffsetSeconds: finiteNumber(row.tz_offset_seconds),
      debPrediction: finiteNumber(row.deb_prediction),
      models,
      modelMedian: median(modelValues),
      modelSpread: spread(modelValues),
      searchText: `${cityName} ${row.city || ""} ${region.labelEn} ${region.labelZh} ${modelSearchText}`.toLowerCase(),
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

export function hasModelSummaryForecastData(rows: ModelSummaryRow[]) {
  return rows.some((row) => {
    if (row.debPrediction != null) return true;
    return MODEL_SUMMARY_MODEL_COLUMNS.some((column) => row.models[column.key] != null);
  });
}
