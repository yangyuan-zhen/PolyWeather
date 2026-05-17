"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dashboardClient,
  getCityRevision,
  toCitySummary,
} from "@/lib/dashboard-client";
import { markAnalyticsOnce, trackAppEvent } from "@/lib/app-analytics";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";
import {
  getLocalDevProAccessState,
  isBrowserLocalFullAccess,
} from "@/lib/local-dev-access";
import {
  CityDetail,
  CityListItem,
  CitySummary,
  DashboardState,
  ForecastModalMode,
  HistoryPoint,
  HistoryPayload,
  HistoryPayloadMeta,
  HistoryState,
  LoadingState,
  ProAccessState,
} from "@/lib/dashboard-types";

interface DashboardStoreValue extends DashboardState {
  clearCityFocus: () => void;
  closeFutureModal: () => void;
  closeHistory: () => void;
  closePanel: () => void;
  ensureCityDetail: (
    cityName: string,
    force?: boolean,
    depth?: "panel" | "market" | "nearby" | "full",
  ) => Promise<CityDetail>;
  ensureCityMarketScan: (
    cityName: string,
    force?: boolean,
    options?: {
      lite?: boolean;
      marketSlug?: string | null;
      targetDate?: string | null;
    },
  ) => Promise<CityDetail["market_scan"] | null>;
  focusCity: (cityName: string) => Promise<void>;
  forecastModalMode: ForecastModalMode | null;
  futureModalDate: string | null;
  loadCities: () => Promise<void>;
  preloadCityFromRow: (row: { city?: string | null; city_display_name?: string | null; display_name?: string | null }) => void;
  openFutureModal: (dateStr: string, forceRefresh?: boolean) => Promise<void>;
  openHistory: () => Promise<void>;
  openTodayModal: (forceRefresh?: boolean) => Promise<void>;
  registerMapStopMotion: (stopMotion: () => void) => void;
  refreshAll: () => Promise<void>;
  refreshProAccess: () => Promise<void>;
  refreshSelectedCity: () => Promise<void>;
  selectedDetail: CityDetail | null;
  selectCity: (cityName: string) => Promise<void>;
  setMapInteractionActive: (active: boolean) => void;
  setForecastDate: (dateStr: string | null) => void;
}

type DashboardModalContextValue = Pick<
  DashboardStoreValue,
  | "closeFutureModal"
  | "forecastModalMode"
  | "futureModalDate"
  | "loadingState"
  | "openFutureModal"
  | "openTodayModal"
  | "selectedForecastDate"
  | "setForecastDate"
>;
type DashboardHistoryContextValue = Pick<
  DashboardStoreValue,
  "closeHistory" | "historyState" | "openHistory"
>;
type DashboardProAccessContextValue = Pick<
  DashboardStoreValue,
  "proAccess" | "refreshProAccess"
>;

const DashboardStoreContext = createContext<DashboardStoreValue | null>(null);
const DashboardActionsContext = createContext<Pick<
  DashboardStoreValue,
  "ensureCityDetail"
> | null>(null);
const DashboardModalContext =
  createContext<DashboardModalContextValue | null>(null);
const DashboardHistoryContext =
  createContext<DashboardHistoryContextValue | null>(null);
const DashboardProAccessContext =
  createContext<DashboardProAccessContextValue | null>(null);
const DashboardSelectionContext = createContext<Pick<
  DashboardStoreValue,
  | "cities"
  | "forecastModalMode"
  | "futureModalDate"
  | "isPanelOpen"
  | "selectedCity"
  | "selectedDetail"
  | "selectedForecastDate"
> | null>(null);
const CityDetailsContext = createContext<{
  cityDetailsByName: Record<string, CityDetail>;
  cityDetailMetaByName: Record<string, { cachedAt: number; revision: string }>;
  citySummariesByName: Record<string, CitySummary>;
  loadingState: LoadingState;
} | null>(null);

function getInitialLoadingState(): LoadingState {
  return {
    cities: false,
    cityDetail: false,
    futureDeep: false,
    history: false,
    historyRecords: false,
    refresh: false,
    marketScan: false,
  };
}

function getInitialHistoryState(): HistoryState {
  return {
    dataByCity: {},
    error: null,
    isOpen: false,
    loading: false,
    metaByCity: {},
    recordsLoading: false,
  };
}

function getInitialProAccessState(): ProAccessState {
  if (isBrowserLocalFullAccess()) {
    return getLocalDevProAccessState();
  }
  const cached = readStoredProAccess();
  if (cached) {
    return cached;
  }
  return {
    loading: true,
    authenticated: false,
    userId: null,
    subscriptionActive: false,
    subscriptionPlanCode: null,
    subscriptionExpiresAt: null,
    subscriptionTotalExpiresAt: null,
    subscriptionQueuedDays: 0,
    points: 0,
    error: null,
  };
}

const SELECTED_CITY_STORAGE_KEY = "polyWeather_selected_city_v1";
const PRO_ACCESS_STORAGE_KEY = "polyWeather_pro_access_v1";
const CITY_LOAD_RETRY_DELAYS_MS = [700, 1600];
const PRO_ACCESS_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
type CityDetailDepth = "panel" | "market" | "nearby" | "full";

type StoredProAccessState = ProAccessState & {
  cachedAt: number;
  expiresAtMs: number;
  version: 1;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getSubscriptionExpiryMs(access: Pick<
  ProAccessState,
  "subscriptionExpiresAt" | "subscriptionTotalExpiresAt"
>) {
  const raw =
    access.subscriptionTotalExpiresAt || access.subscriptionExpiresAt || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clearStoredProAccess() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PRO_ACCESS_STORAGE_KEY);
  } catch {
    // Ignore storage failures; backend auth remains the source of truth.
  }
}

function readStoredProAccess(): ProAccessState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PRO_ACCESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProAccessState>;
    if (parsed.version !== 1) {
      clearStoredProAccess();
      return null;
    }
    if (!parsed.authenticated || !parsed.subscriptionActive || !parsed.userId) {
      clearStoredProAccess();
      return null;
    }
    const expiresAtMs = Number(parsed.expiresAtMs || 0);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      clearStoredProAccess();
      return null;
    }
    return {
      loading: false,
      authenticated: true,
      userId: String(parsed.userId),
      subscriptionActive: true,
      subscriptionPlanCode: parsed.subscriptionPlanCode ?? null,
      subscriptionExpiresAt: parsed.subscriptionExpiresAt ?? null,
      subscriptionTotalExpiresAt: parsed.subscriptionTotalExpiresAt ?? null,
      subscriptionQueuedDays: Math.max(
        0,
        Number(parsed.subscriptionQueuedDays ?? 0),
      ),
      points: Number(parsed.points ?? 0),
      error: null,
    };
  } catch {
    clearStoredProAccess();
    return null;
  }
}

function writeStoredProAccess(access: ProAccessState) {
  if (typeof window === "undefined") return;
  if (!access.authenticated || !access.subscriptionActive || !access.userId) {
    clearStoredProAccess();
    return;
  }
  const explicitExpiryMs = getSubscriptionExpiryMs(access);
  const expiresAtMs =
    explicitExpiryMs > Date.now()
      ? explicitExpiryMs
      : Date.now() + PRO_ACCESS_FALLBACK_TTL_MS;
  const payload: StoredProAccessState = {
    ...access,
    loading: false,
    error: null,
    cachedAt: Date.now(),
    expiresAtMs,
    version: 1,
  };
  try {
    window.localStorage.setItem(PRO_ACCESS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private mode; keep the in-memory state.
  }
}

function mergeWithStoredProAccess(
  next: ProAccessState,
  reason: string,
): ProAccessState {
  if (next.subscriptionActive || !next.authenticated) return next;
  const cached = readStoredProAccess();
  if (!cached) return next;
  if (next.userId && cached.userId !== next.userId) return next;
  const payloadExpiryMs = getSubscriptionExpiryMs(next);
  if (payloadExpiryMs > 0 && payloadExpiryMs <= Date.now()) return next;
  return {
    ...cached,
    loading: false,
    points: Math.max(cached.points, next.points),
    error: reason,
  };
}

async function buildAuthMeHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (!hasSupabasePublicEnv()) {
    return headers;
  }

  try {
    const {
      data: { session: cachedSession },
    } = await getSupabaseBrowserClient().auth.getSession();
    let accessToken = String(cachedSession?.access_token || "").trim();
    const expiresAtSec = Number(cachedSession?.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!accessToken || (Number.isFinite(expiresAtSec) && expiresAtSec <= nowSec + 60)) {
      const {
        data: { session: refreshedSession },
      } = await getSupabaseBrowserClient().auth.refreshSession();
      accessToken = String(refreshedSession?.access_token || accessToken || "").trim();
    }
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
  } catch {
    // The same-origin route can still fall back to cookie-backed auth.
  }
  return headers;
}

function countAvailableModels(
  detail?: CityDetail | null,
  targetDate?: string | null,
): number {
  if (!detail) return 0;
  const date = String(targetDate || detail.local_date || "").trim();
  const dailyModels = detail.multi_model_daily?.[date]?.models;
  const models = dailyModels && typeof dailyModels === "object"
    ? dailyModels
    : detail.multi_model || {};
  return Object.values(models).filter((value) =>
    Number.isFinite(Number(value)),
  ).length;
}

function countForecastDays(detail?: CityDetail | null): number {
  const daily = detail?.forecast?.daily;
  if (!Array.isArray(daily)) return 0;
  return new Set(
    daily
      .map((day) => String(day?.date || "").trim())
      .filter(Boolean),
  ).size;
}

function normalizeCityLookupKey(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function findCachedCityDetail(
  detailsByName: Record<string, CityDetail>,
  cityName?: string | null,
) {
  const key = normalizeCityLookupKey(cityName);
  if (!key) return null;
  return (
    detailsByName[cityName || ""] ||
    Object.entries(detailsByName).find(([storedName, detail]) =>
      [storedName, detail?.name, detail?.display_name].some(
        (value) => normalizeCityLookupKey(value) === key,
      ),
    )?.[1] ||
    null
  );
}

function hasSparseModelCoverage(
  detail?: CityDetail | null,
  targetDate?: string | null,
): boolean {
  return countAvailableModels(detail, targetDate) <= 1;
}

function hasSparseDetailCoverage(
  detail?: CityDetail | null,
  targetDate?: string | null,
): boolean {
  if (!detail) return true;
  return (
    hasSparseModelCoverage(detail, targetDate) || countForecastDays(detail) <= 1
  );
}

function hasMarketDetailCoverage(
  detail?: CityDetail | null,
  targetDate?: string | null,
): boolean {
  if (!detail) return false;
  return countAvailableModels(detail, targetDate) > 1;
}

function normalizeDetailDepth(detail?: CityDetail | null): CityDetailDepth {
  if (detail?.detail_depth === "market") return "market";
  if (detail?.detail_depth === "nearby") return "nearby";
  if (detail?.detail_depth === "panel") return "panel";
  return "full";
}

function detailSatisfiesDepth(
  detail: CityDetail | null | undefined,
  depth: CityDetailDepth,
  targetDate?: string | null,
) {
  if (!detail) return false;
  if (depth === "panel") return true;
  if (depth === "market") {
    const normalized = normalizeDetailDepth(detail);
    return (
      normalized === "market" ||
      normalized === "full" ||
      hasMarketDetailCoverage(detail, targetDate)
    );
  }
  if (depth === "nearby") {
    const normalized = normalizeDetailDepth(detail);
    return normalized === "nearby" || normalized === "full";
  }
  return normalizeDetailDepth(detail) === "full";
}

function hasMeaningfulModelMap(
  value: Record<string, number | null> | undefined,
): value is Record<string, number | null> {
  return Boolean(
    value &&
      Object.values(value).some((entry) => Number.isFinite(Number(entry))),
  );
}

function hasMeaningfulDailyModelMap(
  value: CityDetail["multi_model_daily"] | undefined,
) {
  return Boolean(
    value &&
      Object.values(value).some((day) =>
        hasMeaningfulModelMap(day?.models || undefined),
      ),
  );
}

function countModelMapEntries(value: Record<string, number | null> | undefined) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).filter((entry) => Number.isFinite(Number(entry))).length;
}

function pickRicherModelMap(
  currentValue: CityDetail["multi_model"] | undefined,
  incomingValue: CityDetail["multi_model"] | undefined,
) {
  return countModelMapEntries(incomingValue) >= countModelMapEntries(currentValue)
    ? incomingValue || currentValue
    : currentValue;
}

function mergeDailyModelMap(
  currentValue: CityDetail["multi_model_daily"] | undefined,
  incomingValue: CityDetail["multi_model_daily"] | undefined,
) {
  if (!hasMeaningfulDailyModelMap(incomingValue)) return currentValue;
  if (!hasMeaningfulDailyModelMap(currentValue)) return incomingValue;
  const merged = { ...(currentValue || {}) };
  Object.entries(incomingValue || {}).forEach(([date, incomingDay]) => {
    const currentDay = merged[date];
    const incomingCount = countModelMapEntries(incomingDay?.models || undefined);
    const currentCount = countModelMapEntries(currentDay?.models || undefined);
    if (incomingCount >= currentCount) {
      merged[date] = {
        ...(currentDay || {}),
        ...(incomingDay || {}),
        models: incomingDay?.models || currentDay?.models,
      };
    }
  });
  return merged;
}

function pickRicherForecast(
  currentValue: CityDetail["forecast"] | undefined,
  incomingValue: CityDetail["forecast"] | undefined,
) {
  const picked = countForecastDays({ forecast: incomingValue } as CityDetail) >=
    countForecastDays({ forecast: currentValue } as CityDetail)
    ? incomingValue || currentValue
    : currentValue;
  if (!picked?.daily || !Array.isArray(picked.daily)) return picked;
  const seen = new Set<string>();
  return {
    ...picked,
    daily: picked.daily.filter((day) => {
      const date = String(day?.date || "").trim();
      if (!date || seen.has(date)) return false;
      seen.add(date);
      return true;
    }),
  };
}

function countHourlyPoints(value: CityDetail["hourly"] | undefined) {
  const times = Array.isArray(value?.times) ? value?.times || [] : [];
  const temps = Array.isArray(value?.temps) ? value?.temps || [] : [];
  return Math.min(times.length, temps.length);
}

function pickRicherHourly(
  currentValue: CityDetail["hourly"] | undefined,
  incomingValue: CityDetail["hourly"] | undefined,
) {
  const incomingCount = countHourlyPoints(incomingValue);
  const currentCount = countHourlyPoints(currentValue);
  if (incomingCount <= 0) return currentValue;
  if (currentCount <= 0) return incomingValue;
  return incomingCount >= currentCount ? incomingValue : currentValue;
}

function countObservationSeriesPoints<T extends { time?: string | null; temp?: number | null }>(
  value: T[] | null | undefined,
) {
  return (Array.isArray(value) ? value : []).filter((row) => {
    const time = String(row?.time || "").trim();
    const temp = Number(row?.temp);
    return Boolean(time) && Number.isFinite(temp);
  }).length;
}

function pickRicherObservationSeries<
  T extends { time?: string | null; temp?: number | null },
>(
  currentValue: T[] | null | undefined,
  incomingValue: T[] | null | undefined,
): T[] | undefined {
  const incomingCount = countObservationSeriesPoints(incomingValue);
  const currentCount = countObservationSeriesPoints(currentValue);
  if (incomingCount <= 0) return currentValue || undefined;
  if (currentCount <= 0) return incomingValue || undefined;
  return (incomingCount >= currentCount ? incomingValue : currentValue) || undefined;
}

function mergeTrendInfo(
  currentValue: CityDetail["trend"] | undefined,
  incomingValue: CityDetail["trend"] | undefined,
) {
  if (!incomingValue) return currentValue;
  if (!currentValue) return incomingValue;
  return {
    ...currentValue,
    ...incomingValue,
    recent: pickRicherObservationSeries(
      currentValue.recent,
      incomingValue.recent,
    ),
  };
}

function mergeMgmData(
  currentValue: CityDetail["mgm"] | undefined,
  incomingValue: CityDetail["mgm"] | undefined,
) {
  if (!incomingValue) return currentValue;
  if (!currentValue) return incomingValue;
  return {
    ...currentValue,
    ...incomingValue,
    hourly: pickRicherObservationSeries(
      currentValue.hourly,
      incomingValue.hourly,
    ),
  };
}

function pickPreferredNearbyStations(
  currentValue: CityDetail["official_nearby"] | CityDetail["mgm_nearby"],
  incomingValue: CityDetail["official_nearby"] | CityDetail["mgm_nearby"],
) {
  const currentList = Array.isArray(currentValue) ? currentValue : [];
  const incomingList = Array.isArray(incomingValue) ? incomingValue : [];
  if (incomingList.length > 0) {
    return incomingList;
  }
  return currentList;
}

function mergeCityDetail(
  current: CityDetail | undefined,
  incoming: CityDetail,
): CityDetail {
  if (!current) return incoming;

  const currentDepth = normalizeDetailDepth(current);
  const incomingDepth = normalizeDetailDepth(incoming);
  const mergedDepth =
    currentDepth === "full" || incomingDepth === "full"
      ? "full"
      : currentDepth === "nearby" || incomingDepth === "nearby"
        ? "nearby"
        : currentDepth === "market" || incomingDepth === "market"
          ? "market"
          : "panel";

  return {
    ...current,
    ...incoming,
    detail_depth: mergedDepth,
    current: incoming.current || current.current,
    airport_current: incoming.airport_current || current.airport_current,
    deb: incoming.deb || current.deb,
    probabilities: incoming.probabilities || current.probabilities,
    trend: mergeTrendInfo(current.trend, incoming.trend),
    metar_today_obs: pickRicherObservationSeries(
      current.metar_today_obs,
      incoming.metar_today_obs,
    ),
    settlement_today_obs: pickRicherObservationSeries(
      current.settlement_today_obs,
      incoming.settlement_today_obs,
    ),
    mgm: mergeMgmData(current.mgm, incoming.mgm),
    multi_model: pickRicherModelMap(current.multi_model, incoming.multi_model),
    multi_model_daily: mergeDailyModelMap(
      current.multi_model_daily,
      incoming.multi_model_daily,
    ),
    forecast: pickRicherForecast(current.forecast, incoming.forecast),
    hourly: pickRicherHourly(current.hourly, incoming.hourly),
    official_nearby: pickPreferredNearbyStations(
      current.official_nearby,
      incoming.official_nearby,
    ),
    mgm_nearby: pickPreferredNearbyStations(
      current.mgm_nearby,
      incoming.mgm_nearby,
    ),
    network_lead_signal:
      current.network_lead_signal || incoming.network_lead_signal,
    airport_vs_network_delta:
      current.airport_vs_network_delta ?? incoming.airport_vs_network_delta,
  };
}

function mergeMarketScan(
  current: CityDetail["market_scan"] | undefined,
  incoming: CityDetail["market_scan"] | null | undefined,
): CityDetail["market_scan"] | undefined {
  if (!incoming) return current;
  if (!current) return incoming || undefined;

  const preserveHeavySlices = incoming.scan_scope === "lite";
  const nextTopBuckets =
    preserveHeavySlices &&
    (!Array.isArray(incoming.top_buckets) || incoming.top_buckets.length === 0)
      ? current.top_buckets
      : incoming.top_buckets;
  const nextAllBuckets =
    preserveHeavySlices &&
    (!Array.isArray(incoming.all_buckets) || incoming.all_buckets.length === 0)
      ? current.all_buckets
      : incoming.all_buckets;
  const nextRecentTrades =
    preserveHeavySlices &&
    (!Array.isArray(incoming.recent_trades) || incoming.recent_trades.length === 0)
      ? current.recent_trades
      : incoming.recent_trades;

  return {
    ...current,
    ...incoming,
    top_buckets: nextTopBuckets,
    all_buckets: nextAllBuckets,
    recent_trades: nextRecentTrades,
  };
}

function toHistoryMeta(payload: HistoryPayload): HistoryPayloadMeta {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const previewCount = Number(payload.preview_count || history.length || 0);
  const fullCount = Number(payload.full_count || previewCount || 0);
  return {
    mode: payload.mode === "full" ? "full" : "preview",
    hasMore: payload.has_more === true,
    fullCount,
    previewCount,
    settlementSource: payload.settlement_source ?? null,
    settlementSourceLabel: payload.settlement_source_label ?? null,
  };
}

export function DashboardStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialCacheRef = useRef<ReturnType<
    typeof dashboardClient.readCityDetailCacheBundle
  > | null>(null);
  const [cities, setCities] = useState<CityListItem[]>([]);
  const [cityDetailsByName, setCityDetailsByName] = useState<
    Record<string, CityDetail>
  >({});
  const [citySummariesByName, setCitySummariesByName] = useState<
    Record<string, CitySummary>
  >({});
  const [cityDetailMetaByName, setCityDetailMetaByName] = useState<
    Record<string, { cachedAt: number; revision: string }>
  >({});
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedForecastDate, setSelectedForecastDate] = useState<
    string | null
  >(null);
  const [futureModalDate, setFutureModalDate] = useState<string | null>(null);
  const [forecastModalMode, setForecastModalMode] =
    useState<ForecastModalMode | null>(null);
  const [isMapInteracting, setIsMapInteracting] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState>(
    getInitialLoadingState,
  );
  const [historyState, setHistoryState] = useState<HistoryState>(
    getInitialHistoryState,
  );
  const [proAccess, setProAccess] = useState<ProAccessState>(
    getInitialProAccessState,
  );
  const proAccessRef = useRef<ProAccessState>(getInitialProAccessState());

  const mapStopMotionRef = useRef<() => void>(() => {});
  const modalOpenSeqRef = useRef(0);
  const hydratedSelectionRef = useRef(false);
  const hydratedProCacheRef = useRef(false);
  const summaryInflightByCityRef = useRef<Record<string, Promise<CitySummary>>>(
    {},
  );
  const citiesRef = useRef<CityListItem[]>([]);
  const citySummariesRef = useRef<Record<string, CitySummary>>({});
  const selectedCityRef = useRef<string | null>(null);
  const setCityDetailLoading = (isLoading: boolean) => {
    setLoadingState((current) =>
      current.cityDetail === isLoading
        ? current
        : { ...current, cityDetail: isLoading },
    );
  };
  const selectedDetail = selectedCity
    ? findCachedCityDetail(cityDetailsByName, selectedCity)
    : null;
  useEffect(() => {
    if (proAccess.loading) return;
    if (!proAccess.authenticated || !proAccess.subscriptionActive) {
      return;
    }
    dashboardClient.writeCityDetailCacheBundle(
      cityDetailsByName,
      cityDetailMetaByName,
    );
  }, [
    cityDetailMetaByName,
    cityDetailsByName,
    proAccess.authenticated,
    proAccess.loading,
    proAccess.subscriptionActive,
  ]);

  useEffect(() => {
    citiesRef.current = cities;
  }, [cities]);

  useEffect(() => {
    citySummariesRef.current = citySummariesByName;
  }, [citySummariesByName]);

  useEffect(() => {
    selectedCityRef.current = selectedCity;
  }, [selectedCity]);

  useEffect(() => {
    proAccessRef.current = proAccess;
  }, [proAccess]);

  useEffect(() => {
    if (proAccess.loading) return;
    if (!proAccess.authenticated || !proAccess.subscriptionActive) {
      hydratedProCacheRef.current = false;
      initialCacheRef.current = null;
      return;
    }
    if (hydratedProCacheRef.current) return;

    hydratedProCacheRef.current = true;
    const cached =
      initialCacheRef.current || dashboardClient.readCityDetailCacheBundle();
    initialCacheRef.current = cached;
    if (!Object.keys(cached.details).length) return;

    setCityDetailsByName(cached.details);
    setCityDetailMetaByName(cached.meta);
    setCitySummariesByName((current) => ({
      ...Object.fromEntries(
        Object.entries(cached.details).map(([cityName, detail]) => [
          cityName,
          toCitySummary(detail),
        ]),
      ),
      ...current,
    }));
  }, [proAccess.authenticated, proAccess.loading, proAccess.subscriptionActive]);

  useEffect(() => {
    if (proAccess.loading) return;
    if (proAccess.authenticated && proAccess.subscriptionActive) return;
    dashboardClient.clearCityDetailCache();
  }, [proAccess]);

  const preloadCityFromRow = (row: { city?: string | null; city_display_name?: string | null; display_name?: string | null; [key: string]: unknown }) => {
    const cityName = (row.city || row.city_display_name || row.display_name || "").trim();
    if (!cityName || findCachedCityDetail(cityDetailsByName, cityName)) return;
    // Pre-populate cache from scan terminal row so detail panel shows data immediately
    const now = Date.now();
    const currentTemp = Number(row.current_temp ?? row.current_max_so_far);
    const debPrediction = Number(row.deb_prediction);
    const rawModelSources =
      row.model_cluster_sources && typeof row.model_cluster_sources === "object"
        ? (row.model_cluster_sources as Record<string, unknown>)
        : {};
    const multiModel = Object.fromEntries(
      Object.entries(rawModelSources)
        .map(([name, value]) => [name, Number(value)] as const)
        .filter(([, value]) => Number.isFinite(value)),
    );
    setCityDetailsByName((current) => ({
      ...current,
      [cityName]: {
        name: String(row.city || cityName),
        display_name: String(row.city_display_name || row.display_name || cityName),
        detail_depth: "panel",
        lat: 0,
        lon: 0,
        local_date: String(row.local_date || row.selected_date || ""),
        local_time: String(row.local_time || ""),
        temp_symbol: String(row.temp_symbol || "°C"),
        current: {
          temp: Number.isFinite(currentTemp) ? currentTemp : null,
          max_so_far: Number.isFinite(Number(row.current_max_so_far))
            ? Number(row.current_max_so_far)
            : Number.isFinite(currentTemp)
              ? currentTemp
              : null,
          max_temp_time: null,
          wu_settlement: null,
          station_code: null,
          station_name: String(row.airport || ""),
          obs_time: String((row.metar_context as { last_time?: string } | null)?.last_time || ""),
          obs_age_min: null,
          wind_speed_kt: null,
          wind_dir: null,
          humidity: null,
          cloud_desc: null,
          clouds_raw: [],
          visibility_mi: null,
          wx_desc: null,
        },
        deb: {
          prediction: Number.isFinite(debPrediction) ? debPrediction : null,
        },
        forecast: { today_high: null, daily: [] },
        hourly: { times: [], temps: [] },
        multi_model: multiModel,
        probabilities: {},
        risk: {
          level: String(row.risk_level || "medium"),
          airport: String(row.airport || ""),
        },
      } as CityDetail,
    }));
    setCityDetailMetaByName((current) => ({
      ...current,
      [cityName]: { cachedAt: now - CACHE_TTL_MS, revision: `scan-${now}` },
    }));
  };

  const CACHE_TTL_MS = 30 * 60 * 1000; // reuse same TTL as dashboard-client

  const ensureCityDetail = async (
    cityName: string,
    force = false,
    depth: CityDetailDepth = "panel",
  ) => {
    const cached = findCachedCityDetail(cityDetailsByName, cityName);
    const cachedMeta = cityDetailMetaByName[cityName];
    const marketTargetDate =
      depth === "market" ? selectedForecastDate || cached?.local_date : null;
    const hasRequestedDepth = detailSatisfiesDepth(
      cached,
      depth,
      marketTargetDate,
    );
    if (
      !force &&
      cached &&
      hasRequestedDepth &&
      dashboardClient.isCityDetailFresh(cachedMeta)
    ) {
      return cached;
    }

    if (!force && cached && hasRequestedDepth) {
      // stale-while-revalidate: return cached immediately, refresh in background
      void (async () => {
        try {
          const latestDetail = await dashboardClient.getCityDetail(cityName, {
            force: true,
            depth,
          });
          const detail = latestDetail;
          setCityDetailsByName((current) => ({
            ...current,
            [cityName]: mergeCityDetail(current[cityName], detail),
          }));
          setCitySummariesByName((current) => ({
            ...current,
            [cityName]: toCitySummary(detail),
          }));
          setCityDetailMetaByName((current) => ({
            ...current,
            [cityName]: {
              cachedAt: Date.now(),
              revision: getCityRevision(detail),
            },
          }));
        } catch { /* keep cached data on failure */ }
      })();
      return cached;
    }

    const latestDetail = await dashboardClient.getCityDetail(cityName, {
      force,
      depth,
    });
    const detail = latestDetail;
    setCityDetailsByName((current) => ({
      ...current,
      [cityName]: mergeCityDetail(current[cityName], detail),
    }));
    setCitySummariesByName((current) => ({
      ...current,
      [cityName]: toCitySummary(detail),
    }));
    setCityDetailMetaByName((current) => ({
      ...current,
      [cityName]: {
        cachedAt: Date.now(),
        revision: getCityRevision(detail),
      },
    }));
    return detail;
  };

  const ensureCityMarketScan = async (
    cityName: string,
    force = false,
    options?: {
      lite?: boolean;
      marketSlug?: string | null;
      targetDate?: string | null;
    },
  ) => {
    let cached = findCachedCityDetail(cityDetailsByName, cityName);
    try {
      if (!cached) {
        cached = await ensureCityDetail(cityName, false, "panel");
      }
      const payload = await dashboardClient.getCityMarketScan(cityName, {
        force,
        lite: options?.lite === true,
        marketSlug: options?.marketSlug || null,
        targetDate:
          options?.targetDate ||
          (options?.marketSlug ? cached?.local_date || selectedForecastDate || null : null),
      });
      if (!payload.market_scan) return null;
      setCityDetailsByName((current) => {
        const detail = current[cityName] || cached;
        if (!detail) return current;
        return {
          ...current,
          [cityName]: {
            ...detail,
            market_scan: mergeMarketScan(detail.market_scan, payload.market_scan),
          },
        };
      });
      return payload.market_scan;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (proAccess.loading) return;
    if (!selectedCity) return;
    if (!isPanelOpen) return;
    if (findCachedCityDetail(cityDetailsByName, selectedCity)) return;

    let cancelled = false;
    setCityDetailLoading(true);
    void ensureCityDetail(selectedCity, false, "panel")
      .then((detail) => {
        if (cancelled) return;
        setSelectedForecastDate(detail.local_date);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setCityDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    cityDetailsByName,
    isPanelOpen,
    proAccess.authenticated,
    proAccess.loading,
    proAccess.subscriptionActive,
    selectedCity,
  ]);

  const loadCities = async () => {
    setLoadingState((current) => ({ ...current, cities: true }));
    let lastError: unknown = null;
    try {
      for (let attempt = 0; attempt <= CITY_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const nextCities = await dashboardClient.getCities();
          if (!nextCities.length) {
            throw new Error("City list was empty");
          }
          setCities(nextCities);
          return;
        } catch (error) {
          lastError = error;
          const delayMs = CITY_LOAD_RETRY_DELAYS_MS[attempt];
          if (delayMs == null) break;
          await wait(delayMs);
        }
      }
      console.error("Failed to load monitored cities", lastError);
    } finally {
      setLoadingState((current) => ({ ...current, cities: false }));
    }
  };

  const refreshProAccess = async () => {
    if (isBrowserLocalFullAccess()) {
      const localAccess = getLocalDevProAccessState();
      writeStoredProAccess(localAccess);
      setProAccess(localAccess);
      return;
    }
    setProAccess((current) => ({
      ...current,
      loading: current.subscriptionActive ? false : true,
      error: null,
    }));
    try {
      const headers = await buildAuthMeHeaders();
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        headers,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        authenticated?: boolean;
        user_id?: string | null;
        subscription_active?: boolean | null;
        subscription_plan_code?: string | null;
        subscription_expires_at?: string | null;
        subscription_total_expires_at?: string | null;
        subscription_queued_days?: number | null;
        points?: number;
        degraded_auth_profile?: boolean | null;
        degraded_reason?: string | null;
      };
      const nextAccess: ProAccessState = {
        loading: false,
        authenticated: Boolean(payload.authenticated),
        userId: payload.user_id ?? null,
        subscriptionActive: payload.subscription_active === true,
        subscriptionPlanCode: payload.subscription_plan_code ?? null,
        subscriptionExpiresAt: payload.subscription_expires_at ?? null,
        subscriptionTotalExpiresAt:
          payload.subscription_total_expires_at ?? payload.subscription_expires_at ?? null,
        subscriptionQueuedDays: Math.max(
          0,
          Number(payload.subscription_queued_days ?? 0),
        ),
        points: payload.points ?? 0,
        error: null,
      };
      const mergedAccess = mergeWithStoredProAccess(
        nextAccess,
        payload.degraded_auth_profile
          ? String(payload.degraded_reason || "degraded_auth_profile")
          : "using_cached_pro_access",
      );
      if (mergedAccess.subscriptionActive) {
        writeStoredProAccess(mergedAccess);
      } else if (!mergedAccess.authenticated || payload.subscription_active === false) {
        clearStoredProAccess();
      }
      setProAccess(mergedAccess);
    } catch (error) {
      const cachedAccess = readStoredProAccess();
      if (cachedAccess) {
        setProAccess({
          ...cachedAccess,
          loading: false,
          error: String(error),
        });
        return;
      }
      clearStoredProAccess();
      setProAccess({
        loading: false,
        authenticated: false,
        userId: null,
        subscriptionActive: false,
        subscriptionPlanCode: null,
        subscriptionExpiresAt: null,
        subscriptionTotalExpiresAt: null,
        subscriptionQueuedDays: 0,
        points: 0,
        error: String(error),
      });
    }
  };

  useEffect(() => {
    void loadCities();
  }, []);

  useEffect(() => {
    if (!cities.length) return;
    if (typeof window === "undefined") return;
    const schedule = () => dashboardClient.sendPriorityWarmHint();
    const idleCallback = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof idleCallback === "function") {
      const id = idleCallback(schedule, { timeout: 3000 });
      return () => {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(id);
        }
      };
    }
    const timer = window.setTimeout(schedule, 2000);
    return () => window.clearTimeout(timer);
  }, [cities.length]);

  useEffect(() => {
    void refreshProAccess();
  }, []);

  useEffect(() => {
    if (!hasSupabasePublicEnv()) return;
    const {
      data: { subscription },
    } = getSupabaseBrowserClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearStoredProAccess();
        setProAccess({
          loading: false,
          authenticated: false,
          userId: null,
          subscriptionActive: false,
          subscriptionPlanCode: null,
          subscriptionExpiresAt: null,
          subscriptionTotalExpiresAt: null,
          subscriptionQueuedDays: 0,
          points: 0,
          error: null,
        });
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refreshProAccess();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const ensureCitySummary = async (cityName: string, force = false) => {
    const existing = citySummariesRef.current[cityName];
    if (!force && existing) {
      return existing;
    }

    const inflight = summaryInflightByCityRef.current[cityName];
    if (inflight) {
      const settled = await inflight;
      if (!force) {
        return settled;
      }
    }

    const request = dashboardClient
      .getCitySummary(cityName, { force })
      .then((summary) => {
        setCitySummariesByName((current) => {
          const currentSummary = current[cityName];
          const currentRevision = getCityRevision(currentSummary);
          const nextRevision = getCityRevision(summary);
          if (
            currentSummary &&
            currentRevision &&
            nextRevision &&
            currentRevision === nextRevision
          ) {
            return current;
          }
          const next = {
            ...current,
            [cityName]: summary,
          };
          citySummariesRef.current = next;
          return next;
        });
        return summary;
      })
      .finally(() => {
        if (summaryInflightByCityRef.current[cityName] === request) {
          delete summaryInflightByCityRef.current[cityName];
        }
      });

    summaryInflightByCityRef.current[cityName] = request;
    return request;
  };

  useEffect(() => {
    if (proAccess.loading || !proAccess.authenticated || !proAccess.userId) {
      return;
    }
    if (
      markAnalyticsOnce(`dashboard-active:${proAccess.userId}`, "session")
    ) {
      trackAppEvent("dashboard_active", {
        subscription_active: proAccess.subscriptionActive,
        subscription_plan_code: proAccess.subscriptionPlanCode,
      });
    }

    const isTrialPlan = /trial/i.test(
      String(proAccess.subscriptionPlanCode || ""),
    );
    if (
      isTrialPlan &&
      markAnalyticsOnce(`signup-completed:${proAccess.userId}`, "local")
    ) {
      trackAppEvent("signup_completed", {
        source: "auth_me_trial",
        subscription_plan_code: proAccess.subscriptionPlanCode,
      });
    }
  }, [
    proAccess.authenticated,
    proAccess.loading,
    proAccess.subscriptionActive,
    proAccess.subscriptionPlanCode,
    proAccess.userId,
  ]);

  const selectCity = async (cityName: string) => {
    const wasSelectedCity = selectedCityRef.current === cityName;
    const cached = findCachedCityDetail(cityDetailsByName, cityName);
    selectedCityRef.current = cityName;
    setSelectedCity(cityName);
    setIsPanelOpen(true);
    setSelectedForecastDate(
      cached?.local_date || (wasSelectedCity ? selectedForecastDate : null),
    );
    setFutureModalDate(null);
    setForecastModalMode(null);

    const summaryPromise = !citySummariesRef.current[cityName]
      ? ensureCitySummary(cityName).catch(() => null)
      : Promise.resolve(citySummariesRef.current[cityName]);

    if (proAccessRef.current.loading) {
      setCityDetailLoading(true);
      const detailPromise = ensureCityDetail(cityName, false, "panel");
      try {
        const [, detail] = await Promise.allSettled([summaryPromise, detailPromise]);
        if (selectedCityRef.current === cityName) {
          if (detail.status === "fulfilled") {
            setSelectedForecastDate(detail.value.local_date);
          }
        }
      } catch {
      } finally {
        if (selectedCityRef.current === cityName) {
          setCityDetailLoading(false);
        }
      }
      return;
    }

    setCityDetailLoading(!cached);
    const detailPromise = ensureCityDetail(cityName, false, "panel");
    void Promise.allSettled([summaryPromise, detailPromise])
      .then(([, detail]) => {
        if (selectedCityRef.current !== cityName) return;
        if (detail.status === "fulfilled") {
          setSelectedForecastDate(detail.value.local_date);
        }
      })
      .finally(() => {
        if (selectedCityRef.current !== cityName) return;
        setCityDetailLoading(false);
      });
  };

  const focusCity = async (cityName: string) => {
    const cached = findCachedCityDetail(cityDetailsByName, cityName);
    selectedCityRef.current = cityName;
    setSelectedCity(cityName);
    setIsPanelOpen(false);
    setSelectedForecastDate(null);
    setFutureModalDate(null);
    setForecastModalMode(null);
    setCityDetailLoading(!cached);
    void Promise.allSettled([
      ensureCitySummary(cityName),
      ensureCityDetail(cityName, false, "panel"),
    ])
      .then(([, detail]) => {
        if (selectedCityRef.current !== cityName) return;
        if (detail.status === "fulfilled") {
          setSelectedForecastDate(detail.value.local_date);
        }
      })
      .finally(() => {
        if (selectedCityRef.current !== cityName) return;
        setCityDetailLoading(false);
      });
  };

  const clearCityFocus = () => {
    selectedCityRef.current = null;
    setSelectedCity(null);
    setIsPanelOpen(false);
    setSelectedForecastDate(null);
    setFutureModalDate(null);
    setForecastModalMode(null);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedCity) {
      window.localStorage.setItem(SELECTED_CITY_STORAGE_KEY, selectedCity);
    } else {
      window.localStorage.removeItem(SELECTED_CITY_STORAGE_KEY);
    }
  }, [selectedCity]);

  useEffect(() => {
    if (hydratedSelectionRef.current) return;
    if (!cities.length) return;
    if (selectedCity) {
      hydratedSelectionRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;

    hydratedSelectionRef.current = true;
    window.localStorage.removeItem(SELECTED_CITY_STORAGE_KEY);
  }, [cities, selectedCity]);

  const refreshSelectedCity = async () => {
    if (!selectedCity) return;
    setLoadingState((current) => ({ ...current, refresh: true }));
    try {
      const detail = await ensureCityDetail(selectedCity, true, "panel");
      setSelectedForecastDate(detail.local_date);
    } finally {
      setLoadingState((current) => ({ ...current, refresh: false }));
    }
  };

  const refreshAll = async () => {
    dashboardClient.clearCityDetailCache();
    setCityDetailsByName({});
    setCityDetailMetaByName({});
    if (!citiesRef.current.length) {
      await loadCities();
    }
    if (selectedCity) {
      const access = proAccessRef.current;
      setLoadingState((current) => ({ ...current, refresh: true }));
      try {
        if (access.authenticated && access.subscriptionActive) {
          const latestDetail = await dashboardClient.getCityDetail(selectedCity, {
            force: true,
            depth: "panel",
          });
          const detail = latestDetail;
          setCityDetailsByName({ [selectedCity]: detail });
          setCitySummariesByName((current) => ({
            ...current,
            [selectedCity]: toCitySummary(detail),
          }));
          setCityDetailMetaByName({
            [selectedCity]: {
              cachedAt: Date.now(),
              revision: getCityRevision(detail),
            },
          });
          setSelectedForecastDate(detail.local_date);
        } else {
          const summary = await ensureCitySummary(selectedCity, true);
          setCitySummariesByName((current) => ({
            ...current,
            [selectedCity]: summary,
          }));
        }
      } finally {
        setLoadingState((current) => ({ ...current, refresh: false }));
      }
    }
  };

  const openHistory = async () => {
    if (!selectedCity) return;
    if (!proAccess.subscriptionActive) {
      setHistoryState((current) => ({
        ...current,
        error: null,
        isOpen: true,
        loading: false,
        recordsLoading: false,
      }));
      return;
    }
    const cityName = selectedCity;
    const cachedHistory = historyState.dataByCity[cityName];
    const cachedMeta = historyState.metaByCity[cityName];

    if (cachedMeta && cachedHistory?.length) {
      setHistoryState((current) => ({
        ...current,
        error: null,
        isOpen: true,
        loading: false,
        recordsLoading: cachedMeta.mode !== "full" && cachedMeta.hasMore,
      }));

      if (cachedMeta.mode !== "full" && cachedMeta.hasMore) {
        void dashboardClient
          .getHistory(cityName, { includeRecords: true })
          .then((payload) => {
            if (selectedCityRef.current !== cityName) return;
            setHistoryState((current) => ({
              ...current,
              dataByCity: {
                ...current.dataByCity,
                [cityName]: payload.history,
              },
              metaByCity: {
                ...current.metaByCity,
                [cityName]: toHistoryMeta(payload),
              },
              recordsLoading: false,
            }));
          })
          .catch(() => {
            if (selectedCityRef.current !== cityName) return;
            setHistoryState((current) => ({
              ...current,
              recordsLoading: false,
            }));
          });
      }
      return;
    }

    setHistoryState((current) => ({
      ...current,
      error: null,
      isOpen: true,
      loading: true,
      recordsLoading: false,
    }));
    try {
      const payload = await dashboardClient.getHistory(cityName);
      setHistoryState((current) => ({
        ...current,
        dataByCity: {
          ...current.dataByCity,
          [cityName]: payload.history,
        },
        metaByCity: {
          ...current.metaByCity,
          [cityName]: toHistoryMeta(payload),
        },
        loading: false,
        recordsLoading: payload.has_more === true,
      }));

      if (payload.has_more) {
        void dashboardClient
          .getHistory(cityName, { includeRecords: true })
          .then((fullPayload) => {
            if (selectedCityRef.current !== cityName) return;
            setHistoryState((current) => ({
              ...current,
              dataByCity: {
                ...current.dataByCity,
                [cityName]: fullPayload.history,
              },
              metaByCity: {
                ...current.metaByCity,
                [cityName]: toHistoryMeta(fullPayload),
              },
              recordsLoading: false,
            }));
          })
          .catch(() => {
            if (selectedCityRef.current !== cityName) return;
            setHistoryState((current) => ({
              ...current,
              recordsLoading: false,
            }));
          });
      }
    } catch (error) {
      setHistoryState((current) => ({
        ...current,
        error: String(error),
        loading: false,
        recordsLoading: false,
      }));
    }
  };

  const closeFutureModal = () => {
    modalOpenSeqRef.current += 1;
    setFutureModalDate(null);
    setForecastModalMode(null);
  };

  const closeHistory = () =>
    setHistoryState((current) => ({ ...current, isOpen: false }));

  const openFutureModal = async (dateStr: string, forceRefresh = false) => {
    mapStopMotionRef.current();
    if (!selectedCity || !proAccess.subscriptionActive) return;
    const cityName = selectedCity;
    const modalSeq = (modalOpenSeqRef.current += 1);
    const isLatestModalRequest = () =>
      modalOpenSeqRef.current === modalSeq &&
      selectedCityRef.current === cityName;
    let cachedDetail = findCachedCityDetail(cityDetailsByName, selectedCity);
    if (!cachedDetail) {
      setCityDetailLoading(true);
      try {
        cachedDetail = await ensureCityDetail(cityName, false, "panel");
      } finally {
        if (isLatestModalRequest()) {
          setCityDetailLoading(false);
        }
      }
    }
    if (!isLatestModalRequest()) return;
    const hasFullCachedDetail =
      detailSatisfiesDepth(cachedDetail, "full") &&
      !hasSparseDetailCoverage(cachedDetail, dateStr);
    const todayDate =
      cachedDetail?.local_date ||
      cachedDetail?.forecast?.daily?.[0]?.date ||
      null;
    const modalMode: ForecastModalMode =
      todayDate && dateStr === todayDate ? "today" : "future";

    setSelectedForecastDate(dateStr);
    setFutureModalDate(dateStr);
    setForecastModalMode(modalMode);
    if (!hasFullCachedDetail || forceRefresh) {
      setLoadingState((current) => ({
        ...current,
        futureDeep: true,
      }));
      void ensureCityDetail(cityName, true, "full")
        .catch(() => {})
        .finally(() => {
          if (!isLatestModalRequest()) return;
          setLoadingState((current) => ({
            ...current,
            futureDeep: false,
          }));
        });
    }
  };

  const openTodayModal = async (forceRefresh?: boolean) => {
    const activeCity = selectedCityRef.current || selectedCity;
    if (!activeCity) {
      return;
    }

    mapStopMotionRef.current();
    const cityName = activeCity;
    const modalSeq = (modalOpenSeqRef.current += 1);
    const isLatestModalRequest = () =>
      modalOpenSeqRef.current === modalSeq &&
      selectedCityRef.current === cityName;
    let cachedDetail = findCachedCityDetail(cityDetailsByName, cityName);
    if (!cachedDetail) {
      setCityDetailLoading(true);
      try {
        cachedDetail = await ensureCityDetail(cityName, false, "panel");
      } finally {
        if (isLatestModalRequest()) {
          setCityDetailLoading(false);
        }
      }
    }
    if (!isLatestModalRequest()) return;
    const hasFullCachedDetail =
      detailSatisfiesDepth(cachedDetail, "full") &&
      !hasSparseDetailCoverage(cachedDetail, cachedDetail?.local_date);
    const targetDate =
      cachedDetail?.local_date ||
      cachedDetail?.forecast?.daily?.[0]?.date ||
      null;
    if (targetDate) {
      setSelectedForecastDate(targetDate);
      setFutureModalDate(targetDate);
      setForecastModalMode("today");
    }
    if (!proAccess.subscriptionActive) return;
    const needsDetailRefresh =
      forceRefresh ||
      !detailSatisfiesDepth(cachedDetail, "full") ||
      hasSparseDetailCoverage(cachedDetail, cachedDetail?.local_date);

    setLoadingState((current) => ({
      ...current,
      futureDeep: needsDetailRefresh,
    }));
    void ensureCityDetail(cityName, needsDetailRefresh, "full")
      .then((detail) => {
        if (!isLatestModalRequest()) return;
        setSelectedForecastDate(detail.local_date);
        setFutureModalDate(detail.local_date);
        setForecastModalMode("today");
      })
      .catch(() => {
        if (!isLatestModalRequest()) return;
        if (cachedDetail?.local_date) {
          setSelectedForecastDate(cachedDetail.local_date);
          setFutureModalDate(cachedDetail.local_date);
          setForecastModalMode("today");
        }
      })
      .finally(() => {
        if (!isLatestModalRequest()) return;
        setLoadingState((current) => ({
          ...current,
          futureDeep: false,
        }));
      });
  };

  const setForecastDate = (dateStr: string | null) =>
    setSelectedForecastDate(dateStr);

  const value = useMemo<DashboardStoreValue>(
    () => ({
      cities,
      cityDetailsByName,
      citySummariesByName,
      clearCityFocus,
      closeFutureModal,
      closeHistory,
      closePanel: () => {
        setIsPanelOpen(false);
      },
      ensureCityDetail,
      ensureCityMarketScan,
      focusCity,
      forecastModalMode,
      futureModalDate,
      historyState,
      isPanelOpen,
      loadCities,
      preloadCityFromRow,
      loadingState,
      proAccess,
      openFutureModal,
      openHistory,
      openTodayModal,
      registerMapStopMotion: (stopMotion: () => void) => {
        mapStopMotionRef.current = stopMotion;
      },
      refreshAll,
      refreshProAccess,
      refreshSelectedCity,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
      selectCity,
      setMapInteractionActive: setIsMapInteracting,
      setForecastDate,
    }),
    [
      cities,
      cityDetailsByName,
      citySummariesByName,
      forecastModalMode,
      futureModalDate,
      historyState,
      isPanelOpen,
      loadingState,
      proAccess,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
    ],
  );

  const cityDetailsValue = useMemo(
    () => ({ cityDetailsByName, cityDetailMetaByName, citySummariesByName, loadingState }),
    [cityDetailsByName, cityDetailMetaByName, citySummariesByName, loadingState],
  );
  const latestEnsureCityDetailRef = useRef(ensureCityDetail);
  useEffect(() => {
    latestEnsureCityDetailRef.current = ensureCityDetail;
  }, [ensureCityDetail]);
  const dashboardActionsValue = useMemo<Pick<DashboardStoreValue, "ensureCityDetail">>(
    () => ({
      ensureCityDetail: (...args) => latestEnsureCityDetailRef.current(...args),
    }),
    [],
  );
  const dashboardSelectionValue = useMemo<
    NonNullable<React.ContextType<typeof DashboardSelectionContext>>
  >(
    () => ({
      cities,
      forecastModalMode,
      futureModalDate,
      isPanelOpen,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
    }),
    [
      cities,
      forecastModalMode,
      futureModalDate,
      isPanelOpen,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
    ],
  );
  const dashboardModalValue = useMemo<DashboardModalContextValue>(
    () => ({
      closeFutureModal,
      forecastModalMode,
      futureModalDate,
      loadingState,
      openFutureModal,
      openTodayModal,
      selectedForecastDate,
      setForecastDate,
    }),
    [
      closeFutureModal,
      forecastModalMode,
      futureModalDate,
      loadingState,
      openFutureModal,
      openTodayModal,
      selectedForecastDate,
      setForecastDate,
    ],
  );
  const dashboardHistoryValue = useMemo<DashboardHistoryContextValue>(
    () => ({
      closeHistory,
      historyState,
      openHistory,
    }),
    [closeHistory, historyState, openHistory],
  );
  const dashboardProAccessValue = useMemo<DashboardProAccessContextValue>(
    () => ({
      proAccess,
      refreshProAccess,
    }),
    [proAccess, refreshProAccess],
  );

  return (
    <DashboardStoreContext.Provider value={value}>
      <DashboardActionsContext.Provider value={dashboardActionsValue}>
        <DashboardProAccessContext.Provider value={dashboardProAccessValue}>
          <DashboardModalContext.Provider value={dashboardModalValue}>
            <DashboardHistoryContext.Provider value={dashboardHistoryValue}>
              <DashboardSelectionContext.Provider value={dashboardSelectionValue}>
                <CityDetailsContext.Provider value={cityDetailsValue}>
                  {children}
                </CityDetailsContext.Provider>
              </DashboardSelectionContext.Provider>
            </DashboardHistoryContext.Provider>
          </DashboardModalContext.Provider>
        </DashboardProAccessContext.Provider>
      </DashboardActionsContext.Provider>
    </DashboardStoreContext.Provider>
  );
}

export function useDashboardStore() {
  const context = useContext(DashboardStoreContext);
  if (!context) {
    throw new Error(
      "useDashboardStore must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useCityDetails() {
  const context = useContext(CityDetailsContext);
  if (!context) {
    throw new Error(
      "useCityDetails must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useDashboardActions() {
  const context = useContext(DashboardActionsContext);
  if (!context) {
    throw new Error(
      "useDashboardActions must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useDashboardModal() {
  const context = useContext(DashboardModalContext);
  if (!context) {
    throw new Error(
      "useDashboardModal must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useDashboardHistory() {
  const context = useContext(DashboardHistoryContext);
  if (!context) {
    throw new Error(
      "useDashboardHistory must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useProAccess() {
  const context = useContext(DashboardProAccessContext);
  if (!context) {
    throw new Error("useProAccess must be used within DashboardStoreProvider");
  }
  return context;
}

export function useDashboardSelection() {
  const context = useContext(DashboardSelectionContext);
  if (!context) {
    throw new Error(
      "useDashboardSelection must be used within DashboardStoreProvider",
    );
  }
  return context;
}

export function useCityData(name?: string | null) {
  const selection = useDashboardSelection();
  const details = useCityDetails();
  const key = name || selection.selectedCity;
  return {
    data: key ? findCachedCityDetail(details.cityDetailsByName, key) : null,
    isLoading:
      details.loadingState.cityDetail &&
      Boolean(key) &&
      selection.selectedCity === key,
  };
}

export function useHistoryData(name?: string | null) {
  const history = useDashboardHistory();
  const selection = useDashboardSelection();
  const key = name || selection.selectedCity;
  return {
    data: key
      ? history.historyState.dataByCity[key] || ([] as HistoryPoint[])
      : [],
    error: history.historyState.error,
    isLoading: history.historyState.loading,
    isOpen: history.historyState.isOpen,
    isRecordsLoading: history.historyState.recordsLoading,
    meta: key ? history.historyState.metaByCity[key] || null : null,
  };
}

