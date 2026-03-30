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
  HistoryState,
  LoadingState,
  MarketScan,
  ProAccessState,
} from "@/lib/dashboard-types";

interface DashboardStoreValue extends DashboardState {
  closeFutureModal: () => void;
  closeHistory: () => void;
  closePanel: () => void;
  ensureCityDetail: (cityName: string, force?: boolean) => Promise<CityDetail>;
  futureModalDate: string | null;
  loadCities: () => Promise<void>;
  openFutureModal: (dateStr: string, forceRefresh?: boolean) => void;
  openHistory: () => Promise<void>;
  openTodayModal: (forceRefresh?: boolean) => Promise<void>;
  registerMapStopMotion: (stopMotion: () => void) => void;
  refreshAll: () => Promise<void>;
  refreshProAccess: () => Promise<void>;
  refreshSelectedCity: () => Promise<void>;
  selectedMarketScan: MarketScan | null;
  selectedDetail: CityDetail | null;
  selectCity: (cityName: string) => Promise<void>;
  setForecastDate: (dateStr: string | null) => void;
  marketScanByCityName: Record<string, MarketScan>;
}

const DashboardStoreContext = createContext<DashboardStoreValue | null>(null);

function getInitialLoadingState(): LoadingState {
  return {
    cities: false,
    cityDetail: false,
    history: false,
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
    points: 0,
    error: null,
  };
}

const AI_EMPTY_PATTERNS = [
  /暂无\s*AI\s*分析/i,
  /当前以结构化气象与模型数据为主/i,
  /No\s*AI\s*analysis\s*available/i,
  /Structured\s+meteorological\s+and\s+model\s+data/i,
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractAiPayload(analysis: CityDetail["ai_analysis"]) {
  if (!analysis) {
    return {
      bullets: [] as string[],
      summary: "",
    };
  }

  if (typeof analysis === "string") {
    return {
      bullets: [] as string[],
      summary: normalizeText(analysis),
    };
  }

  const summary =
    normalizeText(analysis.summary) ||
    normalizeText(analysis.text) ||
    normalizeText(analysis.message);
  const bulletsSource = Array.isArray(analysis.highlights)
    ? analysis.highlights
    : Array.isArray(analysis.points)
      ? analysis.points
      : [];

  return {
    bullets: bulletsSource.map((item) => normalizeText(item)).filter(Boolean),
    summary,
  };
}

function hasMeaningfulAiAnalysis(analysis: CityDetail["ai_analysis"]) {
  const parsed = extractAiPayload(analysis);
  const hasBullets = parsed.bullets.length > 0;
  const hasSummary =
    Boolean(parsed.summary) &&
    !AI_EMPTY_PATTERNS.some((pattern) => pattern.test(parsed.summary));
  return hasBullets || hasSummary;
}

function normalizeMetarSignature(detail?: CityDetail) {
  if (!detail) return "";
  const metar = normalizeText(detail.current?.raw_metar)
    .replace(/\s+/g, " ")
    .toUpperCase();
  const obsTime = normalizeText(detail.current?.obs_time);
  return [metar, obsTime].filter(Boolean).join("|");
}

function mergeAiAnalysisIfStable(
  previousDetail: CityDetail | undefined,
  nextDetail: CityDetail,
) {
  if (!previousDetail) return nextDetail;
  if (hasMeaningfulAiAnalysis(nextDetail.ai_analysis)) return nextDetail;
  if (!hasMeaningfulAiAnalysis(previousDetail.ai_analysis)) return nextDetail;

  const prevTemp = Number(previousDetail.current?.temp);
  const nextTemp = Number(nextDetail.current?.temp);
  const tempUnchanged =
    Number.isFinite(prevTemp) &&
    Number.isFinite(nextTemp) &&
    prevTemp === nextTemp;

  const prevMetar = normalizeMetarSignature(previousDetail);
  const nextMetar = normalizeMetarSignature(nextDetail);
  const metarUnchanged =
    Boolean(prevMetar) && Boolean(nextMetar) && prevMetar === nextMetar;

  if (!tempUnchanged && !metarUnchanged) {
    return nextDetail;
  }

  return {
    ...nextDetail,
    ai_analysis: previousDetail.ai_analysis,
  };
}

function getMarketScanCacheKey(cityName: string, targetDate?: string | null) {
  const normalizedDate = String(targetDate || "").trim() || "local";
  return `${cityName}::${normalizedDate}`;
}

const SELECTED_CITY_STORAGE_KEY = "polyWeather_selected_city_v1";
const BACKGROUND_SUMMARY_REFRESH_MS = 30_000;

export function DashboardStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialCache = dashboardClient.readCityDetailCacheBundle();
  const [cities, setCities] = useState<CityListItem[]>([]);
  const [cityDetailsByName, setCityDetailsByName] = useState<
    Record<string, CityDetail>
  >(() => initialCache.details);
  const [citySummariesByName, setCitySummariesByName] = useState<
    Record<string, CitySummary>
  >(() =>
    Object.fromEntries(
      Object.entries(initialCache.details).map(([cityName, detail]) => [
        cityName,
        toCitySummary(detail),
      ]),
    ),
  );
  const [cityDetailMetaByName, setCityDetailMetaByName] = useState<
    Record<string, { cachedAt: number; revision: string }>
  >(() => initialCache.meta);
  const [marketScanByCityName, setMarketScanByCityName] = useState<
    Record<string, MarketScan>
  >({});
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedForecastDate, setSelectedForecastDate] = useState<
    string | null
  >(null);
  const [futureModalDate, setFutureModalDate] = useState<string | null>(null);
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
  const backgroundSummaryCheckAtRef = useRef<Record<string, number>>({});
  const citySummariesRef = useRef<Record<string, CitySummary>>(
    Object.fromEntries(
      Object.entries(initialCache.details).map(([cityName, detail]) => [
        cityName,
        toCitySummary(detail),
      ]),
    ),
  );
  const selectedDetail = selectedCity
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
  const selectedMarketScan = selectedCity
    ? marketScanByCityName[selectedMarketScanKey || ""] || null
    : null;

  useEffect(() => {
    dashboardClient.writeCityDetailCacheBundle(
      cityDetailsByName,
      cityDetailMetaByName,
    );
  }, [cityDetailMetaByName, cityDetailsByName]);

  useEffect(() => {
    citySummariesRef.current = citySummariesByName;
  }, [citySummariesByName]);

  useEffect(() => {
    proAccessRef.current = proAccess;
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
        });
        const detail = mergeAiAnalysisIfStable(cached, latestDetail);

        setCityDetailsByName((current) => ({
          ...current,
          [cityName]: detail,
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

  const ensureCityDetail = async (cityName: string, force = false) => {
    const cached = cityDetailsByName[cityName];
    const cachedMeta = cityDetailMetaByName[cityName];
    if (!force && cached && dashboardClient.isCityDetailFresh(cachedMeta)) {
      scheduleBackgroundDetailRefresh(cityName, cached, cachedMeta);
      return cached;
    }

    if (!force && cached) {
      try {
        const summary = await dashboardClient.getCitySummary(cityName);
        const revision = getCityRevision(summary);
        if (revision && revision === cachedMeta?.revision) {
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
    });
    const detail = mergeAiAnalysisIfStable(cached, latestDetail);
    setCityDetailsByName((current) => ({
      ...current,
      [cityName]: detail,
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
        points?: number;
      };
      setProAccess({
        loading: false,
        authenticated: Boolean(payload.authenticated),
        userId: payload.user_id ?? null,
        subscriptionActive: payload.subscription_active === true,
        subscriptionPlanCode: payload.subscription_plan_code ?? null,
        subscriptionExpiresAt: payload.subscription_expires_at ?? null,
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

  useEffect(() => {
    if (!cities.length) return;

    const queue = cities
      .map((city) => city.name)
      .filter((cityName) => !citySummariesRef.current[cityName]);
    if (!queue.length) return;

    let active = true;
    const concurrency = 4;
    let cursor = 0;

    const worker = async () => {
      while (active && cursor < queue.length) {
        const cityName = queue[cursor];
        cursor += 1;
        if (citySummariesRef.current[cityName]) continue;

        try {
          const summary = await dashboardClient.getCitySummary(cityName);
          if (!active) return;

          setCitySummariesByName((current) => {
            if (current[cityName]) return current;
            const next = {
              ...current,
              [cityName]: summary,
            };
            citySummariesRef.current = next;
            return next;
          });
        } catch {}
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, () =>
        worker(),
      ),
    );

    return () => {
      active = false;
    };
  }, [cities]);

  const selectCity = async (cityName: string) => {
    setSelectedCity(cityName);
    setIsPanelOpen(true);
    setSelectedForecastDate(null);
    setFutureModalDate(null);

    if (proAccessRef.current.loading) {
      await refreshProAccess();
    }
    const access = proAccessRef.current;
    setLoadingState((current) => ({ ...current, cityDetail: true }));
    try {
      const detail = await ensureCityDetail(cityName);
      setSelectedForecastDate(detail.local_date);
      if (access.authenticated && access.subscriptionActive) {
        // 预热市场数据，不做 await 阻塞，后台静默拉取
        void ensureCityMarketScan(
          cityName,
          false,
          null,
          detail.local_date,
        ).catch(() => {});
      }
    } finally {
      setLoadingState((current) => ({ ...current, cityDetail: false }));
    }
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
    if (!stored) return;
    if (!cities.some((city) => city.name === stored)) return;
    void selectCity(stored);
  }, [cities, selectedCity, selectCity]);

  const refreshSelectedCity = async () => {
    if (!selectedCity) return;
    setLoadingState((current) => ({ ...current, refresh: true }));
    try {
      const detail = await ensureCityDetail(selectedCity, true);
      setSelectedForecastDate(detail.local_date);
    } finally {
      setLoadingState((current) => ({ ...current, refresh: false }));
    }
  };

  const refreshAll = async () => {
    const previousSelectedDetail = selectedCity
      ? cityDetailsByName[selectedCity]
      : undefined;
    dashboardClient.clearCityDetailCache();
    setCityDetailsByName({});
    setCityDetailMetaByName({});
    if (selectedCity) {
      setLoadingState((current) => ({ ...current, refresh: true }));
      try {
        const latestDetail = await dashboardClient.getCityDetail(selectedCity, {
          force: true,
        });
        const detail = mergeAiAnalysisIfStable(
          previousSelectedDetail,
          latestDetail,
        );
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
      }));
      return;
    }
    setHistoryState((current) => ({
      ...current,
      error: null,
      isOpen: true,
      loading: true,
    }));
    try {
      const history = await dashboardClient.getHistory(selectedCity);
      setHistoryState((current) => ({
        ...current,
        dataByCity: {
          ...current.dataByCity,
          [selectedCity]: history,
        },
        loading: false,
      }));
    } catch (error) {
      setHistoryState((current) => ({
        ...current,
        error: String(error),
        loading: false,
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
      openFutureModal: (dateStr: string, forceRefresh = false) => {
        mapStopMotionRef.current();
        setFutureModalDate(dateStr);
        if (!selectedCity || !proAccess.subscriptionActive) return;
        const cacheKey = getMarketScanCacheKey(selectedCity, dateStr);
        setLoadingState((current) => ({ ...current, marketScan: true }));
        void ensureCityMarketScan(
          selectedCity,
          forceRefresh || !marketScanByCityName[cacheKey],
          null,
          dateStr,
        )
          .catch(() => {})
          .finally(() => {
            setLoadingState((current) => ({ ...current, marketScan: false }));
          });
      },
      openHistory,
      openTodayModal: async (forceRefresh?: boolean) => {
        if (!selectedCity) {
          return;
        }

        mapStopMotionRef.current();
        const cachedDetail = cityDetailsByName[selectedCity];
        if (cachedDetail?.local_date) {
          setSelectedForecastDate(cachedDetail.local_date);
          setFutureModalDate(cachedDetail.local_date);
        }
        if (!proAccess.subscriptionActive) return;

        setLoadingState((current) => ({
          ...current,
          refresh: !cachedDetail?.local_date,
          marketScan: true,
        }));

        try {
          const detail = await ensureCityDetail(
            selectedCity,
            Boolean(forceRefresh),
          );
          setSelectedForecastDate(detail.local_date);
          setFutureModalDate(detail.local_date);

          const marketKey = getMarketScanCacheKey(selectedCity, detail.local_date);
          try {
            await ensureCityMarketScan(
              selectedCity,
              forceRefresh || !marketScanByCityName[marketKey],
              null,
              detail.local_date,
            );
          } catch {}
        } catch {
          if (cachedDetail?.local_date) {
            setSelectedForecastDate(cachedDetail.local_date);
            setFutureModalDate(cachedDetail.local_date);
          }
        } finally {
          setLoadingState((current) => ({
            ...current,
            refresh: false,
            marketScan: false,
          }));
        }
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
  };
}
