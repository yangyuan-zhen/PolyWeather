/**
 * Pure functions for building temperature chart data paths.
 *
 * All functions in this module accept plain values (arrays, strings, numbers)
 * — they do NOT depend on the CityDetail type.  This keeps the path-building
 * logic testable in isolation and reusable across chart consumers.
 */

import { normalizeTemperatureSymbol } from "@/lib/temperature-utils";
import {
  hmToMinutes,
  interpolateSeriesAtMinutes,
  normalizeHm,
} from "@/lib/time-utils";

// ── small helpers ──────────────────────────────────────────────

export function clampTemperatureDelta(value: number, min = -4, max = 4) {
  return Math.min(Math.max(value, min), max);
}

export function findNearestTimeIndex(
  times: string[],
  targetTime?: string | null,
) {
  const targetMinutes = hmToMinutes(targetTime);
  if (targetMinutes == null || !times.length) return -1;
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const minute = hmToMinutes(time);
    if (minute == null) return;
    const delta = Math.abs(minute - targetMinutes);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

export function buildTemperatureTickLabels(times: string[]) {
  const lastIndex = Math.max(0, times.length - 1);
  return times.map((time, index) => {
    if (index === 0 || index === lastIndex) return time;
    const minute = hmToMinutes(time);
    if (minute == null) return "";
    const hour = Math.floor(minute / 60);
    const minutePart = minute % 60;
    if (minutePart !== 0) return "";
    return hour % 2 === 0 ? time : "";
  });
}

export function getNiceTemperatureScale(
  values: number[],
  tempSymbol?: string | null,
) {
  const numericValues = values.filter((value) => Number.isFinite(Number(value)));
  if (!numericValues.length) {
    return { max: 1, min: 0, step: 1 };
  }

  const rawMin = Math.min(...numericValues);
  const rawMax = Math.max(...numericValues);
  const spread = Math.max(0.1, rawMax - rawMin);
  const isFahrenheit = normalizeTemperatureSymbol(tempSymbol) === "°F";
  const padding = Math.max(isFahrenheit ? 1.5 : 0.8, spread * 0.12);
  const paddedMin = rawMin - padding;
  const paddedMax = rawMax + padding;
  const paddedSpread = Math.max(0.1, paddedMax - paddedMin);
  const candidates = isFahrenheit ? [1, 2, 5, 10, 20] : [0.5, 1, 2, 5, 10];
  let step =
    candidates.find((candidate) => candidate >= paddedSpread / 4) ||
    candidates[candidates.length - 1];
  let min = Math.floor(paddedMin / step) * step;
  let max = Math.ceil(paddedMax / step) * step;

  if (min < 0 && rawMin >= 0 && rawMin <= step * 1.25) min = 0;
  if (max <= min) max = min + step * 4;

  while ((max - min) / step + 1 > 6) {
    const nextStep = candidates.find((candidate) => candidate > step);
    if (!nextStep) break;
    step = nextStep;
    min = Math.floor(paddedMin / step) * step;
    max = Math.ceil(paddedMax / step) * step;
    if (min < 0 && rawMin >= 0 && rawMin <= step * 1.25) min = 0;
  }

  return { max, min, step };
}

export function buildSeriesPoints(
  times: string[],
  values: Array<number | null | undefined>,
) {
  return times
    .map((time, index) => {
      const x = hmToMinutes(time);
      const y = values[index];
      return x != null && y != null && Number.isFinite(Number(y))
        ? { index, labelTime: time, x, y: Number(y) }
        : null;
    })
    .filter(
      (point): point is { index: number; labelTime: string; x: number; y: number } =>
        point != null,
    );
}

export function buildObservationPointSeries(
  items: Array<{ time?: string; temp?: number | null }>,
) {
  return items
    .map((item) => {
      const labelTime = normalizeHm(String(item.time || ""));
      const x = hmToMinutes(labelTime);
      const y = item.temp;
      return x != null && y != null && Number.isFinite(Number(y))
        ? { labelTime: labelTime || "", x, y: Number(y) }
        : null;
    })
    .filter((point): point is { labelTime: string; x: number; y: number } => point != null);
}

// ── hour grid ──────────────────────────────────────────────────

export interface ChartTimeAxis {
  times: string[];
  temps: Array<number | null>;
}

/**
 * Build a 48-point intraday time axis (00:00 … 23:30) from an hourly
 * forecast series.  When the primary hourly series is empty AND the city
 * uses MGM as its forecast source, ``mgmHourly`` rows are used instead.
 */
export function buildChartTimeAxis(
  hourlyTimes: string[] | null | undefined,
  hourlyTemps: Array<number | null> | null | undefined,
  mgmHourlyRows: Array<{ time?: string | null; temp?: number | null }> | null | undefined,
  isTurkishMgm: boolean,
): ChartTimeAxis {
  const primaryTimes = Array.isArray(hourlyTimes) ? hourlyTimes : [];
  const primaryTemps = Array.isArray(hourlyTemps) ? hourlyTemps : [];
  const hasPrimary =
    primaryTimes.length > 0 &&
    primaryTemps.length > 0 &&
    Math.min(primaryTimes.length, primaryTemps.length) > 0;

  const mgmRows = Array.isArray(mgmHourlyRows) ? mgmHourlyRows : [];
  const useMgm = !hasPrimary && isTurkishMgm;

  const rawTimes: string[] = useMgm
    ? mgmRows.map((row) => String(row?.time || ""))
    : primaryTimes;
  const rawTemps: Array<number | null> = useMgm
    ? mgmRows.map((row) => row?.temp ?? null)
    : primaryTemps;

  const dataByHour = new Map<string, number | null>();
  rawTimes.forEach((raw, i) => {
    const tail = normalizeHm(String(raw || "").trim()) || "";
    if (!tail) return;
    const value = Number(rawTemps[i]);
    dataByHour.set(tail, Number.isFinite(value) ? value : null);
  });

  const getHourTemp = (h: number): number | null => {
    const key = `${String(h).padStart(2, "0")}:00`;
    return dataByHour.has(key) ? dataByHour.get(key)! : null;
  };

  const times: string[] = [];
  const temps: Array<number | null> = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    times.push(`${hh}:00`);
    temps.push(getHourTemp(h));
    if (h < 23) {
      const a = getHourTemp(h);
      const b = getHourTemp(h + 1);
      times.push(`${hh}:30`);
      temps.push(
        a != null && b != null
          ? Number((a + (b - a) * 0.5).toFixed(1))
          : a ?? b,
      );
    }
  }

  return { times, temps };
}

// ── DEB baseline path ──────────────────────────────────────────

export function fillTemperaturePathForFullDay(
  times: string[],
  values: Array<number | null>,
) {
  if (!times.length) return values;
  const hasAnyValue = values.some((v) => v != null && Number.isFinite(v));
  if (!hasAnyValue) return values;
  return times.map((time, index) => {
    const value = values[index];
    if (value != null && Number.isFinite(value)) return value;
    const minute = hmToMinutes(time);
    if (minute == null) return null;
    const interpolated = interpolateSeriesAtMinutes(times, values, minute);
    return interpolated != null && Number.isFinite(interpolated)
      ? interpolated
      : null;
  });
}

export interface DebBaselinePath {
  /** Full 48-point DEB baseline (past + future merged). */
  debTemps: Array<number | null>;
  /** Past portion (solid line). */
  debPast: Array<number | null>;
  /** Future portion (dashed line). */
  debFuture: Array<number | null>;
  /** Index of current local time in the time axis, or -1. */
  currentIndex: number;
  /** Offset applied to the hourly curve to align with DEB prediction. */
  offset: number;
}

/**
 * Build the DEB baseline path by shifting the hourly forecast curve so
 * that its peak aligns with the DEB daily-high prediction.
 *
 * **Offset base priority:**
 * 1. The hourly curve's own maximum temperature
 * 2. ``forecastTodayHigh`` (Open-Meteo daily high) — only when hourly
 *    data is completely absent
 * 3. ``mgmHourlyMax`` — only when both hourly and forecast are absent
 *
 * This prevents a stale or unreliable ``forecast.today_high`` from
 * pushing/pulling the entire curve by an unrealistic offset (e.g. Moscow:
 * forecast.today_high=21.4, hourly max=24.7, DEB=24.5 → old offset=+3.1,
 * new offset=+0.2).
 */
export function buildDebBaselinePath(
  times: string[],
  hourlyTemps: Array<number | null>,
  debPrediction: number | null | undefined,
  localTime: string | null | undefined,
  forecastTodayHigh?: number | null,
  mgmHourlyMax?: number | null,
): DebBaselinePath {
  const currentIndex = findNearestTimeIndex(times, localTime);
  const debMax = Number(debPrediction);
  const hasDebMax = Number.isFinite(debMax);

  // Hourly curve's own max — preferred offset base
  const hourlyMax =
    hourlyTemps.length > 0
      ? hourlyTemps.reduce<number | null>(
          (max, v) =>
            v != null && Number.isFinite(v)
              ? max == null
                ? v
                : Math.max(max, v)
              : max,
          null,
        )
      : null;

  const omMax =
    (hourlyMax != null && Number.isFinite(hourlyMax) ? hourlyMax : null) ??
    (forecastTodayHigh != null && Number.isFinite(forecastTodayHigh)
      ? Number(forecastTodayHigh)
      : null) ??
    (mgmHourlyMax != null && Number.isFinite(mgmHourlyMax)
      ? Number(mgmHourlyMax)
      : null);

  const offset =
    hasDebMax && omMax != null ? debMax - omMax : 0;

  // Fill gaps with interpolation, then apply DEB offset
  const filled = fillTemperaturePathForFullDay(times, hourlyTemps);
  const debTemps: Array<number | null> = filled.map((temp) =>
    temp != null && Number.isFinite(temp)
      ? Number((temp + offset).toFixed(1))
      : null,
  );

  const debPast = debTemps.map((t, i) =>
    currentIndex >= 0 && i <= currentIndex ? t : null,
  );
  const debFuture = debTemps.map((t, i) =>
    currentIndex < 0 || i >= currentIndex ? t : null,
  );

  return { debTemps, debPast, debFuture, currentIndex, offset };
}

// ── calibrated "DEB corrected" path ────────────────────────────

export interface CalibratedPathResult {
  adjustmentDelta: number | null;
  future: Array<number | null>;
}

/**
 * Adjust the future portion of the DEB baseline using the most recent
 * METAR observations.  The adjustment fades smoothly back to the DEB
 * baseline by evening (sunset or 18:00).
 */
export function buildCalibratedPath(
  observations: Array<{ time?: string | null; temp?: number | null }>,
  times: string[],
  debTemps: Array<number | null>,
  localTime: string | null | undefined,
  sunset?: string | null,
): CalibratedPathResult {
  if (!times.length || !observations.length) {
    return { adjustmentDelta: null, future: new Array(times.length).fill(null) };
  }

  // Deduplicate by time, keeping the highest temp per slot
  const byTime = new Map<string, { time: string; temp: number }>();
  for (const item of observations) {
    const time = normalizeHm(item.time);
    const value = Number(item.temp);
    if (!time || !Number.isFinite(value)) continue;
    const existing = byTime.get(time);
    if (!existing || value >= existing.temp) {
      byTime.set(time, { time, temp: value });
    }
  }
  const unique = [...byTime.values()].sort((a, b) => {
    const am = hmToMinutes(a.time) ?? 0;
    const bm = hmToMinutes(b.time) ?? 0;
    return am - bm;
  });

  const currentMinutes = hmToMinutes(localTime);

  const latestObsMinute = unique.reduce<number | null>(
    (latest, item) => {
      const minute = hmToMinutes(item.time);
      if (minute == null) return latest;
      return latest == null ? minute : Math.max(latest, minute);
    },
    null,
  );

  if (latestObsMinute == null && currentMinutes == null) {
    return { adjustmentDelta: null, future: new Array(times.length).fill(null) };
  }

  const pathStartMinutes =
    latestObsMinute == null || currentMinutes == null
      ? latestObsMinute ?? currentMinutes ?? 0
      : Math.max(currentMinutes, latestObsMinute);

  // Keep the last 3 deltas before the path start
  const deltas = unique
    .map((item) => {
      const minute = hmToMinutes(item.time);
      const observed = item.temp;
      if (minute == null || minute > pathStartMinutes + 30 || !Number.isFinite(observed))
        return null;
      const expected = interpolateSeriesAtMinutes(times, debTemps, minute);
      if (expected == null || !Number.isFinite(expected)) return null;
      return {
        delta: clampTemperatureDelta(observed - expected),
        minute,
      };
    })
    .filter((d): d is { delta: number; minute: number } => d != null)
    .slice(-3);

  if (!deltas.length) {
    return { adjustmentDelta: null, future: new Array(times.length).fill(null) };
  }

  // Weighted average — more recent = higher weight
  const weighted = deltas.reduce(
    (acc, item, index) => ({
      total: acc.total + item.delta * (index + 1),
      weight: acc.weight + (index + 1),
    }),
    { total: 0, weight: 0 },
  );
  const adjustmentDelta = Number(
    clampTemperatureDelta(weighted.total / Math.max(weighted.weight, 1)).toFixed(1),
  );

  const lastSeriesMinute = times
    .map((t) => hmToMinutes(t))
    .filter((m): m is number => m != null)
    .at(-1);
  const reversionMinutes = hmToMinutes(sunset) ?? hmToMinutes("18:00");
  const returnToBaselineMinute =
    reversionMinutes != null && reversionMinutes > pathStartMinutes
      ? reversionMinutes
      : lastSeriesMinute != null && lastSeriesMinute > pathStartMinutes
        ? lastSeriesMinute
        : pathStartMinutes + 6 * 60;

  const future = times.map((time, index) => {
    const minute = hmToMinutes(time);
    const base = debTemps[index];
    if (minute == null || minute < pathStartMinutes || base == null || !Number.isFinite(base))
      return null;
    const progressToEvening = Math.min(
      Math.max((minute - pathStartMinutes) / Math.max(returnToBaselineMinute - pathStartMinutes, 1), 0),
      1,
    );
    const decay = Math.pow(1 - progressToEvening, 1.35);
    return Number((base + adjustmentDelta * decay).toFixed(1));
  });

  return { adjustmentDelta, future };
}

// ── observation points ─────────────────────────────────────────

/**
 * Map observation items onto the 48-point time grid.
 * Multiple observations landing in the same slot keep the highest temp.
 */
export function buildObservationGrid(
  source: Array<{ time?: string | null; temp?: number | null }>,
  times: string[],
): Array<number | null> {
  const points = new Array(times.length).fill(null) as Array<number | null>;
  for (const item of source) {
    const index = findNearestTimeIndex(times, String(item.time || ""));
    const temp = Number(item.temp);
    if (index >= 0 && Number.isFinite(temp)) {
      const existing = points[index];
      points[index] = existing == null ? temp : Math.max(existing, temp);
    }
  }
  return points;
}
