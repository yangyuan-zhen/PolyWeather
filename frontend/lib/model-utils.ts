import type { CityDetail } from "@/lib/dashboard-types";

export function getProbabilityView(detail: CityDetail, targetDate?: string | null) {
  const date = targetDate || detail.local_date;
  if (date === detail.local_date) {
    return {
      calibrationMode: detail.probabilities?.calibration_mode ?? null,
      calibrationVersion: detail.probabilities?.calibration_version ?? null,
      engine: detail.probabilities?.engine ?? null,
      mu: detail.probabilities?.mu ?? null,
      probabilities: detail.probabilities?.distribution || [],
      probabilitiesAll:
        detail.probabilities?.distribution_all ||
        detail.probabilities?.distribution ||
        [],
      shadowProbabilities: detail.probabilities?.shadow_distribution || [],
      shadowProbabilitiesAll:
        detail.probabilities?.shadow_distribution_all ||
        detail.probabilities?.shadow_distribution ||
        [],
    };
  }

  const daily = detail.multi_model_daily?.[date];
  return {
    calibrationMode: null,
    calibrationVersion: null,
    engine: null,
    mu: daily?.deb?.prediction ?? null,
    probabilities: daily?.probabilities || [],
    probabilitiesAll: daily?.probabilities_all || daily?.probabilities || [],
    shadowProbabilities: [],
    shadowProbabilitiesAll: [],
  };
}

export function getModelView(detail: CityDetail, targetDate?: string | null) {
  const date = targetDate || detail.local_date;
  const daily = detail.multi_model_daily?.[date];
  const deb = detail.deb?.prediction ?? daily?.deb?.prediction ?? null;
  if (daily) {
    return {
      deb,
      models: daily.models || {},
    };
  }

  return {
    deb,
    models: detail.multi_model || {},
  };
}
