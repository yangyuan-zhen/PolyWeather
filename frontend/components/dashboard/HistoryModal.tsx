"use client";

import type { ChartConfiguration } from "chart.js";
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
  const isNoaaSettlement =
    store.selectedDetail?.current?.settlement_source === "noaa" ||
    store.selectedDetail?.current?.settlement_source_label === "NOAA";
  const noaaStationCode = String(
    store.selectedDetail?.current?.station_code ||
      store.selectedDetail?.risk?.icao ||
      "NOAA",
  )
    .trim()
    .toUpperCase();
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );
  const hasMgm =
    store.selectedCity === "ankara" &&
    summary.mgmSeriesComplete &&
    summary.mgms.some((value) => value != null);
  const hasBestBaseline =
    Boolean(summary.bestModelName) &&
    summary.bestModelName !== "MGM" &&
    summary.bestModelSeries.some((value) => value != null);

  const canvasRef = useChart(() => {
    const datasets: NonNullable<
      ChartConfiguration<"line">["data"]
    >["datasets"] = [
      {
        backgroundColor: "rgba(248, 113, 113, 0.1)",
        borderColor: "#f87171",
        borderWidth: 2,
        data: summary.actuals,
        label: isNoaaSettlement
          ? locale === "en-US"
            ? `NOAA Settled High (${noaaStationCode})`
            : `NOAA 结算最高温 (${noaaStationCode})`
          : locale === "en-US"
            ? "Observed High"
            : "实测最高温",
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

    if (hasBestBaseline) {
      datasets.push({
        backgroundColor: "transparent",
        borderColor: "#60a5fa",
        borderDash: [4, 3],
        borderWidth: 2,
        data: summary.bestModelSeries,
        label:
          locale === "en-US"
            ? `Best Baseline (${summary.bestModelName})`
            : `最佳单模型 (${summary.bestModelName})`,
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
  }, [hasBestBaseline, hasMgm, isNoaaSettlement, noaaStationCode, summary, locale]);

  if (!summary.recentData.length) return null;

  return (
    <div className="history-chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function HistoryModal() {
  const store = useDashboardStore();
  const { t, locale } = useI18n();
  const { data, error, isLoading, isOpen } = useHistoryData();
  const isPro = store.proAccess.subscriptionActive;
  const isProLoading = store.proAccess.loading;
  const isNoaaSettlement =
    store.selectedDetail?.current?.settlement_source === "noaa" ||
    store.selectedDetail?.current?.settlement_source_label === "NOAA";
  const noaaStationCode = String(
    store.selectedDetail?.current?.station_code ||
      store.selectedDetail?.risk?.icao ||
      "NOAA",
  )
    .trim()
    .toUpperCase();
  const noaaStationName =
    String(store.selectedDetail?.current?.station_name || "").trim() ||
    String(store.selectedDetail?.risk?.airport || "").trim() ||
    noaaStationCode;
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );
  const settledPeakRows = useMemo(
    () =>
      summary.recentData
        .filter(
          (row) =>
            row.actual != null &&
            row.actual_peak_time &&
            row.deb_at_peak_minus_12h != null,
        )
        .reverse(),
    [summary.recentData],
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
            {isNoaaSettlement && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "12px 14px",
                  border: "1px solid rgba(56, 189, 248, 0.24)",
                  borderRadius: "12px",
                  background: "rgba(14, 165, 233, 0.08)",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                }}
              >
                {t("lang") === "en-US"
                  ? `${store.selectedDetail?.display_name || store.selectedCity || "This city"} historical actuals are aligned to NOAA ${noaaStationCode} (${noaaStationName}) settlement rules: use the highest rounded whole-degree Celsius reading after the date is finalized.`
                  : `${store.selectedDetail?.display_name || store.selectedCity || "该城市"}历史对账已按 NOAA ${noaaStationCode}（${noaaStationName}）结算口径对齐：采用该日最终完成质控后的最高整度摄氏值。`}
              </div>
            )}
            {isLoading ? (
              <div className="history-modal-loading">
                <div className="loading-card history-loading-card">
                  <div className="loading-clouds" aria-hidden="true">
                    <span className="loading-cloud loading-cloud-1" />
                    <span className="loading-cloud loading-cloud-2" />
                  </div>
                  <div className="loading-windfield" aria-hidden="true">
                    <span className="loading-windline loading-windline-1" />
                    <span className="loading-windline loading-windline-2" />
                    <span className="loading-windline loading-windline-3" />
                  </div>
                  <div className="loading-radar history-loading-radar" aria-hidden="true">
                    <div className="loading-radar-core" />
                    <div className="loading-radar-ring loading-radar-ring-1" />
                    <div className="loading-radar-ring loading-radar-ring-2" />
                    <div className="loading-radar-sweep" />
                    <div className="loading-radar-blip loading-radar-blip-1" />
                    <div className="loading-radar-blip loading-radar-blip-2" />
                  </div>
                  <div className="loading-thermals history-loading-thermals" aria-hidden="true">
                    <span className="loading-thermal loading-thermal-1" />
                    <span className="loading-thermal loading-thermal-2" />
                    <span className="loading-thermal loading-thermal-3" />
                    <span className="loading-thermal loading-thermal-4" />
                  </div>
                  <div className="loading-copy history-loading-copy">
                    <strong>
                      {locale === "en-US"
                        ? "Scanning archived settlement history"
                        : "正在扫描历史结算档案"}
                    </strong>
                    <span>
                      {locale === "en-US"
                        ? "Reconciling settled highs, DEB traces, and baseline forecasts..."
                        : "正在对齐实测高温、DEB 轨迹与基线预报..."}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="history-stats">
                  {error ? (
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
                    <span className="label">{t("history.debHitRate")}</span>
                    <span className="val">
                      {summary.hitRate != null ? `${summary.hitRate}%` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.debMae")}</span>
                    <span className="val">
                      {summary.debMae != null ? `${summary.debMae}°` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.bestModelMae")}</span>
                    <span className="val">
                      {summary.bestModelMae != null
                        ? `${summary.bestModelMae}°${
                            summary.bestModelName
                              ? ` (${summary.bestModelName})`
                              : ""
                          }`
                        : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.debVsBest")}</span>
                    <span className="val">
                      {summary.debWinRateVsBest != null
                        ? `${summary.debWinRateVsBest}% (${summary.debWinDaysVsBest}/${summary.debVsBestComparableDays})`
                        : "--"}
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
                {!error && <HistoryChart />}
                {!error && settledPeakRows.length > 0 && (
              <div className="history-peak-reference">
                <div className="history-peak-reference-title">
                  {locale === "en-US"
                    ? "Peak-12h DEB Reference (Approx.)"
                    : "峰值前 12 小时 DEB 参考（近似）"}
                </div>
                <div className="history-peak-reference-scroll">
                  {settledPeakRows.map((row) => (
                    <div key={row.date} className="history-peak-reference-row">
                      <div className="history-peak-reference-date">
                        {row.date}
                      </div>
                      <div className="history-peak-reference-meta">
                        <div>
                          {locale === "en-US" ? "Peak ref" : "峰值参考"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.actual}
                            {store.selectedDetail?.temp_symbol || "°C"} @{" "}
                            {row.actual_peak_time}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "DEB@-12h" : "峰值前12小时 DEB"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.deb_at_peak_minus_12h}
                            {store.selectedDetail?.temp_symbol || "°C"} @{" "}
                            {row.deb_at_peak_minus_12h_time}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "Actual" : "最终实测"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.actual}
                            {store.selectedDetail?.temp_symbol || "°C"}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "Error" : "误差"}:{" "}
                          <span
                            style={{
                              color:
                                (row.deb_at_peak_minus_12h_error ?? 0) > 0
                                  ? "#f59e0b"
                                  : "#34d399",
                            }}
                          >
                            {row.deb_at_peak_minus_12h_error != null
                              ? `${row.deb_at_peak_minus_12h_error > 0 ? "+" : ""}${row.deb_at_peak_minus_12h_error}${store.selectedDetail?.temp_symbol || "°C"}`
                              : "--"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
