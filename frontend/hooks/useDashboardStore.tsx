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

const DashboardStoreContext = createContext<DashboardStoreValue | null>(null);

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
const BACKGROUND_SUMMARY_REFRESH_MS = 30_000;
const CITY_LOAD_RETRY_DELAYS_MS = [700, 1600];
type CityDetailDepth = "panel" | "market" | "nearby" | "full";

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  return Array.isArray(daily) ? daily.length : 0;
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

function shouldCheckSparseCoverageForDepth(depth: CityDetailDepth) {
  return depth === "panel" || depth === "market" || depth === "full";
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
  if (incoming.detail_depth !== "market") return incoming;

  const mergedDepth =
    current.detail_depth === "full" || current.detail_depth === "nearby"
      ? current.detail_depth
      : incoming.detail_depth;

  return {
    ...current,
    ...incoming,
    detail_depth: mergedDepth,
    current: incoming.current || current.current,
    airport_current: incoming.airport_current || current.airport_current,
    deb: incoming.deb || current.deb,
    probabilities: incoming.probabilities || current.probabilities,
    trend: incoming.trend || current.trend,
    multi_model: hasMeaningfulModelMap(incoming.multi_model)
      ? incoming.multi_model
      : current.multi_model,
    multi_model_daily: hasMeaningfulDailyModelMap(incoming.multi_model_daily)
      ? {
          ...(current.multi_model_daily || {}),
          ...(incoming.multi_model_daily || {}),
        }
      : current.multi_model_daily,
    forecast: current.forecast || incoming.forecast,
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
  const backgroundSummaryCheckAtRef = useRef<Record<string, number>>({});
  const summaryInflightByCityRef = useRef<Record<string, Promise<CitySummary>>>(
    {},
  );
  const citiesRef = useRef<CityListItem[]>([]);
  const citySummariesRef = useRef<Record<string, CitySummary>>({});
  const selectedCityRef = useRef<string | null>(null);
  const selectedDetail = selectedCity ? cityDetailsByName[selectedCity] || null : null;
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

  const scheduleBackgroundDetailRefresh = (
    cityName: string,
    cached: CityDetail,
    cachedMeta?: { cachedAt: number; revision: string },
  ) => {
    const nowTs = Date.now();
    const lastTs = backgroundSummaryCheckAtRef.current[cityName] || 0;
    if (nowTs - lastTs < BACKGROUND_SUMMARY_REFRESH_MS) {
      return;
    }
    backgroundSummaryCheckAtRef.current[cityName] = nowTs;

    void dashboardClient
      .getCitySummary(cityName)
      .then(async (summary) => {
        const revision = getCityRevision(summary);
        if (!revision || revision === cachedMeta?.revision) {
          return;
        }

        const latestDetail = await dashboardClient.getCityDetail(cityName, {
          force: false,
          depth: normalizeDetailDepth(cached),
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
      })
      .catch(() => {});
  };

  const ensureCityDetail = async (
    cityName: string,
    force = false,
    depth: CityDetailDepth = "panel",
  ) => {
    const cached = cityDetailsByName[cityName];
    const cachedMeta = cityDetailMetaByName[cityName];
    const marketTargetDate =
      depth === "market" ? selectedForecastDate || cached?.local_date : null;
    const hasRequestedDepth = detailSatisfiesDepth(
      cached,
      depth,
      marketTargetDate,
    );
    const cachedIsSparse =
      shouldCheckSparseCoverageForDepth(depth) &&
      (depth === "market"
        ? hasSparseModelCoverage(cached, marketTargetDate)
        : hasSparseDetailCoverage(cached, cached?.local_date));
    if (
      !force &&
      cached &&
      hasRequestedDepth &&
      !cachedIsSparse &&
      dashboardClient.isCityDetailFresh(cachedMeta)
    ) {
      scheduleBackgroundDetailRefresh(cityName, cached, cachedMeta);
      return cached;
    }

    if (!force && cached && hasRequestedDepth) {
      try {
        const summary = await dashboardClient.getCitySummary(cityName);
        const revision = getCityRevision(summary);
        if (revision && revision === cachedMeta?.revision) {
          if (cachedIsSparse) {
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
            return detail;
          }
          setCityDetailMetaByName((current) => ({
            ...current,
            [cityName]: {
              cachedAt: Date.now(),
              revision,
            },
          }));
          return cached;
        }
      } catch {
        return cached;
      }
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
    let cached = cityDetailsByName[cityName];
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
    if (cityDetailsByName[selectedCity]) return;

    let cancelled = false;
    setLoadingState((current) => ({ ...current, cityDetail: true }));
    void ensureCityDetail(selectedCity, false, "panel")
      .then((detail) => {
        if (cancelled) return;
        setSelectedForecastDate(detail.local_date);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    cityDetailsByName,
    ensureCityDetail,
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
      setProAccess(getLocalDevProAccessState());
      return;
    }
    setProAccess((current) => ({
      ...current,
      loading: true,
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
      };
      setProAccess({
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
      });
    } catch (error) {
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
    const cached = cityDetailsByName[cityName];
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
      setLoadingState((current) => ({ ...current, cityDetail: true }));
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
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      }
      return;
    }

    if (!cached) {
      setLoadingState((current) => ({ ...current, cityDetail: true }));
    }
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
        if (!cached) {
          setLoadingState((current) => ({ ...current, cityDetail: false }));
        }
      });
  };

  const focusCity = async (cityName: string) => {
    selectedCityRef.current = cityName;
    setSelectedCity(cityName);
    setIsPanelOpen(false);
    setSelectedForecastDate(null);
    setFutureModalDate(null);
    setForecastModalMode(null);
    const depth: CityDetailDepth = proAccessRef.current.subscriptionActive
      ? "market"
      : "panel";
    setLoadingState((current) => ({ ...current, cityDetail: true }));
    void Promise.allSettled([
      ensureCitySummary(cityName),
      ensureCityDetail(cityName, false, depth),
    ])
      .then(([, detail]) => {
        if (selectedCityRef.current !== cityName) return;
        if (detail.status === "fulfilled") {
          setSelectedForecastDate(detail.value.local_date);
          if (
            proAccessRef.current.subscriptionActive &&
            !detail.value.market_scan
          ) {
            void ensureCityMarketScan(cityName, false);
          }
        }
      })
      .finally(() => {
        if (selectedCityRef.current !== cityName) return;
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      });
  };

  useEffect(() => {
    if (!selectedCity) return;
    if (!proAccess.subscriptionActive) return;
    const detail = cityDetailsByName[selectedCity];
    if (!detail) return;
    if (detail.market_scan) return;
    void ensureCityMarketScan(selectedCity, false);
  }, [cityDetailsByName, proAccess.subscriptionActive, selectedCity]);

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

  const value = useMemo<DashboardStoreValue>(
    () => ({
      cities,
      cityDetailsByName,
      citySummariesByName,
      clearCityFocus,
      closeFutureModal: () => {
        modalOpenSeqRef.current += 1;
        setFutureModalDate(null);
        setForecastModalMode(null);
      },
      closeHistory: () =>
        setHistoryState((current) => ({ ...current, isOpen: false })),
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
      loadingState,
      proAccess,
      openFutureModal: async (dateStr: string, forceRefresh = false) => {
        mapStopMotionRef.current();
        if (!selectedCity || !proAccess.subscriptionActive) return;
        const cityName = selectedCity;
        const modalSeq = (modalOpenSeqRef.current += 1);
        const isLatestModalRequest = () =>
          modalOpenSeqRef.current === modalSeq &&
          selectedCityRef.current === cityName;
        let cachedDetail = cityDetailsByName[selectedCity];
        if (!cachedDetail) {
          setLoadingState((current) => ({ ...current, cityDetail: true }));
          try {
            cachedDetail = await ensureCityDetail(cityName, false, "panel");
          } finally {
            if (isLatestModalRequest()) {
              setLoadingState((current) => ({ ...current, cityDetail: false }));
            }
          }
        }
        if (!isLatestModalRequest()) return;
        const hasFullCachedDetail =
          detailSatisfiesDepth(cachedDetail, "full") &&
          !hasSparseDetailCoverage(cachedDetail, dateStr);
        const hasMarketCachedDetail = detailSatisfiesDepth(
          cachedDetail,
          "market",
          dateStr,
        );
        const todayDate =
          cachedDetail?.local_date ||
          cachedDetail?.forecast?.daily?.[0]?.date ||
          null;
        const modalMode: ForecastModalMode =
          todayDate && dateStr === todayDate ? "today" : "future";

        setSelectedForecastDate(dateStr);
        setFutureModalDate(dateStr);
        setForecastModalMode(modalMode);
        if (!hasMarketCachedDetail || forceRefresh) {
          void ensureCityDetail(cityName, forceRefresh, "market").catch(() => {});
        }
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
      },
      openHistory,
      openTodayModal: async (forceRefresh?: boolean) => {
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
        let cachedDetail = cityDetailsByName[cityName];
        if (!cachedDetail) {
          setLoadingState((current) => ({ ...current, cityDetail: true }));
          try {
            cachedDetail = await ensureCityDetail(cityName, false, "panel");
          } finally {
            if (isLatestModalRequest()) {
              setLoadingState((current) => ({ ...current, cityDetail: false }));
            }
          }
        }
        if (!isLatestModalRequest()) return;
        const hasFullCachedDetail =
          detailSatisfiesDepth(cachedDetail, "full") &&
          !hasSparseDetailCoverage(cachedDetail, cachedDetail?.local_date);
        const hasMarketCachedDetail = detailSatisfiesDepth(
          cachedDetail,
          "market",
          cachedDetail?.local_date,
        );
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
        if (!hasMarketCachedDetail || forceRefresh) {
          void ensureCityDetail(
            cityName,
            Boolean(forceRefresh),
            "market",
          ).catch(() => {});
        }
        void ensureCityDetail(
          cityName,
          needsDetailRefresh,
          "full",
        )
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
      },
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
      setForecastDate: (dateStr: string | null) =>
        setSelectedForecastDate(dateStr),
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

  return (
    <DashboardStoreContext.Provider value={value}>
      {children}
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

export function useCityData(name?: string | null) {
  const store = useDashboardStore();
  const key = name || store.selectedCity;
  return {
    data: key ? store.cityDetailsByName[key] || null : null,
    isLoading:
      store.loadingState.cityDetail &&
      Boolean(key) &&
      store.selectedCity === key,
  };
}

export function useHistoryData(name?: string | null) {
  const store = useDashboardStore();
  const key = name || store.selectedCity;
  return {
    data: key
      ? store.historyState.dataByCity[key] || ([] as HistoryPoint[])
      : [],
    error: store.historyState.error,
    isLoading: store.historyState.loading,
    isOpen: store.historyState.isOpen,
    isRecordsLoading: store.historyState.recordsLoading,
    meta: key ? store.historyState.metaByCity[key] || null : null,
  };
}

