"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  LogIn,
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
import dashboardHomeStyles from "./DashboardHomeIntelligence.module.css";
import dashboardMapStyles from "./DashboardMap.module.css";
import dashboardModalGuideStyles from "./DashboardModalGuide.module.css";
import dashboardShellStyles from "./DashboardShell.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import detailContentStyles from "./DetailPanelContent.module.css";
import detailSectionsStyles from "./DetailPanelSections.module.css";
import futureForecastModalStyles from "./FutureForecastModal.module.css";
import historyModalStyles from "./HistoryModal.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import scanTerminalCalendarStyles from "./ScanTerminalCalendar.module.css";
import scanTerminalCardStyles from "./ScanTerminalCard.module.css";
import scanTerminalLightThemeStyles from "./ScanTerminalLightTheme.module.css";
import scanTerminalOpportunityStyles from "./ScanTerminalOpportunity.module.css";
import scanTerminalStyles from "./ScanTerminal.module.css";
import scanTerminalBoardStyles from "./ScanTerminalBoard.module.css";
import scanTerminalDetailStyles from "./ScanTerminalDetail.module.css";
import scanTerminalFiltersStyles from "./ScanTerminalFilters.module.css";
import scanTerminalListStyles from "./ScanTerminalList.module.css";
import scanTerminalShellStyles from "./ScanTerminalShell.module.css";
import scanTerminalStateStyles from "./ScanTerminalState.module.css";
import scanTerminalMobileStyles from "./ScanTerminalMobile.module.css";
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
import { CalendarView } from "@/components/dashboard/scan-terminal/CalendarView";
import { AiForecastKPIBar } from "@/components/dashboard/scan-terminal/AiForecastKPIBar";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import { OpportunityOverview } from "@/components/dashboard/scan-terminal/OpportunityOverview";
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

type ContentView = "opportunities" | "analysis" | "map" | "calendar";

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
  const [activeView, setActiveView] = useState<ContentView>("opportunities");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const userLocalTime = useUserLocalClock();
  const { setThemeMode, themeMode } = useScanTerminalTheme();
  const lastMapSelectedCityRef = useRef<string>("");
  const scanTerminalRootClassName = clsx(
    styles.root,
    dashboardHomeStyles.root,
    dashboardMapStyles.root,
    dashboardShellStyles.root,
    dashboardModalGuideStyles.root,
    scanTerminalStyles.root,
    scanTerminalShellStyles.root,
    scanTerminalFiltersStyles.root,
    scanTerminalListStyles.root,
    scanTerminalBoardStyles.root,
    scanTerminalDetailStyles.root,
    scanTerminalStateStyles.root,
    scanTerminalOpportunityStyles.root,
    scanTerminalCardStyles.root,
    scanTerminalCalendarStyles.root,
    scanTerminalMobileStyles.root,
    scanTerminalLightThemeStyles.root,
    detailChromeStyles.root,
    detailContentStyles.root,
    detailSectionsStyles.root,
    modalChromeStyles.root,
    futureForecastModalStyles.root,
    historyModalStyles.root,
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
          onRefreshCityDetail={refreshAiPinnedCityDetail}
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
      <div className={scanTerminalRootClassName}>
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
    <div className={scanTerminalRootClassName}>
      <div
        className={clsx(
          "scan-terminal",
          resolvedView === "map" && "map-view-active",
          themeMode === "light" && "light",
        )}
      >
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

          <section className="scan-upgrade-announcement" aria-label={isEn ? "Upgrade announcement" : "升级公告"}>
            <div className="scan-upgrade-announcement-copy">
              <span>{isEn ? "v1.5.5 upgrade" : "v1.5.5 升级公告"}</span>
              <strong>
                {isEn ? "PolyWeather is now upgraded to v1.5.5" : "网站已升级到 v1.5.5"}
              </strong>
              <p>
                {isEn
                  ? "All members received an extra 7 days. The decision terminal now explains more evidence without making unavailable quotes look like a system failure."
                  : "所有会员已额外延长 7 天。新版会把证据讲得更清楚，也不会让暂无报价看起来像系统故障。"}
              </p>
            </div>
            <ul>
              <li>{isEn ? "DeepSeek airport bulletin read" : "DeepSeek 机场报文解读"}</li>
              <li>{isEn ? "Action calendar view" : "日历行动视图"}</li>
              <li>{isEn ? "Local-time peak window" : "本地时间峰值窗口"}</li>
              <li>{isEn ? "AI evidence guardrails" : "AI 证据护栏"}</li>
            </ul>
          </section>

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
                        ? "Force refresh opportunity board and calendar"
                        : "强制刷新今日机会榜和日历视图"
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
