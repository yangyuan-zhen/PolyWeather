"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  LogIn,
  MessageCircle,
  Moon,
  RefreshCw,
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
import { scanRootClass } from "./scan-root-styles";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  ScanOpportunityRow,
} from "@/lib/dashboard-types";
import { AiPinnedForecastView } from "@/components/dashboard/scan-terminal/AiPinnedForecastView";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import { WelcomeOverlay } from "@/components/dashboard/scan-terminal/WelcomeOverlay";
import { findDetailForCity } from "@/components/dashboard/scan-terminal/city-detail-utils";
import {
  findRowForCity,
  normalizeCityKey,
  rowMatchesCity,
  sortRowsByUserTime,
} from "@/components/dashboard/scan-terminal/decision-utils";
import { useAiPinnedCityWorkspace } from "@/components/dashboard/scan-terminal/use-ai-pinned-city-workspace";
import { useScanTerminalQuery } from "@/components/dashboard/scan-terminal/use-scan-terminal-query";
import {
  useScanTerminalTheme,
  useUserLocalClock,
} from "@/components/dashboard/scan-terminal/use-scan-terminal-ui-state";
const MonitorPanel = dynamic(
  () => import("@/components/dashboard/monitoring/MonitorPanel"),
  { ssr: false },
);

type ContentView = "analysis" | "map" | "monitor";

const CityDetailPanel = dynamic(
  () =>
    import("@/components/dashboard/DetailPanel").then(
      (module) => module.DetailPanel,
    ),
  { ssr: false },
);

const FutureForecastModal = dynamic(
  () =>
    import("@/components/dashboard/FutureForecastModal").then(
      (module) => module.FutureForecastModal,
    ),
  { ssr: false },
);

const MapCanvas = dynamic(
  () =>
    import("@/components/dashboard/MapCanvas").then(
      (module) => module.MapCanvas,
    ),
  { ssr: false },
);

function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = store.proAccess.subscriptionActive;
  const accountHref = store.proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const {
    refreshScanTerminalManually,
    scanError,
    scanLoading,
    terminalData,
  } = useScanTerminalQuery({
    isPro,
    proAccessLoading: store.proAccess.loading,
  });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ContentView>("map");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  useEffect(() => {
    const key = "polyweather_v156_announcement_seen_at";
    const seen = localStorage.getItem(key);
    const now = Date.now();
    if (!seen) {
      localStorage.setItem(key, String(now));
      setShowAnnouncement(true);
      return;
    }
    const elapsed = now - Number(seen);
    setShowAnnouncement(elapsed < 3 * 24 * 60 * 60 * 1000);
  }, []);
  const userLocalTime = useUserLocalClock();
  const { setThemeMode, themeMode } = useScanTerminalTheme();
  const lastMapSelectedCityRef = useRef<string>("");
  const scanTerminalRootClassName = clsx(
    styles.root,
    scanRootClass,
    themeMode === "light" && "light",
  );

  const timeSortedRows = useMemo(
    () => sortRowsByUserTime(terminalData?.rows || []),
    [terminalData?.rows],
  );
  const {
    addAiPinnedCity,
    aiPinnedCities,
    refreshAiPinnedCityDetail,
    removeAiPinnedCity,
  } = useAiPinnedCityWorkspace({
    locale,
    store,
    timeSortedRows,
  });
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

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    lastMapSelectedCityRef.current = normalizeCityKey(cityName);
    const matchedRow = findRowForCity(timeSortedRows, cityName);
    if (matchedRow) store.preloadCityFromRow(matchedRow);
    setSelectedRowId(matchedRow?.id || null);
    addAiPinnedCity(cityName);
    setActiveView("analysis");
  }, [addAiPinnedCity, store, timeSortedRows]);

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
    store.preloadCityFromRow(row);
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
    store.preloadCityFromRow(row);
    addAiPinnedCity(cityName);
    setActiveView("analysis");
    void store.selectCity(cityName);
  }, [addAiPinnedCity, store]);

  const openScanPaywall = useCallback(() => {
    setShowScanPaywall(true);
  }, []);

  const renderMainView = () => {
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
          onRefreshCityDetail={refreshAiPinnedCityDetail}
          onRemoveCity={removeAiPinnedCity}
        />
      );
    }
    if (resolvedView === "monitor") {
      return null; // MonitorPanel is rendered below the main view switch
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
    return null;
  };

  if (store.proAccess.loading) {
    return (
      <div className={scanTerminalRootClassName}>
        <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
          <main className="scan-data-grid">
            <div className="scan-topbar">
              <div className="scan-topbar-title">
                <strong>{isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}</strong>
                <span>
                  {isEn
                    ? "Start from the map, then open city cards to verify weather evidence"
                    : "从地图选城市，再打开决策卡验证天气证据"}
                </span>
              </div>
              <div className="scan-topbar-actions">
                <span className="scan-topbar-time">{userLocalTime}</span>
              </div>
            </div>
            <div className="scan-loading-state">
              <LoadingSignal
                title={isEn ? "Preparing decision workspace" : "正在准备决策工作台"}
                description={
                  isEn
                    ? "Checking access, city context and today's tradable weather windows."
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
    <div className={scanTerminalRootClassName}>
      <div
        className={clsx(
          "scan-terminal",
          resolvedView === "map" && "map-view-active",
          resolvedView !== "map" && "focus-view-active",
          resolvedView === "analysis" && "analysis-view-active",
          themeMode === "light" && "light",
        )}
      >
        <main className="scan-data-grid">
          <div className="scan-topbar">
            <div className="scan-topbar-title">
                <strong>{isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}</strong>
              <span>
                {isEn
                  ? "Start from the map, then open city cards to verify weather evidence"
                  : "从地图选城市，再打开决策卡验证天气证据"}
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
              <a
                href="https://t.me/+nMG7SjziUKYyZmM1"
                target="_blank"
                rel="noopener noreferrer"
                className="scan-account-button"
                aria-label={isEn ? "Feedback" : "反馈"}
                title={isEn ? "Join Telegram for feedback" : "加入 Telegram 反馈"}
              >
                <MessageCircle size={15} />
              </a>
            </div>
          </div>

          {showAnnouncement ? (
          <section className="scan-upgrade-announcement" aria-label={isEn ? "Upgrade announcement" : "升级公告"}>
            <div className="scan-upgrade-announcement-copy">
              <span>{isEn ? "v1.5.6 upgrade" : "v1.5.6 升级公告"}</span>
              <strong>
                {isEn ? "Scan terminal is upgraded to v1.5.6" : "决策终端已升级到 v1.5.6"}
              </strong>
              <p>
                {isEn
                  ? "City decision cards have been redesigned with a compact hero layout and consistent DEB data source. Sticky headers are removed for smoother scrolling."
                  : "城市决策卡 hero 布局重新设计，三指标并列对比更直观；DEB 数据源统一不再出现不一致；去除顶部固定效果滚动更流畅。"}
              </p>
            </div>
            <ul>
              <li>{isEn ? "Redesigned decision card hero" : "重设计城市决策卡 hero 布局"}</li>
              <li>{isEn ? "Unified DEB data source" : "统一 DEB 数据源"}</li>
              <li>{isEn ? "Light theme coverage" : "亮色主题补全覆盖"}</li>
              <li>{isEn ? "HKO observatory AI read" : "香港天文台观测 AI 解读"}</li>
              <li>{isEn ? "Smoother scrolling experience" : "滚动体验优化"}</li>
            </ul>
            <button
              type="button"
              className="scan-announcement-dismiss"
              aria-label={isEn ? "Dismiss" : "关闭"}
              onClick={() => {
                localStorage.setItem("polyweather_v156_announcement_seen_at", String(Date.now() + 90 * 24 * 60 * 60 * 1000));
                setShowAnnouncement(false);
              }}
            >
              ✕
            </button>
          </section>
          ) : null}

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs" role="tablist" aria-label={isEn ? "Content view" : "内容视图"}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resolvedView === "map"}
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
                  role="tab"
                  aria-selected={resolvedView === "analysis"}
                  className={resolvedView === "analysis" ? "active" : ""}
                  onClick={() => {
                    setActiveView("analysis");
                  }}
                >
                  {isEn ? "Decision Cards" : "城市决策卡"}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resolvedView === "monitor"}
                  className={resolvedView === "monitor" ? "active" : ""}
                  onClick={() => setActiveView("monitor")}
                >
                  🔥 {isEn ? "Monitor" : "市场监控"}
                </button>
              </div>
              <div className="scan-list-status">
                {terminalData?.generated_at ? (
                  <span className="scan-status-chip live">
                    {isEn ? "Updated" : "已更新"}{" "}
                    {new Date(terminalData.generated_at).toLocaleTimeString(
                      isEn ? "en-US" : "zh-CN",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                ) : null}
                {terminalData?.stale ? (
                  <span className="scan-status-chip stale">
                    {isEn ? "Delayed snapshot" : "延迟快照"}
                  </span>
                ) : null}
                {isPro ? (
                  <button
                    type="button"
                    className="scan-status-chip refresh"
                    onClick={refreshScanTerminalManually}
                    disabled={scanLoading}
                    title={
                      isEn
                        ? "Force refresh decision cards"
                        : "强制刷新决策卡"
                    }
                  >
                    <RefreshCw size={14} className={scanLoading ? "spin" : undefined} />
                    {isEn ? "Refresh" : "刷新"}
                  </button>
                ) : null}
              </div>
            </div>

            {scanStatus === "failed" && !terminalData ? (
              <div className="scan-empty-state">
                <div className="scan-empty-title">
                  {isEn ? "Scan failed" : "扫描失败"}
                </div>
                <div className="scan-empty-copy">{staleReason}</div>
                <button
                  type="button"
                  className="scan-retry-button"
                  onClick={() => refreshScanTerminalManually()}
                >
                  <RefreshCw size={13} />
                  {isEn ? "Retry" : "重试"}
                </button>
              </div>
            ) : (
              renderMainView()
            )}
            {resolvedView === "monitor" && (
              <MonitorPanel />
            )}
          </section>
        </main>

        <CityDetailPanel variant="rail" />
      </div>
      <WelcomeOverlay locale={locale} onDismiss={() => {}} />
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
