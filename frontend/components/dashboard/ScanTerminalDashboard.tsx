"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  LogIn,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Dashboard.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import { DetailPanel as CityDetailPanel } from "@/components/dashboard/DetailPanel";
import { FutureForecastModal } from "@/components/dashboard/FutureForecastModal";
import { MapCanvas } from "@/components/dashboard/MapCanvas";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  ScanOpportunityRow,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";
import {
  buildBrowserBackendHeaders,
  resolveBackendApiUrl,
} from "@/lib/backend-api";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { AiPinnedForecastView } from "@/components/dashboard/scan-terminal/AiPinnedForecastView";
import { CalendarView } from "@/components/dashboard/scan-terminal/CalendarView";
import { AiForecastKPIBar } from "@/components/dashboard/scan-terminal/AiForecastKPIBar";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import { OpportunityOverview } from "@/components/dashboard/scan-terminal/OpportunityOverview";
import {
  findDetailForCity,
  isFullEnoughForDeepAnalysis,
  waitForDeepAnalysisQueue,
} from "@/components/dashboard/scan-terminal/city-detail-utils";
import type { AiPinnedCity } from "@/components/dashboard/scan-terminal/types";
import {
  findRowForCity,
  formatUserLocalTime,
  normalizeCityKey,
  prettifyCityName,
  rowMatchesCity,
  sortRowsByUserTime,
} from "@/components/dashboard/scan-terminal/decision-utils";

type ContentView = "opportunities" | "analysis" | "map" | "calendar";
type ThemeMode = "dark" | "light";
function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = store.proAccess.subscriptionActive;
  const accountHref = store.proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const [terminalData, setTerminalData] = useState<ScanTerminalResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ContentView>("opportunities");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [aiPinnedCities, setAiPinnedCities] = useState<AiPinnedCity[]>([]);
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const [userLocalTime, setUserLocalTime] = useState("--");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const lastMapSelectedCityRef = useRef<string>("");
  const aiFullHydrationRef = useRef<Set<string>>(new Set());
  const aiHydrationQueueRef = useRef<string[]>([]);
  const aiHydrationRunningRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    const hadDark = root.classList.contains("dark");
    root.classList.toggle("light", themeMode === "light");
    root.classList.toggle("dark", themeMode === "dark");
    return () => {
      root.classList.toggle("light", hadLight);
      root.classList.toggle("dark", hadDark);
    };
  }, [themeMode]);

  const timeSortedRows = useMemo(
    () => sortRowsByUserTime(terminalData?.rows || []),
    [terminalData?.rows],
  );
  const selectedRow = useMemo(() => {
    if (!timeSortedRows.length) return null;
    return timeSortedRows.find((row) => row.id === selectedRowId) || timeSortedRows[0] || null;
  }, [timeSortedRows, selectedRowId]);

  useEffect(() => {
    if (!timeSortedRows.length) return;
    if (selectedRowId && timeSortedRows.some((row) => row.id === selectedRowId)) return;
    setSelectedRowId(timeSortedRows[0].id);
  }, [selectedRowId, timeSortedRows]);

  const mapFocusedRow = useMemo(() => {
    return findRowForCity(
      timeSortedRows,
      mapSelectedCityName || store.selectedCity,
    );
  }, [mapSelectedCityName, store.selectedCity, timeSortedRows]);
  const kpiCityName =
    mapSelectedCityName ||
    store.selectedCity ||
    aiPinnedCities[0]?.cityName ||
    null;
  const kpiDetail =
    findDetailForCity(store.cityDetailsByName, kpiCityName) ||
    (store.selectedDetail &&
    normalizeCityKey(store.selectedDetail.name) === normalizeCityKey(kpiCityName)
      ? store.selectedDetail
      : null);
  const kpiRow = findRowForCity(timeSortedRows, kpiCityName);

  const mapFallbackRow = useMemo(() => {
    const rawCityName = mapSelectedCityName || store.selectedCity;
    const cityKey = normalizeCityKey(rawCityName);
    if (!cityKey || mapFocusedRow) return null;
    const selectedDetail =
      store.selectedDetail && normalizeCityKey(store.selectedDetail.name) === cityKey
        ? store.selectedDetail
        : Object.values(store.cityDetailsByName).find(
            (detail) => normalizeCityKey(detail?.name) === cityKey,
          ) || null;
    const selectedSummary =
      Object.values(store.citySummariesByName).find(
        (summary) => normalizeCityKey(summary?.name) === cityKey,
      ) || null;
    const selectedCityItem =
      store.cities.find(
        (city) =>
          normalizeCityKey(city.name) === cityKey ||
          normalizeCityKey(city.display_name) === cityKey,
      ) || null;
    const canonicalCity =
      selectedDetail?.name ||
      selectedSummary?.name ||
      selectedCityItem?.name ||
      String(rawCityName || "").trim();
    if (!canonicalCity) return null;

    const tempSymbol =
      selectedDetail?.temp_symbol ||
      selectedSummary?.temp_symbol ||
      (selectedCityItem?.temp_unit === "fahrenheit" ? "°F" : "°C");
    const displayName =
      selectedDetail?.display_name ||
      selectedSummary?.display_name ||
      selectedCityItem?.display_name ||
      canonicalCity;
    const currentTemp =
      selectedDetail?.current?.temp ?? selectedSummary?.current?.temp ?? null;

    return {
      id: `map-city:${canonicalCity}`,
      city: canonicalCity,
      city_display_name: displayName,
      display_name: displayName,
      selected_date: selectedDetail?.local_date || null,
      local_date: selectedDetail?.local_date || null,
      local_time: selectedDetail?.local_time || selectedSummary?.local_time || null,
      temp_symbol: tempSymbol,
      current_temp: currentTemp,
      current_max_so_far:
        selectedDetail?.current?.max_so_far ?? currentTemp ?? null,
      deb_prediction:
        selectedDetail?.deb?.prediction ??
        selectedSummary?.deb?.prediction ??
        null,
      airport:
        selectedDetail?.risk?.airport ||
        selectedCityItem?.airport ||
        selectedCityItem?.settlement_station_label ||
        null,
      risk_level:
        selectedDetail?.risk?.level ||
        selectedSummary?.risk?.level ||
        selectedCityItem?.risk_level ||
        "low",
      market_slug: null,
      market_question: isEn ? "City briefing" : "城市简报",
      target_label: isEn ? "City snapshot" : "城市概况",
      side: null,
      edge_percent: null,
      final_score: null,
      window_phase: "city_snapshot",
      tradable: false,
      active: false,
      closed: false,
      accepting_orders: false,
    } satisfies ScanOpportunityRow;
  }, [
    isEn,
    mapFocusedRow,
    mapSelectedCityName,
    store.cityDetailsByName,
    store.citySummariesByName,
    store.cities,
    store.selectedCity,
    store.selectedDetail,
  ]);

  useEffect(() => {
    if (!store.proAccess.loading && !isPro && activeView === "calendar") {
      setActiveView("map");
    }
  }, [activeView, isPro, store.proAccess.loading]);

  useEffect(() => {
    if (store.proAccess.loading) return;
    if (!isPro) {
      setScanLoading(false);
      setScanError(null);
      setTerminalData(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setScanLoading(true);
    setScanError(null);
    const params = new URLSearchParams({
      scan_mode: "tradable",
      min_price: "0.05",
      max_price: "0.95",
      min_edge_pct: "2",
      min_liquidity: "500",
      market_type: "maxtemp",
      time_range: "today",
      limit: "36",
    });
    void buildBrowserBackendHeaders({
      Accept: "application/json",
    })
      .then((headers) => {
        if (cancelled) return null;
        return fetch(resolveBackendApiUrl(`/api/scan/terminal?${params.toString()}`), {
          cache: "no-store",
          headers,
          signal: controller.signal,
        });
      })
      .then(async (response) => {
        if (!response) return null;
        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
            const payload = await response.json();
            message = String(payload?.error || payload?.detail || message);
          } catch {
            // Keep HTTP status message.
          }
          throw new Error(message);
        }
        return response.json() as Promise<ScanTerminalResponse>;
      })
      .then((payload) => {
        if (!payload) return;
        if (cancelled) return;
        setTerminalData(payload);
        setScanError(null);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setScanError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setScanLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isPro, store.proAccess.loading]);

  useEffect(() => {
    setUserLocalTime(formatUserLocalTime());
    const intervalId = window.setInterval(() => {
      setUserLocalTime(formatUserLocalTime());
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("polyweather_scan_theme");
    if (stored === "light") {
      setThemeMode("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("polyweather_scan_theme", themeMode);
  }, [themeMode]);

  const resolvedView: ContentView = activeView;
  const mapFocusedCity = mapSelectedCityName || store.selectedCity;
  const activeDetailRow =
    resolvedView === "map" && mapFocusedCity
      ? mapFocusedRow || mapFallbackRow
      : selectedRow;
  const scanStatus = terminalData?.status || "ready";
  const staleReason = terminalData?.stale_reason || null;

  useEffect(() => {
    if (!activeDetailRow) return;
    if (!findDetailForCity(store.cityDetailsByName, activeDetailRow.city)) {
      void store.ensureCityDetail(activeDetailRow.city, false, "panel").catch(() => {});
    }
  }, [activeDetailRow, store.cityDetailsByName, store.ensureCityDetail]);

  const runAiHydrationQueue = useCallback(async () => {
    if (aiHydrationRunningRef.current) return;
    aiHydrationRunningRef.current = true;
    try {
      while (aiHydrationQueueRef.current.length > 0) {
        const nextCity = aiHydrationQueueRef.current.shift();
        const key = normalizeCityKey(nextCity || "");
        if (!nextCity || !key) continue;
        const existingDetail = findDetailForCity(store.cityDetailsByName, nextCity);
        try {
          const detail = await store.ensureCityDetail(
            nextCity,
            Boolean(existingDetail) && !isFullEnoughForDeepAnalysis(existingDetail),
            "full",
          );
          if (!isFullEnoughForDeepAnalysis(detail)) {
            aiFullHydrationRef.current.delete(key);
          }
        } catch {
          aiFullHydrationRef.current.delete(key);
        }
        await waitForDeepAnalysisQueue(1200);
      }
    } finally {
      aiHydrationRunningRef.current = false;
      if (aiHydrationQueueRef.current.length > 0) {
        void runAiHydrationQueue();
      }
    }
  }, [store.cityDetailsByName, store.ensureCityDetail]);

  const queueAiFullHydration = useCallback(
    (cityName: string) => {
      const key = normalizeCityKey(cityName);
      if (!key || aiFullHydrationRef.current.has(key)) return;
      aiFullHydrationRef.current.add(key);
      aiHydrationQueueRef.current.push(cityName);
      void runAiHydrationQueue();
    },
    [runAiHydrationQueue],
  );

  const addAiPinnedCity = useCallback((cityName: string) => {
    const cleanName = String(cityName || "").trim();
    const key = normalizeCityKey(cleanName);
    if (!key) return;
    const matchedRow = findRowForCity(timeSortedRows, cleanName);
    const prettyName = prettifyCityName(cleanName);
    const displayName =
      matchedRow?.city_display_name ||
      matchedRow?.display_name ||
      getLocalizedCityName(cleanName, prettyName || cleanName, locale) ||
      prettyName ||
      cleanName;
    setAiPinnedCities((current) => {
      const existing = current.findIndex(
        (item) => normalizeCityKey(item.cityName) === key,
      );
      const nextItem = {
        cityName: matchedRow?.city || cleanName,
        displayName,
        addedAt: Date.now(),
      };
      if (existing >= 0) {
        const next = [...current];
        next[existing] = { ...next[existing], ...nextItem };
        return [
          next[existing],
          ...next.filter((_, index) => index !== existing),
        ];
      }
      return [nextItem, ...current].slice(0, 8);
    });
    queueAiFullHydration(matchedRow?.city || cleanName);
  }, [locale, queueAiFullHydration, timeSortedRows]);

  const removeAiPinnedCity = useCallback((cityName: string) => {
    const key = normalizeCityKey(cityName);
    aiFullHydrationRef.current.delete(key);
    aiHydrationQueueRef.current = aiHydrationQueueRef.current.filter(
      (queuedCity) => normalizeCityKey(queuedCity) !== key,
    );
    setAiPinnedCities((current) =>
      current.filter((item) => normalizeCityKey(item.cityName) !== key),
    );
  }, []);

  useEffect(() => {
    aiPinnedCities.forEach((item) => {
      const key = normalizeCityKey(item.cityName);
      if (!key || aiFullHydrationRef.current.has(key)) return;
      const detail = findDetailForCity(store.cityDetailsByName, item.cityName);
      const needsFullHydration = !isFullEnoughForDeepAnalysis(detail);
      if (!needsFullHydration) return;
      queueAiFullHydration(item.cityName);
    });
  }, [aiPinnedCities, queueAiFullHydration, store.cityDetailsByName]);

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    lastMapSelectedCityRef.current = normalizeCityKey(cityName);
    const matchedRow = findRowForCity(timeSortedRows, cityName);
    setSelectedRowId(matchedRow?.id || null);
    addAiPinnedCity(cityName);
    setActiveView("analysis");
  }, [addAiPinnedCity, timeSortedRows]);

  useEffect(() => {
    if (activeView !== "map") return;
    const selectedCity = String(store.selectedCity || "").trim();
    const selectedKey = normalizeCityKey(selectedCity);
    if (!selectedKey || selectedKey === lastMapSelectedCityRef.current) return;
    lastMapSelectedCityRef.current = selectedKey;
    setMapSelectedCityName(selectedCity);
    const matchedRow = findRowForCity(timeSortedRows, selectedCity);
    setSelectedRowId(matchedRow?.id || null);
    addAiPinnedCity(selectedCity);
  }, [activeView, addAiPinnedCity, store.selectedCity, timeSortedRows]);

  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    const cityName = row.city || row.city_display_name || row.display_name || "";
    if (!cityName) return;
    setSelectedRowId(row.id);
    const selectedCityKey = normalizeCityKey(store.selectedCity);
    const rowCityKey = normalizeCityKey(cityName);
    const hasCachedDetail =
      Boolean(findDetailForCity(store.cityDetailsByName, cityName)) ||
      Object.values(store.cityDetailsByName).some((detail) =>
        rowMatchesCity(row, detail?.name || detail?.display_name || ""),
      );
    if (store.isPanelOpen && selectedCityKey === rowCityKey) {
      if (!hasCachedDetail) {
        void store.ensureCityDetail(cityName, false, "panel").catch(() => {});
      }
      return;
    }
    void store.selectCity(cityName);
  }, [store]);

  const handleOpenDecisionRow = useCallback((row: ScanOpportunityRow) => {
    const cityName = row.city || row.city_display_name || row.display_name || "";
    if (!cityName) return;
    setSelectedRowId(row.id);
    addAiPinnedCity(cityName);
    setActiveView("analysis");
    void store.selectCity(cityName);
  }, [addAiPinnedCity, store]);

  const openScanPaywall = useCallback(() => {
    setShowScanPaywall(true);
  }, []);

  const renderMainView = () => {
    if (resolvedView === "opportunities") {
      if (!isPro) {
        return (
          <div className="scan-opportunity-overview empty">
            <strong>{isEn ? "Opportunity board is Pro" : "今日机会榜需 Pro 权限"}</strong>
            <p>
              {isEn
                ? "Map exploration and city briefing are still available."
                : "地图探索和城市简报仍可使用。"}
            </p>
            <button type="button" onClick={openScanPaywall}>
              {isEn ? "Unlock opportunity board" : "解锁机会榜"}
            </button>
          </div>
        );
      }
      return (
        <OpportunityOverview
          rows={timeSortedRows}
          terminalData={terminalData}
          loading={scanLoading}
          error={scanError}
          locale={locale}
          selectedRowId={selectedRowId}
          onOpenDecision={handleOpenDecisionRow}
          onSelectRow={handleSelectRow}
          onOpenMap={() => setActiveView("map")}
        />
      );
    }
    if (resolvedView === "map") {
      return (
        <div className="scan-map-view">
          <div className="scan-map-shell">
            <MapCanvas
              onCitySelect={handleMapCitySelect}
              selectionMode="select"
            />
          </div>
        </div>
      );
    }
    if (resolvedView === "analysis") {
      return (
        <AiPinnedForecastView
          items={aiPinnedCities}
          rows={timeSortedRows}
          detailsByName={store.cityDetailsByName}
          locale={locale}
          onRemoveCity={removeAiPinnedCity}
        />
      );
    }
    if (!isPro) {
      return (
        <div className="scan-table-shell empty">
          <div className="scan-empty-state">
            <div className="scan-empty-title">
              {isEn ? "Scan is available on Pro" : "扫描功能需 Pro 权限"}
            </div>
            <div className="scan-empty-copy">
              {isEn
                ? "Distribution view and city briefing remain available."
                : "分布视图和右侧城市简报仍可查看。"}
            </div>
          </div>
        </div>
      );
    }
    if (resolvedView === "calendar") {
      return (
        <CalendarView
          rows={timeSortedRows}
          locale={locale}
          selectedRowId={selectedRowId}
          onSelectRow={handleSelectRow}
        />
      );
    }
    return null;
  };

  if (store.proAccess.loading) {
    return (
      <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root, themeMode === "light" && "light")}>
        <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
          <main className="scan-data-grid">
            <div className="scan-loading-state">
              <LoadingSignal
                title={isEn ? "Preparing decision workspace" : "正在准备决策工作台"}
                description={
                  isEn
                    ? "Checking access, city context and today’s tradable weather windows."
                    : "正在检查权限、城市上下文和今日可交易天气窗口。"
                }
              />
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root, themeMode === "light" && "light")}>
      <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
        <main className="scan-data-grid">
          <div className="scan-topbar">
            <div className="scan-topbar-title">
              <strong>{isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}</strong>
              <span>
                {isEn
                  ? "Start from opportunities, then open city cards to verify weather evidence"
                  : "先看今日机会榜，再打开城市决策卡验证天气证据"}
              </span>
            </div>
            <div className="scan-topbar-actions">
              <button
                type="button"
                className="scan-locale-switch"
                aria-label={isEn ? "Switch to Chinese" : "切换到英文"}
                title={isEn ? "Switch to Chinese" : "切换到英文"}
                onClick={toggleLocale}
              >
                <span className={clsx(locale === "zh-CN" && "active")}>中文</span>
                <span className={clsx(locale === "en-US" && "active")}>EN</span>
              </button>
              <span className="scan-topbar-time">
                {userLocalTime}
              </span>
              {isPro ? null : store.proAccess.authenticated ? (
                <button
                  type="button"
                  className="scan-primary-button"
                  onClick={openScanPaywall}
                >
                  <UserRound size={14} />
                  {isEn ? "Upgrade Pro" : "升级 Pro"}
                </button>
              ) : (
                <Link href={accountHref} className="scan-primary-button">
                  <LogIn size={14} />
                  {isEn ? "Sign in" : "登录"}
                </Link>
              )}
              <button
                type="button"
                className="scan-theme-button"
                aria-label={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                title={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              >
                {themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}
              </button>
              {store.proAccess.authenticated ? (
                <Link
                  href={accountHref}
                  className="scan-account-button"
                  aria-label={isEn ? "Account" : "账户"}
                  title={isEn ? "Account" : "账户"}
                >
                  <UserRound size={15} />
                </Link>
              ) : null}
            </div>
          </div>

          <AiForecastKPIBar
            pinnedCount={aiPinnedCities.length}
            activeCityName={kpiCityName}
            activeDetail={kpiDetail}
            activeRow={kpiRow}
            locale={locale}
          />

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs">
                <button
                  type="button"
                  className={resolvedView === "opportunities" ? "active" : ""}
                  onClick={() => {
                    setActiveView("opportunities");
                  }}
                >
                  {isEn ? "Opportunity Board" : "今日机会榜"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "map" ? "active" : ""}
                  onClick={() => {
                    lastMapSelectedCityRef.current = normalizeCityKey(store.selectedCity);
                    setActiveView("map");
                  }}
                >
                  {isEn ? "Distribution View" : "分布视图"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "analysis" ? "active" : ""}
                  onClick={() => {
                    setActiveView("analysis");
                  }}
                >
                  {isEn ? "Decision Cards" : "城市决策卡"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "calendar" ? "active" : ""}
                  title={!isPro ? (isEn ? "Pro forecast calendar required" : "日历预测需 Pro") : undefined}
                  onClick={() => {
                    if (!isPro) {
                      openScanPaywall();
                      return;
                    }
                    setActiveView("calendar");
                  }}
                >
                  {isEn ? "Calendar View" : "日历视图"}
                </button>
              </div>
              <div className="scan-list-status">
                {terminalData?.stale ? (
                  <span className="scan-status-chip stale">
                    {isEn ? "Delayed snapshot" : "延迟快照"}
                  </span>
                ) : null}
              </div>
            </div>

            {scanStatus === "failed" && !terminalData ? (
              <div className="scan-empty-state">
                <div className="scan-empty-title">
                  {isEn ? "Scan failed" : "扫描失败"}
                </div>
                <div className="scan-empty-copy">{staleReason}</div>
              </div>
            ) : (
              renderMainView()
            )}
          </section>
        </main>

        <CityDetailPanel variant="rail" />
      </div>
      <FutureForecastModal />
      {showScanPaywall ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? "Unlock market scan" : "解锁市场扫描"}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowScanPaywall(false);
            }
          }}
        >
          <ProFeaturePaywall
            feature="scan"
            onClose={() => setShowScanPaywall(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ScanTerminalDashboard() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <ScanTerminalScreen />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
