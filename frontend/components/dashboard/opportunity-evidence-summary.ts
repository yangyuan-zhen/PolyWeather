import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatTemperatureValue } from "@/lib/temperature-utils";
import { formatTemperatureDelta } from "./opportunity-format";
import { getMetarObservationContext } from "./opportunity-observation";
import { getTargetRange } from "./opportunity-target";

export function getDebDistanceSummary(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  if (deb == null) return locale === "en-US" ? "DEB pending" : "DEB 待确认";
  const { lower, upper } = getTargetRange(row);
  if (lower != null && upper == null) {
    const delta = deb - lower;
    if (Math.abs(delta) < 0.05) return locale === "en-US" ? "DEB on threshold" : "DEB 贴近阈值";
    return delta >= 0
      ? locale === "en-US"
        ? `DEB above by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB below by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  if (upper != null && lower == null) {
    const delta = deb - upper;
    if (Math.abs(delta) < 0.05) return locale === "en-US" ? "DEB on threshold" : "DEB 贴近阈值";
    return delta <= 0
      ? locale === "en-US"
        ? `DEB below by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB above by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  if (lower != null && upper != null) {
    if (deb >= lower && deb <= upper) return locale === "en-US" ? "DEB inside bucket" : "DEB 位于桶内";
    const nearest = deb < lower ? lower : upper;
    const delta = deb - nearest;
    return deb < lower
      ? locale === "en-US"
        ? `DEB below bucket by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于桶 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB above bucket by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于桶 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  return locale === "en-US"
    ? `DEB ${formatTemperatureValue(deb, tempSymbol, { digits: 1 })}`
    : `DEB ${formatTemperatureValue(deb, tempSymbol, { digits: 1 })}`;
}

export function getModelSupportSummary(
  row: ScanOpportunityRow,
  locale: string,
) {
  const sources = Object.values(row.model_cluster_sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  if (!sources.length || deb == null) return locale === "en-US" ? "Models pending" : "模型待确认";
  const { lower, upper } = getTargetRange(row);
  let supports = 0;
  if (lower != null && upper == null) {
    supports = sources.filter((value) => (deb >= lower ? value >= lower : value < lower)).length;
  } else if (upper != null && lower == null) {
    supports = sources.filter((value) => (deb <= upper ? value <= upper : value > upper)).length;
  } else if (lower != null && upper != null) {
    if (deb >= lower && deb <= upper) {
      supports = sources.filter((value) => value >= lower && value <= upper).length;
    } else if (deb < lower) {
      supports = sources.filter((value) => value < lower).length;
    } else {
      supports = sources.filter((value) => value > upper).length;
    }
  } else {
    const tolerance = 1;
    supports = sources.filter((value) => Math.abs(value - deb) <= tolerance).length;
  }
  return locale === "en-US"
    ? `${supports}/${sources.length} models support DEB`
    : `${supports}/${sources.length} 模型支持 DEB`;
}

export function getMetarConflictSummary(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
) {
  const obs = getMetarObservationContext(row, detail);
  if (obs.stale || obs.maxTemp == null) return locale === "en-US" ? "METAR pending" : "METAR 待确认";
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  const { lower, upper } = getTargetRange(row);
  if (deb == null || (lower == null && upper == null)) {
    return locale === "en-US" ? "METAR read only" : "METAR 仅参考";
  }
  const phase = String(row.window_phase || "").toLowerCase();
  const peakPending =
    phase === "early_today" ||
    phase === "setup_today" ||
    (row.minutes_until_peak_start != null && Number(row.minutes_until_peak_start) > 0);
  if (lower != null && upper == null) {
    if (deb < lower && obs.maxTemp >= lower) return locale === "en-US" ? "METAR conflicts" : "METAR 冲突";
    if (deb >= lower && obs.maxTemp < lower && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
    return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
  }
  if (upper != null && lower == null) {
    if (deb <= upper && obs.maxTemp > upper) return locale === "en-US" ? "METAR conflicts" : "METAR 冲突";
    if (deb > upper && obs.maxTemp <= upper && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
    return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
  }
  if (lower != null && upper != null && deb >= lower && deb <= upper) {
    if (obs.maxTemp > upper) return locale === "en-US" ? "METAR above bucket" : "METAR 已越过桶";
    if (obs.maxTemp < lower && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
  }
  return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
}
