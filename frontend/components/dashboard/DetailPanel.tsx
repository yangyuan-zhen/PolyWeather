"use client";

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForecastTable } from "@/components/dashboard/PanelSections";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { getOfficialSourceLinks } from "@/lib/dashboard-official-sources";
import { getCityScenery } from "@/lib/dashboard-scenery";
import { CityDetail } from "@/lib/dashboard-types";
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
  const detail = store.selectedDetail;
  const selectedCityItem = useMemo(
    () =>
      store.selectedCity
        ? store.cities.find((city) => city.name === store.selectedCity) || null
        : null,
    [store.cities, store.selectedCity],
  );
  const selectedSummary = store.selectedCity
    ? store.citySummariesByName[store.selectedCity] || null
    : null;
  const isBasicGuestPanel = !detail && Boolean(store.selectedCity && selectedCityItem && selectedSummary);
  const isPro = store.proAccess.subscriptionActive;
  const panelRef = useRef<HTMLElement | null>(null);
  const [heavyContentReady, setHeavyContentReady] = useState(false);
  const isOverlayOpen =
    Boolean(store.futureModalDate) ||
    store.historyState.isOpen;
  const isVisible =
    store.isPanelOpen &&
    Boolean(store.selectedCity) &&
    Boolean(detail) &&
    !store.loadingState.cityDetail &&
    !isOverlayOpen;
  const profileStats = useMemo(
    () => (detail ? getCityProfileStats(detail, locale) : []),
    [detail, locale],
  );
  const officialLinks = useMemo(
    () => (detail ? getOfficialSourceLinks(detail) : []),
    [detail],
  );
  const scenery = getCityScenery(detail?.name);
  const blurActiveElement = () => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
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
          <h2>{detail?.display_name?.toUpperCase() || "..."}</h2>
          <div className="panel-meta">
            <span className={clsx("risk-badge", detail?.risk?.level || "low")}>
              {getRiskBadgeLabel(detail?.risk?.level, locale)}
            </span>
            <div className="relative group">
              <button
                type="button"
                className={clsx("history-btn", !isPro && "pro-locked")}
                title={
                  isPro
                    ? t("detail.todayAnalysis")
                    : `${t("detail.todayAnalysis")} (Pro)`
                }
                onClick={() => {
                  blurActiveElement();
                  void store.openTodayModal();
                }}
                disabled={!detail}
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
                onClick={() => {
                  blurActiveElement();
                  void store.openHistory();
                }}
                disabled={!detail}
              >
                {isPro ? t("detail.history") : `${t("detail.history")} · Pro`}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-body">
        {!detail && !isBasicGuestPanel ? (
          <section>
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {store.loadingState.cityDetail
                ? t("detail.loading")
                : t("detail.emptyHint")}
            </div>
          </section>
        ) : (
          <>
            {isBasicGuestPanel && selectedCityItem && selectedSummary ? (
              <>
                <section className="detail-section">
                  <h3>{t("detail.profile")}</h3>
                  <div className="detail-grid">
                    <div className="detail-card">
                      <span className="detail-label">{locale === "en-US" ? "City" : "城市"}</span>
                      <span className="detail-value">{selectedCityItem.display_name}</span>
                    </div>
                    <div className="detail-card">
                      <span className="detail-label">{locale === "en-US" ? "Current" : "当前温度"}</span>
                      <span className="detail-value">
                        {selectedSummary.current?.temp != null
                          ? `${selectedSummary.current.temp}${selectedSummary.temp_symbol || "°C"}`
                          : t("common.na")}
                      </span>
                    </div>
                    <div className="detail-card">
                      <span className="detail-label">{locale === "en-US" ? "Observation" : "观测时间"}</span>
                      <span className="detail-value">{selectedSummary.current?.obs_time || t("common.na")}</span>
                    </div>
                    <div className="detail-card">
                      <span className="detail-label">{locale === "en-US" ? "DEB" : "DEB 预测"}</span>
                      <span className="detail-value">
                        {selectedSummary.deb?.prediction != null
                          ? `${selectedSummary.deb.prediction}${selectedSummary.temp_symbol || "°C"}`
                          : t("common.na")}
                      </span>
                    </div>
                    <div className="detail-card">
                      <span className="detail-label">{locale === "en-US" ? "Settlement" : "结算口径"}</span>
                      <span className="detail-value">
                        {selectedSummary.current?.settlement_source_label ||
                          selectedCityItem.settlement_source_label ||
                          t("common.na")}
                      </span>
                    </div>
                    <div className="detail-card">
                      <span className="detail-label">{t("section.airport")}</span>
                      <span className="detail-value">{selectedCityItem.airport || t("common.na")}</span>
                    </div>
                  </div>
                </section>
                <section className="detail-section">
                  <div className="detail-card">
                    <span className="detail-label">
                      {locale === "en-US" ? "Pro required for intraday analysis and history" : "今日日内分析与历史对账需开通 Pro"}
                    </span>
                    <span className="detail-source-note" style={{ marginTop: 8 }}>
                      {locale === "en-US"
                        ? "Guests can browse the city overview here. Sign in and subscribe to unlock the full intraday model, history reconciliation, and market-linked weather analysis."
                        : "游客可先浏览城市概览。登录并开通 Pro 后，可查看完整的今日日内分析、历史对账和市场联动天气解读。"}
                    </span>
                  </div>
                </section>
              </>
            ) : null}

            {!isBasicGuestPanel ? (
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
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
