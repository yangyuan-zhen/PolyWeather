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
import {
  CityDetail,
  CityListItem,
  CitySummary,
  DashboardState,
  HistoryPoint,
  HistoryState,
  LoadingState,
} from "@/lib/dashboard-types";

interface DashboardStoreValue extends DashboardState {
  closeFutureModal: () => void;
  closeGuide: () => void;
  closeHistory: () => void;
  closePanel: () => void;
  ensureCityDetail: (cityName: string, force?: boolean) => Promise<CityDetail>;
  futureModalDate: string | null;
  isGuideOpen: boolean;
  loadCities: () => Promise<void>;
  openFutureModal: (dateStr: string) => void;
  openGuide: () => void;
  openHistory: () => Promise<void>;
  openTodayModal: () => void;
  registerMapStopMotion: (stopMotion: () => void) => void;
  refreshAll: () => Promise<void>;
  refreshSelectedCity: () => Promise<void>;
  selectedDetail: CityDetail | null;
  selectCity: (cityName: string) => Promise<void>;
  setForecastDate: (dateStr: string | null) => void;
}

const DashboardStoreContext = createContext<DashboardStoreValue | null>(null);

function getInitialLoadingState(): LoadingState {
  return {
    cities: false,
    cityDetail: false,
    history: false,
    refresh: false,
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
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const mapStopMotionRef = useRef<() => void>(() => {});
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

  useEffect(() => {
    dashboardClient.writeCityDetailCacheBundle(
      cityDetailsByName,
      cityDetailMetaByName,
    );
  }, [cityDetailMetaByName, cityDetailsByName]);

  useEffect(() => {
    citySummariesRef.current = citySummariesByName;
  }, [citySummariesByName]);

  const ensureCityDetail = async (cityName: string, force = false) => {
    const cached = cityDetailsByName[cityName];
    const cachedMeta = cityDetailMetaByName[cityName];
    if (!force && cached && dashboardClient.isCityDetailFresh(cachedMeta)) {
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

    const detail = await dashboardClient.getCityDetail(cityName, { force });
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

  const loadCities = async () => {
    setLoadingState((current) => ({ ...current, cities: true }));
    try {
      const nextCities = await dashboardClient.getCities();
      setCities(nextCities);
    } finally {
      setLoadingState((current) => ({ ...current, cities: false }));
    }
  };

  useEffect(() => {
    void loadCities();
  }, []);

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
    setLoadingState((current) => ({ ...current, cityDetail: true }));
    try {
      const detail = await ensureCityDetail(cityName);
      setSelectedForecastDate(detail.local_date);
    } finally {
      setLoadingState((current) => ({ ...current, cityDetail: false }));
    }
  };

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
    dashboardClient.clearCityDetailCache();
    setCityDetailsByName({});
    setCityDetailMetaByName({});
    if (selectedCity) {
      setLoadingState((current) => ({ ...current, refresh: true }));
      try {
        const detail = await dashboardClient.getCityDetail(selectedCity, {
          force: true,
        });
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
      closeGuide: () => setIsGuideOpen(false),
      closeHistory: () =>
        setHistoryState((current) => ({ ...current, isOpen: false })),
      closePanel: () => {
        setIsPanelOpen(false);
      },
      ensureCityDetail,
      futureModalDate,
      historyState,
      isPanelOpen,
      isGuideOpen,
      loadCities,
      loadingState,
      openFutureModal: (dateStr: string) => {
        mapStopMotionRef.current();
        setFutureModalDate(dateStr);
      },
      openGuide: () => setIsGuideOpen(true),
      openHistory,
      openTodayModal: () => {
        if (selectedDetail?.local_date) {
          mapStopMotionRef.current();
          setFutureModalDate(selectedDetail.local_date);
        }
      },
      registerMapStopMotion: (stopMotion: () => void) => {
        mapStopMotionRef.current = stopMotion;
      },
      refreshAll,
      refreshSelectedCity,
      selectedCity,
      selectedDetail,
      selectedForecastDate,
      selectCity,
      setForecastDate: (dateStr: string | null) =>
        setSelectedForecastDate(dateStr),
    }),
    [
      cities,
      cityDetailsByName,
      citySummariesByName,
      futureModalDate,
      historyState,
      isPanelOpen,
      isGuideOpen,
      loadingState,
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
