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
  CityDetail,
  CityListItem,
  CitySummary,
  DashboardState,
  HistoryPoint,
  HistoryPayload,
  HistoryPayloadMeta,
  HistoryState,
  LoadingState,
  MarketScan,
  ProAccessState,
} from "@/lib/dashboard-types";

interface DashboardStoreValue extends DashboardState {
  closeFutureModal: () => void;
  closeHistory: () => void;
  closePanel: () => void;
  ensureCityDetail: (
    cityName: string,
    force?: boolean,
    depth?: "panel" | "nearby" | "full",
  ) => Promise<CityDetail>;
  futureModalDate: string | null;
  loadCities: () => Promise<void>;
  openFutureModal: (dateStr: string, forceRefresh?: boolean) => Promise<void>;
  openHistory: () => Promise<void>;
  openTodayModal: (forceRefresh?: boolean) => Promise<void>;
  registerMapStopMotion: (stopMotion: () => void) => void;
  refreshAll: () => Promise<void>;
  refreshProAccess: () => Promise<void>;
  refreshSelectedCity: () => Promise<void>;
  selectedMarketScan: MarketScan | null;
  selectedDetail: CityDetail | null;
  selectCity: (cityName: string) => Promise<void>;
  setMapInteractionActive: (active: boolean) => void;
  setForecastDate: (dateStr: string | null) => void;
  marketScanByCityName: Record<string, MarketScan>;
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

function getMarketScanCacheKey(cityName: string, targetDate?: string | null) {
  const normalizedDate = String(targetDate || "").trim() || "local";
  return `${cityName}::${normalizedDate}`;
}

const SELECTED_CITY_STORAGE_KEY = "polyWeather_selected_city_v1";
const BACKGROUND_SUMMARY_REFRESH_MS = 30_000;
type CityDetailDepth = "panel" | "market" | "nearby" | "full";

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
  const [marketScanByCityName, setMarketScanByCityName] = useState<
    Record<string, MarketScan>
  >({});
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedForecastDate, setSelectedForecastDate] = useState<
    string | null
  >(null);
  const [futureModalDate, setFutureModalDate] = useState<string | null>(null);
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
  const hydratedSelectionRef = useRef(false);
  const hydratedProCacheRef = useRef(false);
  const backgroundSummaryCheckAtRef = useRef<Record<string, number>>({});
  const summaryInflightByCityRef = useRef<Record<string, Promise<CitySummary>>>(
    {},
  );
  const citySummariesRef = useRef<Record<string, CitySummary>>({});
  const selectedCityRef = useRef<string | null>(null);
  const selectedDetail =
    selectedCity && proAccess.subscriptionActive
      ? cityDetailsByName[selectedCity] || null
      : null;
  const selectedMarketDate =
    futureModalDate ||
    selectedForecastDate ||
    selectedDetail?.local_date ||
    null;
  const selectedMarketScanKey = selectedCity
    ? getMarketScanCacheKey(selectedCity, selectedMarketDate)
    : null;
  const selectedMarketScan =
    selectedCity && proAccess.subscriptionActive
      ? marketScanByCityName[selectedMarketScanKey || ""] || null
      : null;

  useEffect(() => {
    if (proAccess.loading) return;
    if (!proAccess.authenticated || !proAccess.subscriptionActive) {
      dashboardClient.clearCityDetailCache();
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
    setCityDetailsByName({});
    setCityDetailMetaByName({});
    setMarketScanByCityName({});
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

  useEffect(() => {
    if (proAccess.loading) return;
    if (!selectedCity) return;
    if (!isPanelOpen) return;
    if (!proAccess.authenticated || !proAccess.subscriptionActive) return;
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

  const ensureCityMarketScan = async (
    cityName: string,
    force = false,
    marketSlug?: string | null,
    targetDate?: string | null,
  ) => {
    const cacheKey = getMarketScanCacheKey(cityName, targetDate);
    const cached = marketScanByCityName[cacheKey];
    if (!force && cached && !marketSlug) {
      return cached;
    }

    const latestScan = await dashboardClient.getCityMarketScan(cityName, {
      force,
      marketSlug,
      targetDate,
    });
    if (latestScan) {
      setMarketScanByCityName((current) => ({
        ...current,
        [cacheKey]: latestScan,
      }));
    }
    return latestScan;
  };

  const loadCities = async () => {
    setLoadingState((current) => ({ ...current, cities: true }));
    try {
      const nextCities = await dashboardClient.getCities();
      setCities(nextCities);
    } finally {
      setLoadingState((current) => ({ ...current, cities: false }));
    }
  };

  const refreshProAccess = async () => {
    setProAccess((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
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
    setSelectedCity(cityName);
    setIsPanelOpen(true);
    setSelectedForecastDate(null);
    setFutureModalDate(null);

    const summaryPromise = !citySummariesRef.current[cityName]
      ? ensureCitySummary(cityName).catch(() => null)
      : Promise.resolve(citySummariesRef.current[cityName]);

    if (proAccessRef.current.loading) {
      setLoadingState((current) => ({ ...current, cityDetail: true }));
      try {
        await summaryPromise;
      } catch {
      } finally {
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      }
      return;
    }

    const access = proAccessRef.current;
    if (!access.authenticated || !access.subscriptionActive) {
      setLoadingState((current) => ({ ...current, cityDetail: true }));
      try {
        await summaryPromise;
      } catch {
      } finally {
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      }
      return;
    }

    const cachedDetail = cityDetailsByName[cityName];
    const needsDetailRefresh = hasSparseDetailCoverage(
      cachedDetail,
      cachedDetail?.local_date,
    );
    setLoadingState((current) => ({ ...current, cityDetail: true }));
    try {
      await summaryPromise;
    } catch {
    }

    void ensureCityDetail(cityName, needsDetailRefresh, "panel")
      .then((detail) => {
        if (selectedCityRef.current !== cityName) return;
        setSelectedForecastDate(detail.local_date);
      })
      .finally(() => {
        if (selectedCityRef.current !== cityName) return;
        setLoadingState((current) => ({ ...current, cityDetail: false }));
      });
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
    const stored = String(
      window.localStorage.getItem(SELECTED_CITY_STORAGE_KEY) || "",
    )
      .trim()
      .toLowerCase();
    if (!stored) {
      return;
    }
    if (!cities.some((city) => city.name === stored)) {
      return;
    }
    void selectCity(stored);
  }, [cities, selectedCity, selectCity]);

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
      closeFutureModal: () => setFutureModalDate(null),
      closeHistory: () =>
        setHistoryState((current) => ({ ...current, isOpen: false })),
      closePanel: () => {
        setIsPanelOpen(false);
      },
      ensureCityDetail,
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
        let cachedDetail = cityDetailsByName[selectedCity];
        if (!cachedDetail) {
          setLoadingState((current) => ({ ...current, cityDetail: true }));
          try {
            cachedDetail = await ensureCityDetail(cityName, false, "panel");
          } finally {
            if (selectedCityRef.current === cityName) {
              setLoadingState((current) => ({ ...current, cityDetail: false }));
            }
          }
        }
        const hasFullCachedDetail =
          detailSatisfiesDepth(cachedDetail, "full") &&
          !hasSparseDetailCoverage(cachedDetail, dateStr);
        const hasMarketCachedDetail = detailSatisfiesDepth(
          cachedDetail,
          "market",
          dateStr,
        );

        setFutureModalDate(dateStr);
        const cacheKey = getMarketScanCacheKey(selectedCity, dateStr);
        setLoadingState((current) => ({ ...current, marketScan: true }));
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
              if (selectedCityRef.current !== cityName) return;
              setLoadingState((current) => ({
                ...current,
                futureDeep: false,
              }));
            });
        }
        void ensureCityMarketScan(
          cityName,
          forceRefresh || !marketScanByCityName[cacheKey],
          null,
          dateStr,
        )
          .catch(() => {})
          .finally(() => {
            if (selectedCityRef.current !== cityName) return;
            setLoadingState((current) => ({ ...current, marketScan: false }));
          });
      },
      openHistory,
      openTodayModal: async (forceRefresh?: boolean) => {
        if (!selectedCity) {
          return;
        }

        mapStopMotionRef.current();
        const cityName = selectedCity;
        let cachedDetail = cityDetailsByName[cityName];
        if (!cachedDetail) {
          setLoadingState((current) => ({ ...current, cityDetail: true }));
          try {
            cachedDetail = await ensureCityDetail(cityName, false, "panel");
          } finally {
            if (selectedCityRef.current === cityName) {
              setLoadingState((current) => ({ ...current, cityDetail: false }));
            }
          }
        }
        const hasFullCachedDetail =
          detailSatisfiesDepth(cachedDetail, "full") &&
          !hasSparseDetailCoverage(cachedDetail, cachedDetail?.local_date);
        const hasMarketCachedDetail = detailSatisfiesDepth(
          cachedDetail,
          "market",
          cachedDetail?.local_date,
        );
        const targetDate =
          cachedDetail?.local_date || selectedForecastDate || null;
        if (targetDate) {
          setSelectedForecastDate(targetDate);
          setFutureModalDate(targetDate);
        }
        if (!proAccess.subscriptionActive) return;
        const needsDetailRefresh =
          forceRefresh ||
          !detailSatisfiesDepth(cachedDetail, "full") ||
          hasSparseDetailCoverage(cachedDetail, cachedDetail?.local_date);

        setLoadingState((current) => ({
          ...current,
          futureDeep: needsDetailRefresh,
          marketScan: true,
        }));
        if (!hasMarketCachedDetail || forceRefresh) {
          void ensureCityDetail(
            cityName,
            Boolean(forceRefresh),
            "market",
          ).catch(() => {});
        }
        const initialTargetDate =
          cachedDetail?.local_date || selectedForecastDate || null;
        const initialMarketKey = getMarketScanCacheKey(
          cityName,
          initialTargetDate,
        );
        void ensureCityMarketScan(
          cityName,
          forceRefresh || !marketScanByCityName[initialMarketKey],
          null,
          initialTargetDate,
        )
          .catch(() => {})
          .finally(() => {
            if (selectedCityRef.current !== cityName) return;
            setLoadingState((current) => ({
              ...current,
              marketScan: false,
            }));
          });
        void ensureCityDetail(
          cityName,
          needsDetailRefresh,
          "full",
        )
          .then((detail) => {
            if (selectedCityRef.current !== cityName) return;
            setSelectedForecastDate(detail.local_date);
            setFutureModalDate(detail.local_date);
          })
          .catch(() => {
            if (selectedCityRef.current !== cityName) return;
            if (cachedDetail?.local_date) {
              setSelectedForecastDate(cachedDetail.local_date);
              setFutureModalDate(cachedDetail.local_date);
            }
          })
          .finally(() => {
            if (selectedCityRef.current !== cityName) return;
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
      selectedMarketScan,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
      selectCity,
      setMapInteractionActive: setIsMapInteracting,
      setForecastDate: (dateStr: string | null) =>
        setSelectedForecastDate(dateStr),
      marketScanByCityName,
    }),
    [
      cities,
      cityDetailsByName,
      citySummariesByName,
      futureModalDate,
      historyState,
      isPanelOpen,
      loadingState,
      proAccess,
      marketScanByCityName,
      selectedMarketScan,
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
