import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { normalizeTemperatureLabel } from "@/lib/temperature-utils";

export function normalizeBucketLabel(value?: string | null, tempSymbol?: string | null) {
  return normalizeTemperatureLabel(value, tempSymbol)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/℃/g, "°c");
}

export function extractNumbers(value?: string | null) {
  return Array.from(String(value || "").matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );
}

export function getTargetRange(row: ScanOpportunityRow) {
  const lower =
    row.target_lower != null && Number.isFinite(Number(row.target_lower))
      ? Number(row.target_lower)
      : null;
  const upper =
    row.target_upper != null && Number.isFinite(Number(row.target_upper))
      ? Number(row.target_upper)
      : null;
  if (lower != null || upper != null) return { lower, upper };

  const rawLabel = String(row.target_label || row.action || "");
  const numbers = extractNumbers(rawLabel);
  if (numbers.length >= 2) {
    return { lower: Math.min(numbers[0], numbers[1]), upper: Math.max(numbers[0], numbers[1]) };
  }
  const value =
    row.target_threshold ??
    row.target_value ??
    (numbers.length ? numbers[0] : null);
  if (value == null || !Number.isFinite(Number(value))) {
    return { lower: null, upper: null };
  }
  const numeric = Number(value);
  if (/(\+|above|higher|or\s+higher|>=|≥|以上)/i.test(rawLabel)) {
    return { lower: numeric, upper: null };
  }
  if (/(below|or\s+below|<=|≤|以下)/i.test(rawLabel)) {
    return { lower: null, upper: numeric };
  }
  return { lower: numeric, upper: numeric };
}
