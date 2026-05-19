"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Dashboard.module.css";
import { scanRootClass } from "./scan-root-styles";
import {
  DashboardStoreProvider,
  useDashboardStore,
  useProAccess,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { AiPinnedForecastView } from "@/components/dashboard/scan-terminal/AiPinnedForecastView";
import { MobileCityPicker } from "@/components/dashboard/scan-terminal/MobileCityPicker";
import { WelcomeOverlay } from "@/components/dashboard/scan-terminal/WelcomeOverlay";
import {
  ScanPaywallModal,
  ScanTerminalLoadingScreen,
  ScanTerminalTopBar,
  type ScanTerminalContentView,
} from "@/components/dashboard/scan-terminal/ScanTerminalShellParts";
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
import { useRelativeTime } from "@/hooks/useRelativeTime";

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
  const { proAccess } = useProAccess();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = proAccess.subscriptionActive;
  const accountHref = proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const { refreshScanTerminalManually, scanError, scanLoading, terminalData } =
    useScanTerminalQuery({
      isPro,
      proAccessLoading: proAccess.loading,
    });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ScanTerminalContentView>("map");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(
    null,
  );
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 768px)");
    const syncMobileViewport = () => {
      setIsMobileViewport(media.matches);
      if (media.matches) {
        setActiveView((current) => (current === "map" ? "city-list" : current));
      } else {
        setActiveView((current) => (current === "city-list" ? "map" : current));
      }
    };
    syncMobileViewport();
    media.addEventListener("change", syncMobileViewport);
    return () => media.removeEventListener("change", syncMobileViewport);
  }, []);

  const userLocalTime = useUserLocalClock();
  const { setThemeMode, themeMode } = useScanTerminalTheme();
  const lastMapSelectedCityRef = useRef<string>("");
  const lastFetchedAtRef = useRef<number>(0);
  const serverAgeText = useRelativeTime(terminalData?.generated_at ?? null);
  const localAgeText = useRelativeTime(
    lastFetchedAtRef.current
      ? new Date(lastFetchedAtRef.current).toISOString()
      : null,
  );

  useEffect(() => {
    if (terminalData?.generated_at) {
      lastFetchedAtRef.current = Date.now();
    }
  }, [terminalData?.generated_at]);

  const scanTerminalRootClassName = clsx(
    styles.root,
    scanRootClass,
    themeMode === "light" && "light",
  );

  const timeSortedRows = useMemo(
    () => sortRowsByUserTime(terminalData?.rows || []),
    [terminalData?.rows],
  );

  const cityListRows = useMemo(() => {
    if (timeSortedRows.length > 0) return timeSortedRows;
    return store.cities.map((city, index) => {
      const cityKey = normalizeCityKey(city.name);
      const summary =
        store.citySummariesByName[cityKey] ??
        Object.values(store.citySummariesByName).find(
          (s) => normalizeCityKey(s?.name) === cityKey,
        ) ??
        null;
      return {
        id: `city-fallback:${cityKey}:${index}`,
        city: cityKey,
        city_display_name: city.display_name || city.name,
        display_name: city.display_name || city.name,
        temp_symbol: city.temp_unit === "fahrenheit" ? "°F" : "°C",
        current_temp: summary?.current?.temp ?? null,
        current_max_so_far: summary?.current?.temp ?? null,
        deb_prediction: summary?.deb?.prediction ?? null,
        airport: city.airport || null,
        local_time: summary?.local_time ?? null,
        risk_level: city.risk_level || "low",
        market_slug: null,
        market_question: null,
        target_label: null,
        side: null,
        edge_percent: null,
        final_score: null,
        window_phase: null,
        tradable: false,
        active: false,
        closed: false,
        accepting_orders: false,
      } satisfies ScanOpportunityRow;
    });
  }, [timeSortedRows, store.cities, store.citySummariesByName]);
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
    return (
      timeSortedRows.find((row) => row.id === selectedRowId) ||
      timeSortedRows[0] ||
      null
    );
  }, [timeSortedRows, selectedRowId]);

  useEffect(() => {
    if (!timeSortedRows.length) return;
    if (selectedRowId && timeSortedRows.some((row) => row.id === selectedRowId))
      return;
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
      store.selectedDetail &&
      normalizeCityKey(store.selectedDetail.name) === cityKey
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
      local_time:
        selectedDetail?.local_time || selectedSummary?.local_time || null,
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

  const resolvedView: ScanTerminalContentView = activeView;
  const mapFocusedCity = mapSelectedCityName || store.selectedCity;
  const activeDetailRow =
    resolvedView === "map" && mapFocusedCity
      ? mapFocusedRow || mapFallbackRow
      : selectedRow;
  const scanStatus = terminalData?.status || "ready";
  const staleReason = terminalData?.stale_reason || null;
  const proPreviewItems = isEn
    ? [
        "Real-time METAR & official station data for 52 cities",
        "Multi-model DEB blend vs market-implied temperature",
        "Probability buckets mapped to Polymarket contracts",
        "Live observation deviation & mispricing signals",
        "City decision cards for current & future settlement dates",
      ]
    : [
        "52 城实时机场报文与官方观测站数据",
        "多模型 DEB 融合预测 vs 市场隐含温度",
        "概率分布桶对照 Polymarket 合约",
        "实时观测偏差与错价信号",
        "当前日与未来结算日的城市决策卡",
        "未来日期城市决策卡",
      ];

  useEffect(() => {
    if (!activeDetailRow) return;
    if (!findDetailForCity(store.cityDetailsByName, activeDetailRow.city)) {
      void store
        .ensureCityDetail(activeDetailRow.city, false, "panel")
        .catch(() => {});
    }
  }, [activeDetailRow, store.cityDetailsByName, store.ensureCityDetail]);

  const handleMapCitySelect = useCallback(
    (cityName: string) => {
      setMapSelectedCityName(cityName);
      lastMapSelectedCityRef.current = normalizeCityKey(cityName);
      const matchedRow = findRowForCity(timeSortedRows, cityName);
      if (matchedRow) {
        store.preloadCityFromRow(matchedRow);
        setSelectedRowId(matchedRow.id);
      } else {
        void store.ensureCityDetail(cityName, false, "panel").catch(() => {});
        setSelectedRowId(null);
      }
      if (isPro) {
        addAiPinnedCity(cityName);
        setActiveView("analysis");
      }
    },
    [store, timeSortedRows, isPro, addAiPinnedCity],
  );

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

  const handleSelectRow = useCallback(
    (row: ScanOpportunityRow) => {
      const cityName =
        row.city || row.city_display_name || row.display_name || "";
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
    },
    [store],
  );

  const handleOpenDecisionRow = useCallback(
    (row: ScanOpportunityRow) => {
      const cityName =
        row.city || row.city_display_name || row.display_name || "";
      if (!cityName) return;
      setSelectedRowId(row.id);
      store.preloadCityFromRow(row);
      addAiPinnedCity(cityName);
      setActiveView("analysis");
      void store.selectCity(cityName);
    },
    [addAiPinnedCity, store],
  );

  const openScanPaywall = useCallback(() => {
    setShowScanPaywall(true);
  }, []);

  const renderMainView = () => {
    if (resolvedView === "city-list") {
      return (
        <MobileCityPicker
          isEn={isEn}
          rows={cityListRows}
          onSelectCity={isPro ? handleOpenDecisionRow : handleSelectRow}
        />
      );
    }
    // Keep MapCanvas always mounted — hiding with CSS avoids Leaflet
    // reinitialization that causes a white background on tab switches.
    // The analysis view overlays on top when active.
    return (
      <>
        <div
          className="scan-map-view"
          style={{ display: resolvedView === "map" ? undefined : "none" }}
        >
          <div className="scan-map-shell">
            <MapCanvas
              onCitySelect={handleMapCitySelect}
              selectionMode="select"
            />
          </div>
        </div>
        {resolvedView === "analysis" && isPro ? (
          <AiPinnedForecastView
            items={aiPinnedCities}
            rows={timeSortedRows}
            detailsByName={store.cityDetailsByName}
            locale={locale}
            onRefreshCityDetail={refreshAiPinnedCityDetail}
            onRemoveCity={removeAiPinnedCity}
          />
        ) : null}
      </>
    );
  };

  if (proAccess.loading) {
    return (
      <ScanTerminalLoadingScreen
        isEn={isEn}
        rootClassName={scanTerminalRootClassName}
        themeMode={themeMode}
        userLocalTime={userLocalTime}
      />
    );
  }

  return (
    <div className={scanTerminalRootClassName}>
      <div
        className={clsx(
          "scan-terminal",
          resolvedView === "city-list" && "city-list-view-active",
          resolvedView === "map" && "map-view-active",
          resolvedView !== "map" && "focus-view-active",
          resolvedView === "analysis" && "analysis-view-active",
          themeMode === "light" && "light",
        )}
      >
        <main className="scan-data-grid">
          <ScanTerminalTopBar
            accountHref={accountHref}
            isAuthenticated={proAccess.authenticated}
            isEn={isEn}
            isPro={isPro}
            locale={locale}
            onOpenScanPaywall={openScanPaywall}
            setThemeMode={setThemeMode}
            themeMode={themeMode}
            toggleLocale={toggleLocale}
            userLocalTime={userLocalTime}
          />

          {!isPro ? (
            <section
              className="scan-upgrade-announcement"
              aria-label={isEn ? "Pro preview" : "Pro 能力预览"}
            >
              <div className="scan-upgrade-announcement-copy">
                <span>{isEn ? "PolyWeather Pro" : "PolyWeather Pro"}</span>
                <strong>
                  {isEn
                    ? "Weather intelligence for temperature settlement markets."
                    : "面向温度结算市场的气象情报系统。"}
                </strong>
                <p>
                  {isEn
                    ? "Turn weather data into trading decisions. Compare multi-model forecasts against live observations, identify mispriced Polymarket contracts, and back your trades with calibrated probability distributions."
                    : "将气象数据转化为交易决策。多模型预报对照实时观测，识别 Polymarket 错价合约，用校准概率分布支撑每一笔交易。"}
                </p>
              </div>
              <ul>
                {proPreviewItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {proAccess.authenticated ? (
                <button
                  type="button"
                  className="scan-primary-button"
                  onClick={openScanPaywall}
                >
                  {isEn ? "View Pro" : "查看 Pro"}
                </button>
              ) : (
                <a href={accountHref} className="scan-primary-button">
                  {isEn ? "Sign in for Pro" : "登录查看 Pro"}
                </a>
              )}
            </section>
          ) : null}

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div
                className="scan-list-tabs"
                role="tablist"
                aria-label={isEn ? "Content view" : "内容视图"}
              >
                {isMobileViewport ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resolvedView === "city-list"}
                    className={resolvedView === "city-list" ? "active" : ""}
                    onClick={() => {
                      setActiveView("city-list");
                    }}
                  >
                    {isEn ? "City List" : "城市列表"}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resolvedView === "map"}
                    className={resolvedView === "map" ? "active" : ""}
                    onClick={() => {
                      lastMapSelectedCityRef.current = normalizeCityKey(
                        store.selectedCity,
                      );
                      setActiveView("map");
                    }}
                  >
                    {isEn ? "Distribution View" : "分布视图"}
                  </button>
                )}
                {isPro ? (
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
                ) : null}
              </div>
              <div className="scan-list-status">
                {terminalData?.generated_at ? (
                  <span
                    className={clsx(
                      "scan-status-chip",
                      terminalData?.stale ? "stale" : "live",
                    )}
                  >
                    {isEn ? "Updated" : "已更新"} {serverAgeText || ""}
                  </span>
                ) : null}
                {terminalData?.stale && localAgeText ? (
                  <span className="scan-status-chip stale">
                    {isEn ? "Local fetch " : "本地下发 "}
                    {localAgeText}
                  </span>
                ) : null}
                {isPro ? (
                  <button
                    type="button"
                    className="scan-status-chip refresh"
                    onClick={refreshScanTerminalManually}
                    disabled={scanLoading}
                    title={
                      isEn ? "Force refresh decision cards" : "强制刷新决策卡"
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={scanLoading ? "spin" : undefined}
                    />
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
          </section>
        </main>

        <CityDetailPanel variant="rail" />
      </div>
      <WelcomeOverlay locale={locale} onDismiss={() => {}} />
      <FutureForecastModal />
      {showScanPaywall ? (
        <ScanPaywallModal
          isEn={isEn}
          onClose={() => setShowScanPaywall(false)}
        />
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
