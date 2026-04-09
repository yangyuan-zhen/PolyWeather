"use client";

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForecastTable } from "@/components/dashboard/PanelSections";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { getOfficialSourceLinks } from "@/lib/dashboard-official-sources";
import { getCityScenery } from "@/lib/dashboard-scenery";
import { CityDetail } from "@/lib/dashboard-types";
import { trackAppEvent } from "@/lib/app-analytics";
import { getTodayPolymarketUrl } from "@/lib/polymarket-market-links";
import {
  getCityProfileStats,
  getRiskBadgeLabel,
  getTemperatureChartData,
} from "@/lib/dashboard-utils";

function DetailMiniTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale, t } = useI18n();
  const chartData = useMemo(
    () => getTemperatureChartData(detail, locale),
    [detail, locale],
  );

  const canvasRef = useChart(() => {
    if (!chartData) {
      return {
        data: { datasets: [], labels: [] },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    }

    const forecastPoints = chartData.datasets.hasMgmHourly
      ? chartData.datasets.mgmHourlyPoints
      : chartData.datasets.debPast.map(
          (value, index) => value ?? chartData.datasets.debFuture[index],
        );

    return {
      data: {
        datasets: [
          {
            borderColor: chartData.datasets.hasMgmHourly
              ? "rgba(250, 204, 21, 0.92)"
              : "rgba(52, 211, 153, 0.86)",
            borderWidth: 1.8,
            data: forecastPoints,
            fill: false,
            label: chartData.datasets.hasMgmHourly
              ? locale === "en-US"
                ? "MGM Forecast"
                : "MGM 预测"
              : locale === "en-US"
                ? "DEB Forecast"
                : "DEB 预测",
            pointRadius: 0,
            spanGaps: true,
            tension: 0.28,
          },
          {
            backgroundColor: "#22d3ee",
            borderColor: "#22d3ee",
            borderWidth: 0,
            data: chartData.datasets.metarPoints,
            fill: false,
            label:
              chartData.observationLabel ||
              (locale === "en-US" ? "METAR Observation" : "METAR 实况"),
            pointHoverRadius: 6,
            pointRadius: 3.8,
            showLine: false,
          },
        ],
        labels: chartData.times,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            borderColor: "rgba(34, 211, 238, 0.25)",
            borderWidth: 1,
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.03)" },
            ticks: {
              callback: (_value, index) =>
                typeof index === "number" && index % 4 === 0
                  ? chartData.times[index]
                  : "",
              color: "#64748b",
              font: { size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.03)" },
            max: chartData.max,
            min: chartData.min,
            ticks: {
              callback: (value) => `${value}${detail.temp_symbol || "°C"}`,
              color: "#64748b",
              font: { size: 10 },
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [chartData, detail.temp_symbol, locale]);

  return (
    <div className="detail-mini-chart-wrap">
      <div className="detail-mini-chart">
        <canvas ref={canvasRef} />
      </div>
      <div className="detail-mini-meta">
        {chartData?.legendText || t("detail.chartLegendEmpty")}
      </div>
    </div>
  );
}

export function DetailPanel() {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const router = useRouter();
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
  const isPro = store.proAccess.subscriptionActive;
  const isAuthenticated = store.proAccess.authenticated;
  const panelRef = useRef<HTMLElement | null>(null);
  const [heavyContentReady, setHeavyContentReady] = useState(false);
  const isOverlayOpen =
    Boolean(store.futureModalDate) ||
    store.historyState.isOpen;
  const isVisible =
    store.isPanelOpen &&
    Boolean(store.selectedCity) &&
    !isOverlayOpen;
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
  const scenery = getCityScenery(detail?.name);
  const basicCurrentTemp = selectedSummary?.current?.temp;
  const basicObsTime = selectedSummary?.current?.obs_time;
  const basicDeb = selectedSummary?.deb?.prediction;
  const basicSettlementLabel =
    selectedSummary?.current?.settlement_source_label ||
    selectedCityItem?.settlement_source_label ||
    selectedCityItem?.settlement_source ||
    (locale === "en-US" ? "Settlement source pending" : "结算口径待确认");
  const basicAirportLabel =
    selectedCityItem?.airport ||
    selectedSummary?.icao ||
    (locale === "en-US" ? "Airport pending" : "机场待确认");
  const isBasicSummaryLoading =
    !detail && !selectedSummary && store.loadingState.cityDetail;
  const blurActiveElement = () => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };
  const handleFeatureAccess = (feature: "today" | "history") => {
    blurActiveElement();

    if (!isPro) {
      trackAppEvent("paywall_feature_clicked", {
        entry: "detail_panel",
        feature,
        city: store.selectedCity,
        user_state: isAuthenticated ? "logged_in" : "guest",
      });
    }

    if (isPro) {
      if (feature === "today") {
        void store.openTodayModal();
        return;
      }
      void store.openHistory();
      return;
    }

    if (isAuthenticated) {
      router.push("/account");
      return;
    }

    if (feature === "today") {
      void store.openTodayModal();
      return;
    }
    void store.openHistory();
  };

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
      if (win && idleId != null && typeof win.cancelIdleCallback === "function") {
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
      className={clsx("detail-panel", isVisible && "visible")}
    >
      <div className="panel-header">
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
        <div className="panel-title-area">
          <h2>{panelDisplayName.toUpperCase()}</h2>
          {store.loadingState.cityDetail && (
            <div className="panel-loading-hint" role="status" aria-live="polite">
              <span className="panel-loading-spinner" aria-hidden="true" />
              <span>
                {locale === "en-US"
                  ? `Syncing ${panelDisplayName}...`
                  : `正在同步 ${panelDisplayName}...`}
              </span>
            </div>
          )}
          <div className="panel-meta">
            <span className={clsx("risk-badge", panelRiskLevel)}>
              {getRiskBadgeLabel(panelRiskLevel, locale)}
            </span>
            <div className="relative group">
              {marketUrl ? (
                <a
                  className="history-btn"
                  href={marketUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={
                    locale === "en-US"
                      ? "Open today's Polymarket market"
                      : "打开今日 Polymarket 题目页"
                  }
                >
                  {locale === "en-US" ? "Open Market" : "打开 Polymarket"}
                </a>
              ) : null}
              <button
                type="button"
                className={clsx("history-btn", !isPro && "pro-locked")}
                title={
                  isPro
                    ? t("detail.todayAnalysis")
                    : `${t("detail.todayAnalysis")} (Pro)`
                }
                onClick={() => handleFeatureAccess("today")}
                disabled={!store.selectedCity}
              >
                {isPro
                  ? t("detail.todayAnalysis")
                  : `${t("detail.todayAnalysis")} · Pro`}
              </button>
              <button
                type="button"
                className={clsx("history-btn", !isPro && "pro-locked")}
                title={
                  isPro ? t("detail.history") : `${t("detail.history")} (Pro)`
                }
                onClick={() => handleFeatureAccess("history")}
                disabled={!store.selectedCity}
              >
                {isPro ? t("detail.history") : `${t("detail.history")} · Pro`}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-body">
        {!hasBasicPanelContent ? (
          <section>
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {store.loadingState.cityDetail
                ? t("detail.loading")
                : t("detail.emptyHint")}
            </div>
          </section>
        ) : !detail ? (
          <>
            <section className="detail-section">
              <h3>{locale === "en-US" ? "City Snapshot" : "城市概览"}</h3>
              {isBasicSummaryLoading ? (
                <div className="detail-mini-meta">
                  {locale === "en-US"
                    ? "Syncing public city snapshot..."
                    : "正在同步城市基础信息..."}
                </div>
              ) : null}
              <div className="detail-grid">
                <div className="detail-card">
                  <span className="detail-label">
                    {locale === "en-US" ? "Current temp" : "当前温度"}
                  </span>
                  <span className="detail-value">
                    {basicCurrentTemp != null
                      ? `${basicCurrentTemp}${selectedSummary?.temp_symbol || ""}`
                      : locale === "en-US"
                        ? "--"
                        : "--"}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="detail-label">
                    {locale === "en-US" ? "Observed" : "观测时间"}
                  </span>
                  <span className="detail-value">
                    {basicObsTime || (locale === "en-US" ? "Pending" : "待更新")}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="detail-label">DEB</span>
                  <span className="detail-value">
                    {basicDeb != null
                      ? `${basicDeb}${selectedSummary?.temp_symbol || ""}`
                      : locale === "en-US"
                        ? isBasicSummaryLoading
                          ? "Syncing..."
                          : "Pending"
                        : isBasicSummaryLoading
                          ? "同步中..."
                          : "待更新"}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="detail-label">
                    {locale === "en-US" ? "Settlement" : "结算口径"}
                  </span>
                  <span className="detail-value">{basicSettlementLabel}</span>
                </div>
                <div className="detail-card">
                  <span className="detail-label">
                    {locale === "en-US" ? "Airport" : "结算机场"}
                  </span>
                  <span className="detail-value">{basicAirportLabel}</span>
                </div>
              </div>
            </section>

            <section className="detail-section">
              <div className="detail-card">
                <span className="detail-label">
                  {locale === "en-US" ? "Pro features" : "Pro 功能"}
                </span>
                <span className="detail-value" style={{ fontSize: "15px" }}>
                  {locale === "en-US"
                    ? "Intraday analysis, history reconciliation, and deeper structure signals require Pro."
                    : "今日日内分析、历史对账和更深入的结构信号需要 Pro。"}
                </span>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="detail-scenery-card">
              {scenery ? (
                <>
                  <img
                    className="detail-scenery-image"
                    src={scenery.imageUrl}
                    alt={t("detail.sceneryAlt", { city: detail?.display_name || "" })}
                  />
                  <div className="detail-scenery-overlay">
                    <div className="detail-scenery-copy">
                      <span className="detail-scenery-kicker">
                        {detail?.display_name}
                      </span>
                    </div>
                    <a
                      className="detail-scenery-credit"
                      href={scenery.creditUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {scenery.creditLabel}
                    </a>
                  </div>
                </>
              ) : (
                <div className="detail-scenery-fallback">
                  <span className="detail-scenery-kicker">
                    {detail?.display_name}
                  </span>
                  <strong className="detail-scenery-title">
                    {t("detail.sceneryTitle")}
                  </strong>
                  <span className="detail-scenery-subtitle">
                    {t("detail.sceneryFallback")}
                  </span>
                </div>
              )}
            </section>

            <section className="detail-section">
              <h3>{t("detail.profile")}</h3>
              <div className="detail-grid">
                {profileStats.map((item) => (
                  <div key={item.label} className="detail-card">
                    <span className="detail-label">{item.label}</span>
                    <span className="detail-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>

            {officialLinks.length > 0 ? (
              <section className="detail-section">
                <h3>{locale === "en-US" ? "Official Sources" : "官方参考"}</h3>
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
                      <span className="detail-source-label">{link.label}</span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="detail-section rounded-2xl">
              <h3>{t("detail.todayMiniTrend")}</h3>
              {heavyContentReady ? (
                <DetailMiniTemperatureChart detail={detail!} />
              ) : (
                <div className="detail-mini-meta">{t("detail.loading")}</div>
              )}
            </section>

            {heavyContentReady ? <ForecastTable /> : null}
          </>
        )}
      </div>
    </aside>
  );
}
