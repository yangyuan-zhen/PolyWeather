"use client";

import { ChartConfiguration } from "chart.js/auto";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import { ForecastTable } from "@/components/dashboard/PanelSections";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { getCityScenery } from "@/lib/dashboard-scenery";
import { CityDetail } from "@/lib/dashboard-types";
import {
  getCityProfileStats,
  getRiskBadgeLabel,
  getTemperatureChartData,
} from "@/lib/dashboard-utils";
import { ChevronRight, Crown } from "lucide-react";
import { useRouter } from "next/navigation";

function DetailMiniTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale, t } = useI18n();
  const chartData = getTemperatureChartData(detail, locale);

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
            label: locale === "en-US" ? "METAR Observation" : "METAR 实测",
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
  const router = useRouter();
  const { locale, t } = useI18n();
  const detail = store.selectedDetail;
  const isPro = store.proAccess.subscriptionActive;
  const panelRef = useRef<HTMLElement | null>(null);
  const isOverlayOpen =
    Boolean(store.futureModalDate) ||
    store.historyState.isOpen ||
    store.isGuideOpen;
  const isVisible =
    store.isPanelOpen &&
    Boolean(store.selectedCity) &&
    Boolean(detail) &&
    !store.loadingState.cityDetail &&
    !isOverlayOpen;
  const profileStats = detail ? getCityProfileStats(detail, locale) : [];
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
        {!detail ? (
          <section>
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {store.loadingState.cityDetail
                ? t("detail.loading")
                : t("detail.emptyHint")}
            </div>
          </section>
        ) : (
          <>
            <section className="detail-scenery-card">
              {scenery ? (
                <>
                  <img
                    className="detail-scenery-image"
                    src={scenery.imageUrl}
                    alt={t("detail.sceneryAlt", { city: detail.display_name })}
                  />
                  <div className="detail-scenery-overlay">
                    <div className="detail-scenery-copy">
                      <span className="detail-scenery-kicker">
                        {detail.display_name}
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
                    {detail.display_name}
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

            <section className="detail-section relative overflow-hidden rounded-2xl">
              <h3>{t("detail.todayMiniTrend")}</h3>
              <div
                className={clsx(
                  "transition-all duration-500",
                  !isPro &&
                    "blur-md opacity-30 select-none pointer-events-none",
                )}
              >
                <DetailMiniTemperatureChart detail={detail} />
              </div>
              {!isPro && (
                <div className="absolute inset-x-0 bottom-0 top-[3rem] z-10 flex flex-col items-center justify-center p-4 bg-gradient-to-t from-[#0b0f1a] via-transparent to-transparent">
                  <div className="bg-blue-600/90 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg shadow-blue-600/40 flex items-center gap-1.5 mb-2">
                    <Crown size={10} fill="currentColor" /> Pro Feature
                  </div>
                  <p className="text-[10px] text-slate-400 text-center mb-3">
                    解锁日内高精趋势图
                  </p>
                  <button
                    onClick={() => router.push("/account")}
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  >
                    立即升级 <ChevronRight size={10} />
                  </button>
                </div>
              )}
            </section>

            <ForecastTable />
          </>
        )}
      </div>
    </aside>
  );
}
