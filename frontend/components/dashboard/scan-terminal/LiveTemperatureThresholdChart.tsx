"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AmosData,
  AirportCurrentConditions,
  CityDetail,
  ScanOpportunityRow,
  ForecastDay,
  DailyModelForecast,
} from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import { DASHBOARD_REFRESH_POLICY_MS } from "@/lib/refresh-policy";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { rowName, temp } from "@/components/dashboard/scan-terminal/utils";

const ROLLING_WINDOW_BEFORE_MS = 12 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_LIVE_MS = 2 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_FORECAST_MS = 8 * 60 * 60 * 1000;

const SETTLEMENT_RUNWAY_PAIRS: Record<string, Array<[string, string]>> = {
  shanghai: [["17L", "35R"]],
  beijing: [["19", "01"]],
  guangzhou: [["02L", "20R"]],
  chengdu: [["02L", "20R"]],
  chongqing: [["20R", "02L"]],
  wuhan: [["04", "22"]],
  seoul: [["15R", "33L"]],
};

function normalizeRunwayLabel(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCityKey(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function pairKey(pair: [string, string]) {
  return pair.map(normalizeRunwayLabel).sort().join("/");
}

function runwaySeriesKey(rwy: string) {
  return `runway_${String(rwy || "unknown")
    .split("/")
    .map(normalizeRunwayLabel)
    .filter(Boolean)
    .join("_")}`;
}

function isTemperatureSeriesVisibleByDefault(city: string, seriesKey: string) {
  if (seriesKey.startsWith("model_curve_")) {
    return normalizeCityKey(city) === "paris" && seriesKey === "model_curve_AROME HD";
  }
  return true;
}

function getVisibleTemperatureSeries(
  city: string,
  series: EvidenceSeries[],
  userToggledKeys: Record<string, boolean>,
) {
  return series.filter((item) => {
    if (userToggledKeys[item.key] !== undefined) {
      return userToggledKeys[item.key];
    }
    return isTemperatureSeriesVisibleByDefault(city, item.key);
  });
}

function buildRunwayPlates(
  amos: AmosData | null | undefined,
  row: ScanOpportunityRow | null,
  settlementObs?: Array<{ ts: number; value: number }>,
) {
  if (!amos) return [];
  const runwayObs = amos.runway_obs || {};
  const runwayPairs = runwayObs.runway_pairs || [];
  const runwayTemps = runwayObs.temperatures || [];
  const pointTemps = runwayObs.point_temperatures || [];

  const cityKey = normalizeCityKey(row?.city);
  const settlementPairs = SETTLEMENT_RUNWAY_PAIRS[cityKey] || [];
  const settlementKeys = new Set(settlementPairs.map(pairKey));

  const list: Array<{
    rwy: string;
    isSettlement: boolean;
    tdzTemp: number | null;
    midTemp: number | null;
    endTemp: number | null;
    maxTemp: number | null;
    dailyHigh: number | null;
    trend_15m: number | null;
  }> = [];

  runwayPairs.forEach((rawPair: any, index: number) => {
    const pair = rawPair as [string, string];
    if (!Array.isArray(pair) || pair.length < 2) return;
    const isSettlement = settlementKeys.has(pairKey(pair));
    
    const tdz = validNumber(pointTemps[index]?.tdz_temp);
    const mid = validNumber(pointTemps[index]?.mid_temp);
    const end = validNumber(pointTemps[index]?.end_temp);
    
    const historyVals = Array.isArray(runwayTemps[index])
      ? (runwayTemps[index] as Array<number | null>).map(validNumber).filter((v): v is number => v !== null)
      : [];

    const tdzVal = tdz !== null ? [tdz] : [];
    const midVal = mid !== null ? [mid] : [];
    const endVal = end !== null ? [end] : [];
    const allVals = [...historyVals, ...tdzVal, ...midVal, ...endVal];
    
    const maxTemp = allVals.length ? Math.max(...allVals) : null;
    const dailyHigh = historyVals.length ? Math.max(...historyVals) : maxTemp;

    // Calculate 15-minute trend
    const latest = historyVals.length > 0 ? historyVals[historyVals.length - 1] : (tdz ?? mid ?? end ?? null);
    const val15 = historyVals.length > 15 ? historyVals[historyVals.length - 16] : (historyVals.length > 0 ? historyVals[0] : null);
    let trend_15m = (latest !== null && val15 !== null) ? latest - val15 : null;

    if (isSettlement && settlementObs && settlementObs.length >= 2) {
      const latestObs = settlementObs[settlementObs.length - 1];
      const targetTs = latestObs.ts - 15 * 60 * 1000;
      let closestPoint = settlementObs[0];
      let minDiff = Math.abs(closestPoint.ts - targetTs);
      for (let i = 1; i < settlementObs.length; i++) {
        const diff = Math.abs(settlementObs[i].ts - targetTs);
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = settlementObs[i];
        }
      }
      if (Math.abs(closestPoint.ts - targetTs) < 5 * 60 * 1000) {
        trend_15m = latestObs.value - closestPoint.value;
      }
    }

    list.push({
      rwy: `${normalizeRunwayLabel(pair[0])}/${normalizeRunwayLabel(pair[1])}`,
      isSettlement,
      tdzTemp: tdz,
      midTemp: mid,
      endTemp: end,
      maxTemp,
      dailyHigh,
      trend_15m,
    });
  });

  return list;
}

type ObsPoint = { time?: string | null; temp?: number | null };
type RawObsPoint = ObsPoint | [string | number | null, number | null | undefined];

type EvidenceSeries = {
  key: string;
  label: string;
  source: string;
  color: string;
  dashed?: boolean;
  featured?: boolean;
  smooth?: boolean;
  curve?: "linear" | "monotone" | "stepAfter";
  connectNulls?: boolean;
  showDot?: boolean;
  values: Array<number | null>;
};

type RunwayHistorySeries = {
  key: string;
  label: string;
  rwy: string;
  isSettlement: boolean;
  color: string;
  points: Array<{ ts: number; value: number }>;
};

const MAX_OBS_POINTS = 1440;
const HOURLY_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.model;
const FULL_DAY_SLOT_MINUTES = 30;
const FULL_DAY_SLOTS = 48;
const SLOT_INTERVAL_MS = FULL_DAY_SLOT_MINUTES * 60 * 1000;
const _hourlyCache = new Map<string, { ts: number; data: HourlyForecast }>();
const _hourlyRequestCache = new Map<string, Promise<HourlyForecast>>();
const RUNWAY_LINE_COLORS = ["#00897b", "#d97706", "#7c3aed", "#0891b2", "#ea580c", "#64748b"];

function validNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getCityLocalUtcTimestamp(
  value: string | number | null | undefined,
  tzOffsetSeconds: number,
  referenceLocalDate?: string | null
): number | null {
  if (value == null) return null;
  
  if (typeof value === "number") {
    const d = new Date(value + tzOffsetSeconds * 1000);
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes()
    );
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (raw.includes("T") || raw.includes("Z") || raw.includes("-")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const localMs = d.getTime() + tzOffsetSeconds * 1000;
      const localDate = new Date(localMs);
      return Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
        localDate.getUTCHours(),
        localDate.getUTCMinutes()
      );
    }
  }

  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const h = +m[1];
    const min = +m[2];
    
    let year = new Date().getUTCFullYear();
    let month = new Date().getUTCMonth();
    let date = new Date().getUTCDate();
    
    if (referenceLocalDate) {
      const dateParts = referenceLocalDate.split("-");
      if (dateParts.length === 3) {
        year = parseInt(dateParts[0]);
        month = parseInt(dateParts[1]) - 1;
        date = parseInt(dateParts[2]);
      }
    }
    
    return Date.UTC(year, month, date, h, min);
  }

  return null;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function normalizeRawObsPoint(point: RawObsPoint): ObsPoint | null {
  if (Array.isArray(point)) {
    return { time: point[0] == null ? null : String(point[0]), temp: validNumber(point[1]) };
  }
  return point;
}

function normObs(points: RawObsPoint[] | null | undefined, tzOffsetSeconds: number, limit = MAX_OBS_POINTS) {
  return (points || [])
    .map(normalizeRawObsPoint)
    .filter((p): p is ObsPoint => p !== null)
    .filter((p) => validNumber(p.temp) !== null && p.time)
    .map((p) => ({
      ts: getCityLocalUtcTimestamp(p.time, tzOffsetSeconds)!,
      value: Number(p.temp),
    }))
    .filter((p) => p.ts !== null)
    .slice(-limit);
}

function seriesStats(values: Array<number | null>) {
  const nums = values.filter((v): v is number => validNumber(v) !== null);
  const latest = nums.length ? nums[nums.length - 1] : null;
  const high = nums.length ? Math.max(...nums) : null;
  const first15 = nums.length > 1 ? nums[Math.max(0, nums.length - 15)] : null;
  const delta15 = latest !== null && first15 !== null ? latest - first15 : null;
  return { latest, high, delta15 };
}

function latestObservationValue(obs: Array<{ ts: number; value: number }>) {
  if (!obs.length) return null;
  return obs.reduce((latest, point) => (point.ts > latest.ts ? point : latest), obs[0]).value;
}

function maxObservationValue(obs: Array<{ ts: number; value: number }>) {
  if (!obs.length) return null;
  return Math.max(...obs.map((point) => point.value));
}

function observationSetContains(
  superset: Array<{ ts: number; value: number }>,
  subset: Array<{ ts: number; value: number }>,
) {
  if (!superset.length || !subset.length) return false;
  return subset.every((point) =>
    superset.some((candidate) => candidate.ts === point.ts && Math.abs(candidate.value - point.value) < 0.01),
  );
}

function getObservationDisplayMetrics(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  settlementPlate?: { maxTemp: number | null } | null,
) {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const settlementObs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset);
  const metarObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset);
  const latestSettlement = latestObservationValue(settlementObs);
  const latestMetar = latestObservationValue(metarObs);
  const highSettlement = maxObservationValue(settlementObs);
  const highMetar = maxObservationValue(metarObs);
  const airportCurrentTemp = validNumber(hourly?.airportCurrent?.temp) ?? validNumber(hourly?.airportPrimary?.temp);
  const airportHigh = validNumber(hourly?.airportCurrent?.max_so_far) ?? validNumber(hourly?.airportPrimary?.max_so_far);
  const rowMetarHigh = validNumber(row?.metar_context?.airport_max_so_far ?? row?.metar_context?.max_temp ?? row?.current_max_so_far);

  const currentRunwayTemp =
    validNumber(hourly?.amos?.temp_c) ??
    settlementPlate?.maxTemp ??
    latestSettlement ??
    latestMetar ??
    airportCurrentTemp ??
    validNumber(row?.current_temp) ??
    null;
  const observedHighMetar = airportHigh ?? highSettlement ?? highMetar ?? rowMetarHigh ?? null;
  const observedHighRunway =
    settlementPlate?.maxTemp ??
    highSettlement ??
    airportHigh ??
    highMetar ??
    validNumber(row?.current_max_so_far) ??
    currentRunwayTemp ??
    null;

  return { currentRunwayTemp, observedHighMetar, observedHighRunway };
}

function isSettlementRunway(row: ScanOpportunityRow | null, rwy: string) {
  const cityKey = normalizeCityKey(row?.city);
  const settlementPairs = SETTLEMENT_RUNWAY_PAIRS[cityKey] || [];
  if (!settlementPairs.length) return false;
  const normalized = rwy
    .split("/")
    .map(normalizeRunwayLabel)
    .filter(Boolean)
    .sort()
    .join("/");
  return settlementPairs.some((pair) => pairKey(pair) === normalized);
}

function runwayLabelFromPair(rawPair: unknown, index: number) {
  if (Array.isArray(rawPair) && rawPair.length >= 2) {
    return `${normalizeRunwayLabel(rawPair[0])}/${normalizeRunwayLabel(rawPair[1])}`;
  }
  return `RWY ${index + 1}`;
}

type HourlyForecast = {
  forecastTodayHigh?: number | null;
  debPrediction?: number | null;
  localTime?: string | null;
  times: string[];
  temps: Array<number | null>;
  modelCurves?: Record<string, Array<number | null>>;
  runwayPlateHistory?: Record<string, Array<Record<string, unknown>>>;
  amos?: AmosData | null;
  airportCurrent?: AirportCurrentConditions | null;
  airportPrimary?: AirportCurrentConditions | null;
  forecastDaily?: ForecastDay[];
  multiModelDaily?: Record<string, DailyModelForecast>;
  settlementTodayObs?: ObsPoint[];
  metarTodayObs?: ObsPoint[];
  airportPrimaryTodayObs?: RawObsPoint[];
} | null;

function seedHourlyForecastFromRow(row: ScanOpportunityRow | null): HourlyForecast {
  if (!row) return null;
  return {
    forecastTodayHigh: null,
    debPrediction: validNumber(row.deb_prediction),
    localTime: row.local_time || null,
    times: [],
    temps: [],
    modelCurves: undefined,
    runwayPlateHistory: (row as any)?.runway_plate_history || undefined,
    amos: null,
    airportCurrent: null,
    airportPrimary: null,
    forecastDaily: [],
    multiModelDaily: {},
    settlementTodayObs: row.settlement_today_obs || row.metar_context?.settlement_today_obs || undefined,
    metarTodayObs: row.metar_today_obs || row.metar_context?.today_obs || row.metar_recent_obs || row.metar_context?.recent_obs || undefined,
    airportPrimaryTodayObs: undefined,
  };
}

async function fetchHourlyForecastForCity(city: string): Promise<HourlyForecast> {
  const cached = _hourlyCache.get(city);
  if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
    return cached.data;
  }

  const pending = _hourlyRequestCache.get(city);
  if (pending) return pending;

  const request = fetch(`/api/city/${encodeURIComponent(city)}/detail?depth=full&force_refresh=false`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) return null;
      return res.json() as Promise<CityDetail>;
    })
    .then((json) => {
      const hourlySource = (json as any)?.hourly ?? (json as any)?.timeseries?.hourly;
      if (!json || !hourlySource) return null;
      const data: HourlyForecast = {
        forecastTodayHigh: json.forecast?.today_high ?? null,
        debPrediction: json.deb?.prediction ?? (json as any)?.overview?.deb_prediction ?? null,
        localTime: json.local_time || null,
        times: hourlySource.times || [],
        temps: hourlySource.temps || [],
        modelCurves: (json.models_hourly ?? (json as any)?.timeseries?.models_hourly)?.curves || undefined,
        runwayPlateHistory: (json as any)?.runway_plate_history || (json.amos as any)?.runway_plate_history || undefined,
        amos: json.amos || null,
        airportCurrent: json.airport_current || null,
        airportPrimary: json.airport_primary || null,
        forecastDaily: json.forecast?.daily || [],
        multiModelDaily: json.multi_model_daily || {},
        settlementTodayObs: (json as any).timeseries?.settlement_today_obs || (json as any)?.settlement_today_obs || undefined,
        metarTodayObs: (json as any).timeseries?.metar_today_obs || (json as any)?.metar_today_obs || undefined,
        airportPrimaryTodayObs: (json as any)?.official?.airport_primary_today_obs || (json as any)?.airport_primary_today_obs || undefined,
      };
      _hourlyCache.set(city, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      _hourlyRequestCache.delete(city);
    });

  _hourlyRequestCache.set(city, request);
  return request;
}

function parseRunwayHistoryValue(point: Record<string, unknown>) {
  return validNumber(point.max_temp_c) ?? validNumber(point.temp_c) ?? validNumber(point.temp) ?? validNumber(point.value);
}

function parseRunwayHistoryTime(
  point: Record<string, unknown>,
  tzOffset: number,
  localDateStr: string,
) {
  return getCityLocalUtcTimestamp(
    (point.timestamp as string | number | null | undefined) ??
      (point.time as string | number | null | undefined) ??
      (point.observed_at as string | number | null | undefined),
    tzOffset,
    localDateStr,
  );
}

function buildRunwayHistorySeries(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  tzOffset: number,
  localDateStr: string,
): RunwayHistorySeries[] {
  const directHistory =
    hourly?.runwayPlateHistory ??
    ((hourly?.amos as any)?.runway_plate_history as Record<string, Array<Record<string, unknown>>> | undefined) ??
    ((row as any)?.runway_plate_history as Record<string, Array<Record<string, unknown>>> | undefined);

  if (directHistory && typeof directHistory === "object") {
    return Object.entries(directHistory)
      .map(([rwy, rawPoints], index) => {
        const normalizedRwy = String(rwy || `RWY ${index + 1}`).trim();
        const points = (Array.isArray(rawPoints) ? rawPoints : [])
          .map((point) => {
            const ts = parseRunwayHistoryTime(point, tzOffset, localDateStr);
            const value = parseRunwayHistoryValue(point);
            return ts !== null && value !== null ? { ts, value } : null;
          })
          .filter((point): point is { ts: number; value: number } => point !== null)
          .sort((a, b) => a.ts - b.ts)
          .slice(-MAX_OBS_POINTS);
        const isSettlement = isSettlementRunway(row, normalizedRwy);
        return {
          key: runwaySeriesKey(normalizedRwy),
          label: `${normalizedRwy}${isSettlement ? (row ? " 结算跑道" : " Settlement") : ""}`,
          rwy: normalizedRwy,
          isSettlement,
          color: isSettlement ? "#009688" : RUNWAY_LINE_COLORS[index % RUNWAY_LINE_COLORS.length],
          points,
        };
      })
      .filter((series) => series.points.length > 1);
  }

  const amos = hourly?.amos;
  const runwayObs = amos?.runway_obs;
  const runwayPairs = runwayObs?.runway_pairs || [];
  const runwayTemps = runwayObs?.temperatures || [];
  const pointTemps = runwayObs?.point_temperatures || [];
  const anchor =
    getCityLocalUtcTimestamp(amos?.observation_time_local || amos?.observation_time || hourly?.localTime || row?.local_time, tzOffset, localDateStr) ??
    getCityLocalUtcTimestamp(row?.local_time, tzOffset, localDateStr);

  if (!anchor || !Array.isArray(runwayTemps)) return [];

  return runwayTemps
    .map((rawTemps, index) => {
      if (!Array.isArray(rawTemps)) return null;
      const rwy = runwayLabelFromPair(runwayPairs[index], index);
      const isSettlement = isSettlementRunway(row, rwy);
      const pointTemp = Array.isArray(pointTemps) ? pointTemps[index] : null;
      const snapshotValues = [
        validNumber((pointTemp as any)?.tdz_temp),
        validNumber((pointTemp as any)?.mid_temp),
        validNumber((pointTemp as any)?.end_temp),
        validNumber((pointTemp as any)?.target_runway_max),
      ].filter((value): value is number => value !== null);
      const samples = rawTemps.map(validNumber).filter((value): value is number => value !== null);
      const valuesForLine = samples.length > 1
        ? samples
        : snapshotValues.length > 1
          ? snapshotValues
          : samples.length === 1
            ? [samples[0], samples[0]]
            : snapshotValues.length === 1
              ? [snapshotValues[0], snapshotValues[0]]
              : [];
      const values = valuesForLine
        .map((value, pointIndex) => {
          const minutesFromEnd = (valuesForLine.length - 1 - pointIndex) * FULL_DAY_SLOT_MINUTES;
          return {
            ts: anchor - minutesFromEnd * 60 * 1000,
            value,
          };
        })
        .filter((point) => validNumber(point.value) !== null);
      if (values.length <= 1) return null;
      return {
        key: runwaySeriesKey(rwy),
        label: `${rwy}${isSettlement ? " 结算跑道" : ""}`,
        rwy,
        isSettlement,
        color: isSettlement ? "#009688" : RUNWAY_LINE_COLORS[index % RUNWAY_LINE_COLORS.length],
        points: values.slice(-MAX_OBS_POINTS),
      };
    })
    .filter((series): series is RunwayHistorySeries => series !== null);
}

function generate3DaySlots(localDateStr: string): number[] {
  const parts = localDateStr.split("-");
  if (parts.length !== 3) return [];
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const slots: number[] = [];
  // Generate 72 hours starting from local date 00:00
  for (let h = 0; h < 72; h++) {
    slots.push(Date.UTC(year, month, day, h, 0));
  }
  return slots;
}

function format3DayTimestamp(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:00`;
}

function build3DayChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
): { data: Array<Record<string, string | number | null>>; series: EvidenceSeries[] } {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = row?.local_date || new Date().toISOString().slice(0, 10);

  const slots = generate3DaySlots(localDateStr);
  if (!slots.length) return { data: [], series: [] };
  const n = slots.length;

  const series: EvidenceSeries[] = [];
  const na = (): Array<number | null> => new Array(n).fill(null);

  // DEB forecast curve (from hourly.times & hourly.temps)
  if (hourly?.times?.length && hourly?.temps?.length) {
    const debVals = na();
    hourly.times.forEach((t, i) => {
      const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
      if (ts === null) return;
      const slotIdx = slots.findIndex((s) => s === ts);
      if (slotIdx >= 0) {
        debVals[slotIdx] = validNumber(hourly.temps[i]);
      }
    });
    if (debVals.some((v) => v !== null)) {
      series.push({
        key: "hourly_forecast",
        label: "DEB Forecast",
        source: "DEB Hourly",
        color: "#f97316",
        featured: true,
        smooth: true,
        values: debVals,
      });
    }

    // Per-model curves
    if (hourly.modelCurves) {
      const modelColors = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];
      Object.keys(hourly.modelCurves).forEach((model, idx) => {
        const modelTemps = hourly.modelCurves![model];
        if (!modelTemps?.length) return;
        const vals = na();
        hourly.times.forEach((t, i) => {
          const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
          if (ts === null) return;
          const slotIdx = slots.findIndex((s) => s === ts);
          if (slotIdx >= 0 && i < modelTemps.length) {
            vals[slotIdx] = validNumber(modelTemps[i]);
          }
        });
        if (vals.some((v) => v !== null)) {
          series.push({
            key: `model_curve_${model}`,
            label: model,
            source: "Multi-model hourly",
            color: modelColors[idx % modelColors.length],
            dashed: true,
            smooth: true,
            values: vals,
          });
        }
      });
    }
  }

  // Historical METAR observations (past timestamps of the 3 days)
  const metarObs = normObs(
    row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs,
    tzOffset
  );
  if (metarObs.length) {
    const mvals = binObservationsToSlots(slots, metarObs);
    if (mvals.some((v) => v !== null)) {
      series.push({
        key: "metar",
        label: "METAR",
        source: row?.airport || "METAR",
        color: "#0ea5e9",
        dashed: true,
        values: mvals,
      });
    }
  }

  // Build data rows
  const data = slots.map((ts, i) => {
    const point: Record<string, string | number | null> = {
      label: format3DayTimestamp(ts),
      ts,
    };
    series.forEach((s) => {
      point[s.key] = s.values[i] ?? null;
    });
    return point;
  });

  return { data, series };
}

function generateDailySlots(localDateStr: string, daysCount: number): string[] {
  const parts = localDateStr.split("-");
  if (parts.length !== 3) return [];
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const dates: string[] = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(Date.UTC(year, month, day + i));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

function formatDailyDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[2]}`;
}

function buildDailyChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  daysCount: number,
): { data: Array<Record<string, string | number | null>>; series: EvidenceSeries[] } {
  const localDateStr = row?.local_date || new Date().toISOString().slice(0, 10);
  const slots = generateDailySlots(localDateStr, daysCount);

  const series: EvidenceSeries[] = [
    {
      key: "deb_prediction",
      label: "DEB Daily Max",
      source: "DEB",
      color: "#f97316", // orange
      featured: true,
      values: [],
    },
    {
      key: "max_temp",
      label: "Model Daily Max",
      source: "Standard Forecast",
      color: "#dc2626", // red
      dashed: true,
      values: [],
    },
    {
      key: "min_temp",
      label: "Model Daily Min",
      source: "Standard Forecast",
      color: "#2563eb", // blue
      dashed: true,
      values: [],
    },
  ];

  const data = slots.map((dateStr) => {
    const dayForecast = hourly?.forecastDaily?.find((d) => d.date === dateStr);
    const dayMultiModel = hourly?.multiModelDaily?.[dateStr];

    const label = formatDailyDateLabel(dateStr);

    const debMax = validNumber(dayMultiModel?.deb?.prediction) ??
      (dateStr === localDateStr ? validNumber(hourly?.debPrediction) ?? validNumber(row?.deb_prediction) : null);
    const maxTemp = validNumber(dayForecast?.max_temp);
    const minTemp = validNumber(dayForecast?.min_temp);

    return {
      label,
      date: dateStr,
      deb_prediction: debMax,
      max_temp: maxTemp,
      min_temp: minTemp,
    };
  });

  // Populate series values
  series[0].values = data.map((d) => d.deb_prediction);
  series[1].values = data.map((d) => d.max_temp);
  series[2].values = data.map((d) => d.min_temp);

  // Filter out series that have no valid data points
  const activeSeries = series.filter((s) => s.values.some((v) => v !== null));

  return { data, series: activeSeries };
}

function buildFullDayChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
): { data: Array<Record<string, string | number | null>>; series: EvidenceSeries[] } {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = row?.local_date || new Date().toISOString().slice(0, 10);

  const settlementObs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset);
  const metarObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset);
  const madisObs = normObs(hourly?.airportPrimaryTodayObs, tzOffset);
  const runwayHistorySeries = buildRunwayHistorySeries(row, hourly, tzOffset, localDateStr);

  const slots = generateFullDaySlots(localDateStr);
  if (!slots.length) return { data: [], series: [] };
  const slotLabels = slots.map(formatTimestamp);
  const n = slots.length;

  const series: EvidenceSeries[] = [];
  const na = (): Array<number | null> => new Array(n).fill(null);

  // ── Runway history series ──
  runwayHistorySeries.forEach((rhs) => {
    const binned = binObservationsToSlots(slots, rhs.points);
    if (!binned.some((v) => v !== null)) return;
    series.push({
      key: rhs.key,
      label: rhs.label,
      source: "",
      color: rhs.color,
      featured: rhs.isSettlement,
      dashed: !rhs.isSettlement,
      values: binned,
    });
  });

  // ── Settlement observations ──
  if (settlementObs.length) {
    const svals = binObservationsToSlots(slots, settlementObs);
    if (svals.some((v) => v !== null)) {
      series.push({
        key: "settlement",
        label: row?.metar_context?.station_label || row?.metar_context?.station || "Settlement",
        source: row?.metar_context?.station || row?.airport || "Settlement",
        color: "#009688",
        featured: true,
        values: svals,
      });
    }
  }

  // ── METAR ──
  if (madisObs.length) {
    const madisVals = binObservationsToSlots(slots, madisObs);
    if (madisVals.some((v) => v !== null)) {
      series.push({
        key: "madis",
        label: hourly?.airportPrimary?.source_label || "NOAA MADIS",
        source: hourly?.airportPrimary?.station_code || row?.airport || "MADIS",
        color: "#0284c7",
        dashed: false,
        values: madisVals,
      });
    }
  }

  if (metarObs.length && !observationSetContains(madisObs, metarObs)) {
    const mvals = binObservationsToSlots(slots, metarObs);
    if (mvals.some((v) => v !== null)) {
      series.push({
        key: "metar",
        label: row?.metar_context?.station_label || "METAR",
        source: row?.airport || "METAR",
        color: "#0ea5e9",
        dashed: true,
        values: mvals,
      });
    }
  }

  // ── DEB forecast curve ──
  if (hourly?.times?.length && hourly?.temps?.length) {
    const debPath = buildDebBaselinePath(
      hourly.times,
      hourly.temps,
      validNumber(hourly?.debPrediction) ?? row?.deb_prediction,
      hourly.localTime || row?.local_time,
      hourly.forecastTodayHigh,
    );
    const debVals = na();
    hourly.times.forEach((t, i) => {
      const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
      if (ts === null) return;
      const slotIdx = slots.findIndex((s) => s === ts);
      if (slotIdx >= 0 && i < debPath.debTemps.length) {
        debVals[slotIdx] = validNumber(debPath.debTemps[i]);
      }
    });
    if (debVals.some((v) => v !== null)) {
      series.push({
        key: "hourly_forecast",
        label: "DEB Forecast",
        source: "DEB Hourly",
        color: "#f97316",
        featured: true,
        smooth: true,
        values: debVals,
      });
    }

    // Per-model curves
    if (hourly.modelCurves) {
      const modelColors = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];
      Object.keys(hourly.modelCurves).forEach((model, idx) => {
        const modelTemps = hourly.modelCurves![model];
        if (!modelTemps?.length) return;
        const vals = na();
        hourly.times.forEach((t, i) => {
          const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
          if (ts === null) return;
          const slotIdx = slots.findIndex((s) => s === ts);
          if (slotIdx >= 0 && i < modelTemps.length) vals[slotIdx] = validNumber(modelTemps[i]);
        });
        if (vals.some((v) => v !== null)) {
          series.push({
            key: `model_curve_${model}`,
            label: model,
            source: "Multi-model hourly",
            color: modelColors[idx % modelColors.length],
            dashed: true,
            smooth: true,
            values: vals,
          });
        }
      });
    }
  }

  // ── Fallback ──
  if (!series.length) {
    const fb = validNumber(row?.current_temp) ?? validNumber(hourly?.debPrediction) ?? validNumber(row?.deb_prediction) ?? validNumber(row?.target_threshold);
    if (fb !== null) {
      series.push({
        key: "current",
        label: "Current reference",
        source: row?.metar_context?.source || "Live",
        color: "#009688",
        featured: true,
        values: Array.from({ length: n }, () => fb),
      });
    }
  }

  // ── Build data rows ──
  const data = slots.map((ts, i) => {
    const point: Record<string, string | number | null> = {
      label: formatTimestamp(ts),
      ts,
    };
    series.forEach((s) => { point[s.key] = s.values[i] ?? null; });
    return point;
  });

  return { data, series };
}

// ── Model summary cards (daily high point predictions) ─────────────────

function buildModelSummaryCards(row: ScanOpportunityRow | null): EvidenceSeries[] {
  return Object.entries(row?.model_cluster_sources || {})
    .map(([label, value]) => [label, validNumber(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)
    .slice(0, 4)
    .map(([label, value], index) => ({
      key: `model_summary_${index}`,
      label,
      source: "Multi-model daily high",
      color: ["#2563eb", "#14b8a6", "#7c3aed", "#64748b"][index] || "#64748b",
      dashed: true,
      values: [value],
    }));
}

// ── Integer-degree ticks for Y-axis ──────────────────────────────────

function buildIntDegreeTicks(series: EvidenceSeries[], data?: Array<Record<string, string | number | null>>): number[] | null {
  const vals = data?.length
    ? data.flatMap((point) => series.map((s) => point[s.key])).filter((v): v is number => validNumber(v) !== null)
    : series.flatMap((s) => s.values).filter((v): v is number => validNumber(v) !== null);
  if (!vals.length) return null;
  const min = Math.floor(Math.min(...vals));
  const max = Math.ceil(Math.max(...vals));
  const ticks: number[] = [];
  for (let d = min; d <= max; d++) ticks.push(d);
  return ticks.length > 0 ? ticks : null;
}

function buildChartDomain(
  series: EvidenceSeries[],
  data?: Array<Record<string, string | number | null>>,
): [number, number] | ["auto", "auto"] {
  const vals = data?.length
    ? data.flatMap((point) => series.map((s) => point[s.key])).filter((v): v is number => validNumber(v) !== null)
    : series.flatMap((s) => s.values).filter((v): v is number => validNumber(v) !== null);
  if (!vals.length) return ["auto", "auto"];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const pad = Math.max(0.5, span * 0.08);
  return [Number((min - pad).toFixed(1)), Number((max + pad).toFixed(1))];
}

function generateFullDaySlots(localDateStr: string): number[] {
  const parts = localDateStr.split("-");
  if (parts.length !== 3) return [];
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const slots: number[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += FULL_DAY_SLOT_MINUTES) {
      slots.push(Date.UTC(year, month, day, h, m));
    }
  }
  return slots;
}

function binObservationsToSlots(
  slots: number[],
  obs: Array<{ ts: number; value: number }>,
): Array<number | null> {
  const result: Array<number | null> = new Array(slots.length).fill(null);
  for (const point of obs) {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (point.ts >= slots[i]) {
        result[i] = point.value;
        break;
      }
    }
  }
  return result;
}

// ── Main component ─────────────────────────────────────────────────────

export function LiveTemperatureThresholdChart({
  isEn,
  row,
  allRows = [],
  compact = false,
  onSearchClick,
  onMaximize,
  onClose,
  isMaximized = false,
  disableClose = false,
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
  allRows?: ScanOpportunityRow[];
  compact?: boolean;
  onSearchClick?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  disableClose?: boolean;
}) {
  const [hourly, setHourly] = useState<HourlyForecast>(null);
  const city = String(row?.city || "").toLowerCase().trim();
  const [timeframe, setTimeframe] = useState<"1D" | "3D">("1D");
  const [userToggledKeys, setUserToggledKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setUserToggledKeys({});
  }, [city, timeframe]);

  useEffect(() => {
    if (!city) return;
    const cached = _hourlyCache.get(city);
    if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
      setHourly(cached.data);
      return;
    }
    setHourly(seedHourlyForecastFromRow(row));
    let cancelled = false;
    fetchHourlyForecastForCity(city)
      .then((data) => {
        if (cancelled || !data) return;
        setHourly(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [city, row]);

  const { data, series } = useMemo(() => {
    if (timeframe === "3D") {
      return build3DayChartData(row, hourly);
    }
    return buildFullDayChartData(row, hourly);
  }, [row, hourly, timeframe]);

  const tzOffset = row?.tz_offset_seconds ?? 0;
  const settlementObs = useMemo(() => {
    let obs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset);
    if (!obs.length && !hourly?.runwayPlateHistory) {
      const mObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs, tzOffset);
      if (mObs.length > 0) {
        obs = mObs;
      }
    }
    return obs;
  }, [row, hourly, tzOffset]);

  const runwayPlates = useMemo(() => buildRunwayPlates(hourly?.amos, row, settlementObs), [hourly?.amos, row, settlementObs]);
  const hasRunwayData = runwayPlates.length > 0;
  const settlementPlate = useMemo(() => runwayPlates.find((p) => p.isSettlement), [runwayPlates]);

  const chartSeries = useMemo(() => {
    return series;
  }, [series]);

  const isSeriesVisible = (sKey: string) => {
    if (userToggledKeys[sKey] !== undefined) {
      return userToggledKeys[sKey];
    }
    return isTemperatureSeriesVisibleByDefault(city, sKey);
  };

  const activeSeries = useMemo(() => {
    return getVisibleTemperatureSeries(city, chartSeries, userToggledKeys);
  }, [chartSeries, userToggledKeys, city]);

  const cityKey = String(row?.city || "").toLowerCase().trim();
  const runwaySensorCities = new Set([
    'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'qingdao',
    'chengdu', 'chongqing', 'wuhan', // AMSC runway sensors
    'seoul', 'busan',                 // AMOS runway sensors
  ]);
  const isHKO = cityKey === 'hong kong' || cityKey === 'lau fau shan' || cityKey.includes('hongkong') || cityKey.includes('laufau');
  const isTokyo = cityKey === 'tokyo';
  const isSingapore = cityKey === 'singapore';
  const isParis = cityKey === 'paris';
  const isWeatherStation = !runwaySensorCities.has(cityKey)
    && !isHKO && !isTokyo && !isSingapore && !isParis;

  const runwayHeaderLabel = isHKO ? '参考站点 (1分钟)'
    : isTokyo ? '机场气象站 (10分钟)'
    : isSingapore ? '航站楼温度'
    : isParis ? '官方机场观测 (15分钟)'
    : isWeatherStation ? '气象站实测'
    : '跑道实测 (1分钟)';

  const metarHeaderLabel = isHKO ? '天文台实测 (10分钟)'
    : 'METAR 结算 (30分钟)';

  const runwayHighLabel = isHKO ? '参考站点'
    : isTokyo ? '机场气象站'
    : isSingapore ? '航站楼'
    : isParis ? '官方机场观测'
    : isWeatherStation ? '气象站'
    : '跑道实测';

  const metarHighLabel = isHKO ? '天文台'
    : 'METAR 官方';

  const { currentRunwayTemp, observedHighMetar, observedHighRunway } = useMemo(
    () => getObservationDisplayMetrics(row, hourly, settlementPlate),
    [row, hourly, settlementPlate],
  );
  const wundergroundDailyHigh = validNumber(hourly?.airportCurrent?.max_so_far ?? hourly?.airportPrimary?.max_so_far) ?? null;

  const modelValues = Object.values(row?.model_cluster_sources || {})
    .map(validNumber)
    .filter((v): v is number => v !== null);
  const modelMin = modelValues.length ? Math.min(...modelValues) : (row?.cluster_core_low ?? null);
  const modelMax = modelValues.length ? Math.max(...modelValues) : (row?.cluster_core_high ?? null);
  const debVal = validNumber(hourly?.debPrediction) ?? validNumber(row?.deb_prediction) ?? null;

  const spread = (modelMax !== null && modelMin !== null) ? modelMax - modelMin : null;
  const spreadLabel = spread === null ? "" : (spread <= 2.0 ? "低分歧" : (spread <= 4.0 ? "中等分歧" : "高分歧"));
  const spreadLabelEn = spread === null ? "" : (spread <= 2.0 ? "Low" : (spread <= 4.0 ? "Medium" : "High"));

  const formattedUpdateTime = useMemo(() => {
    if (row?.local_date && row?.local_time) {
      return `${row.local_date} ${row.local_time.slice(0, 8)}`;
    }
    const d = new Date();
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }, [row]);

  const cityThresholds = useMemo(() => {
    if (!row || !allRows || !allRows.length) return [];
    const cityKey = String(row.city || "").toLowerCase().trim();
    const sameCityRows = allRows.filter(
      (r) => String(r.city || "").toLowerCase().trim() === cityKey
    );

    const seen = new Set<number>();
    const list: { threshold: number; label: string; isBreached: boolean; kind: "gte" | "lte" }[] = [];
    sameCityRows.forEach((r) => {
      const t = Number(r.target_threshold ?? r.target_value ?? r.target_lower ?? r.target_upper);
      if (!Number.isFinite(t) || seen.has(t)) return;
      seen.add(t);

      const maxTemp = Number(r.current_max_so_far ?? r.current_temp ?? 0);
      const q = String(r.market_question || r.target_label || "").toLowerCase();
      const kind: "gte" | "lte" = q.includes("below") || q.includes("under") || q.includes("lte") ? "lte" : "gte";
      const isBreached = kind === "lte" ? maxTemp > t : maxTemp >= t;

      list.push({
        threshold: t,
        label: r.target_label || `${t}°C`,
        isBreached,
        kind,
      });
    });

    return list.sort((a, b) => a.threshold - b.threshold);
  }, [row, allRows]);

  const intDegreeTicks = useMemo(() => buildIntDegreeTicks(activeSeries, data), [activeSeries, data]);
  const chartDomain = useMemo(
    () => buildChartDomain(activeSeries, data),
    [activeSeries, data],
  );

  const subtitle = row
    ? isEn
      ? timeframe === "1D"
        ? "Live & Forecast"
        : `${timeframe} Forecast`
      : timeframe === "1D"
      ? "实测与预测"
      : `${timeframe}预报`
    : "";

  const panelTitle = row ? (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onSearchClick}
        className={clsx(
          "flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left transition-colors font-bold text-slate-800 outline-none select-none",
          onSearchClick ? "hover:bg-slate-200/80 cursor-pointer" : ""
        )}
      >
        <span>{rowName(row)}</span>
        {onSearchClick && <span className="text-[8px] text-slate-400">▼</span>}
      </button>
      <span className="text-slate-400 font-normal">·</span>
      <span className="text-slate-500 font-normal">{subtitle}</span>
    </div>
  ) : isEn ? (
    "Temperature Chart"
  ) : (
    "气温图表"
  );

  const timeframeActions = (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 rounded bg-[#eef2f6] p-0.5 border border-slate-200">
        {(["1D", "3D"] as const).map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={clsx(
              "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
              timeframe === tf
                ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      {(onMaximize || onClose) && (
        <div className="flex items-center gap-1">
          {onMaximize && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              className="grid h-6 w-6 place-items-center rounded bg-white hover:bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800 transition-colors shadow-sm"
              title={isMaximized ? (isEn ? "Restore Grid" : "还原网格") : (isEn ? "Maximize" : "最大化")}
            >
              {isMaximized ? "❐" : "⛶"}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              disabled={disableClose}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className={clsx(
                "grid h-6 w-6 place-items-center rounded border transition-colors shadow-sm",
                disableClose
                  ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed"
                  : "bg-white hover:bg-slate-50 border-slate-200 text-slate-500 hover:text-red-600"
              )}
              title={isEn ? "Clear Slot" : "清除槽位"}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Panel title={panelTitle} actions={timeframeActions}>
      <div className="flex h-full min-h-[300px] flex-col">
        {/* Compact stats bar */}
        {compact ? (
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between">
            {timeframe === "1D" ? (
              <div className="flex items-center gap-4 text-[11px]">
                <span className="font-semibold text-slate-500">
                  {isEn ? "Runway" : runwayHeaderLabel}:{" "}
                  <strong className="text-[#009688] font-mono">{temp(currentRunwayTemp)}</strong>
                </span>
                <span className="text-slate-300">|</span>
                <span className="font-semibold text-slate-500">
                  {isEn ? "METAR" : metarHeaderLabel}:{" "}
                  <strong className="text-blue-600 font-mono">{temp(observedHighMetar)}</strong>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-4 text-[11px]">
                <span className="font-semibold text-slate-500">
                  DEB: <strong className="text-orange-600 font-mono">{temp(debVal)}</strong>
                </span>
                {modelMin !== null && modelMax !== null && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="font-semibold text-slate-500">
                      {isEn ? "Models" : "多模型"}:{" "}
                      <strong className="text-slate-700 font-mono">
                        {temp(modelMin)} - {temp(modelMax)}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="text-[10px] text-slate-400 font-mono">
              {timeframe === "1D" && formattedUpdateTime.includes(" ") ? formattedUpdateTime.split(" ")[1].slice(0, 5) : ""}
            </div>
          </div>
        ) : (
          /* Normal detailed stats bar */
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
            {/* Top Row: Large temperatures */}
            <div className="flex justify-between items-center gap-6 mb-3">
              {timeframe === "1D" ? (
                <div className="flex items-center gap-12">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "Runway Live (1m)" : `${runwayHeaderLabel}`}
                    </span>
                    <span className="text-2xl font-bold font-mono text-[#009688] mt-1">
                      {temp(currentRunwayTemp)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "METAR Settlement (30m) · Daily High" : `${metarHeaderLabel} · 当日最高`}
                    </span>
                    <span className="text-2xl font-bold font-mono text-blue-600 mt-1">
                      {temp(observedHighMetar)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-12">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      DEB Max
                    </span>
                    <span className="text-2xl font-bold font-mono text-orange-600 mt-1">
                      {temp(debVal)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "Model Range" : "多模型区间"}
                    </span>
                    <span className="text-2xl font-bold font-mono text-slate-700 mt-1">
                      {modelMin !== null && modelMax !== null ? `${temp(modelMin)} - ${temp(modelMax)}` : "--"}
                    </span>
                  </div>
                </div>
              )}
              
              <div className="hidden sm:flex flex-col items-end text-right">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  {isEn ? "Daily Peak" : "当日最高气温"}
                </span>
                <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-600">
                  <span>{isEn ? "Runway" : runwayHighLabel}: <strong className="text-[#009688]">{temp(observedHighRunway)}</strong></span>
                  <span>|</span>
                  <span>{isEn ? "METAR" : metarHighLabel}: <strong className="text-blue-600">{temp(observedHighMetar)}</strong></span>
                  {wundergroundDailyHigh !== null && (
                    <>
                      <span>|</span>
                      <span>WU: <strong className="text-purple-600">{temp(wundergroundDailyHigh)}</strong></span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Row: Model Range Panel (Only for 1D mode) */}
            {timeframe === "1D" && (
              <div className="grid grid-cols-4 gap-4 border-t border-slate-100 pt-3 text-xs font-mono text-slate-700 bg-slate-50/50 -mx-4 px-4 rounded-b-md">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">
                    {isEn ? "Model Range" : "模型区间"}
                  </span>
                  <strong className="text-slate-800 font-bold">
                    {modelMin !== null && modelMax !== null ? `${temp(modelMin)} - ${temp(modelMax)}` : "--"}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">
                    DEB
                  </span>
                  <strong className="text-blue-600 font-bold">
                    {temp(debVal)}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">
                    {isEn ? "Spread" : "分歧"}
                  </span>
                  <strong className={clsx("font-bold", spreadLabel === "高分歧" ? "text-amber-600" : "text-slate-600")}>
                    {spread !== null ? `${spread.toFixed(1)}°C` : "--"}
                    {spreadLabel && ` · ${isEn ? spreadLabelEn : spreadLabel}`}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">
                    {isEn ? "Updated" : "更新时间"}
                  </span>
                  <strong className="text-slate-800 font-bold">
                    {formattedUpdateTime}
                  </strong>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Runway observations (Only for 1D mode and when not compact) */}
        {timeframe === "1D" && !compact && runwayPlates.length > 0 && (
          <div className="shrink-0 border-b border-slate-200 bg-[#f8fafc] px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-black text-slate-700 mb-1.5 uppercase">
              <span>{isEn ? "Runway Observations" : "跑道观测"}</span>
              {runwayPlates.some((p) => p.trend_15m !== null && p.trend_15m > 0 && !p.isSettlement) && (
                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-sans">
                  {isEn ? "Non-settlement Runway Warming Alert" : "非结算跑道升温提醒"}
                </span>
              )}
            </div>
            <div className="grid gap-1">
              {runwayPlates.map((plate) => (
                <div
                  key={plate.rwy}
                  className={clsx(
                    "grid grid-cols-7 gap-2 items-center border rounded px-2.5 py-1 text-[11px] font-mono",
                    plate.isSettlement
                      ? "border-emerald-200 bg-emerald-50/50 text-emerald-950 font-bold"
                      : "border-slate-200 bg-white text-slate-600"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-sans font-bold text-slate-800">
                    {plate.isSettlement && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />}
                    <span>{plate.rwy}</span>
                    {plate.isSettlement && (
                      <span className="text-[9px] bg-teal-200 text-teal-800 px-1 rounded font-normal">
                        {isEn ? "Settlement" : "结算"}
                      </span>
                    )}
                  </div>
                  <div>TDZ: <strong>{plate.tdzTemp !== null ? `${plate.tdzTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>MID: <strong>{plate.midTemp !== null ? `${plate.midTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>END: <strong>{plate.endTemp !== null ? `${plate.endTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>max: <strong>{plate.maxTemp !== null ? `${plate.maxTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>high: <strong>{plate.dailyHigh !== null ? `${plate.dailyHigh.toFixed(1)}°C` : "--"}</strong></div>
                  <div className={clsx(plate.trend_15m !== null && plate.trend_15m > 0 ? "text-orange-600 font-bold" : "text-slate-500")}>
                    15m: <strong>{plate.trend_15m !== null ? `${plate.trend_15m >= 0 ? "+" : ""}${plate.trend_15m.toFixed(1)}°C` : "--"}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multi-model list (Only in 1D mode and when not compact) */}
        {timeframe === "1D" && !compact && hasRunwayData && activeSeries.some((s) => s.key.startsWith("model_curve_")) && (
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
              <span className="font-black text-slate-500 uppercase mr-2">
                {isEn ? "Models:" : "多模型:"}
              </span>
              {activeSeries
                .filter((s) => s.key.startsWith("model_curve_"))
                .map((s) => {
                  const stats = seriesStats(s.values);
                  return (
                    <span key={s.key} className="inline-flex items-center gap-1.5 font-mono">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-slate-700 font-bold">{s.label}</span>
                      <span className="text-slate-500">{temp(stats.latest)}</span>
                    </span>
                  );
                })}
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="relative min-h-0 flex-1 p-2">
          {/* Interactive legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 text-[11px] border-b border-[#e2e8f0] bg-white">
            {chartSeries.length > 1 && chartSeries.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setUserToggledKeys((prev) => ({
                    ...prev,
                    [s.key]: !isSeriesVisible(s.key),
                  }));
                }}
                className={clsx(
                  "inline-flex items-center gap-1.5 font-mono cursor-pointer transition-opacity hover:opacity-80",
                  !isSeriesVisible(s.key) && "opacity-40 line-through"
                )}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-slate-700 font-bold">{s.label}</span>
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={data} margin={{ top: 16, right: compact ? 20 : 44, left: 4, bottom: 8 }}>
              <CartesianGrid stroke="#dbe6ef" strokeDasharray="2 2" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "#64748b" }}
                tickLine={false}
                axisLine={{ stroke: "#cbd5e1" }}
                interval={Math.max(1, Math.floor(data.length / (compact ? 6 : 10)))}
              />
              <YAxis
                orientation="right"
                tick={{ fontSize: 9, fill: "#64748b" }}
                tickFormatter={(v) => `${Number(v).toFixed(0)}°`}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                domain={chartDomain}
                ticks={intDegreeTicks ?? undefined}
              />
              {timeframe === "1D" && cityThresholds.map((t, idx) => {
                const isSelected = row && (Number(row.target_threshold ?? row.target_value) === t.threshold);
                const labelText = isEn
                  ? `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}° [${t.isBreached ? "Excluded" : "Active"}]`
                  : `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}° [${t.isBreached ? "已排除" : "活跃"}]`;

                return (
                  <ReferenceLine
                    key={idx}
                    y={t.threshold}
                    stroke={isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316"}
                    strokeDasharray={isSelected ? undefined : "4 4"}
                    strokeWidth={isSelected ? 2 : 1}
                    label={{
                      value: compact ? undefined : labelText,
                      fill: isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316",
                      fontSize: 9,
                      position: isSelected ? "left" : "insideBottomRight",
                    }}
                  />
                );
              })}
              <Tooltip
                contentStyle={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  fontSize: 11,
                  boxShadow: "0 8px 24px rgba(15,23,42,.12)",
                }}
                formatter={(value: unknown) => `${Number(value).toFixed(2)}°`}
              />
              {activeSeries.map((item) => (
                <Line
                  key={item.key}
                  type={item.smooth ? "monotone" : "linear"}
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={item.featured ? 2.8 : 1.2}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  activeDot={{ r: item.featured ? 6 : 4 }}
                  connectNulls={true}
                  isAnimationActive={false}
                />
              ))}
              {!compact && (timeframe === "1D" || timeframe === "3D") && (
                <Brush
                  dataKey="label"
                  height={18}
                  stroke="#64748b"
                  fill="#f8fafc"
                  travellerWidth={8}
                  startIndex={0}
                  endIndex={data.length - 1}
                />
              )}
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}

export function __buildTemperatureChartDataForTest(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  timeframe: "1D" | "3D" = "1D",
) {
  return timeframe === "3D" ? build3DayChartData(row, hourly) : buildFullDayChartData(row, hourly);
}

export const __isTemperatureSeriesVisibleByDefaultForTest = isTemperatureSeriesVisibleByDefault;
export const __getVisibleTemperatureSeriesForTest = getVisibleTemperatureSeries;
export const __getObservationDisplayMetricsForTest = getObservationDisplayMetrics;
