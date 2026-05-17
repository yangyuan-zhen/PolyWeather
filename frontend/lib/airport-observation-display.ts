import type { AirportCurrentConditions, CityDetail } from "@/lib/dashboard-types";

function normalizeCityKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

const KOREAN_RUNWAY_OBSERVATION_CITY_KEYS = new Set(["seoul", "busan"]);

function hasRunwayObservationPayload(detail: CityDetail) {
  return Boolean(
    detail.amos?.runway_temp_range ||
      (detail.amos?.runway_temps?.length || 0) > 0 ||
      (detail.amos?.runway_obs?.temperatures?.length || 0) > 0 ||
      (detail.amos?.runway_obs?.point_temperatures?.length || 0) > 0,
  );
}

function isRunwayObservationSource(
  airportPrimary?: AirportCurrentConditions | null,
  detail?: CityDetail | null,
) {
  const sourceText = [
    airportPrimary?.source_code,
    airportPrimary?.source_label,
    airportPrimary?.station_label,
    detail?.amos?.source,
    detail?.amos?.source_label,
    detail?.amos?.temp_source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    sourceText.includes("amos") ||
    sourceText.includes("amsc") ||
    sourceText.includes("awos") ||
    sourceText.includes("runway") ||
    sourceText.includes("跑道")
  );
}

export function shouldSuppressKoreanRunwayObservation(detail?: CityDetail | null) {
  if (!detail) return false;
  const cityKey = normalizeCityKey(detail.name) || normalizeCityKey(detail.display_name);
  if (!KOREAN_RUNWAY_OBSERVATION_CITY_KEYS.has(cityKey)) return false;
  return isRunwayObservationSource(detail.airport_primary, detail) || hasRunwayObservationPayload(detail);
}

export function getDisplayAirportPrimary(detail?: CityDetail | null) {
  if (!detail || shouldSuppressKoreanRunwayObservation(detail)) return undefined;
  return detail.airport_primary;
}
