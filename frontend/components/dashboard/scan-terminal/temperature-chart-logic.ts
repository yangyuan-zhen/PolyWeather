import type {
  AirportCurrentConditions,
  CityDetail,
  CurrentConditions,
  ScanOpportunityRow,
  ForecastDay,
  DailyModelForecast,
  DebForecast,
  DebHourlyPath,
  ProbabilityBucket,
} from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import { DASHBOARD_REFRESH_POLICY_MS } from "@/lib/refresh-policy";
import { buildBrowserBackendHeaders } from "@/lib/backend-api";
import type { CityPatch } from "@/hooks/use-sse-patches";
const ROLLING_WINDOW_BEFORE_MS = 12 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_LIVE_MS = 2 * 60 * 60 * 1000;
const ROLLING_WINDOW_AFTER_FORECAST_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeCityKey(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function hasRecordEntries(value: unknown) {
  return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);
}

function isTemperatureSeriesVisibleByDefault(city: string, seriesKey: string) {
  if (seriesKey.startsWith("model_curve_")) {
    return true;
  }
  if (seriesKey === "metar") {
    const cityKey = normalizeCityKey(city);
    return (
      cityKey !== "hongkong" &&
      cityKey !== "laufaushan" &&
      cityKey !== "shenzhen"
    );
  }
  if (seriesKey === "madis") {
    return true;
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

function getActiveTemperatureSeries(
  city: string,
  chartSeries: EvidenceSeries[],
  userToggledKeys: Record<string, boolean>,
) {
  return getVisibleTemperatureSeries(city, chartSeries, userToggledKeys);
}

type ObsPoint = { time?: string | null; temp?: number | null };
type RawObsPoint = ObsPoint | [string | number | null, number | null | undefined];
type LooseObservationCondition = AirportCurrentConditions & {
  observation_time?: string | number | null;
  timestamp?: string | number | null;
  time?: string | number | null;
  icao?: string | null;
};

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

type LocalDayBounds = { start: number; end: number };

const MAX_OBS_POINTS = 1440;
const HOURLY_CACHE_TTL_MS = DASHBOARD_REFRESH_POLICY_MS.metar;
const SESSION_CACHE_TTL_MS = HOURLY_CACHE_TTL_MS;
const HOURLY_CACHE_STALE_TTL_MS = 6 * HOURLY_CACHE_TTL_MS;
const MAX_HOURLY_CACHE_ENTRIES = 160;
const HOURLY_FORCE_REFRESH_DEDUP_MS = 60_000;
const _hourlyCache = new Map<string, { ts: number; data: FullChartDetail }>();
const _hourlyRequestCache = new Map<string, Promise<FullChartDetail | null>>();
const MAX_HOURLY_DETAIL_CONCURRENT_REQUESTS = 3;
const HOURLY_DETAIL_REQUEST_TIMEOUT_MS = 16_000;
let _hourlyActiveDetailRequests = 0;
const _hourlyDetailRequestQueue: Array<() => void> = [];
const SHORT_RANGE_MODEL_CURVES = new Set(["AROME HD", "HRRR", "NAM", "ICON-D2", "HRDPS"]);
const SHORT_RANGE_MODEL_STALE_GRACE_MS = 2 * 60 * 60 * 1000;

const SESSION_CACHE_PREFIX = "polyweather_city_detail_v1:";

type HourlyCacheEntry = { ts: number; data: FullChartDetail };
type HourlyDetailSnapshotSource = "memory_cache" | "session_cache";
type HourlyDetailSnapshotEntry = HourlyCacheEntry & { source: HourlyDetailSnapshotSource };
type CityDetailBatchDiagnostics = Record<string, any>;
type CityDetailBatchDiagnosticsEntry = { ts: number; data: CityDetailBatchDiagnostics };

const _cityDetailBatchDiagnosticsCache = new Map<string, CityDetailBatchDiagnosticsEntry>();

function cityDetailBatchDiagnosticsKey(city: string, resolution: string) {
  return `${normalizeCityKey(city)}:${resolution || "10m"}`;
}

function rememberCityDetailBatchDiagnostics(
  city: string,
  resolution: string,
  diagnostics: unknown,
) {
  if (!diagnostics || typeof diagnostics !== "object") return;
  const key = cityDetailBatchDiagnosticsKey(city, resolution);
  if (!key.startsWith(":")) {
    _cityDetailBatchDiagnosticsCache.set(key, {
      ts: Date.now(),
      data: diagnostics as CityDetailBatchDiagnostics,
    });
  }
}

function readCityDetailBatchDiagnostics(
  city: string,
  resolution: string,
): CityDetailBatchDiagnostics | null {
  const key = cityDetailBatchDiagnosticsKey(city, resolution);
  const entry = _cityDetailBatchDiagnosticsCache.get(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.ts || 0) >= HOURLY_CACHE_TTL_MS) {
    _cityDetailBatchDiagnosticsCache.delete(key);
    return null;
  }
  return entry.data;
}

function hourlyCacheKey(city: string, resolution: string) {
  const cityKey = normalizeCityKey(city);
  return cityKey ? `${cityKey}:${resolution || "10m"}` : "";
}

function hourlyCacheEntryAgeMs(entry: HourlyCacheEntry | null | undefined, now = Date.now()) {
  if (!entry) return Number.POSITIVE_INFINITY;
  return now - Number(entry.ts || 0);
}

function isFreshHourlyCacheEntry(
  entry: HourlyCacheEntry | null | undefined,
  maxAgeMs = HOURLY_CACHE_TTL_MS,
) {
  const age = hourlyCacheEntryAgeMs(entry);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

function isRetainedHourlyCacheEntry(
  entry: HourlyCacheEntry | null | undefined,
  maxAgeMs = HOURLY_CACHE_STALE_TTL_MS,
) {
  const age = hourlyCacheEntryAgeMs(entry);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

function isUsableHourlyDetailCacheEntry(entry: HourlyCacheEntry | null | undefined) {
  return Boolean(toFullChartDetail(entry?.data || null));
}

function normalizeHourlyCacheEntry(entry: unknown): HourlyCacheEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const cached = entry as Partial<HourlyCacheEntry> | null;
  const ts = Number(cached?.ts || 0);
  const data = toFullChartDetail(cached?.data || null);
  if (!Number.isFinite(ts) || ts <= 0 || !data) return null;
  return { ts, data };
}

function pruneHourlyCache() {
  for (const [key, entry] of _hourlyCache.entries()) {
    const normalized = normalizeHourlyCacheEntry(entry);
    if (!normalized || !isRetainedHourlyCacheEntry(normalized, HOURLY_CACHE_STALE_TTL_MS)) {
      _hourlyCache.delete(key);
      continue;
    }
    if (normalized !== entry) _hourlyCache.set(key, normalized);
  }

  if (_hourlyCache.size <= MAX_HOURLY_CACHE_ENTRIES) return;

  const oldestFirst = Array.from(_hourlyCache.entries())
    .sort((left, right) => Number(left[1].ts || 0) - Number(right[1].ts || 0));
  for (const [key] of oldestFirst) {
    if (_hourlyCache.size <= MAX_HOURLY_CACHE_ENTRIES) break;
    _hourlyCache.delete(key);
  }
}

function rememberMemoryHourlyCacheEntry(cacheKey: string, entry: HourlyCacheEntry) {
  if (!cacheKey || !isUsableHourlyDetailCacheEntry(entry)) return;
  _hourlyCache.set(cacheKey, entry);
  pruneHourlyCache();
}

function readSessionCache(
  city: string,
  options: { allowStale?: boolean; maxAgeMs?: number } = {},
): HourlyCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_CACHE_PREFIX}${city}`);
    if (!raw) return null;
    const item = normalizeHourlyCacheEntry(JSON.parse(raw));
    const maxAgeMs = options.allowStale
      ? HOURLY_CACHE_STALE_TTL_MS
      : options.maxAgeMs ?? SESSION_CACHE_TTL_MS;
    if (!item || !isRetainedHourlyCacheEntry(item, HOURLY_CACHE_STALE_TTL_MS)) {
      sessionStorage.removeItem(`${SESSION_CACHE_PREFIX}${city}`);
      return null;
    }
    if (isRetainedHourlyCacheEntry(item, maxAgeMs)) {
      return item;
    }
  } catch {}
  return null;
}

function readHourlyCacheEntry(
  cacheKey: string,
  options: { allowStale?: boolean; maxAgeMs?: number } = {},
): HourlyCacheEntry | null {
  const cachedRaw = _hourlyCache.get(cacheKey);
  const cached = normalizeHourlyCacheEntry(cachedRaw);
  if (
    cached &&
    (options.allowStale ? isRetainedHourlyCacheEntry(cached) : isFreshHourlyCacheEntry(cached, options.maxAgeMs))
  ) {
    if (cached !== cachedRaw) _hourlyCache.set(cacheKey, cached);
    return cached;
  }
  if (cachedRaw && (!cached || !isRetainedHourlyCacheEntry(cached))) {
    _hourlyCache.delete(cacheKey);
  }

  const sessionEntry = readSessionCache(cacheKey, options);
  if (sessionEntry) {
    rememberMemoryHourlyCacheEntry(cacheKey, sessionEntry);
    return sessionEntry;
  }

  return null;
}

function readHourlyCacheSnapshot(
  cacheKey: string,
  options: { allowStale?: boolean; maxAgeMs?: number } = {},
): HourlyDetailSnapshotEntry | null {
  const cachedRaw = _hourlyCache.get(cacheKey);
  const cached = normalizeHourlyCacheEntry(cachedRaw);
  if (
    cached &&
    (options.allowStale ? isRetainedHourlyCacheEntry(cached) : isFreshHourlyCacheEntry(cached, options.maxAgeMs))
  ) {
    if (cached !== cachedRaw) _hourlyCache.set(cacheKey, cached);
    return { ...cached, source: "memory_cache" };
  }
  if (cachedRaw && (!cached || !isRetainedHourlyCacheEntry(cached))) {
    _hourlyCache.delete(cacheKey);
  }

  const sessionEntry = readSessionCache(cacheKey, options);
  if (sessionEntry) {
    rememberMemoryHourlyCacheEntry(cacheKey, sessionEntry);
    return { ...sessionEntry, source: "session_cache" };
  }

  return null;
}

function writeSessionCache(city: string, data: FullChartDetail, ts = Date.now()) {
  if (typeof window === "undefined" || !data) return;
  try {
    sessionStorage.setItem(
      `${SESSION_CACHE_PREFIX}${city}`,
      JSON.stringify({ ts, data })
    );
  } catch {}
}

function writeHourlyCacheEntry(cacheKey: string, data: FullChartDetail, ts = Date.now()) {
  if (!cacheKey || !data) return;
  rememberMemoryHourlyCacheEntry(cacheKey, { ts, data });
  writeSessionCache(cacheKey, data, ts);
}

function readHourlyDetailSnapshot(
  city: string,
  resolution: string,
  options: { allowStale?: boolean; maxAgeMs?: number } = {},
): HourlyDetailSnapshotEntry | null {
  const cacheKey = hourlyCacheKey(city, resolution);
  return cacheKey ? readHourlyCacheSnapshot(cacheKey, options) : null;
}

function readHourlyDetailSnapshotAgeMs(
  city: string,
  resolution: string,
) {
  const entry = readHourlyDetailSnapshot(city, resolution, { allowStale: true });
  return entry ? hourlyCacheEntryAgeMs(entry) : Number.POSITIVE_INFINITY;
}

function readCachedHourlyForInitialRow(
  city: string,
  preferredResolution: string,
): ChartRenderState {
  const cityKey = normalizeCityKey(city);
  if (!cityKey) return null;
  const resolutions = [
    preferredResolution,
    preferredResolution === "1m" ? "10m" : "1m",
  ].filter((value, index, list) => value && list.indexOf(value) === index);

  for (const resolution of resolutions) {
    const entry = readHourlyDetailSnapshot(cityKey, resolution, { allowStale: true });
    if (entry?.data) return entry.data;
  }
  return null;
}

function rememberHourlyDetailSnapshot(
  city: string,
  resolution: string,
  data: FullChartDetail,
) {
  const cityKey = normalizeCityKey(city);
  const detail = toFullChartDetail(data);
  if (!cityKey || !detail) return;
  const cacheKey = hourlyCacheKey(cityKey, resolution);
  writeHourlyCacheEntry(cacheKey, detail);
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
  _cityDetailBatchDiagnosticsCache.clear();
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
const __readHourlyCacheEntryForTest = readHourlyCacheEntry;

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

  const floatingIsoDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (floatingIsoDateTime) {
    return Date.UTC(
      Number(floatingIsoDateTime[1]),
      Number(floatingIsoDateTime[2]) - 1,
      Number(floatingIsoDateTime[3]),
      Number(floatingIsoDateTime[4]),
      Number(floatingIsoDateTime[5]),
      floatingIsoDateTime[6] ? Number(floatingIsoDateTime[6]) : 0,
    );
  }

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

function laterLocalDate(left?: string | null, right?: string | null) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDate(a) && isDate(b)) return a >= b ? a : b;
  return isDate(a) ? a : isDate(b) ? b : null;
}

function resolveChartLocalDate(row: ScanOpportunityRow | null, hourly: ChartRenderState) {
  const hourlyDate = hourly?.localDate || dateFromLocalTime(hourly?.localTime);
  const rowDate = row?.local_date || dateFromLocalTime(row?.local_time);
  return (
    laterLocalDate(hourlyDate, rowDate) ||
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
      source?.obs_time ??
      (source as LooseObservationCondition)?.observation_time ??
      (source as LooseObservationCondition)?.timestamp ??
      (source as LooseObservationCondition)?.time ??
      null;
    if (temp === null || !time) return;
    const key = `${String(time)}:${temp}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ time: String(time), temp });
  });

  return merged;
}

function isMgmAirportPrimary(hourly: ChartRenderState) {
  const primary = hourly?.airportPrimary;
  const sourceTokens = [
    primary?.source_code,
    primary?.source_label,
    primary?.source,
  ].map((value) => String(value || "").toLowerCase());
  return sourceTokens.some((value) => value === "mgm" || value.includes("turkey_mgm"));
}

function canonicalAirportPrimarySourceLabel(hourly: ChartRenderState) {
  const primary = hourly?.airportPrimary;
  const tokens = [
    primary?.source_code,
    primary?.source,
  ].map((value) => String(value || "").trim().toLowerCase());
  if (tokens.some((value) => value === "mgm" || value.includes("turkey_mgm"))) return "MGM";
  if (tokens.some((value) => value.includes("jma"))) return "JMA";
  if (tokens.some((value) => value.includes("fmi"))) return "FMI";
  if (tokens.some((value) => value.includes("knmi"))) return "KNMI";
  if (tokens.some((value) => value.includes("ims"))) return "IMS";
  if (tokens.some((value) => value.includes("ncm"))) return "NCM";
  if (tokens.some((value) => value.includes("aeroweb"))) return "AeroWeb";
  if (tokens.some((value) => value.includes("singapore_mss") || value === "mss")) return "MSS";
  if (tokens.some((value) => value.includes("madis") || value.includes("noaa"))) return "NOAA MADIS";
  return "";
}

function airportPrimaryHasMetarSource(hourly: ChartRenderState) {
  const primary = hourly?.airportPrimary;
  const tokens = [
    primary?.source_code,
    primary?.source_label,
    primary?.source,
  ].map((value) => String(value || "").trim().toLowerCase());
  return tokens.some((value) => value === "metar" || value.includes(" metar"));
}

function airportCodeForSeriesLabel(
  hourly: ChartRenderState,
  row?: ScanOpportunityRow | null,
) {
  const candidates = [
    hourly?.airportPrimary?.station_code,
    (hourly?.airportPrimary as LooseObservationCondition)?.icao,
    hourly?.settlementStationCode,
    row?.metar_context?.station,
    row?.icao,
    row?.station_code,
    row?.airport,
  ];
  const code = candidates
    .map((value) => String(value || "").trim().toUpperCase())
    .find((value) => /^[A-Z0-9]{4}$/.test(value));
  return code || "";
}

function isUsAirportCode(value: string) {
  return /^K[A-Z0-9]{3}$/.test(String(value || "").trim().toUpperCase());
}

function isGenericAirportPrimaryLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "metar" ||
    normalized === "madis" ||
    normalized === "noaa madis"
  );
}

function airportPrimarySeriesLabel(
  hourly: ChartRenderState,
  isHKO: boolean,
  row?: ScanOpportunityRow | null,
) {
  if (isHKO) return "HKO";
  const cityKey = normalizeCityKey(row?.city);
  const canonicalLabel = canonicalAirportPrimarySourceLabel(hourly);
  if (canonicalLabel === "MGM") return canonicalLabel;
  const stationCode = airportCodeForSeriesLabel(hourly, row);
  if (airportPrimaryHasMetarSource(hourly)) {
    return stationCode ? `${stationCode} METAR` : "METAR";
  }
  if ((cityKey === "ankara" || cityKey === "istanbul") && (!canonicalLabel || canonicalLabel === "NOAA MADIS")) {
    return "MGM";
  }
  const payloadLabel = String(hourly?.airportPrimary?.source_label || "").trim();
  if (payloadLabel && !isGenericAirportPrimaryLabel(payloadLabel)) return payloadLabel;
  const isUsAirport = isUsAirportCode(stationCode);
  if (!isUsAirport) {
    if (canonicalLabel && canonicalLabel !== "NOAA MADIS") return canonicalLabel;
    return stationCode ? `${stationCode} METAR` : "METAR";
  }
  return canonicalLabel || payloadLabel || "NOAA MADIS";
}

function airportPrimaryUsesMetarFallback(
  hourly: ChartRenderState,
  isHKO: boolean,
  row?: ScanOpportunityRow | null,
) {
  if (isHKO) return false;
  const cityKey = normalizeCityKey(row?.city);
  if (cityKey === "ankara" || cityKey === "istanbul") return false;
  const canonicalLabel = canonicalAirportPrimarySourceLabel(hourly);
  if (canonicalLabel && canonicalLabel !== "NOAA MADIS") return false;
  const payloadLabel = String(hourly?.airportPrimary?.source_label || "").trim();
  return !payloadLabel || isGenericAirportPrimaryLabel(payloadLabel);
}

function metarStationCodeForSeries(row?: ScanOpportunityRow | null, hourly?: ChartRenderState) {
  const candidates = [
    row?.metar_context?.station,
    hourly?.settlementStationCode,
    row?.station_code,
    row?.icao,
  ];
  return candidates
    .map((value) => String(value || "").trim().toUpperCase())
    .find((value) => /^[A-Z0-9]{4}$/.test(value)) || "";
}

function airportPrimaryMatchesMetarStation(hourly: ChartRenderState, row?: ScanOpportunityRow | null) {
  const primaryCode = airportCodeForSeriesLabel(hourly, row);
  const metarCode = metarStationCodeForSeries(row, hourly);
  return Boolean(primaryCode && metarCode && primaryCode === metarCode);
}

function airportPrimaryObservationPoints(hourly: ChartRenderState) {
  return appendLatestAirportObservation(
    hourly?.airportPrimaryTodayObs,
    hourly?.airportPrimary,
    ...(isMgmAirportPrimary(hourly) ? [] : [hourly?.airportCurrent]),
  );
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
  hourly: ChartRenderState,
) {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = resolveChartLocalDate(row, hourly);
  const settlementObs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset, MAX_OBS_POINTS, localDateStr);
  const metarObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset, MAX_OBS_POINTS, localDateStr);
  const madisObs = normObs(
    airportPrimaryObservationPoints(hourly),
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

  const currentObsTemp =
    latestMadis ??
    latestSettlement ??
    latestMetar ??
    airportCurrentTemp ??
    validNumber(row?.current_temp) ??
    null;
  const observedHighObs =
    highMadis ??
    highSettlement ??
    airportHigh ??
    highMetar ??
    validNumber(row?.current_max_so_far) ??
    currentObsTemp ??
    null;

  const currentMetarTemp =
    latestSettlement ??
    latestMetar ??
    airportCurrentTemp ??
    null;
  const observedHighMetar = airportHigh ?? highSettlement ?? highMetar ?? rowMetarHigh ?? null;

  return { currentMetarTemp, currentObsTemp, observedHighMetar, observedHighObs };
}

function selectCompactSecondaryTemp({
  isHKO,
  isShenzhen,
  displayMetarTemp,
  observedHighMetar,
}: {
  isHKO: boolean;
  isShenzhen: boolean;
  displayMetarTemp: number | null;
  observedHighMetar: number | null;
}) {
  if (isShenzhen) {
    return observedHighMetar;
  }
  // The compact secondary label is an observation cadence, so it must not display a daily high.
  if (isHKO) {
    return displayMetarTemp;
  }
  return displayMetarTemp;
}

function rowCurrentObservation(row: ScanOpportunityRow | null) {
  if (!row) return null;
  const metarContext = row.metar_context || null;
  const temp =
    validNumber(row.current_temp) ??
    validNumber(metarContext?.airport_current_temp) ??
    validNumber(metarContext?.last_temp);
  const time =
    metarContext?.airport_obs_time ||
    metarContext?.last_observation_time ||
    metarContext?.last_time ||
    row.local_time ||
    null;
  if (temp === null || !time) return null;
  const maxSoFar =
    validNumber(row.current_max_so_far) ??
    validNumber(metarContext?.airport_max_so_far) ??
    validNumber(metarContext?.max_temp) ??
    temp;
  return {
    temp,
    time: String(time),
    maxSoFar,
    sourceCode: String(metarContext?.source || "").trim() || null,
    sourceLabel: String(metarContext?.station_label || metarContext?.source || "").trim() || null,
  };
}

function appendRawObservationPoint(
  points: RawObsPoint[] | null | undefined,
  time: string,
  temp: number,
) {
  const merged = [...(points || [])];
  const normalizedTime = String(time || "").trim();
  if (!normalizedTime) return merged;
  const exists = merged
    .map(normalizeRawObsPoint)
    .some((point) => point?.time === normalizedTime && validNumber(point.temp) === temp);
  if (!exists) merged.push([normalizedTime, temp]);
  return merged.slice(-MAX_OBS_POINTS);
}

function rawObservationKey(point: RawObsPoint) {
  const normalized = normalizeRawObsPoint(point);
  const time = String(normalized?.time || "").trim();
  const temp = validNumber(normalized?.temp);
  if (!time || temp === null) return "";
  return `${time}:${temp}`;
}

function mergeRawObservationPoints(
  base: RawObsPoint[] | null | undefined,
  live: RawObsPoint[] | null | undefined,
) {
  const merged: RawObsPoint[] = [];
  const seen = new Set<string>();
  [...(base || []), ...(live || [])].forEach((point) => {
    const key = rawObservationKey(point);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(point);
  });
  return merged.length ? merged.slice(-MAX_OBS_POINTS) : undefined;
}

function observationTimeRank(
  value: string | number | null | undefined,
  row: ScanOpportunityRow | null,
  localDateStr: string | null | undefined,
) {
  const localRank = getCityLocalUtcTimestamp(
    value,
    row?.tz_offset_seconds ?? 0,
    localDateStr || row?.local_date || null,
  );
  if (localRank !== null) return localRank;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function conditionObservationTime(source: AirportCurrentConditions | null | undefined) {
  return (
    source?.obs_time ??
    (source as LooseObservationCondition)?.observation_time ??
    (source as LooseObservationCondition)?.timestamp ??
    (source as LooseObservationCondition)?.time ??
    null
  );
}

function conditionObservationSourceKey(source: AirportCurrentConditions | null | undefined) {
  const tokens = [
    source?.source_code,
    source?.source,
    source?.source_label,
  ].map((value) => String(value || "").trim().toLowerCase());
  if (tokens.some((value) => value === "mgm" || value.includes("turkey_mgm"))) return "mgm";
  if (tokens.some((value) => value === "metar" || value.includes(" metar"))) return "metar";
  return tokens.find(Boolean) || "";
}

function mergeAirportCondition(
  base: AirportCurrentConditions | null | undefined,
  live: AirportCurrentConditions | null | undefined,
  row: ScanOpportunityRow | null,
  localDateStr: string | null | undefined,
) {
  if (!base) return live || null;
  if (!live) return base || null;
  const baseTime = observationTimeRank(conditionObservationTime(base), row, localDateStr);
  const liveTime = observationTimeRank(conditionObservationTime(live), row, localDateStr);
  const liveIsAtLeastAsFresh = liveTime === null || baseTime === null || liveTime >= baseTime;
  const maxSoFar = Math.max(
    validNumber(base.max_so_far) ?? validNumber(base.temp) ?? Number.NEGATIVE_INFINITY,
    validNumber(live.max_so_far) ?? validNumber(live.temp) ?? Number.NEGATIVE_INFINITY,
  );
  const merged = liveIsAtLeastAsFresh ? { ...base, ...live } : { ...live, ...base };
  if (Number.isFinite(maxSoFar)) {
    merged.max_so_far = maxSoFar;
  }
  return merged;
}

function airportPrimaryObservationSourceChanged(
  base: ChartRenderState,
  live: ChartRenderState,
) {
  const baseSource =
    conditionObservationSourceKey(base?.airportPrimary) ||
    conditionObservationSourceKey(base?.airportCurrent);
  const liveSource =
    conditionObservationSourceKey(live?.airportPrimary) ||
    conditionObservationSourceKey(live?.airportCurrent);
  return Boolean(baseSource && liveSource && baseSource !== liveSource);
}

function hasFullHourlyDetailPayload(hourly: ChartRenderState) {
  if (!hourly) return false;
  return Boolean(
    (hourly.times || []).length > 0 ||
      (hourly.temps || []).length > 0 ||
      (hourly.debHourlyPath?.times || []).length > 0 ||
      Object.keys(hourly.modelCurves || {}).length > 0 ||
      (hourly.forecastDaily || []).length > 0 ||
      Object.keys(hourly.multiModelDaily || {}).length > 0,
  );
}

function toFullChartDetail(hourly: ChartRenderState): FullChartDetail | null {
  if (!hourly || !hasFullHourlyDetailPayload(hourly)) return null;
  if ((hourly as FullChartDetail)?.__detailKind === "full_chart_detail") return hourly as FullChartDetail;
  return {
    ...hourly,
    __detailKind: "full_chart_detail",
  };
}

function hasArrayItems<T>(value: T[] | null | undefined): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

function hasProbabilityPayload(value: LegacyGaussianProbabilitySource | null | undefined) {
  const distribution =
    value?.distribution_all ||
    value?.distribution ||
    [];
  return Boolean(value?.mu != null || distribution.length > 0 || value?.engine);
}

function preferNumber(
  primary: number | null | undefined,
  fallback: number | null | undefined,
) {
  return validNumber(primary) ?? validNumber(fallback) ?? null;
}

function preferArray<T>(
  primary: T[] | null | undefined,
  fallback: T[] | null | undefined,
) {
  return hasArrayItems(primary) ? primary : fallback;
}

function preferRecord<T>(
  primary: Record<string, T> | null | undefined,
  fallback: Record<string, T> | null | undefined,
) {
  return hasRecordEntries(primary) ? primary : fallback;
}

function latestRawObservationRank(
  points: RawObsPoint[] | null | undefined,
  row: ScanOpportunityRow | null,
  localDateStr: string | null | undefined,
) {
  let latest: number | null = null;
  (points || []).forEach((point) => {
    const normalized = normalizeRawObsPoint(point);
    const rank = observationTimeRank(normalized?.time, row, localDateStr);
    if (rank !== null) latest = latest === null ? rank : Math.max(latest, rank);
  });
  return latest;
}

function latestHourlyObservationRank(
  hourly: ChartRenderState,
  row: ScanOpportunityRow | null,
) {
  if (!hourly) return null;
  const localDateStr = hourly.localDate || row?.local_date || null;
  const ranks = [
    observationTimeRank(hourly.localTime, row, localDateStr),
    observationTimeRank(conditionObservationTime(hourly.airportCurrent), row, localDateStr),
    observationTimeRank(conditionObservationTime(hourly.airportPrimary), row, localDateStr),
    latestRawObservationRank(hourly.airportPrimaryTodayObs, row, localDateStr),
    latestRawObservationRank(hourly.metarTodayObs, row, localDateStr),
    latestRawObservationRank(hourly.settlementTodayObs, row, localDateStr),
  ].filter((rank): rank is number => rank !== null);
  return ranks.length ? Math.max(...ranks) : null;
}

function shouldKeepLiveHourlyDetailPayload(
  base: ChartRenderState,
  live: ChartRenderState,
  row: ScanOpportunityRow | null,
) {
  if (!base || !live) return false;
  if (!hasFullHourlyDetailPayload(base) || !hasFullHourlyDetailPayload(live)) return false;
  const baseRank = latestHourlyObservationRank(base, row);
  const liveRank = latestHourlyObservationRank(live, row);
  return baseRank !== null && liveRank !== null && liveRank > baseRank;
}

function hourlyLocalDatesConflict(
  base: ChartRenderState,
  live: ChartRenderState,
  row: ScanOpportunityRow | null,
) {
  const baseDate = String(base?.localDate || "").trim();
  const liveDate = String(live?.localDate || row?.local_date || "").trim();
  return Boolean(baseDate && liveDate && baseDate !== liveDate);
}

type ChartRenderState = {
  forecastTodayHigh?: number | null;
  debPrediction?: number | null;
  debQuality?: Pick<
    DebForecast,
    | "quality_tier"
    | "recommendation"
    | "recent_hit_rate"
    | "recent_samples"
    | "recent_hits"
    | "recent_mae"
    | "ensemble_signal"
  > | null;
  debHourlyPath?: DebHourlyPath | null;
  localDate?: string | null;
  localTime?: string | null;
  times: string[];
  temps: Array<number | null>;
  modelTimes?: string[];
  modelCurves?: Record<string, Array<number | null>>;
  current?: CurrentConditions | null;
  airportCurrent?: AirportCurrentConditions | null;
  airportPrimary?: AirportCurrentConditions | null;
  forecastDaily?: ForecastDay[];
  multiModelDaily?: Record<string, DailyModelForecast>;
  probabilities?: LegacyGaussianProbabilitySource | null;
  settlementTodayObs?: ObsPoint[];
  settlementStationCode?: string | null;
  settlementStationLabel?: string | null;
  metarTodayObs?: ObsPoint[];
  airportPrimaryTodayObs?: RawObsPoint[];
} | null;

type FullChartDetail = NonNullable<ChartRenderState> & {
  readonly __detailKind: "full_chart_detail";
};

function seedChartRenderStateFromRow(row: ScanOpportunityRow | null): ChartRenderState {
  if (!row) return null;
  const current = rowCurrentObservation(row);
  const sourceCode = current?.sourceCode || undefined;
  const sourceLabel = current?.sourceLabel || undefined;
  const airportCurrent = current
    ? {
        temp: current.temp,
        obs_time: current.time,
        max_so_far: current.maxSoFar,
        source_code: sourceCode,
        source_label: sourceLabel,
      }
    : null;
  const airportPrimary = current
    ? {
        temp: current.temp,
        obs_time: current.time,
        max_so_far: current.maxSoFar,
        source_code: sourceCode,
        source_label: sourceLabel,
        source: sourceCode,
      }
    : null;
  return {
    forecastTodayHigh: null,
    debPrediction: validNumber(row.deb_prediction),
    debQuality: null,
    debHourlyPath: null,
    localDate: row.local_date || null,
    localTime: row.local_time || null,
    times: [],
    temps: [],
    modelTimes: undefined,
    modelCurves: undefined,
    current: null,
    airportCurrent,
    airportPrimary,
    forecastDaily: [],
    multiModelDaily: {},
    probabilities: {
      engine: row.probability_engine || null,
      distribution: row.distribution_preview || [],
      distribution_all: row.distribution_full || row.distribution_preview || [],
    },
    settlementTodayObs: row.settlement_today_obs || row.metar_context?.settlement_today_obs || undefined,
    settlementStationCode: row.metar_context?.station || row.station_code || row.icao || null,
    metarTodayObs: row.metar_today_obs || row.metar_context?.today_obs || row.metar_recent_obs || row.metar_context?.recent_obs || undefined,
    airportPrimaryTodayObs: current
      ? appendRawObservationPoint(undefined, current.time, current.temp)
      : undefined,
  };
}

function mergeHourlyWithLiveObservations(
  base: ChartRenderState,
  live: ChartRenderState,
  row: ScanOpportunityRow | null,
): ChartRenderState {
  if (!base) return live;
  if (!live) return base;
  if (hourlyLocalDatesConflict(base, live, row)) return base;
  const detailSource = shouldKeepLiveHourlyDetailPayload(base, live, row) ? live : base;
  const forecastFallback = detailSource === base ? live : base;
  const localDate = detailSource.localDate || base.localDate || live.localDate || row?.local_date || null;
  const useLiveAirportPrimary =
    airportPrimaryObservationSourceChanged(base, live) &&
    Array.isArray(live.airportPrimaryTodayObs) &&
    live.airportPrimaryTodayObs.length > 0;
  return {
    ...detailSource,
    localDate,
    localTime: live.localTime || base.localTime,
    forecastTodayHigh: preferNumber(detailSource.forecastTodayHigh, forecastFallback.forecastTodayHigh),
    debPrediction: preferNumber(detailSource.debPrediction, forecastFallback.debPrediction),
    debQuality: hasRecordEntries(detailSource.debQuality) ? detailSource.debQuality : forecastFallback.debQuality,
    debHourlyPath: detailSource.debHourlyPath || forecastFallback.debHourlyPath || null,
    times: preferArray(detailSource.times, forecastFallback.times) || [],
    temps: preferArray(detailSource.temps, forecastFallback.temps) || [],
    modelTimes: preferArray(detailSource.modelTimes, forecastFallback.modelTimes) || undefined,
    modelCurves: preferRecord(detailSource.modelCurves, forecastFallback.modelCurves) || undefined,
    forecastDaily: preferArray(detailSource.forecastDaily, forecastFallback.forecastDaily) || [],
    multiModelDaily: preferRecord(detailSource.multiModelDaily, forecastFallback.multiModelDaily) || {},
    probabilities: hasProbabilityPayload(detailSource.probabilities)
      ? detailSource.probabilities
      : forecastFallback.probabilities || null,
    airportCurrent: useLiveAirportPrimary
      ? live.airportCurrent || live.airportPrimary || null
      : mergeAirportCondition(base.airportCurrent, live.airportCurrent, row, localDate),
    airportPrimary: useLiveAirportPrimary
      ? live.airportPrimary || live.airportCurrent || null
      : mergeAirportCondition(base.airportPrimary, live.airportPrimary, row, localDate),
    settlementTodayObs: mergeRawObservationPoints(base.settlementTodayObs, live.settlementTodayObs) as ObsPoint[] | undefined,
    settlementStationCode: detailSource.settlementStationCode || forecastFallback.settlementStationCode || row?.metar_context?.station || null,
    settlementStationLabel: detailSource.settlementStationLabel || forecastFallback.settlementStationLabel || null,
    metarTodayObs: mergeRawObservationPoints(base.metarTodayObs, live.metarTodayObs) as ObsPoint[] | undefined,
    airportPrimaryTodayObs: useLiveAirportPrimary
      ? live.airportPrimaryTodayObs
      : mergeRawObservationPoints(
          base.airportPrimaryTodayObs,
          live.airportPrimaryTodayObs,
        ),
  };
}

function mergeObservationSnapshotIntoHourly(
  prev: ChartRenderState,
  snapshot: ObservationSnapshot | null | undefined,
): ChartRenderState {
  const live = observationSnapshotToHourly(snapshot);
  if (!prev) return live;
  if (!live) return prev;
  return mergeHourlyWithLiveObservations(prev, live, null);
}

function mergeRowObservationIntoHourly(
  prev: ChartRenderState,
  row: ScanOpportunityRow | null,
): ChartRenderState {
  const seeded = seedChartRenderStateFromRow(row);
  if (!prev) return seeded;
  return mergeHourlyWithLiveObservations(prev, seeded, row);
}

function selectInitialHourlyForRowChange({
  cachedHourly,
  previousCity,
  previousHourly,
  row,
}: {
  cachedHourly?: ChartRenderState;
  previousCity?: string | null;
  previousHourly?: ChartRenderState;
  row: ScanOpportunityRow | null;
}): ChartRenderState {
  const seeded = seedChartRenderStateFromRow(row);
  const nextCity = normalizeCityKey(row?.city);
  if (!nextCity) return seeded;

  if (cachedHourly) {
    return mergeHourlyWithLiveObservations(cachedHourly, seeded, row);
  }

  if (previousHourly && normalizeCityKey(previousCity) === nextCity) {
    return mergeHourlyWithLiveObservations(previousHourly, seeded, row);
  }

  return seeded;
}

type ChartDetailFetchOptions = {
  bypassLocalCache?: boolean;
  ignoreCache?: boolean;
  resolution?: string;
};

type CityObservationPayload = {
  city?: string | null;
  local_date?: string | null;
  local_time?: string | null;
  current?: Record<string, any> | null;
  airport_current?: Record<string, any> | null;
  airport_primary?: Record<string, any> | null;
  metar_today_obs?: Array<Record<string, any>>;
  timeseries?: {
    metar_today_obs?: Array<Record<string, any>>;
  } | null;
};

type ObservationSnapshot = CityObservationPayload & {
  readonly __observationKind: "observation_snapshot";
};

type CityDetailBatchPayload = {
  cities?: string[];
  details?: Record<string, CityDetail | null | undefined>;
  diagnostics?: CityDetailBatchDiagnostics;
  errors?: Record<string, string>;
  missing?: string[];
  partial?: boolean;
};

type CityDetailBatchWaiter = {
  resolve: (value: FullChartDetail | null) => void;
  reject: (reason?: unknown) => void;
};

type CityDetailBatchQueue = {
  cities: Set<string>;
  waiters: Map<string, CityDetailBatchWaiter[]>;
  timer: ReturnType<typeof setTimeout> | null;
  resolution: string;
  forceRefresh: boolean;
};

const CITY_DETAIL_BATCH_WINDOW_MS = 100;
const CITY_DETAIL_BATCH_MAX_CITIES = 12;
const _cityDetailBatchQueues = new Map<string, CityDetailBatchQueue>();

function normalizeObservationCondition(block: Record<string, any> | null | undefined): AirportCurrentConditions | null {
  if (!block || typeof block !== "object") return null;
  const temp = validNumber(block.temp);
  const obsTime = String(block.obs_time || block.observed_at || block.observation_time || block.time || "").trim();
  if (temp === null || !obsTime) return null;
  return {
    ...(block as AirportCurrentConditions),
    temp,
    obs_time: obsTime,
    max_so_far: validNumber(block.max_so_far) ?? validNumber(block.max_temp_so_far) ?? temp,
    source_code: String(block.source_code || block.source || "").trim() || null,
    source_label: String(block.source_label || block.settlement_source_label || block.source || "").trim() || null,
    station_code: String(block.station_code || block.icao || "").trim() || null,
    station_label: String(block.station_label || block.station_name || "").trim() || null,
  };
}

function normalizeObservationPoint(point: Record<string, any>): ObsPoint | null {
  const temp = validNumber(point.temp);
  const time = String(point.time || point.obs_time || point.observed_at || point.observation_time || "").trim();
  if (temp === null || !time) return null;
  return { time, temp };
}

function observationPayloadToSnapshot(payload: CityObservationPayload | null | undefined): ObservationSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  if ((payload as ObservationSnapshot)?.__observationKind === "observation_snapshot") return payload as ObservationSnapshot;
  return {
    ...payload,
    __observationKind: "observation_snapshot",
  };
}

function observationSnapshotToHourly(snapshot: ObservationSnapshot | null | undefined): ChartRenderState {
  if (!snapshot || typeof snapshot !== "object") return null;
  const airportCurrent = normalizeObservationCondition(snapshot.airport_current || snapshot.current);
  const airportPrimary = normalizeObservationCondition(snapshot.airport_primary || snapshot.airport_current || snapshot.current);
  const current = snapshot.current && typeof snapshot.current === "object"
    ? {
        ...(snapshot.current as CurrentConditions),
        temp: validNumber(snapshot.current.temp),
      }
    : null;
  const metarTodayObs = [
    ...((snapshot.timeseries?.metar_today_obs || []) as Array<Record<string, any>>),
    ...((snapshot.metar_today_obs || []) as Array<Record<string, any>>),
  ]
    .map(normalizeObservationPoint)
    .filter((point): point is ObsPoint => point !== null);
  const airportPrimaryTodayObs = (airportPrimary?.obs_time && validNumber(airportPrimary.temp) !== null)
    ? appendRawObservationPoint(undefined, airportPrimary.obs_time, Number(airportPrimary.temp))
    : undefined;
  return {
    forecastTodayHigh: null,
    debPrediction: null,
    debQuality: null,
    debHourlyPath: null,
    localDate: snapshot.local_date || null,
    localTime: snapshot.local_time || airportPrimary?.obs_time || airportCurrent?.obs_time || null,
    times: [],
    temps: [],
    modelTimes: undefined,
    modelCurves: undefined,
    forecastDaily: [],
    multiModelDaily: {},
    probabilities: null,
    current,
    airportCurrent,
    airportPrimary,
    metarTodayObs: metarTodayObs.length ? metarTodayObs : undefined,
    airportPrimaryTodayObs,
  };
}

type LooseCityDetailPayload = {
  overview?: { deb_prediction?: number | null; local_date?: string | null };
  timeseries?: {
    hourly?: { times?: string[]; temps?: Array<number | null> };
    models_hourly?: { times?: string[]; curves?: Record<string, Array<number | null>> };
    settlement_today_obs?: Array<{ time?: string; temp?: number | null }>;
    metar_today_obs?: Array<{ time?: string; temp?: number | null }>;
  };
  official?: { airport_primary_today_obs?: Array<{ time?: string; temp?: number | null }> };
};

function parseFullChartDetailFromCityDetail(json: CityDetail | null): FullChartDetail | null {
  const hourlySource = json?.hourly ?? (json as LooseCityDetailPayload)?.timeseries?.hourly;
  if (!json || !hourlySource) return null;
  const parsed: ChartRenderState = {
    forecastTodayHigh: json.forecast?.today_high ?? null,
    debPrediction: json.deb?.prediction ?? (json as LooseCityDetailPayload)?.overview?.deb_prediction ?? null,
    debQuality: json.deb ? {
      quality_tier: json.deb.quality_tier,
      recommendation: json.deb.recommendation,
      recent_hit_rate: json.deb.recent_hit_rate,
      recent_samples: json.deb.recent_samples,
      recent_hits: json.deb.recent_hits,
      recent_mae: json.deb.recent_mae,
      ensemble_signal: json.deb.ensemble_signal,
    } : null,
    debHourlyPath: json.deb?.hourly_path || null,
    localDate: json.local_date || (json as LooseCityDetailPayload)?.overview?.local_date || null,
    localTime: json.local_time || null,
    times: hourlySource.times || [],
    temps: hourlySource.temps || [],
    modelTimes: (json.models_hourly ?? (json as LooseCityDetailPayload)?.timeseries?.models_hourly)?.times || undefined,
    modelCurves: (json.models_hourly ?? (json as LooseCityDetailPayload)?.timeseries?.models_hourly)?.curves || undefined,
    current: json.current || null,
    airportCurrent: json.airport_current || null,
    airportPrimary: json.airport_primary || null,
    forecastDaily: json.forecast?.daily || [],
    multiModelDaily: json.multi_model_daily || {},
    probabilities: json.probabilities || null,
    settlementTodayObs: (json as LooseCityDetailPayload).timeseries?.settlement_today_obs || json.settlement_today_obs || undefined,
    settlementStationCode: json.settlement_station?.settlement_station_code || json.settlement_station?.airport_code || null,
    settlementStationLabel: json.settlement_station?.settlement_station_label || null,
    metarTodayObs: (json as LooseCityDetailPayload).timeseries?.metar_today_obs || json.metar_today_obs || undefined,
    airportPrimaryTodayObs: (json as LooseCityDetailPayload)?.official?.airport_primary_today_obs || json.airport_primary_today_obs || undefined,
  };
  return toFullChartDetail(parsed);
}

function primeCityDetailCache(
  city: string,
  resolution: string,
  detail: CityDetail | null | undefined,
): FullChartDetail | null {
  const data = parseFullChartDetailFromCityDetail(detail || null);
  if (!data) return null;
  const cacheKey = hourlyCacheKey(city, resolution);
  writeHourlyCacheEntry(cacheKey, data);
  return data;
}

function cityDetailBatchQueueKey(resolution: string, forceRefresh: boolean) {
  return `${resolution}:${forceRefresh ? "force" : "cached"}`;
}

function queueCityDetailBatch(
  city: string,
  resolution: string,
  forceRefresh: boolean,
): Promise<FullChartDetail | null> {
  return new Promise<FullChartDetail | null>((resolve, reject) => {
    const queueKey = cityDetailBatchQueueKey(resolution, forceRefresh);
    const queue = _cityDetailBatchQueues.get(queueKey) || {
      cities: new Set<string>(),
      waiters: new Map<string, CityDetailBatchWaiter[]>(),
      timer: null,
      resolution,
      forceRefresh,
    };
    _cityDetailBatchQueues.set(queueKey, queue);

    const cityWaiters = queue.waiters.get(city) || [];
    cityWaiters.push({ resolve, reject });
    queue.waiters.set(city, cityWaiters);
    queue.cities.add(city);

    if (queue.timer === null) {
      queue.timer = setTimeout(() => flushCityDetailBatch(queueKey), CITY_DETAIL_BATCH_WINDOW_MS);
    }
    if (queue.cities.size >= CITY_DETAIL_BATCH_MAX_CITIES) {
      flushCityDetailBatch(queueKey);
    }
  });
}

function resolveBatchWaiters(
  waiters: CityDetailBatchWaiter[] | undefined,
  value: FullChartDetail | null,
) {
  (waiters || []).forEach((waiter) => waiter.resolve(value));
}

function resolveCityDetailFromBatch(
  details: Record<string, CityDetail | null | undefined> | undefined,
  city: string,
) {
  if (!details) return undefined;
  const trimmed = String(city || "").trim();
  const direct =
    details[city] ||
    details[trimmed] ||
    details[trimmed.toLowerCase()] ||
    details[normalizeCityKey(trimmed)];
  if (direct) return direct;

  const requestedKey = normalizeCityKey(trimmed);
  if (!requestedKey) return undefined;
  for (const [key, detail] of Object.entries(details)) {
    if (!detail) continue;
    if (normalizeCityKey(key) === requestedKey) return detail;
    const detailCity = detail.city || detail.name || detail.display_name;
    if (normalizeCityKey(detailCity) === requestedKey) return detail;
  }
  return undefined;
}

async function flushCityDetailBatch(queueKey: string) {
  const queue = _cityDetailBatchQueues.get(queueKey);
  if (!queue) return;
  _cityDetailBatchQueues.delete(queueKey);
  if (queue.timer !== null) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  const cities = Array.from(queue.cities).sort();
  if (!cities.length) return;

  try {
    const payload = await fetchCityDetailBatchWithTimeout(
      cities,
      queue.resolution,
      queue.forceRefresh,
    );
    if (!payload) {
      resolveAllBatchWaitersAsNull(cities, queue);
      return;
    }

    const details = payload?.details || {};
    const diagnostics = payload?.diagnostics || null;
    const partialMissingCities =
      payload?.partial === true
        ? new Set((payload.missing || []).map((city) => normalizeCityKey(city)))
        : new Set<string>();
    await Promise.all(
      cities.map(async (city) => {
        const waiters = queue.waiters.get(city);
        rememberCityDetailBatchDiagnostics(city, queue.resolution, diagnostics);
        const detail = resolveCityDetailFromBatch(details, city);
        const data = primeCityDetailCache(city, queue.resolution, detail);
        if (data) {
          resolveBatchWaiters(waiters, data);
          return;
        }
        if (partialMissingCities.has(normalizeCityKey(city))) {
          resolveBatchWaiters(waiters, null);
          return;
        }
        resolveBatchWaiters(waiters, null);
      }),
    );
  } catch (error) {
    resolveAllBatchWaitersAsNull(cities, queue);
  }
}

function resolveAllBatchWaitersAsNull(
  cities: string[],
  queue: CityDetailBatchQueue,
) {
  cities.forEach((city) => {
    resolveBatchWaiters(queue.waiters.get(city), null);
  });
}

async function fetchCityDetailBatchWithTimeout(
  cities: string[],
  resolution: string,
  forceRefresh: boolean,
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), HOURLY_DETAIL_REQUEST_TIMEOUT_MS);
  const params = new URLSearchParams({
    cities: cities.join(","),
    depth: "full",
    force_refresh: forceRefresh ? "true" : "false",
    limit: String(Math.max(cities.length, CITY_DETAIL_BATCH_MAX_CITIES)),
    resolution,
    scope: "chart",
  });
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return fetch(`/api/cities/detail-batch?${params.toString()}`, {
    headers,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) return null;
      return res.json() as Promise<CityDetailBatchPayload>;
    })
    .catch(() => null)
    .finally(() => globalThis.clearTimeout(timeoutId));
}

async function fetchLiveObservationForCity(city: string): Promise<ObservationSnapshot | null> {
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return fetch(`/api/city/${encodeURIComponent(city)}/observation`, {
    cache: "no-store",
    headers,
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const payload = await res.json() as CityObservationPayload;
      return observationPayloadToSnapshot(payload);
    })
    .catch(() => null);
}

async function fetchFullChartDetailForCity(
  city: string,
  options: ChartDetailFetchOptions = {},
): Promise<FullChartDetail | null> {
  const resParam = options.resolution || "10m";
  const cacheKey = hourlyCacheKey(city, resParam);
  const forceRefresh = Boolean(options.ignoreCache);
  const bypassLocalCache = forceRefresh || Boolean(options.bypassLocalCache);

  if (!bypassLocalCache) {
    const cached = readHourlyCacheEntry(cacheKey);
    if (cached) {
      return cached.data;
    }
  } else if (forceRefresh) {
    const recentlyRefreshed = readHourlyCacheEntry(cacheKey, {
      maxAgeMs: HOURLY_FORCE_REFRESH_DEDUP_MS,
    });
    if (recentlyRefreshed) {
      return recentlyRefreshed.data;
    }
  }

  const requestKey = forceRefresh
    ? `${city}:${resParam}:live`
    : bypassLocalCache
      ? `${city}:${resParam}:revalidate`
      : `${city}:${resParam}`;
  const pending = _hourlyRequestCache.get(requestKey);
  if (pending) return pending;

  const request = queueCityDetailBatch(city, resParam, forceRefresh)
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
  hourly: ChartRenderState,
) {
  const normalizedKey = normalizeCityKey(row?.city);
  const weatherStationCities = new Set(["ankara", "istanbul"]);
  const isShenzhen = normalizedKey === "shenzhen";
  const isHKO = (normalizedKey === "hongkong" || normalizedKey === "laufaushan") && !isShenzhen;
  const isTokyo = normalizedKey === "tokyo";
  const isSingapore = normalizedKey === "singapore";
  const isParis = normalizedKey === "paris";
  const sourceTokens = [
    hourly?.airportPrimary?.source,
    hourly?.airportPrimary?.source_code,
    hourly?.airportPrimary?.source_label,
    hourly?.airportCurrent?.source,
    hourly?.airportCurrent?.source_code,
    hourly?.airportCurrent?.source_label,
    row?.station_source_code,
    row?.network_provider,
    row?.network_provider_label,
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
  const isWeatherStation =
    !isHKO && !isShenzhen && !isTokyo && !isSingapore && !isParis
    && hasRealStationNetwork;

  const obsHeaderLabel = isShenzhen ? "天文台实测 (10分钟)"
    : isHKO ? "参考站点 (1分钟)"
    : isTokyo ? "机场气象站 (10分钟)"
    : isSingapore ? "航站楼温度"
    : isParis ? "官方机场观测 (15分钟)"
    : isWeatherStation ? "气象站实测"
    : "机场报文";

  const metarHeaderLabel = (isShenzhen || isHKO) ? "天文台实测 (10分钟)"
    : "METAR 结算 (30分钟)";

  const obsHighLabel = isShenzhen ? "天文台实测"
    : isHKO ? "参考站点"
    : isTokyo ? "机场气象站"
    : isSingapore ? "航站楼"
    : isParis ? "官方机场观测"
    : isWeatherStation ? "气象站"
    : "机场报文";

  const metarHighLabel = isShenzhen ? "天文台"
    : isHKO ? "天文台"
    : "METAR 官方";

  return {
    isHKO,
    isParis,
    isShenzhen,
    isWeatherStation,
    metarHeaderLabel,
    metarHighLabel,
    obsHeaderLabel,
    obsHighLabel,
  };
}

function mergePatchIntoHourly(
  prev: ChartRenderState,
  patch: CityPatch,
): ChartRenderState {
  const changes = patch.changes || {};
  const tempValue = validNumber(changes.temp);
  const observedAtUtc = typeof changes.observed_at_utc === "string" ? changes.observed_at_utc : null;
  const obsTime = observedAtUtc || (typeof changes.obs_time === "string" ? changes.obs_time : null);
  const source = typeof changes.source === "string" ? changes.source : "";
  const explicitHourlyPatch = changes.hourly && typeof changes.hourly === "object"
    ? changes.hourly as Partial<NonNullable<ChartRenderState>>
    : {};

  const next: NonNullable<ChartRenderState> = {
    ...(prev || {
      forecastTodayHigh: null,
      debPrediction: null,
      debQuality: null,
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

  if (typeof changes.local_date === "string") {
    next.localDate = changes.local_date;
  }
  if (typeof changes.city_local_date === "string") {
    next.localDate = changes.city_local_date;
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
  hourly: ChartRenderState,
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
  hourly: ChartRenderState,
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

function resolveModelCurveTimes(
  hourly: ChartRenderState,
  modelTemps: Array<number | null>,
) {
  if (hourly?.modelTimes?.length) return hourly.modelTimes;
  return hourly?.times?.length === modelTemps.length ? hourly.times : [];
}

function isShortRangeModelCurve(model: string) {
  return SHORT_RANGE_MODEL_CURVES.has(String(model || "").trim().toUpperCase());
}

function shouldRenderModelCurve(
  model: string,
  values: Array<number | null>,
  timeline: number[],
  row: ScanOpportunityRow | null,
  hourly: ChartRenderState,
  tzOffsetSeconds: number,
  localDateStr: string,
) {
  if (!isShortRangeModelCurve(model)) return true;
  const currentTs = getCityLocalUtcTimestamp(
    hourly?.localTime || row?.local_time,
    tzOffsetSeconds,
    localDateStr,
  );
  if (currentTs === null) return true;

  let latestValidTs: number | null = null;
  values.forEach((value, index) => {
    if (validNumber(value) === null) return;
    const ts = timeline[index];
    if (!Number.isFinite(ts)) return;
    latestValidTs = latestValidTs === null ? ts : Math.max(latestValidTs, ts);
  });

  return latestValidTs !== null && latestValidTs >= currentTs - SHORT_RANGE_MODEL_STALE_GRACE_MS;
}

function formatDailySlotLabel(timeStr: string): string {
  // "2026-08-11T00:00" -> "8/11" at midnight, "08:00" otherwise: the 3D axis
  // renders every hour, so date markers land on each local-day boundary.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/.exec(String(timeStr || "").trim());
  if (!match) return String(timeStr || "");
  const hour = Number(match[4]);
  if (hour === 0 && Number(match[5]) === 0) {
    return `${Number(match[2])}/${Number(match[3])}`;
  }
  return `${match[4]}:${match[5]}`;
}

function build72hChartData(
  row: ScanOpportunityRow | null,
  hourly: ChartRenderState,
): { data: Array<Record<string, any>>; series: EvidenceSeries[] } {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const modelTimes = Array.isArray(hourly?.modelTimes) ? hourly.modelTimes : [];
  const modelCurves = (hourly?.modelCurves || {}) as Record<string, Array<number | null>>;
  if (modelTimes.length === 0 || Object.keys(modelCurves).length === 0) {
    return { data: [], series: [] };
  }

  const rows: Array<Record<string, any>> = [];
  modelTimes.forEach((timeStr, index) => {
    const ts = getCityLocalUtcTimestamp(timeStr, tzOffset);
    if (ts === null) return;
    // X-axis label: "M/D HH:00" so the three day boundaries are visible.
    const label = formatDailySlotLabel(timeStr);
    const values: number[] = [];
    Object.keys(modelCurves).forEach((key) => {
      const arr = modelCurves[key];
      const value = arr && index < arr.length ? validNumber(arr[index]) : null;
      if (value !== null) values.push(value);
    });
    if (values.length === 0) {
      rows.push({ ts, label, model_median: null, model_min: null, model_max: null });
      return;
    }
    const sorted = [...values].sort((a, b) => a - b);
    rows.push({
      ts,
      label,
      model_median: sorted[Math.floor(values.length / 2)],
      model_min: sorted[0],
      model_max: sorted[values.length - 1],
    });
  });
  if (rows.length === 0) return { data: [], series: [] };

  // Live observations for the local day (same fallback chain as the 1D chart).
  const localDateStr = resolveChartLocalDate(row, hourly);
  const obsPoints = normObs(
    hourly?.settlementTodayObs ||
      row?.settlement_today_obs ||
      row?.metar_context?.settlement_today_obs ||
      hourly?.metarTodayObs ||
      row?.metar_today_obs ||
      row?.metar_context?.today_obs,
    tzOffset,
    undefined,
    localDateStr || null,
  );
  const obsByTs = new Map(obsPoints.map((point) => [point.ts, point.value]));
  const observationSeries = rows.map((entry) => obsByTs.get(entry.ts) ?? null);

  // DEB anchors: today's hourly path plus daily DEB predictions for the
  // following days (multiModelDaily), sampled at noon local time.
  const debByTs = new Map<number, number>();
  const debPath = hourly?.debHourlyPath;
  if (
    debPath &&
    Array.isArray(debPath.times) &&
    Array.isArray(debPath.temps)
  ) {
    debPath.times.forEach((timeText, index) => {
      const ts = getCityLocalUtcTimestamp(timeText, tzOffset, localDateStr);
      const value = validNumber(debPath.temps?.[index]);
      if (ts !== null && value !== null) debByTs.set(ts, value);
    });
  }
  const multiDaily = (hourly?.multiModelDaily || {}) as Record<
    string,
    { deb?: { prediction?: number | null } | null }
  >;
  Object.keys(multiDaily).forEach((dateStr) => {
    const debValue = validNumber(multiDaily[dateStr]?.deb?.prediction);
    if (debValue === null) return;
    const ts = getCityLocalUtcTimestamp(`${dateStr}T12:00`, tzOffset);
    if (ts !== null) debByTs.set(ts, debValue);
  });
  const debSeries = rows.map((entry) => debByTs.get(entry.ts) ?? null);

  const series: EvidenceSeries[] = [
    {
      key: "observation",
      label: "Live",
      source: "Live",
      color: "#0d9488",
      featured: true,
      values: observationSeries,
    },
    {
      key: "model_median",
      label: "Model Consensus",
      source: "Multi-model hourly",
      color: "#f97316",
      featured: true,
      values: rows.map((entry) => entry.model_median),
    },
    {
      key: "model_min",
      label: "Model Min",
      source: "Multi-model hourly",
      color: "#3b82f6",
      dashed: true,
      values: rows.map((entry) => entry.model_min),
    },
    {
      key: "model_max",
      label: "Model Max",
      source: "Multi-model hourly",
      color: "#ef4444",
      dashed: true,
      values: rows.map((entry) => entry.model_max),
    },
    {
      key: "deb_72h",
      label: "DEB",
      source: "DEB",
      color: "#f59e0b",
      dashed: true,
      values: debSeries,
    },
  ];

  return { data: rows, series };
}

function buildFullDayChartData(
  row: ScanOpportunityRow | null,
  hourly: ChartRenderState,
  isEn: boolean,
): { data: Array<Record<string, any>>; series: EvidenceSeries[] } {
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
      airportPrimaryObservationPoints(hourly),
      tzOffset,
      MAX_OBS_POINTS,
      localDateStr,
    ),
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

  // ── Settlement / MADIS fallback ──
  const isHKOCity = settlementCityKey === 'hongkong' || settlementCityKey === 'laufaushan'
    || settlementCityKey === 'shenzhen' || (row?.city || '').toLowerCase().includes('hong kong')
    || (row?.city || '').toLowerCase().includes('lau fau shan');
  const isRedundantMetarFallback =
    finalMadisObs.length > 0 &&
    airportPrimaryUsesMetarFallback(hourly, isHKO, row) &&
    airportPrimaryMatchesMetarStation(hourly, row);
  const shouldRenderMetar =
    metarObs.length > 0 &&
    !isRedundantMetarFallback &&
    !observationSetContains(finalMadisObs, metarObs);

  const timelineSet = new Set<number>();
  finalSettlementObs.forEach((point) => timelineSet.add(point.ts));
  finalMadisObs.forEach((point) => timelineSet.add(point.ts));
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
  if (hourly?.modelCurves) {
    Object.values(hourly.modelCurves).forEach((modelTemps) => {
      addHourlyTimesToTimeline(
        timelineSet,
        resolveModelCurveTimes(hourly, modelTemps),
        modelTemps,
        tzOffset,
        localDateStr,
        localDayBounds,
      );
    });
  }

  const fallbackAnchor = resolveFullDayFallbackAnchor(row, hourly, tzOffset, localDateStr);
  const timeline = ensureRenderableTimeline(sortedTimeline(timelineSet), fallbackAnchor);
  const n = timeline.length;
  const indexByTs = buildTimelineIndex(timeline);
  const series: EvidenceSeries[] = [];

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

  // ── Airport Primary (MADIS) ──
  if (finalMadisObs.length) {
    const madisVals = valuesAtTimeline(n, indexByTs, finalMadisObs);
    if (madisVals.some((v) => v !== null)) {
      series.push({
        key: "madis",
        label: airportPrimarySeriesLabel(hourly, isHKO, row),
        source: isHKO ? "HKO" : (airportCodeForSeriesLabel(hourly, row) || row?.airport || "MADIS"),
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
    if (hourly?.modelCurves) {
      const modelColors = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];
      Object.keys(hourly.modelCurves).forEach((model, idx) => {
        const modelTemps = hourly.modelCurves![model];
        if (!modelTemps?.length) return;
        const vals = valuesForHourlyTimes(
          n,
          indexByTs,
          resolveModelCurveTimes(hourly, modelTemps),
          modelTemps,
          tzOffset,
          localDateStr,
          localDayBounds,
        );
        if (vals.some((v) => v !== null)) {
          if (!shouldRenderModelCurve(model, vals, timeline, row, hourly, tzOffset, localDateStr)) return;
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

function buildIntDegreeTicks(
  series: EvidenceSeries[],
  data?: Array<Record<string, string | number | null>>,
): number[] | null {
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
  HOURLY_DETAIL_REQUEST_TIMEOUT_MS,
  HOURLY_CACHE_TTL_MS,
  HOURLY_FORCE_REFRESH_DEDUP_MS,
  _hourlyCache,
  __readHourlyCacheEntryForTest,
  resolveCityDetailFromBatch as __resolveCityDetailFromBatchForTest,
  __resetHourlyDetailRequestQueueForTest,
  __runQueuedHourlyDetailRequestForTest,
  build72hChartData,
  buildChartDomain,
  buildFullDayChartData,
  getDebPeakWindowRange,
  getPeakGlowState,
  buildIntDegreeTicks,
  buildModelSummaryCards,
  fetchFullChartDetailForCity,
  fetchLiveObservationForCity,
  getActiveTemperatureSeries,
  getLiveObservationLabels,
  getObservationDisplayMetrics,
  getVisibleTemperatureSeries,
  isTemperatureSeriesVisibleByDefault,
  mergeHourlyWithLiveObservations,
  mergeObservationSnapshotIntoHourly,
  mergePatchIntoHourly,
  mergeRowObservationIntoHourly,
  normObs,
  normalizeCityKey,
  readCachedHourlyForInitialRow,
  readCityDetailBatchDiagnostics,
  readHourlyDetailSnapshot,
  readHourlyDetailSnapshotAgeMs,
  readSessionCache,
  rememberHourlyDetailSnapshot,
  selectCompactSecondaryTemp,
  selectInitialHourlyForRowChange,
  seedChartRenderStateFromRow,
  seriesStats,
  shouldPollLiveChart,
  observationPayloadToSnapshot,
  toFullChartDetail,
  validNumber,
  rememberCityDetailBatchDiagnostics as __rememberCityDetailBatchDiagnosticsForTest,
};

export type { EvidenceSeries, FullChartDetail, ChartRenderState, ObservationSnapshot, PeakGlowMeta, PeakGlowState };
