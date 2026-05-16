"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForecastTable } from "@/components/dashboard/PanelSections";
import {
  useDashboardModal,
  useDashboardStore,
  useProAccess,
} from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { getOfficialSourceLinks } from "@/lib/dashboard-official-sources";
import { trackAppEvent } from "@/lib/app-analytics";
import { getTodayPolymarketUrl } from "@/lib/polymarket-market-links";
import { getCityProfileStats } from "@/lib/dashboard-utils";
import { normalizeObservationSourceLabel } from "@/lib/source-labels";
import { getRiskBadgeLabel } from "@/lib/weather-summary-utils";

const DetailMiniTemperatureChart = dynamic(
  () =>
    import("@/components/dashboard/DetailMiniTemperatureChart").then(
      (module) => module.DetailMiniTemperatureChart,
    ),
  {
    loading: () => <div className="detail-mini-chart detail-mini-chart-loading" />,
    ssr: false,
  },
);

export function DetailPanel({
  variant = "overlay",
}: {
  variant?: "overlay" | "rail";
} = {}) {
  const store = useDashboardStore();
  const modal = useDashboardModal();
  const { proAccess } = useProAccess();
  const { locale, t } = useI18n();
  const router = useRouter();
  const isRail = variant === "rail";
  const detail = store.selectedDetail;
  const selectedCityItem = useMemo(
    () =>
      store.selectedCity
        ? store.cities.find((city) => city.name === store.selectedCity) || null
        : null,
    [store.cities, store.selectedCity],
  );
  const selectedSummary = useMemo(
    () =>
      store.selectedCity
        ? store.citySummariesByName[store.selectedCity] || null
        : null,
    [store.citySummariesByName, store.selectedCity],
  );
  const isPro = proAccess.subscriptionActive;
  const isAuthenticated = proAccess.authenticated;
  const panelRef = useRef<HTMLElement | null>(null);
  const lastDetailFetchedAtRef = useRef<number>(0);

  useEffect(() => {
    if (detail?.name) {
      lastDetailFetchedAtRef.current = Date.now();
    }
  }, [detail?.name]);

  const detailAgeText = useRelativeTime(
    lastDetailFetchedAtRef.current
      ? new Date(lastDetailFetchedAtRef.current).toISOString()
      : null,
  );
  const [heavyContentReady, setHeavyContentReady] = useState(false);
  const isOverlayOpen =
    Boolean(modal.futureModalDate);
  const isVisible = isRail
    ? Boolean(store.selectedCity) && !isOverlayOpen
    : store.isPanelOpen && Boolean(store.selectedCity) && !isOverlayOpen;
  const hasBasicPanelContent = Boolean(
    detail || selectedSummary || selectedCityItem,
  );
  const panelDisplayName =
    detail?.display_name ||
    selectedSummary?.display_name ||
    selectedCityItem?.display_name ||
    store.selectedCity ||
    "...";
  const panelRiskLevel =
    detail?.risk?.level ||
    selectedSummary?.risk?.level ||
    selectedCityItem?.risk_level ||
    "low";
  const profileStats = useMemo(
    () => (detail ? getCityProfileStats(detail, locale) : []),
    [detail, locale],
  );
  const officialLinks = useMemo(
    () => (detail ? getOfficialSourceLinks(detail) : []),
    [detail],
  );
  const marketUrl = useMemo(
    () => getTodayPolymarketUrl(detail, locale),
    [detail, locale],
  );
  const basicSettlementLabel = normalizeObservationSourceLabel(
    selectedSummary?.current?.settlement_source_label ||
      selectedCityItem?.settlement_source_label ||
      selectedCityItem?.settlement_source,
    locale === "en-US" ? "Settlement source pending" : "结算口径待确认",
  );
  const basicAirportLabel =
    selectedCityItem?.airport ||
    selectedSummary?.icao ||
    (locale === "en-US" ? "Airport pending" : "机场待确认");
  const heroSettlementLabel = normalizeObservationSourceLabel(
    detail?.current?.settlement_source_label,
    basicSettlementLabel,
  );
  const heroAirportLabel = detail?.risk?.airport || basicAirportLabel;
  const isSparsePanelDetail = Boolean(
    detail &&
    (detail.detail_depth !== "full" ||
      (detail.forecast?.daily?.length ?? 0) <= 1),
  );
  const isPanelSyncing = store.loadingState.cityDetail;
  const [panelSyncTimedOut, setPanelSyncTimedOut] = useState(false);
  const showPanelSyncing = isPanelSyncing && !panelSyncTimedOut;
  const isShowingCachedDetailDuringSync = false;

  const blurActiveElement = () => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };

  const handleTodayAccess = () => {
    blurActiveElement();

    if (!isPro) {
      trackAppEvent("paywall_feature_clicked", {
        entry: "detail_panel",
        feature: "today",
        city: store.selectedCity,
        user_state: isAuthenticated ? "logged_in" : "guest",
      });
    }

    if (isPro) {
      void modal.openTodayModal();
      return;
    }

    if (isAuthenticated) {
      router.push("/account");
      return;
    }

    void modal.openTodayModal();
  };

  useEffect(() => {
    if (!isPanelSyncing || !store.selectedCity) {
      setPanelSyncTimedOut(false);
      return;
    }

    setPanelSyncTimedOut(false);
    const timeoutId = window.setTimeout(() => {
      setPanelSyncTimedOut(true);
    }, 12_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isPanelSyncing, store.selectedCity]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (!isVisible) {
      panel.setAttribute("inert", "");
      if (
        typeof document !== "undefined" &&
        panel.contains(document.activeElement)
      ) {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      }
      return;
    }

    panel.removeAttribute("inert");
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !detail) {
      setHeavyContentReady(false);
      return;
    }

    let canceled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const win = typeof window !== "undefined" ? (window as any) : null;

    const markReady = () => {
      if (!canceled) {
        setHeavyContentReady(true);
      }
    };

    if (win && typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(markReady, { timeout: 180 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(markReady, 80);
    } else {
      setHeavyContentReady(true);
    }

    return () => {
      canceled = true;
      if (
        win &&
        idleId != null &&
        typeof win.cancelIdleCallback === "function"
      ) {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId != null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
    };
  }, [detail, isVisible]);

  return (
    <aside
      ref={panelRef}
      className={clsx(
        "detail-panel",
        isRail && "scan-city-detail-rail",
        (isVisible || isRail) && "visible",
      )}
    >
      <div className="panel-header">
        {!isRail ? (
          <button
            type="button"
            className="panel-close"
            aria-label={t("detail.closeAria")}
            onClick={() => {
              blurActiveElement();
              store.closePanel();
            }}
          >
            ×
          </button>
        ) : null}
        <div className="panel-title-area">
          <div className="panel-title-stack">
            <div className="panel-overline">
              <span>{locale === "en-US" ? "City briefing" : "城市简报"}</span>
              <span className="panel-overline-sep">•</span>
              <span>{panelDisplayName.toUpperCase()}</span>
            </div>
            <h2>{panelDisplayName}</h2>
          </div>
          {showPanelSyncing && (
            <div
              className="panel-loading-hint"
              role="status"
              aria-live="polite"
            >
              <span className="panel-loading-spinner" aria-hidden="true" />
              <span>
                {locale === "en-US"
                  ? isSparsePanelDetail
                    ? `Completing ${panelDisplayName} cards...`
                    : `Syncing ${panelDisplayName}...`
                  : isSparsePanelDetail
                    ? `正在补齐 ${panelDisplayName} 卡片...`
                    : `正在同步 ${panelDisplayName}...`}
              </span>
            </div>
          )}
          {panelSyncTimedOut && (
            <div className="panel-loading-hint timed-out" role="alert">
              <span>
                {locale === "en-US"
                  ? "Sync is taking longer than expected. Data shown may be incomplete."
                  : "同步时间较长，当前展示的数据可能不完整。"}
              </span>
            </div>
          )}
          <div className="panel-meta">
            <span className={clsx("risk-badge", panelRiskLevel)}>
              {getRiskBadgeLabel(panelRiskLevel, locale)}
            </span>
            {detailAgeText ? (
              <span
                className="panel-meta-chip panel-meta-chip-muted"
                title={
                  locale === "en-US"
                    ? "Time since last data refresh"
                    : "上次数据更新时间"
                }
              >
                {locale === "en-US" ? "Updated " : "更新于 "}
                {detailAgeText}
              </span>
            ) : null}
            <span className="panel-meta-chip panel-meta-chip-strong">
              {heroSettlementLabel}
            </span>
            <span className="panel-meta-chip panel-meta-chip-muted">
              {heroAirportLabel}
            </span>
          </div>
          <div className="panel-actions">
            {marketUrl ? (
              <a
                className="panel-action-button panel-action-button-ghost"
                href={marketUrl}
                target="_blank"
                rel="noreferrer"
                title={
                  locale === "en-US"
                    ? "Open today's Polymarket market"
                    : "打开今日 Polymarket 题目页"
                }
              >
                {locale === "en-US" ? "Market" : "市场页"}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={clsx(
          "panel-body",
          isShowingCachedDetailDuringSync && "is-syncing",
        )}
      >
        {isShowingCachedDetailDuringSync ? (
          <div className="panel-sync-blocker" role="status" aria-live="polite">
            <span className="panel-loading-spinner" aria-hidden="true" />
            <span>
              {locale === "en-US"
                ? `Refreshing ${panelDisplayName}. Current cards are paused until the latest data arrives.`
                : `正在刷新 ${panelDisplayName}，最新数据返回前暂停展示旧卡片。`}
            </span>
          </div>
        ) : null}
        <div
          className={clsx(
            isShowingCachedDetailDuringSync && "panel-content-stale",
          )}
        >
          {!hasBasicPanelContent ? (
            <section className="detail-summary-shell detail-empty-state">
              <div className="detail-section-head">
                <div>
                  <div className="detail-section-kicker">
                    {locale === "en-US" ? "No city selected" : "尚未选择城市"}
                  </div>
                  <h3>
                    {locale === "en-US"
                      ? "Pick a city to start."
                      : "先选择一个城市。"}
                  </h3>
                </div>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                {showPanelSyncing
                  ? t("detail.loading")
                  : t("detail.emptyHint")}
              </div>
            </section>
          ) : !detail ? (
            <div className="detail-mini-meta" role="status" aria-live="polite">
              {showPanelSyncing
                ? locale === "en-US"
                  ? "Loading city cards..."
                  : "正在加载城市卡片..."
                : locale === "en-US"
                  ? "City cards will appear here."
                  : "城市卡片会显示在这里。"}
            </div>
          ) : (
            <>
              <section className="detail-structured-section">
                <div className="detail-section-head">
                  <div>
                    <div className="detail-section-kicker">
                      {locale === "en-US" ? "Profile" : "城市画像"}
                    </div>
                    <h3>{t("detail.profile")}</h3>
                  </div>
                </div>
                <div className="detail-grid">
                  {profileStats.map((item) => (
                    <article key={item.label} className="detail-card">
                      <span className="detail-label">{item.label}</span>
                      <span className="detail-value">{item.value}</span>
                    </article>
                  ))}
                </div>
              </section>

              {officialLinks.length > 0 ? (
                <section className="detail-structured-section">
                  <div className="detail-section-head">
                    <div>
                      <div className="detail-section-kicker">
                        {locale === "en-US" ? "Primary references" : "官方参考"}
                      </div>
                      <h3>
                        {locale === "en-US"
                          ? "Settlement and observation references"
                          : "结算与观测参考来源"}
                      </h3>
                    </div>
                  </div>
                  <p className="detail-source-note">
                    {locale === "en-US"
                      ? "AGENCY = national meteorological service, METAR = airport observation, AIRPORT = airport official page."
                      : "AGENCY = 国家气象机构，METAR = 机场实测报文，AIRPORT = 机场官网页面。"}
                  </p>
                  <div className="detail-source-list">
                    {officialLinks.map((link) => (
                      <a
                        key={`${link.label}-${link.href}`}
                        className="detail-source-link"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="detail-source-kind">
                          {link.kind.toUpperCase()}
                        </span>
                        <span className="detail-source-label">
                          {link.label}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="detail-structured-section rounded-2xl">
                <div className="detail-section-head">
                  <div>
                    <div className="detail-section-kicker">
                      {locale === "en-US" ? "Mini trend" : "温度微趋势"}
                    </div>
                    <h3>{t("detail.todayMiniTrend")}</h3>
                  </div>
                </div>
                {heavyContentReady ? (
                  <DetailMiniTemperatureChart detail={detail} />
                ) : (
                  <div className="detail-mini-meta">{t("detail.loading")}</div>
                )}
              </section>

              {heavyContentReady ? <ForecastTable /> : null}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
