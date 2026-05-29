import type {
  AmosData,
  AirportCurrentConditions,
  CityDetail,
  ScanOpportunityRow,
  ForecastDay,
  DailyModelForecast,
  DebHourlyPath,
  ProbabilityBucket,
} from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import { DASHBOARD_REFRESH_POLICY_MS } from "@/lib/refresh-policy";
import type { CityPatch } from "@/hooks/use-sse-patches";
const ROLLING_WINDOW_BEFORE_MS = 12 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_LIVE_MS = 2 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_FORECAST_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SETTLEMENT_RUNWAY_PAIRS: Record<string, Array<[string, string]>> = {
  shanghai: [["17L", "35R"]],
  beijing: [["19", "01"]],
  guangzhou: [["02L", "20R"]],
  chengdu: [["02L", "20R"]],
  chongqing: [["20R", "02L"]],
  wuhan: [["04", "22"]],
  qingdao: [["16", "34"]],
  seoul: [["15R", "33L"]],
  busan: [["SR", "SL"]],
};

const SETTLEMENT_RUNWAY_TARGETS: Record<string, string> = {
  shanghai: "35R",
  beijing: "01",
  guangzhou: "02L",
  chengdu: "02L",
  chongqing: "02L",
  wuhan: "04",
  qingdao: "34",
};

function normalizeRunwayLabel(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCityKey(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function hasRecordEntries(value: unknown) {
  return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);
}

function pairKey(pair: [string, string]) {
  return pair.map(normalizeRunwayLabel).sort().join("/");
}

function settlementEndpointTempForPair(
  cityKey: string,
  pair: [string, string],
  tdz: number | null,
  end: number | null,
) {
  const target = normalizeRunwayLabel(SETTLEMENT_RUNWAY_TARGETS[cityKey]);
  if (!target) return null;
  const first = normalizeRunwayLabel(pair[0]);
  const second = normalizeRunwayLabel(pair[1]);
  if (target === first) return tdz ?? end;
  if (target === second) return end ?? tdz;
  return null;
}

function runwaySeriesKey(rwy: string) {
  return `runway_${String(rwy || "unknown")
    .split("/")
    .map(normalizeRunwayLabel)
    .filter(Boolean)
    .join("_")}`;
}

function runwaySeriesLabel(rwy: string, isSettlement: boolean, isEn: boolean) {
  if (!isSettlement) return rwy;
  return `${rwy} ${isEn ? "Settlement Runway" : "结算跑道"}`;
}

function isTemperatureSeriesVisibleByDefault(city: string, seriesKey: string) {
  if (seriesKey.startsWith("model_curve_")) {
    return normalizeCityKey(city) === "paris" && seriesKey === "model_curve_AROME HD";
  }
  return true;
}

function prefersHighFrequencyRunwayResolution(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
) {
  const cityKey = normalizeCityKey(row?.city);
  if ((SETTLEMENT_RUNWAY_PAIRS[cityKey] || []).length > 0) return true;
  if (hasRecordEntries((row as any)?.runway_plate_history)) return true;
  if (hasRecordEntries(hourly?.runwayPlateHistory)) return true;
  if ((hourly?.runwayBandHistory || []).length > 0) return true;
  if (((hourly?.amos?.runway_obs as any)?.runway_pairs || []).length > 0) return true;
  return false;
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

function getActiveTemperatureSeries(
  city: string,
  chartSeries: EvidenceSeries[],
  userToggledKeys: Record<string, boolean>,
  showRunwayDetails: boolean,
) {
  const rawVisible = getVisibleTemperatureSeries(city, chartSeries, userToggledKeys);
  const hasRunwayMax = rawVisible.some((item) => item.key === "runway_max");

  return rawVisible.filter((item) => {
    const isIndividualRunway =
      item.key.startsWith("runway_") && item.key !== "runway_max";
    if (showRunwayDetails) {
      return item.key !== "runway_max";
    }
    if (!hasRunwayMax) {
      return true;
    }
    return !isIndividualRunway;
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
    
    const pointTemp = pointTemps[index] as any;
    const tdz = validNumber(pointTemp?.tdz_temp);
    const mid = validNumber(pointTemp?.mid_temp);
    const end = validNumber(pointTemp?.end_temp);
    const endpointTemp = isSettlement
      ? settlementEndpointTempForPair(cityKey, pair, tdz, end)
      : null;
    const aggregateRunwayTemp =
      endpointTemp ??
      validNumber(pointTemp?.temp) ??
      validNumber(pointTemp?.target_runway_max);
    const isAmosTempDewTuple = String(amos.source || "").toLowerCase() === "amos";
    
    const historyVals = !isAmosTempDewTuple && Array.isArray(runwayTemps[index])
      ? (runwayTemps[index] as Array<number | null>).map(validNumber).filter((v): v is number => v !== null)
      : [];

    const aggregateVal = aggregateRunwayTemp !== null ? [aggregateRunwayTemp] : [];
    const tdzVal = tdz !== null ? [tdz] : [];
    const midVal = mid !== null ? [mid] : [];
    const endVal = end !== null ? [end] : [];
    const allVals = isSettlement && endpointTemp !== null
      ? [...historyVals, endpointTemp]
      : [...historyVals, ...aggregateVal, ...tdzVal, ...midVal, ...endVal];
    
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

type LegacyGaussianProbabilitySource = {
  mu?: number | null;
  engine?: string | null;
  calibration_mode?: string | null;
  distribution?: ProbabilityBucket[];
  distribution_all?: ProbabilityBucket[];
};

type ProbabilityTemperatureBand = {
  key: string;
  value: number;
  lower: number;
  upper: number;
  probability: number;
  label: string;
  opacity: number;
};

type ProbabilityMuLine = {
  value: number;
  label: string;
};

type ProbabilityOverlay = {
  engine: string | null;
  muLine: ProbabilityMuLine | null;
  bands: ProbabilityTemperatureBand[];
};

type PeakGlowState = "none" | "watch" | "near_peak" | "breakout" | "cooling";

type PeakGlowMeta = {
  state: PeakGlowState;
  currentTemp: number | null;
  referenceHigh: number | null;
  distanceToHigh: number | null;
  trend30m: number | null;
  trend60m: number | null;
  observedHigh: number | null;
};

type RunwayHistorySeries = {
  key: string;
  label: string;
  rwy: string;
  isSettlement: boolean;
  color: string;
  points: Array<{ ts: number; value: number }>;
};

type TemperatureBandPoint = { ts: number; high: number; low: number; avg: number };
type LocalDayBounds = { start: number; end: number };

const MAX_OBS_POINTS = 1440;
const HOURLY_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.metar;
const _hourlyCache = new Map<string, { ts: number; data: HourlyForecast }>();
const _hourlyRequestCache = new Map<string, Promise<HourlyForecast>>();
const MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS = 3;
let _hourlyActiveDetailRequests = 0;
const _hourlyDetailRequestQueue: Array<() => void> = [];
const RUNWAY_LINE_COLORS = ["#00897b", "#d97706", "#7c3aed", "#0891b2", "#ea580c", "#64748b"];

const SESSION_CACHE_PREFIX = "polyweather_city_detail_v1:";
const SESSION_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.metar;

function readSessionCache(city: string): { ts: number; data: HourlyForecast } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_CACHE_PREFIX}${city}`);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (item && item.ts && Date.now() - item.ts < SESSION_CACHE_TTL_MS) {
      return item;
    }
  } catch {}
  return null;
}

function writeSessionCache(city: string, data: HourlyForecast) {
  if (typeof window === "undefined" || !data) return;
  try {
    sessionStorage.setItem(
      `${SESSION_CACHE_PREFIX}${city}`,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {}
}

function drainHourlyDetailRequestQueue() {
  while (
    _hourlyActiveDetailRequests < MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS &&
    _hourlyDetailRequestQueue.length > 0
  ) {
    const start = _hourlyDetailRequestQueue.shift();
    if (start) start();
  }
}

function runQueuedHourlyDetailRequest<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      _hourlyActiveDetailRequests += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          _hourlyActiveDetailRequests = Math.max(0, _hourlyActiveDetailRequests - 1);
          drainHourlyDetailRequestQueue();
        });
    };

    _hourlyDetailRequestQueue.push(start);
    drainHourlyDetailRequestQueue();
  });
}

export function clearCityDetailCache() {
  _hourlyCache.clear();
  _hourlyRequestCache.clear();
  if (typeof window !== "undefined") {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(SESSION_CACHE_PREFIX)) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {}
  }
}

function __resetHourlyDetailRequestQueueForTest() {
  _hourlyActiveDetailRequests = 0;
  _hourlyDetailRequestQueue.length = 0;
}

const __runQueuedHourlyDetailRequestForTest = runQueuedHourlyDetailRequest;

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
      d.getUTCMinutes(),
      d.getUTCSeconds()
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
        localDate.getUTCMinutes(),
        localDate.getUTCSeconds()
      );
    }
  }

  const m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const h = +m[1];
    const min = +m[2];
    const sec = m[3] ? +m[3] : 0;
    
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
    
    return Date.UTC(year, month, date, h, min, sec);
  }

  return null;
}

function getLocalDayBounds(localDateStr: string): LocalDayBounds | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDateStr);
  if (!match) return null;
  const start = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
  );
  return Number.isFinite(start) ? { start, end: start + DAY_MS } : null;
}

function dateFromLocalTime(value?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function resolveChartLocalDate(row: ScanOpportunityRow | null, hourly: HourlyForecast) {
  return (
    hourly?.localDate ||
    dateFromLocalTime(hourly?.localTime) ||
    row?.local_date ||
    dateFromLocalTime(row?.local_time) ||
    new Date().toISOString().slice(0, 10)
  );
}

function isWithinLocalDay(ts: number | null, bounds: LocalDayBounds | null) {
  return ts !== null && Number.isFinite(ts) && (!bounds || (ts >= bounds.start && ts < bounds.end));
}

function filterTimelinePointsToLocalDay<T extends { ts: number }>(
  points: T[],
  bounds: LocalDayBounds | null,
) {
  if (!bounds) return points;
  return points.filter((point) => isWithinLocalDay(point.ts, bounds));
}

function filterRunwayHistoryToLocalDay(
  series: RunwayHistorySeries[],
  bounds: LocalDayBounds | null,
) {
  if (!bounds) return series;
  return series
    .map((item) => ({
      ...item,
      points: filterTimelinePointsToLocalDay(item.points, bounds),
    }))
    .filter((item) => item.points.length > 1);
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

function normalizeRawObsPoint(point: RawObsPoint): ObsPoint | null {
  if (Array.isArray(point)) {
    return { time: point[0] == null ? null : String(point[0]), temp: validNumber(point[1]) };
  }
  return point;
}

function normObs(
  points: RawObsPoint[] | null | undefined,
  tzOffsetSeconds: number,
  limit = MAX_OBS_POINTS,
  referenceLocalDate?: string | null,
) {
  return (points || [])
    .map(normalizeRawObsPoint)
    .filter((p): p is ObsPoint => p !== null)
    .filter((p) => validNumber(p.temp) !== null && p.time)
    .map((p) => {
      const ts = getCityLocalUtcTimestamp(p.time, tzOffsetSeconds, referenceLocalDate);
      return ts === null ? null : { ts, value: Number(p.temp) };
    })
    .filter((p): p is { ts: number; value: number } => p !== null)
    .slice(-limit);
}

function appendLatestAirportObservation(
  points: RawObsPoint[] | null | undefined,
  ...currentSources: Array<AirportCurrentConditions | null | undefined>
): RawObsPoint[] {
  const merged = [...(points || [])];
  const seen = new Set(
    merged
      .map(normalizeRawObsPoint)
      .filter((point): point is ObsPoint => point !== null)
      .map((point) => `${String(point.time || "")}:${validNumber(point.temp) ?? ""}`),
  );

  currentSources.forEach((source) => {
    const temp = validNumber(source?.temp);
    const time =
      (source as any)?.obs_time ??
      (source as any)?.observation_time ??
      (source as any)?.timestamp ??
      (source as any)?.time ??
      null;
    if (temp === null || !time) return;
    const key = `${String(time)}:${temp}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ time: String(time), temp });
  });

  return merged;
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

function getRunwayHistoryObservationMetrics(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
) {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = resolveChartLocalDate(row, hourly);
  const localDayBounds = getLocalDayBounds(localDateStr);
  const runwayHistorySeries = buildRunwayHistorySeries(row, hourly, tzOffset, localDateStr, 1)
    .map((item) => ({
      ...item,
      points: filterTimelinePointsToLocalDay(item.points, localDayBounds),
    }))
    .filter((item) => item.points.length > 0);

  const settlementSeries = runwayHistorySeries.filter((item) => item.isSettlement);
  const candidateSeries = settlementSeries.length ? settlementSeries : runwayHistorySeries;
  const points = candidateSeries.flatMap((item) => item.points);
  if (!points.length) return { latest: null, high: null };

  const latestTs = Math.max(...points.map((point) => point.ts));
  const latestValues = points
    .filter((point) => point.ts === latestTs)
    .map((point) => point.value);
  return {
    latest: latestValues.length ? Math.max(...latestValues) : null,
    high: Math.max(...points.map((point) => point.value)),
  };
}

function hasRenderableLineSeries(series: EvidenceSeries[]) {
  return series.some(
    (item) => item.values.filter((value) => validNumber(value) !== null).length >= 2,
  );
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
  const localDateStr = resolveChartLocalDate(row, hourly);
  const settlementObs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset, MAX_OBS_POINTS, localDateStr);
  const metarObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset, MAX_OBS_POINTS, localDateStr);
  const madisObs = normObs(
    appendLatestAirportObservation(hourly?.airportPrimaryTodayObs, hourly?.airportPrimary, hourly?.airportCurrent),
    tzOffset,
    MAX_OBS_POINTS,
    localDateStr,
  );
  const latestSettlement = latestObservationValue(settlementObs);
  const latestMetar = latestObservationValue(metarObs);
  const latestMadis = latestObservationValue(madisObs);
  const highSettlement = maxObservationValue(settlementObs);
  const highMetar = maxObservationValue(metarObs);
  const highMadis = maxObservationValue(madisObs);
  const airportCurrentTemp = validNumber(hourly?.airportCurrent?.temp) ?? validNumber(hourly?.airportPrimary?.temp);
  const airportHigh = validNumber(hourly?.airportCurrent?.max_so_far) ?? validNumber(hourly?.airportPrimary?.max_so_far);
  const rowMetarHigh = validNumber(row?.metar_context?.airport_max_so_far ?? row?.metar_context?.max_temp ?? row?.current_max_so_far);
  const runwayHistoryMetrics = getRunwayHistoryObservationMetrics(row, hourly);

  const settlementCityKey = normalizeCityKey(row?.city);
  const isShenzhen = settlementCityKey === 'shenzhen';
  const isHKO = (settlementCityKey === 'hongkong' || settlementCityKey === 'laufaushan'
    || (row?.city || '').toLowerCase().includes('hong kong')
    || (row?.city || '').toLowerCase().includes('lau fau shan')) && !isShenzhen;

  let currentRunwayTemp: number | null = null;
  let observedHighRunway: number | null = null;

  if (isHKO) {
    currentRunwayTemp =
      latestMadis ??
      latestSettlement ??
      latestMetar ??
      airportCurrentTemp ??
      validNumber(row?.current_temp) ??
      null;
    observedHighRunway =
      highMadis ??
      highSettlement ??
      airportHigh ??
      highMetar ??
      validNumber(row?.current_max_so_far) ??
      currentRunwayTemp ??
      null;
  } else {
    currentRunwayTemp =
      runwayHistoryMetrics.latest ??
      settlementPlate?.maxTemp ??
      validNumber(hourly?.amos?.temp_c) ??
      latestSettlement ??
      latestMetar ??
      airportCurrentTemp ??
      validNumber(row?.current_temp) ??
      null;
    observedHighRunway =
      runwayHistoryMetrics.high ??
      settlementPlate?.maxTemp ??
      highSettlement ??
      airportHigh ??
      highMetar ??
      validNumber(row?.current_max_so_far) ??
      currentRunwayTemp ??
      null;
  }

  const observedHighMetar = airportHigh ?? highSettlement ?? highMetar ?? rowMetarHigh ?? null;

  return { currentRunwayTemp, observedHighMetar, observedHighRunway };
}

function selectDisplayRunwayTemp(
  liveTemp: number | null,
  currentRunwayTemp: number | null,
  _hasRunwayData: boolean,
) {
  if (currentRunwayTemp !== null) return currentRunwayTemp;
  return liveTemp;
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

function runwayTemperatureFromPairTuple(rawTemp: unknown) {
  if (Array.isArray(rawTemp)) return validNumber(rawTemp[0]);
  return validNumber(rawTemp);
}

function runwayPatchPointsFromRunwayObs(runwayObs: any) {
  const directPoints = Array.isArray(runwayObs?.point_temperatures)
    ? runwayObs.point_temperatures
    : [];
  if (directPoints.length) return directPoints;

  const runwayPairs = Array.isArray(runwayObs?.runway_pairs)
    ? runwayObs.runway_pairs
    : [];
  const temperatures = Array.isArray(runwayObs?.temperatures)
    ? runwayObs.temperatures
    : [];

  return runwayPairs
    .map((pair: unknown, index: number) => {
      const temp = runwayTemperatureFromPairTuple(temperatures[index]);
      if (temp === null) return null;
      return {
        runway: runwayLabelFromPair(pair, index),
        temp,
        target_runway_max: temp,
      };
    })
    .filter((point: any): point is { runway: string; temp: number; target_runway_max: number } => point !== null);
}

type HourlyForecast = {
  forecastTodayHigh?: number | null;
  debPrediction?: number | null;
  debHourlyPath?: DebHourlyPath | null;
  localDate?: string | null;
  localTime?: string | null;
  times: string[];
  temps: Array<number | null>;
  modelCurves?: Record<string, Array<number | null>>;
  runwayPlateHistory?: Record<string, Array<Record<string, unknown>>>;
  runwayBandHistory?: Array<{ time: string; high_temp: number; low_temp: number; avg_temp: number }>;
  amos?: AmosData | null;
  airportCurrent?: AirportCurrentConditions | null;
  airportPrimary?: AirportCurrentConditions | null;
  wundergroundCurrent?: AirportCurrentConditions | null;
  forecastDaily?: ForecastDay[];
  multiModelDaily?: Record<string, DailyModelForecast>;
  probabilities?: LegacyGaussianProbabilitySource | null;
  settlementTodayObs?: ObsPoint[];
  settlementStationLabel?: string | null;
  metarTodayObs?: ObsPoint[];
  airportPrimaryTodayObs?: RawObsPoint[];
} | null;

function seedHourlyForecastFromRow(row: ScanOpportunityRow | null): HourlyForecast {
  if (!row) return null;
  return {
    forecastTodayHigh: null,
    debPrediction: validNumber(row.deb_prediction),
    debHourlyPath: null,
    localDate: row.local_date || null,
    localTime: row.local_time || null,
    times: [],
    temps: [],
    modelCurves: undefined,
    runwayPlateHistory: (row as any)?.runway_plate_history || undefined,
    runwayBandHistory: undefined,
    amos: null,
    airportCurrent: null,
    airportPrimary: null,
    wundergroundCurrent: (row as any)?.wunderground_current || null,
    forecastDaily: [],
    multiModelDaily: {},
    probabilities: {
      engine: row.probability_engine || null,
      distribution: row.distribution_preview || [],
      distribution_all: row.distribution_full || row.distribution_preview || [],
    },
    settlementTodayObs: row.settlement_today_obs || row.metar_context?.settlement_today_obs || undefined,
    metarTodayObs: row.metar_today_obs || row.metar_context?.today_obs || row.metar_recent_obs || row.metar_context?.recent_obs || undefined,
    airportPrimaryTodayObs: undefined,
  };
}

type HourlyForecastFetchOptions = {
  ignoreCache?: boolean;
  resolution?: string;
};

function parseHourlyForecastFromCityDetail(json: CityDetail | null): HourlyForecast {
  const hourlySource = (json as any)?.hourly ?? (json as any)?.timeseries?.hourly;
  if (!json || !hourlySource) return null;
  return {
    forecastTodayHigh: json.forecast?.today_high ?? null,
    debPrediction: json.deb?.prediction ?? (json as any)?.overview?.deb_prediction ?? null,
    debHourlyPath: json.deb?.hourly_path || null,
    localDate: json.local_date || (json as any)?.overview?.local_date || null,
    localTime: json.local_time || null,
    times: hourlySource.times || [],
    temps: hourlySource.temps || [],
    modelCurves: (json.models_hourly ?? (json as any)?.timeseries?.models_hourly)?.curves || undefined,
    runwayPlateHistory: (json as any)?.runway_plate_history || (json.amos as any)?.runway_plate_history || undefined,
    runwayBandHistory: (json as any)?.runway_band_history || undefined,
    amos: json.amos || null,
    airportCurrent: json.airport_current || null,
    airportPrimary: json.airport_primary || null,
    wundergroundCurrent: (json as any).wunderground_current || (json as any)?.official?.wunderground_current || null,
    forecastDaily: json.forecast?.daily || [],
    multiModelDaily: json.multi_model_daily || {},
    probabilities: json.probabilities || null,
    settlementTodayObs: (json as any).timeseries?.settlement_today_obs || (json as any)?.settlement_today_obs || undefined,
    settlementStationLabel: (json as any)?.settlement_station?.settlement_station_label || null,
    metarTodayObs: (json as any).timeseries?.metar_today_obs || (json as any)?.metar_today_obs || undefined,
    airportPrimaryTodayObs: (json as any)?.official?.airport_primary_today_obs || (json as any)?.airport_primary_today_obs || undefined,
  };
}

async function fetchHourlyForecastForCity(
  city: string,
  options: HourlyForecastFetchOptions = {},
): Promise<HourlyForecast> {
  const resParam = options.resolution || "10m";
  const cacheKey = `${city}:${resParam}`;

  if (!options.ignoreCache) {
    const cached = _hourlyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
      return cached.data;
    }

    const sessionCached = readSessionCache(cacheKey);
    if (sessionCached) {
      _hourlyCache.set(cacheKey, sessionCached);
      return sessionCached.data;
    }
  }

  const requestKey = options.ignoreCache ? `${city}:${resParam}:live` : `${city}:${resParam}`;
  const pending = _hourlyRequestCache.get(requestKey);
  if (pending) return pending;

  const request = runQueuedHourlyDetailRequest(() =>
    fetch(`/api/city/${encodeURIComponent(city)}/detail?depth=full&force_refresh=false&resolution=${resParam}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<CityDetail>;
      })
      .then((json) => {
        const data = parseHourlyForecastFromCityDetail(json);
        if (!data) return null;
        _hourlyCache.set(cacheKey, { ts: Date.now(), data });
        writeSessionCache(cacheKey, data);
        return data;
      }),
  )
    .finally(() => {
      _hourlyRequestCache.delete(requestKey);
    });

  _hourlyRequestCache.set(requestKey, request);
  return request;
}

function shouldPollLiveChart({
  city,
  compact,
  isActive,
  isMaximized,
}: {
  city: string;
  compact: boolean;
  isActive: boolean;
  isMaximized: boolean;
}) {
  return Boolean(city) && (compact || isActive || isMaximized);
}

function getLiveObservationLabels(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
) {
  const normalizedKey = normalizeCityKey(row?.city);
  const runwaySensorCities = new Set([
    "beijing", "shanghai", "guangzhou", "qingdao",
    "chengdu", "chongqing", "wuhan",
    "seoul", "busan",
  ]);
  const weatherStationCities = new Set(["ankara", "istanbul"]);
  const isShenzhen = normalizedKey === "shenzhen";
  const isHKO = (normalizedKey === "hongkong" || normalizedKey === "laufaushan") && !isShenzhen;
  const isTokyo = normalizedKey === "tokyo";
  const isSingapore = normalizedKey === "singapore";
  const isParis = normalizedKey === "paris";
  const isTaipei = normalizedKey === "taipei";
  const sourceTokens = [
    (hourly?.airportPrimary as any)?.source,
    hourly?.airportPrimary?.source_code,
    hourly?.airportPrimary?.source_label,
    (hourly?.airportCurrent as any)?.source,
    (hourly?.airportCurrent as any)?.source_code,
    (hourly?.airportCurrent as any)?.source_label,
    (row as any)?.station_source_code,
    (row as any)?.network_provider,
    (row as any)?.network_provider_label,
    row?.metar_context?.source,
    row?.metar_context?.station,
    row?.metar_context?.station_label,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const hasRealStationNetwork =
    weatherStationCities.has(normalizedKey) ||
    /\b(mgm|turkey_mgm|jma_amedas|fmi|knmi|cowin_obs|ims|ncm|aeroweb|madis_hfmetar|singapore_mss)\b/.test(sourceTokens);
  const isRunwaySensorCity = runwaySensorCities.has(normalizedKey);
  const isWeatherStation = !runwaySensorCities.has(normalizedKey)
    && !isHKO && !isShenzhen && !isTokyo && !isSingapore && !isParis && !isTaipei
    && hasRealStationNetwork;

  const runwayHeaderLabel = isShenzhen ? "天文台实测 (10分钟)"
    : isHKO ? "参考站点 (1分钟)"
    : isTokyo ? "机场气象站 (10分钟)"
    : isSingapore ? "航站楼温度"
    : isParis ? "官方机场观测 (15分钟)"
    : isTaipei ? "CWA (10分钟)"
    : isWeatherStation ? "气象站实测"
    : isRunwaySensorCity ? "跑道实测 (1分钟)"
    : "机场报文";

  const metarHeaderLabel = (isShenzhen || isHKO) ? "天文台实测 (10分钟)"
    : "METAR 结算 (30分钟)";

  const runwayHighLabel = isShenzhen ? "天文台实测"
    : isHKO ? "参考站点"
    : isTokyo ? "机场气象站"
    : isSingapore ? "航站楼"
    : isParis ? "官方机场观测"
    : isTaipei ? "CWA"
    : isWeatherStation ? "气象站"
    : isRunwaySensorCity ? "跑道实测"
    : "机场报文";

  const metarHighLabel = isShenzhen ? "天文台"
    : isHKO ? "天文台"
    : "METAR 官方";

  return {
    isHKO,
    isParis,
    isShenzhen,
    isTaipei,
    isWeatherStation,
    metarHeaderLabel,
    metarHighLabel,
    runwayHeaderLabel,
    runwayHighLabel,
  };
}

function mergePatchIntoHourly(
  prev: HourlyForecast,
  patch: CityPatch,
): HourlyForecast {
  const changes = patch.changes || {};
  const tempValue = validNumber(changes.temp);
  const observedAtUtc = typeof changes.observed_at_utc === "string" ? changes.observed_at_utc : null;
  const obsTime = observedAtUtc || (typeof changes.obs_time === "string" ? changes.obs_time : null);
  const source = typeof changes.source === "string" ? changes.source : "";
  const explicitHourlyPatch = changes.hourly && typeof changes.hourly === "object"
    ? changes.hourly as Partial<NonNullable<HourlyForecast>>
    : {};

  const next: NonNullable<HourlyForecast> = {
    ...(prev || {
      forecastTodayHigh: null,
      debPrediction: null,
      localDate: null,
      localTime: null,
      times: [],
      temps: [],
      forecastDaily: [],
      multiModelDaily: {},
      probabilities: null,
    }),
    ...explicitHourlyPatch,
  };

  if (typeof (changes as any).local_date === "string") {
    next.localDate = (changes as any).local_date;
  }
  if (typeof (changes as any).city_local_date === "string") {
    next.localDate = (changes as any).city_local_date;
  }

  if (changes.amos && typeof changes.amos === "object") {
    const oldAmos = prev?.amos || {};
    const newAmos = changes.amos as AmosData;
    next.amos = {
      ...oldAmos,
      ...newAmos,
    } as any;
  }

  // Preserve runwayPlateHistory in next state
  if (prev?.runwayPlateHistory) {
    next.runwayPlateHistory = prev.runwayPlateHistory;
  }

  // Append new runway observations to history if available in the patch
  const amosChanges = changes.amos as Record<string, any> | undefined;
  const obsTimeVal = obsTime || amosChanges?.observation_time || amosChanges?.observation_time_local;
  const runwayObs = amosChanges?.runway_obs;
  const runwayPoints = Array.isArray(changes.runway_points)
    ? changes.runway_points
    : runwayObs
      ? runwayPatchPointsFromRunwayObs(runwayObs)
      : [];
  if (runwayPoints.length && obsTimeVal) {
    const history: Record<string, Array<Record<string, unknown>>> = {};
    const sourceHistory = next.runwayPlateHistory || (next.amos as any)?.runway_plate_history || {};
    
    // Copy existing history points
    Object.entries(sourceHistory).forEach(([rwy, pts]) => {
      if (Array.isArray(pts)) {
        history[rwy] = [...pts];
      }
    });

    // Append new points from point_temperatures
    runwayPoints.forEach((pt: any) => {
      const rwy = pt.runway || "";
      if (!rwy) return;
      const tempVal = validNumber(pt.temp) ?? validNumber(pt.target_runway_max) ?? validNumber(pt.tdz_temp) ?? validNumber(pt.end_temp);
      if (tempVal === null) return;

      const rwyHistory = history[rwy] || [];
      const exists = rwyHistory.some((p: any) => p.timestamp === obsTimeVal || p.time === obsTimeVal || p.observed_at === obsTimeVal);
      if (!exists) {
        rwyHistory.push({
          timestamp: obsTimeVal,
          temp_c: tempVal,
          value: tempVal,
        });
        history[rwy] = rwyHistory.slice(-MAX_OBS_POINTS);
      }
    });

    next.runwayPlateHistory = history;
    next.amos = {
      ...(next.amos || {}),
      runway_obs: {
        ...((next.amos as any)?.runway_obs || {}),
        point_temperatures: runwayPoints,
      },
    } as any;
    if (next.amos) {
      (next.amos as any).runway_plate_history = history;
    }
  }

  if (tempValue !== null) {
    next.airportCurrent = {
      ...(next.airportCurrent || {}),
      obs_time: obsTime || next.airportCurrent?.obs_time || null,
      temp: tempValue,
      max_so_far: Math.max(
        tempValue,
        validNumber(next.airportCurrent?.max_so_far) ?? tempValue,
      ),
    };
    next.airportPrimary = {
      ...(next.airportPrimary || {}),
      obs_time: obsTime || next.airportPrimary?.obs_time || null,
      temp: tempValue,
      max_so_far: Math.max(
        tempValue,
        validNumber(next.airportPrimary?.max_so_far) ?? tempValue,
      ),
      source_label: next.airportPrimary?.source_label || source || undefined,
    };
  }

  if (tempValue !== null && obsTime) {
    const obsPoint: RawObsPoint = [obsTime, tempValue];
    const currentObs = Array.isArray(next.airportPrimaryTodayObs)
      ? next.airportPrimaryTodayObs
      : [];
    next.airportPrimaryTodayObs = [...currentObs, obsPoint].slice(-MAX_OBS_POINTS);
  }

  return next;
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
  minPoints = 2,
  isEn = false,
): RunwayHistorySeries[] {
  const directHistory =
    hourly?.runwayPlateHistory ??
    ((hourly?.amos as any)?.runway_plate_history as Record<string, Array<Record<string, unknown>>> | undefined) ??
    ((row as any)?.runway_plate_history as Record<string, Array<Record<string, unknown>>> | undefined);

  if (directHistory && typeof directHistory === "object") {
    const directSeries = Object.entries(directHistory)
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
          label: runwaySeriesLabel(normalizedRwy, isSettlement, isEn),
          rwy: normalizedRwy,
          isSettlement,
          color: isSettlement ? "#009688" : RUNWAY_LINE_COLORS[index % RUNWAY_LINE_COLORS.length],
          points,
        };
      })
      .filter((series) => series.points.length >= minPoints);
    if (directSeries.length) return directSeries;
  }

  const amos = hourly?.amos;
  const runwayObs = amos?.runway_obs;
  const runwayPairs = runwayObs?.runway_pairs || [];
  const runwayTemps = runwayObs?.temperatures || [];
  const pointTemps = runwayObs?.point_temperatures || [];
  const isAmosTempDewTuple = String(amos?.source || "").toLowerCase() === "amos";
  const anchor =
    getCityLocalUtcTimestamp(amos?.observation_time || amos?.observation_time_local || hourly?.localTime || row?.local_time, tzOffset, localDateStr) ??
    getCityLocalUtcTimestamp(row?.local_time, tzOffset, localDateStr);

  if (!anchor || !Array.isArray(runwayTemps)) return [];

  return runwayTemps
    .map((rawTemps, index) => {
      if (!Array.isArray(rawTemps)) return null;
      const rawPair = runwayPairs[index];
      const rwy = runwayLabelFromPair(rawPair, index);
      const isSettlement = isSettlementRunway(row, rwy);
      const pointTemp = Array.isArray(pointTemps) ? (pointTemps[index] as any) : null;
      const pair = Array.isArray(rawPair) && rawPair.length >= 2
        ? [String(rawPair[0]), String(rawPair[1])] as [string, string]
        : rwy.split("/").length >= 2
          ? [rwy.split("/")[0], rwy.split("/")[1]] as [string, string]
          : [rwy, rwy] as [string, string];
      const tdz = validNumber(pointTemp?.tdz_temp);
      const mid = validNumber(pointTemp?.mid_temp);
      const end = validNumber(pointTemp?.end_temp);
      const endpointTemp = isSettlement
        ? settlementEndpointTempForPair(normalizeCityKey(row?.city), pair, tdz, end)
        : null;
      const aggregateRunwayTemp =
        endpointTemp ??
        validNumber(pointTemp?.temp) ??
        validNumber(pointTemp?.target_runway_max) ??
        (isAmosTempDewTuple ? runwayTemperatureFromPairTuple(rawTemps) : null);
      const snapshotValues = [
        aggregateRunwayTemp,
        ...(isSettlement && endpointTemp !== null ? [] : [tdz, mid, end]),
      ].filter((value): value is number => value !== null);
      const samples = isAmosTempDewTuple
        ? []
        : rawTemps.map(validNumber).filter((value): value is number => value !== null);
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
          const minutesFromEnd = (valuesForLine.length - 1 - pointIndex);
          return {
            ts: anchor - minutesFromEnd * 60 * 1000,
            value,
          };
        })
        .filter((point) => validNumber(point.value) !== null);
      if (values.length < minPoints) return null;
      return {
        key: runwaySeriesKey(rwy),
        label: runwaySeriesLabel(rwy, isSettlement, isEn),
        rwy,
        isSettlement,
        color: isSettlement ? "#009688" : RUNWAY_LINE_COLORS[index % RUNWAY_LINE_COLORS.length],
        points: values.slice(-MAX_OBS_POINTS),
      };
    })
    .filter((series): series is RunwayHistorySeries => series !== null);
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
  const localDateStr = resolveChartLocalDate(row, hourly);
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

function binBandObservationsToSlots(
  slots: number[],
  obs: TemperatureBandPoint[],
): Array<[number, number] | null> {
  const result: Array<[number, number] | null> = new Array(slots.length).fill(null);
  for (const point of obs) {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (point.ts >= slots[i]) {
        result[i] = [point.low, point.high];
        break;
      }
    }
  }
  return result;
}

function sortedTimeline(timestamps: Iterable<number>) {
  return Array.from(new Set(Array.from(timestamps).filter((ts) => Number.isFinite(ts)))).sort((a, b) => a - b);
}

function addLocalDayAxisSlots(timeline: Set<number>, bounds: LocalDayBounds | null) {
  if (!bounds) return;
  for (let ts = bounds.start; ts < bounds.end; ts += 60 * 60 * 1000) {
    timeline.add(ts);
  }
}

function resolveFullDayFallbackAnchor(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  tzOffsetSeconds: number,
  localDateStr: string,
) {
  return (
    getCityLocalUtcTimestamp(hourly?.localTime || row?.local_time, tzOffsetSeconds, localDateStr) ??
    Date.UTC(
      Number(localDateStr.slice(0, 4)) || new Date().getUTCFullYear(),
      (Number(localDateStr.slice(5, 7)) || 1) - 1,
      Number(localDateStr.slice(8, 10)) || new Date().getUTCDate(),
      12,
      0,
      0,
    )
  );
}

function ensureRenderableTimeline(timeline: number[], fallbackAnchor: number) {
  if (timeline.length >= 2) return timeline;
  const anchor = timeline[0] ?? fallbackAnchor;
  return [anchor - 30 * 60 * 1000, anchor];
}

function buildTimelineIndex(timeline: number[]) {
  return new Map(timeline.map((ts, index) => [ts, index]));
}

function valuesAtTimeline(
  size: number,
  indexByTs: Map<number, number>,
  obs: Array<{ ts: number; value: number }>,
) {
  const result: Array<number | null> = new Array(size).fill(null);
  obs.forEach((point) => {
    const idx = indexByTs.get(point.ts);
    if (idx !== undefined) result[idx] = point.value;
  });
  return result;
}

function bandValuesAtTimeline(
  size: number,
  indexByTs: Map<number, number>,
  obs: TemperatureBandPoint[],
) {
  const result: Array<[number, number] | null> = new Array(size).fill(null);
  obs.forEach((point) => {
    const idx = indexByTs.get(point.ts);
    if (idx !== undefined) result[idx] = [point.low, point.high];
  });
  return result;
}

function valuesForHourlyTimes(
  size: number,
  indexByTs: Map<number, number>,
  times: string[] | undefined,
  values: Array<number | null | undefined>,
  tzOffsetSeconds: number,
  localDateStr: string,
  bounds: LocalDayBounds | null = null,
) {
  const result: Array<number | null> = new Array(size).fill(null);
  (times || []).forEach((time, index) => {
    const ts = getCityLocalUtcTimestamp(time, tzOffsetSeconds, localDateStr);
    if (!isWithinLocalDay(ts, bounds)) return;
    if (ts === null) return;
    const value = validNumber(values[index]);
    if (value === null) return;
    const idx = indexByTs.get(ts);
    if (idx !== undefined) result[idx] = value;
  });
  return result;
}

function addHourlyTimesToTimeline(
  timeline: Set<number>,
  times: string[] | undefined,
  values: Array<number | null | undefined> | undefined,
  tzOffsetSeconds: number,
  localDateStr: string,
  bounds: LocalDayBounds | null = null,
) {
  if (!times?.length || !values?.length) return;
  times.forEach((time, index) => {
    if (validNumber(values[index]) === null) return;
    const ts = getCityLocalUtcTimestamp(time, tzOffsetSeconds, localDateStr);
    if (ts !== null && isWithinLocalDay(ts, bounds)) timeline.add(ts);
  });
}

function probabilityBucketValue(bucket: ProbabilityBucket) {
  return validNumber(bucket.value ?? (bucket as any).temp ?? (bucket as any).temperature);
}

function probabilityBucketProbability(bucket: ProbabilityBucket) {
  const raw = validNumber(bucket.probability ?? (bucket as any).model_probability);
  if (raw === null) return null;
  return raw > 1 ? raw / 100 : raw;
}

function probabilityBucketRange(bucket: ProbabilityBucket, value: number) {
  const rawRange = String(bucket.range || bucket.bucket || "").trim();
  const rangeMatch = rawRange.match(/(-?\d+(?:\.\d+)?)\s*~\s*(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const lower = Number(rangeMatch[1]);
    const upper = Number(rangeMatch[2]);
    if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
      return { lower, upper };
    }
  }
  return {
    lower: Number((value - 0.5).toFixed(2)),
    upper: Number((value + 0.5).toFixed(2)),
  };
}

function buildLegacyGaussianProbabilityOverlay(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
): ProbabilityOverlay | null {
  const source = hourly?.probabilities || null;
  const rowBuckets = ((row as any)?.distribution_full || (row as any)?.distribution_preview || []) as ProbabilityBucket[];
  const buckets = (
    source?.distribution_all?.length
      ? source.distribution_all
      : source?.distribution?.length
        ? source.distribution
        : rowBuckets
  ) || [];

  const engine = source?.engine || row?.probability_engine || (buckets.length ? "legacy" : null);
  if (engine && String(engine).toLowerCase() !== "legacy") return null;

  const tempSymbol = row?.temp_symbol || "°C";
  const bands = buckets
    .map((bucket, index) => {
      const value = probabilityBucketValue(bucket);
      const probability = probabilityBucketProbability(bucket);
      if (value === null || probability === null || probability <= 0) return null;
      const { lower, upper } = probabilityBucketRange(bucket, value);
      return {
        key: `legacy_probability_${value}_${index}`,
        value,
        lower,
        upper,
        probability,
        label: `${value}${tempSymbol} ${Math.round(probability * 100)}%`,
        opacity: Number(Math.min(0.16, Math.max(0.035, 0.04 + probability * 0.22)).toFixed(3)),
      };
    })
    .filter((band): band is ProbabilityTemperatureBand => band !== null)
    .sort((a, b) => a.value - b.value);

  const mu = validNumber(source?.mu);
  const muLine = mu === null
    ? null
    : {
        value: mu,
        label: `Gaussian μ ${mu.toFixed(1)}${tempSymbol}`,
      };

  if (!bands.length && !muLine) return null;
  return {
    engine: engine || "legacy",
    muLine,
    bands,
  };
}

function buildFullDayChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  isEn: boolean,
): { data: Array<Record<string, any>>; series: EvidenceSeries[]; probabilityOverlay: ProbabilityOverlay | null } {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = resolveChartLocalDate(row, hourly);
  const localDayBounds = getLocalDayBounds(localDateStr);

  const settlementObs = filterTimelinePointsToLocalDay(
    normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset, MAX_OBS_POINTS, localDateStr),
    localDayBounds,
  );
  const metarObs = filterTimelinePointsToLocalDay(
    normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset, MAX_OBS_POINTS, localDateStr),
    localDayBounds,
  );
  const madisObs = filterTimelinePointsToLocalDay(
    normObs(
      appendLatestAirportObservation(hourly?.airportPrimaryTodayObs, hourly?.airportPrimary, hourly?.airportCurrent),
      tzOffset,
      MAX_OBS_POINTS,
      localDateStr,
    ),
    localDayBounds,
  );
  const runwayHistorySeries = filterRunwayHistoryToLocalDay(
    buildRunwayHistorySeries(row, hourly, tzOffset, localDateStr, 2, isEn),
    localDayBounds,
  );

  const settlementCityKey = normalizeCityKey(row?.city);
  const isShenzhen = settlementCityKey === 'shenzhen';
  const isHKO = (settlementCityKey === 'hongkong' || settlementCityKey === 'laufaushan'
    || (row?.city || '').toLowerCase().includes('hong kong')
    || (row?.city || '').toLowerCase().includes('lau fau shan')) && !isShenzhen;

  let finalSettlementObs = settlementObs;
  let finalMadisObs = madisObs;
  if (isHKO) {
    finalSettlementObs = madisObs;
    finalMadisObs = settlementObs;
  } else if (isShenzhen && !settlementObs.length && madisObs.length) {
    finalSettlementObs = madisObs;
    finalMadisObs = [];
  }

  // ── Runway band & max series ──
  const normBandObs: TemperatureBandPoint[] = (hourly?.runwayBandHistory || []).map((pt) => {
    try {
      const ts = getCityLocalUtcTimestamp(pt.time, tzOffset, localDateStr);
      if (ts === null) return null;
      return {
        ts,
        high: pt.high_temp,
        low: pt.low_temp,
        avg: pt.avg_temp
      };
    } catch {
      return null;
    }
  }).filter((v): v is NonNullable<typeof v> => v !== null && isWithinLocalDay(v.ts, localDayBounds));

  const isHKOCity = settlementCityKey === 'hongkong' || settlementCityKey === 'laufaushan'
    || settlementCityKey === 'shenzhen' || (row?.city || '').toLowerCase().includes('hong kong')
    || (row?.city || '').toLowerCase().includes('lau fau shan');
  const isAmscSource =
    (hourly?.airportPrimary as any)?.source === "amsc_awos" ||
    String(hourly?.airportPrimary?.source_label || "").toLowerCase().includes("amsc");
  const isKoreanAmosSource =
    (settlementCityKey === "seoul" || settlementCityKey === "busan") &&
    (
      String(
        (hourly?.airportPrimary as any)?.source ||
          hourly?.airportPrimary?.source_code ||
          hourly?.airportPrimary?.source_label ||
          hourly?.amos?.source ||
          "",
      ).toLowerCase().includes("amos") ||
      Boolean(hourly?.amos?.runway_obs)
    );
  const isRunwaySensorAggregateSource = isAmscSource || isKoreanAmosSource;
  const shouldRenderMetar = metarObs.length > 0 && !observationSetContains(finalMadisObs, metarObs);

  const timelineSet = new Set<number>();
  runwayHistorySeries.forEach((rhs) => rhs.points.forEach((point) => timelineSet.add(point.ts)));
  normBandObs.forEach((point) => timelineSet.add(point.ts));
  finalSettlementObs.forEach((point) => timelineSet.add(point.ts));
  if (!isRunwaySensorAggregateSource) finalMadisObs.forEach((point) => timelineSet.add(point.ts));
  if (shouldRenderMetar) metarObs.forEach((point) => timelineSet.add(point.ts));
  addLocalDayAxisSlots(timelineSet, localDayBounds);

  const correctedDebPath = hourly?.debHourlyPath;
  const correctedDebTimes = Array.isArray(correctedDebPath?.times) ? correctedDebPath?.times || [] : [];
  const correctedDebTemps = Array.isArray(correctedDebPath?.temps) ? correctedDebPath?.temps || [] : [];
  let debTimes: string[] = [];
  let debTemps: Array<number | null | undefined> = [];
  if (correctedDebTimes.length && correctedDebTemps.length) {
    debTimes = correctedDebTimes;
    debTemps = correctedDebTemps;
  } else if (hourly?.times?.length && hourly?.temps?.length) {
    const debPath = buildDebBaselinePath(
      hourly.times,
      hourly.temps,
      validNumber(hourly?.debPrediction) ?? row?.deb_prediction,
      hourly.localTime || row?.local_time,
      hourly.forecastTodayHigh,
    );
    debTimes = hourly.times;
    debTemps = debPath.debTemps;
  }
  if (debTimes.length && debTemps.length) {
    addHourlyTimesToTimeline(timelineSet, debTimes, debTemps, tzOffset, localDateStr, localDayBounds);
  }
  if (hourly?.times?.length && hourly?.modelCurves) {
    Object.values(hourly.modelCurves).forEach((modelTemps) => {
      addHourlyTimesToTimeline(timelineSet, hourly.times, modelTemps, tzOffset, localDateStr, localDayBounds);
    });
  }

  const fallbackAnchor = resolveFullDayFallbackAnchor(row, hourly, tzOffset, localDateStr);
  const timeline = ensureRenderableTimeline(sortedTimeline(timelineSet), fallbackAnchor);
  const n = timeline.length;
  const indexByTs = buildTimelineIndex(timeline);
  const series: EvidenceSeries[] = [];

  // ── Runway history series ──
  runwayHistorySeries.forEach((rhs) => {
    const values = valuesAtTimeline(n, indexByTs, rhs.points);
    if (!values.some((v) => v !== null)) return;
    series.push({
      key: rhs.key,
      label: rhs.label,
      source: "",
      color: rhs.color,
      featured: rhs.isSettlement,
      dashed: !rhs.isSettlement,
      curve: "monotone",
      showDot: rhs.isSettlement,
      values,
    });
  });

  const bandVals = bandValuesAtTimeline(n, indexByTs, normBandObs);
  const maxVals = bandVals.map((val) => val ? val[1] : null);
  if (maxVals.some((v) => v !== null)) {
    series.push({
      key: "runway_max",
      label: isEn ? "Runway Max" : "跑道最高温",
      source: "Runway Max",
      color: "#009688",
      featured: true,
      values: maxVals,
    });
  }

  // ── Settlement observations ──
  if (finalSettlementObs.length) {
    const svals = valuesAtTimeline(n, indexByTs, finalSettlementObs);
    if (svals.some((v) => v !== null)) {
      series.push({
        key: "settlement",
        label: isHKO ? "CoWIN 6087" : (isHKOCity ? "HKO" : (hourly?.settlementStationLabel || row?.metar_context?.station_label || row?.metar_context?.station || "Settlement")),
        source: isHKO ? "cowin_obs" : (row?.metar_context?.station || row?.airport || "Settlement"),
        color: "#009688",
        featured: true,
        values: svals,
      });
    }
  }

  // ── Airport Primary (MADIS / AMSC AWOS) ──
  // Skip this series for AMSC AWOS cities — their data is redundant with
  // runway sensor data and adds a confusing "AMSC AWOS" label to the chart.
  if (finalMadisObs.length && !isRunwaySensorAggregateSource) {
    const madisVals = valuesAtTimeline(n, indexByTs, finalMadisObs);
    if (madisVals.some((v) => v !== null)) {
      series.push({
        key: "madis",
        label: isHKO ? "HKO" : (hourly?.airportPrimary?.source_label || "NOAA MADIS"),
        source: isHKO ? "HKO" : (hourly?.airportPrimary?.station_code || row?.airport || "MADIS"),
        color: "#0284c7",
        dashed: isHKO ? true : false,
        values: madisVals,
      });
    }
  }

  if (shouldRenderMetar) {
    const mvals = valuesAtTimeline(n, indexByTs, metarObs);
    if (mvals.some((v) => v !== null)) {
      series.push({
        key: "metar",
        label: isHKO ? "VHHH METAR" : (isHKOCity ? "HKO" : (row?.metar_context?.station_label || "METAR")),
        source: row?.airport || "METAR",
        color: "#0ea5e9",
        dashed: true,
        curve: "stepAfter",
        showDot: true,
        values: mvals,
      });
    }
  }

  // ── DEB forecast curve ──
  if (debTimes.length && debTemps.length) {
    const debVals = valuesForHourlyTimes(n, indexByTs, debTimes, debTemps, tzOffset, localDateStr, localDayBounds);
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
    if (hourly?.times?.length && hourly.modelCurves) {
      const modelColors = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];
      Object.keys(hourly.modelCurves).forEach((model, idx) => {
        const modelTemps = hourly.modelCurves![model];
        if (!modelTemps?.length) return;
        const vals = valuesForHourlyTimes(n, indexByTs, hourly.times, modelTemps, tzOffset, localDateStr, localDayBounds);
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
  if (!hasRenderableLineSeries(series)) {
    const fb =
      validNumber(hourly?.airportCurrent?.temp) ??
      validNumber(hourly?.airportPrimary?.temp) ??
      latestObservationValue(finalMadisObs) ??
      latestObservationValue(finalSettlementObs) ??
      latestObservationValue(metarObs) ??
      validNumber(row?.current_temp) ??
      validNumber(hourly?.debPrediction) ??
      validNumber(row?.deb_prediction) ??
      validNumber(row?.target_threshold);
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
  const data = timeline.map((ts, i) => {
    const point: Record<string, any> = {
      label: formatTimestamp(ts),
      ts,
      runway_band: bandVals[i] ?? null,
    };
    series.forEach((s) => { point[s.key] = s.values[i] ?? null; });
    return point;
  });

  const probabilityOverlay = buildLegacyGaussianProbabilityOverlay(row, hourly);

  return { data, series, probabilityOverlay };
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

function probabilityOverlayValues(probabilityOverlay?: ProbabilityOverlay | null) {
  if (!probabilityOverlay) return [];
  return [
    ...(probabilityOverlay.muLine ? [probabilityOverlay.muLine.value] : []),
    ...probabilityOverlay.bands.flatMap((band) => [band.lower, band.upper]),
  ];
}
function buildIntDegreeTicks(
  series: EvidenceSeries[],
  data?: Array<Record<string, string | number | null>>,
  probabilityOverlay?: ProbabilityOverlay | null,
): number[] | null {
  const vals = data?.length
    ? data.flatMap((point) => series.map((s) => point[s.key])).filter((v): v is number => validNumber(v) !== null)
    : series.flatMap((s) => s.values).filter((v): v is number => validNumber(v) !== null);
  const overlayVals = probabilityOverlayValues(probabilityOverlay);
  const allVals = [...vals, ...overlayVals];
  if (!allVals.length) return null;
  const min = Math.floor(Math.min(...allVals));
  const max = Math.ceil(Math.max(...allVals));
  const ticks: number[] = [];
  for (let d = min; d <= max; d++) ticks.push(d);
  return ticks.length > 0 ? ticks : null;
}

function buildChartDomain(
  series: EvidenceSeries[],
  data?: Array<Record<string, string | number | null>>,
  probabilityOverlay?: ProbabilityOverlay | null,
): [number, number] | ["auto", "auto"] {
  const vals = data?.length
    ? data.flatMap((point) => series.map((s) => point[s.key])).filter((v): v is number => validNumber(v) !== null)
    : series.flatMap((s) => s.values).filter((v): v is number => validNumber(v) !== null);
  const overlayVals = probabilityOverlayValues(probabilityOverlay);
  const allVals = [...vals, ...overlayVals];
  if (!allVals.length) return ["auto", "auto"];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = Math.max(1, max - min);
  const pad = Math.max(0.5, span * 0.08);
  return [Number((min - pad).toFixed(1)), Number((max + pad).toFixed(1))];
}

function isLiveObservationSeries(series: EvidenceSeries) {
  if (series.key === "hourly_forecast") return false;
  if (series.key.startsWith("model_curve_")) return false;
  if (series.key.startsWith("model_summary_")) return false;
  if (["deb_prediction", "max_temp", "min_temp"].includes(series.key)) return false;

  const source = String(series.source || "").toLowerCase();
  if (source.includes("forecast") || source.includes("multi-model") || source === "deb") return false;
  return true;
}

function latestLiveObservationTimestamp(
  data: Array<Record<string, any>>,
  series: EvidenceSeries[],
) {
  let latest: number | null = null;
  series.filter(isLiveObservationSeries).forEach((item) => {
    item.values.forEach((value, index) => {
      if (validNumber(value) === null) return;
      const ts = typeof data[index]?.ts === "number" ? data[index].ts : null;
      if (ts === null) return;
      latest = latest === null ? ts : Math.max(latest, ts);
    });
  });
  return latest;
}

function chartDeltaForCelsius(row: ScanOpportunityRow | null, deltaC: number) {
  const symbol = String(row?.temp_symbol || "").toUpperCase();
  return symbol.includes("F") ? deltaC * 1.8 : deltaC;
}

function getLiveObservationPoints(
  data: Array<Record<string, any>>,
  series: EvidenceSeries[],
) {
  const liveSeries = series.filter(isLiveObservationSeries);
  const points: Array<{ ts: number; temp: number }> = [];
  data.forEach((row, index) => {
    const ts = typeof row?.ts === "number" ? row.ts : null;
    if (ts === null) return;
    const values = liveSeries
      .map((item) => validNumber(item.values[index]))
      .filter((value): value is number => value !== null);
    if (!values.length) return;
    points.push({ ts, temp: Math.max(...values) });
  });
  return points.sort((left, right) => left.ts - right.ts);
}

function pointAtOrBefore(
  points: Array<{ ts: number; temp: number }>,
  targetTs: number,
): { ts: number; temp: number } | null {
  let match: { ts: number; temp: number } | null = null;
  for (const point of points) {
    if (point.ts <= targetTs) match = point;
  }
  return match;
}

function getPeakGlowState(
  row: ScanOpportunityRow | null,
  data: Array<Record<string, any>>,
  series: EvidenceSeries[],
): PeakGlowMeta {
  const empty: PeakGlowMeta = {
    state: "none",
    currentTemp: null,
    referenceHigh: null,
    distanceToHigh: null,
    trend30m: null,
    trend60m: null,
    observedHigh: null,
  };
  const livePoints = getLiveObservationPoints(data, series);
  const latest = livePoints[livePoints.length - 1] || null;
  if (!latest) return empty;

  const previousLivePoints = livePoints.filter((point) => point.ts < latest.ts);
  const previousHigh = previousLivePoints.length
    ? Math.max(...previousLivePoints.map((point) => point.temp))
    : null;
  const liveHigh = Math.max(...livePoints.map((point) => point.temp));
  const rowHigh = validNumber(
    row?.current_max_so_far ??
      row?.metar_context?.airport_max_so_far ??
      row?.metar_context?.max_temp,
  );
  const observedHigh = rowHigh !== null ? Math.max(liveHigh, rowHigh) : liveHigh;
  const trend30Base = pointAtOrBefore(livePoints, latest.ts - 30 * 60 * 1000);
  const trend60Base = pointAtOrBefore(livePoints, latest.ts - 60 * 60 * 1000);
  const trend30m = trend30Base ? latest.temp - trend30Base.temp : null;
  const trend60m = trend60Base ? latest.temp - trend60Base.temp : null;
  const distanceToHigh = observedHigh - latest.temp;

  const metaBase = {
    currentTemp: latest.temp,
    referenceHigh: observedHigh,
    distanceToHigh,
    trend30m,
    trend60m,
    observedHigh,
  };

  const hotWindowRange = getDebPeakWindowRange(data, series);
  const hotWindowStart =
    hotWindowRange ? validNumber(data[hotWindowRange[0]]?.ts) : null;
  if (hotWindowStart !== null && latest.ts < hotWindowStart) {
    return { state: "none", ...metaBase };
  }

  const nearThreshold = chartDeltaForCelsius(row, 0.5);
  const watchThreshold = chartDeltaForCelsius(row, 1);
  const flatTrendFloor = -chartDeltaForCelsius(row, 0.2);
  const coolingDrop = -chartDeltaForCelsius(row, 0.5);
  const breakoutStep = chartDeltaForCelsius(row, 0.1);
  const isCooling =
    distanceToHigh >= Math.abs(coolingDrop) &&
    ((trend60m !== null && trend60m <= coolingDrop) ||
      (previousHigh !== null && latest.temp <= previousHigh + coolingDrop));
  if (isCooling) return { state: "cooling", ...metaBase };

  const isBreakout =
    previousHigh !== null &&
    latest.temp > previousHigh + breakoutStep;
  if (isBreakout) return { state: "breakout", ...metaBase };

  if (
    distanceToHigh <= nearThreshold &&
    (trend30m === null || trend30m >= flatTrendFloor)
  ) {
    return { state: "near_peak", ...metaBase };
  }

  if (distanceToHigh <= watchThreshold) {
    return { state: "watch", ...metaBase };
  }

  return { state: "none", ...metaBase };
}

function getDebPeakWindowRange(
  data: Array<Record<string, any>>,
  series: EvidenceSeries[],
): [number, number] | null {
  const debSeries = series.find((item) => item.key === "hourly_forecast");
  if (!debSeries || data.length < 2) return null;

  const debPoints = debSeries.values
    .map((value, index) => {
      const ts = typeof data[index]?.ts === "number" ? data[index].ts : null;
      const temp = validNumber(value);
      return ts === null || temp === null ? null : { index, ts, temp };
    })
    .filter((point): point is { index: number; ts: number; temp: number } => point !== null);

  if (debPoints.length < 2) return null;

  const peak = debPoints.reduce((best, point) => (point.temp > best.temp ? point : best), debPoints[0]);
  const peakPointIndex = debPoints.findIndex((point) => point.index === peak.index);
  if (peakPointIndex < 0) return null;

  const hotThreshold = peak.temp - 2;
  let hotStartPoint = peakPointIndex;
  let hotEndPoint = peakPointIndex;
  while (hotStartPoint > 0 && debPoints[hotStartPoint - 1].temp >= hotThreshold) {
    hotStartPoint -= 1;
  }
  while (hotEndPoint < debPoints.length - 1 && debPoints[hotEndPoint + 1].temp >= hotThreshold) {
    hotEndPoint += 1;
  }

  const hour = 60 * 60 * 1000;
  const targetSpan = 8 * hour;
  const minSpan = 6 * hour;
  const maxSpan = 12 * hour;
  const firstTs = data.find((point) => typeof point.ts === "number")?.ts;
  const lastTs = [...data].reverse().find((point) => typeof point.ts === "number")?.ts;
  if (typeof firstTs !== "number" || typeof lastTs !== "number" || lastTs <= firstTs) return null;

  let startTs = debPoints[hotStartPoint].ts - 1.5 * hour;
  let endTs = debPoints[hotEndPoint].ts + 2 * hour;
  const centerTs = peak.ts;
  const latestObsTs = latestLiveObservationTimestamp(data, series);

  if (endTs - startTs < targetSpan) {
    startTs = centerTs - targetSpan / 2;
    endTs = centerTs + targetSpan / 2;
  }
  if (endTs - startTs > maxSpan) {
    startTs = centerTs - maxSpan / 2;
    endTs = centerTs + maxSpan / 2;
  }
  if (latestObsTs !== null && latestObsTs > endTs && latestObsTs > debPoints[hotEndPoint].ts) {
    endTs = Math.min(lastTs, latestObsTs);
    if (endTs - startTs > maxSpan) {
      startTs = Math.max(firstTs, endTs - maxSpan);
    }
  }

  if (startTs < firstTs) {
    endTs = Math.min(lastTs, endTs + firstTs - startTs);
    startTs = firstTs;
  }
  if (endTs > lastTs) {
    startTs = Math.max(firstTs, startTs - (endTs - lastTs));
    endTs = lastTs;
  }
  if (endTs - startTs < minSpan && lastTs - firstTs >= minSpan) {
    const missing = minSpan - (endTs - startTs);
    startTs = Math.max(firstTs, startTs - missing / 2);
    endTs = Math.min(lastTs, endTs + missing / 2);
  }

  const startIndex = data.findIndex((point) => typeof point.ts === "number" && point.ts >= startTs);
  let endIndex = -1;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (typeof data[index]?.ts === "number" && data[index].ts <= endTs) {
      endIndex = index;
      break;
    }
  }

  return startIndex >= 0 && endIndex > startIndex ? [startIndex, endIndex] : null;
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

export {
  MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS,
  HOURLY_CACHE_TTL_MS,
  _hourlyCache,
  __resetHourlyDetailRequestQueueForTest,
  __runQueuedHourlyDetailRequestForTest,
  buildChartDomain,
  buildFullDayChartData,
  getDebPeakWindowRange,
  getPeakGlowState,
  buildIntDegreeTicks,
  buildModelSummaryCards,
  buildRunwayPlates,
  fetchHourlyForecastForCity,
  getActiveTemperatureSeries,
  getLiveObservationLabels,
  getObservationDisplayMetrics,
  getVisibleTemperatureSeries,
  isTemperatureSeriesVisibleByDefault,
  mergePatchIntoHourly,
  normObs,
  normalizeCityKey,
  prefersHighFrequencyRunwayResolution,
  readSessionCache,
  selectDisplayRunwayTemp,
  seedHourlyForecastFromRow,
  seriesStats,
  shouldPollLiveChart,
  validNumber,
};

export type { EvidenceSeries, HourlyForecast, PeakGlowMeta, PeakGlowState, ProbabilityOverlay };
