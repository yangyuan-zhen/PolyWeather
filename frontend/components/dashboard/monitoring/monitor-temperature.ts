import type { CityDetail } from "@/lib/dashboard-types";

export type MonitorTemperatureSource =
  | "amos_runway_median"
  | "amos_runway"
  | "amos"
  | "airport_primary"
  | "airport_current"
  | "current"
  | "missing";

export type MonitorTemperature = {
  source: MonitorTemperatureSource;
  value: number | null;
};

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getAmosRunwayTemperature(detail?: CityDetail | null) {
  const runwayTemps =
    detail?.amos?.runway_obs?.temperatures ||
    detail?.amos?.runway_temps ||
    [];
  const values = runwayTemps
    .map((pair) => finiteNumber(pair?.[0]))
    .filter((value): value is number => value != null);
  const value = median(values);
  if (value == null) return null;
  return {
    source: values.length > 1 ? "amos_runway_median" : "amos_runway",
    value,
  } satisfies MonitorTemperature;
}

export function resolveMonitorTemperature(
  detail?: CityDetail | null,
): MonitorTemperature {
  const runway = getAmosRunwayTemperature(detail);
  if (runway) return runway;

  const amosTemp = finiteNumber(detail?.amos?.temp ?? detail?.amos?.temp_c);
  if (amosTemp != null && detail?.amos?.temp_source === "runway_median") {
    return { source: "amos", value: amosTemp };
  }

  const airportPrimary = finiteNumber(detail?.airport_primary?.temp);
  if (airportPrimary != null) return { source: "airport_primary", value: airportPrimary };

  const airport = finiteNumber(detail?.airport_current?.temp);
  if (airport != null) return { source: "airport_current", value: airport };

  const current = finiteNumber(detail?.current?.temp);
  if (current != null) return { source: "current", value: current };

  return { source: "missing", value: null };
}
