"use client";

import { ChartConfiguration } from "chart.js/auto";
import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore, useHistoryData } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import { getHistorySummary } from "@/lib/dashboard-utils";

function HistoryChart() {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const { data } = useHistoryData();
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );
  const hasMgm =
    store.selectedCity === "ankara" &&
    summary.mgms.some((value) => value != null);

  const canvasRef = useChart(() => {
    const datasets: NonNullable<
      ChartConfiguration<"line">["data"]
    >["datasets"] = [
      {
        backgroundColor: "rgba(248, 113, 113, 0.1)",
        borderColor: "#f87171",
        borderWidth: 2,
        data: summary.actuals,
        label: locale === "en-US" ? "Observed High" : "实测最高温",
        pointBackgroundColor: "#f87171",
        pointBorderColor: "#fff",
        pointHoverRadius: 7,
        pointRadius: 5,
        tension: 0.2,
      },
      {
        backgroundColor: "transparent",
        borderColor: "#34d399",
        borderDash: [5, 4],
        borderWidth: 2,
        data: summary.debs,
        label: locale === "en-US" ? "DEB Fusion" : "DEB 融合",
        pointHoverRadius: 6,
        pointRadius: 4,
        tension: 0.2,
      },
    ];

    if (hasMgm) {
      datasets.push({
        backgroundColor: "transparent",
        borderColor: "#fb923c",
        borderWidth: 2,
        data: summary.mgms,
        label: locale === "en-US" ? "MGM Official Forecast" : "MGM 官方预报",
        pointHoverRadius: 6,
        pointRadius: 4,
        tension: 0.2,
      });
    }

    return {
      data: {
        datasets,
        labels: summary.dates,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              boxHeight: 12,
              boxWidth: 34,
              color: "#94a3b8",
              font: { family: "Inter", size: 14 },
              padding: 18,
            },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            bodyFont: { family: "Inter", size: 13 },
            titleFont: { family: "Inter", size: 13, weight: 600 },
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°`,
            },
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              color: "#64748b",
              font: { family: "Inter", size: 12 },
              padding: 8,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              color: "#64748b",
              font: { family: "Inter", size: 12 },
              padding: 8,
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [hasMgm, summary, locale]);

  if (!summary.recentData.length) return null;

  return (
    <div className="history-chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function HistoryModal() {
  const store = useDashboardStore();
  const { t } = useI18n();
  const { data, error, isLoading, isOpen } = useHistoryData();
  const isPro = store.proAccess.subscriptionActive;
  const isProLoading = store.proAccess.loading;
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          store.closeHistory();
        }
      }}
    >
      {isProLoading ? (
        <div
          className="modal-content"
          style={{ padding: "40px", textAlign: "center" }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            {t("dashboard.loading")}
          </div>
        </div>
      ) : !isPro ? (
        <ProFeaturePaywall feature="history" onClose={store.closeHistory} />
      ) : (
        <div className="modal-content history-modal">
          <div className="modal-header">
            <h2 id="history-modal-title">
              {t("history.title", {
                city: store.selectedCity?.toUpperCase() || "",
              })}
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={t("history.closeAria")}
              onClick={store.closeHistory}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <div className="history-stats">
              {isLoading ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {t("history.loading")}
                </span>
              ) : error ? (
                <span style={{ color: "var(--accent-red)" }}>
                  {t("history.error")}
                </span>
              ) : !summary.recentData.length ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {t("history.empty")}
                </span>
              ) : (
                <>
                  <div className="h-stat-card">
                    <span className="label">{t("history.hitRate")}</span>
                    <span className="val">
                      {summary.hitRate != null ? `${summary.hitRate}%` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.mae")}</span>
                    <span className="val">
                      {summary.debMae != null ? `${summary.debMae}°` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.sample")}</span>
                    <span className="val">
                      {t("history.sampleDays", { count: summary.settledCount })}
                    </span>
                  </div>
                </>
              )}
            </div>
            {!isLoading && !error && <HistoryChart />}
          </div>
        </div>
      )}
    </div>
  );
}
