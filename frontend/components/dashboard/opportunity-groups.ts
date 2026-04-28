import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { getModelView, getProbabilityView } from "@/lib/model-utils";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import { getWindowPhaseMeta, type PhaseMeta } from "./opportunity-window-phase";
import {
  getDetailForRow,
  getDetailViewDate,
} from "./opportunity-detail";
import {
  formatThreshold,
  normalizeProbability,
} from "./opportunity-format";
import { formatModelClusterRange } from "./opportunity-model-summary";
import {
  extractNumbers,
  getTargetRange,
  normalizeBucketLabel,
} from "./opportunity-target";

export function getBucketText(bucket: { label?: string | null; bucket?: string | null; range?: string | null }) {
  return [bucket.label, bucket.bucket, bucket.range]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export function bucketMatchesRow(
  bucket: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | string | null;
  },
  row: ScanOpportunityRow,
  tempSymbol?: string | null,
) {
  const targetLabel = normalizeBucketLabel(row.target_label, tempSymbol);
  const bucketLabels = getBucketText(bucket).map((label) =>
    normalizeBucketLabel(label, tempSymbol),
  );
  if (targetLabel && bucketLabels.some((label) => label === targetLabel)) {
    return true;
  }

  const rawTargetLabel = String(row.target_label || "");
  const targetNumbers = extractNumbers(rawTargetLabel);
  const targetValue =
    row.target_value ?? row.target_threshold ?? row.target_lower ?? row.target_upper ?? targetNumbers[0] ?? null;
  if (targetValue == null || !Number.isFinite(Number(targetValue))) return false;

  const bucketNumbers = [
    ...(bucket.value != null && Number.isFinite(Number(bucket.value))
      ? [Number(bucket.value)]
      : []),
    ...getBucketText(bucket).flatMap(extractNumbers),
  ];
  const matchesNumber = bucketNumbers.some(
    (value) => Math.abs(Number(value) - Number(targetValue)) < 0.05,
  );
  if (!matchesNumber) return false;

  const targetIsUpper =
    /(\+|以上|or\s*above|above|greater|>=|≥)/i.test(rawTargetLabel) ||
    (row.target_lower != null && row.target_upper == null);
  const targetIsLower =
    /(<=|≤|below|or\s*below|以下)/i.test(rawTargetLabel) ||
    (row.target_upper != null && row.target_lower == null);
  const bucketRaw = getBucketText(bucket).join(" ");
  const bucketIsUpper = /(\+|以上|or\s*above|above|greater|>=|≥|inf|∞)/i.test(bucketRaw);
  const bucketIsLower = /(<=|≤|below|or\s*below|以下|-inf|-∞)/i.test(bucketRaw);

  if (targetIsUpper || bucketIsUpper) return targetIsUpper === bucketIsUpper;
  if (targetIsLower || bucketIsLower) return targetIsLower === bucketIsLower;
  return true;
}

export function getDetailBucketEventProbability(
  detail: CityDetail | null,
  row: ScanOpportunityRow,
  tempSymbol?: string | null,
) {
  if (!detail) return null;
  const view = getProbabilityView(detail, getDetailViewDate(detail, row));
  const buckets = Array.isArray(view.probabilitiesAll)
    ? view.probabilitiesAll
    : [];
  if (!buckets.length) return null;
  const matched = buckets.find((bucket) => bucketMatchesRow(bucket, row, tempSymbol));
  return normalizeProbability(matched?.probability);
}

export type OpportunityGroup = {
  key: string;
  cityName: string;
  date?: string | null;
  tempSymbol?: string | null;
  debLabel: string;
  peakLabel: string;
  peakProbability?: number | null;
  phaseMeta: PhaseMeta;
  localTime?: string | null;
  remainingMinutes?: number | null;
  rows: ScanOpportunityRow[];
};

export function buildOpportunityGroups(
  rows: ScanOpportunityRow[],
  locale: string,
  cityDetailsByName?: Record<string, CityDetail>,
): OpportunityGroup[] {
  const groups = new Map<string, OpportunityGroup>();
  for (const row of rows) {
    const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
    const detail = getDetailForRow(row, cityDetailsByName);
    const cityName = getLocalizedCityName(
      row.city,
      row.city_display_name || row.display_name || row.city,
      locale,
    );
    const date = detail ? getDetailViewDate(detail, row) : row.selected_date || row.local_date || "";
    const key = `${row.city || cityName}|${date}`;
    const modelView = detail ? getModelView(detail, date) : null;
    const debPrediction = modelView?.deb ?? row.deb_prediction ?? null;
    const modelClusterLabel = formatModelClusterRange(
      modelView?.models || row.model_cluster_sources,
      tempSymbol,
    );
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        cityName,
        date,
        tempSymbol,
        debLabel:
          debPrediction != null
            ? formatTemperatureValue(Number(debPrediction), tempSymbol, { digits: 1 })
            : "--",
        peakLabel: modelClusterLabel,
        peakProbability: null,
        phaseMeta: getWindowPhaseMeta(row, locale),
        localTime: row.local_time,
        remainingMinutes: row.remaining_window_minutes,
        rows: [row],
      });
      continue;
    }
    existing.rows.push(row);
    if (existing.peakLabel === "--" && modelClusterLabel !== "--") {
      existing.peakLabel = modelClusterLabel;
    }
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    rows: [...group.rows].sort(
      (a, b) =>
        Number(b.edge_percent ?? -Infinity) - Number(a.edge_percent ?? -Infinity) ||
        Number(b.final_score ?? -Infinity) - Number(a.final_score ?? -Infinity),
    ),
  }));
}

export function getBucketDisplayLabel(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const { lower, upper } = getTargetRange(row);
  if (lower != null && upper == null) {
    const value = formatTemperatureValue(lower, tempSymbol);
    return isEn ? `${value} or higher` : `${value} 以上`;
  }
  if (upper != null && lower == null) {
    const value = formatTemperatureValue(upper, tempSymbol);
    return isEn ? `${value} or lower` : `${value} 以下`;
  }
  if (lower != null && upper != null && Math.abs(lower - upper) > 0.01) {
    return `${formatTemperatureValue(lower, tempSymbol)} ~ ${formatTemperatureValue(upper, tempSymbol)}`;
  }
  return formatThreshold(row, tempSymbol);
}
