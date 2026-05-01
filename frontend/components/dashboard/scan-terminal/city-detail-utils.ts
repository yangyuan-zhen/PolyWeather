import type { CityDetail } from "@/lib/dashboard-types";
import { normalizeCityKey } from "@/components/dashboard/scan-terminal/decision-utils";

export function findDetailForCity(
  detailsByName: Record<string, CityDetail>,
  cityName?: string | null,
) {
  const target = normalizeCityKey(cityName);
  if (!target) return null;
  return (
    Object.values(detailsByName).find((detail) =>
      [detail?.name, detail?.display_name].some(
        (value) => normalizeCityKey(value) === target,
      ),
    ) || null
  );
}

export function countDetailModels(detail?: CityDetail | null, targetDate?: string | null) {
  if (!detail) return 0;
  const date = String(targetDate || detail.local_date || "").trim();
  const dailyModels = date ? detail.multi_model_daily?.[date]?.models : null;
  const models =
    dailyModels && typeof dailyModels === "object"
      ? dailyModels
      : detail.multi_model || {};
  return Object.values(models).filter((value) =>
    Number.isFinite(Number(value)),
  ).length;
}

export function countDetailForecastDays(detail?: CityDetail | null) {
  const daily = detail?.forecast?.daily;
  return Array.isArray(daily) ? daily.length : 0;
}

export function isFullEnoughForDeepAnalysis(detail?: CityDetail | null) {
  if (!detail) return false;
  if (detail.detail_depth && detail.detail_depth !== "full") return false;
  const hourlyTimes = Array.isArray(detail.hourly?.times)
    ? detail.hourly?.times || []
    : [];
  const hourlyTemps = Array.isArray(detail.hourly?.temps)
    ? detail.hourly?.temps || []
    : [];
  if (!detail.local_time || hourlyTimes.length === 0 || hourlyTemps.length === 0) {
    return false;
  }
  return (
    countDetailModels(detail, detail.local_date) > 1 &&
    countDetailForecastDays(detail) > 1
  );
}

export function waitForDeepAnalysisQueue(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
