"use client";

import { ChartConfiguration } from "chart.js/auto";
import clsx from "clsx";
import { CSSProperties } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import {
  ModelForecast,
  ProbabilityDistribution,
} from "@/components/dashboard/PanelSections";
import {
  getClimateDrivers,
  getFutureModalView,
  getSettlementRiskNarrative,
  getShortTermNowcastLines,
  getTemperatureChartData,
  getWeatherSummary,
  parseAiAnalysis,
} from "@/lib/dashboard-utils";

function DailyTemperatureChart({ dateStr }: { dateStr: string }) {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const detail = store.selectedDetail;
  const view = detail ? getFutureModalView(detail, dateStr, locale) : null;
  const isToday = detail ? dateStr === detail.local_date : false;
  const todayChartData =
    detail && isToday ? getTemperatureChartData(detail, locale) : null;

  const canvasRef = useChart(
    () => {
      if (!detail || !view) {
        return {
          data: { datasets: [], labels: [] },
          type: "line",
        } satisfies ChartConfiguration<"line">;
      }

      if (isToday && todayChartData) {
        const datasets: NonNullable<ChartConfiguration<"line">["data"]>["datasets"] = [];

        if (todayChartData.datasets.hasMgmHourly) {
          datasets.push({
            backgroundColor: "rgba(234, 179, 8, 0.05)",
            borderColor: "rgba(234, 179, 8, 0.8)",
            borderWidth: 2,
            data: todayChartData.datasets.mgmHourlyPoints,
            fill: false,
            label: locale === "en-US" ? "MGM Forecast" : "MGM 预报",
            pointHoverRadius: 6,
            pointRadius: 3,
            spanGaps: true,
            tension: 0.3,
          });
        } else {
          datasets.push({
            backgroundColor: "rgba(52, 211, 153, 0.05)",
            borderColor: "rgba(52, 211, 153, 0.6)",
            borderWidth: 1.5,
            data: todayChartData.datasets.debPast,
            fill: true,
            label: locale === "en-US" ? "DEB Forecast" : "DEB 预报",
            pointHoverRadius: 3,
            pointRadius: 0,
            tension: 0.3,
          });
          datasets.push({
            borderColor: "rgba(52, 211, 153, 0.35)",
            borderDash: [5, 3],
            borderWidth: 1.5,
            data: todayChartData.datasets.debFuture,
            fill: false,
            label: locale === "en-US" ? "DEB Forecast" : "DEB 预报",
            pointRadius: 0,
            tension: 0.3,
          });
        }

        datasets.push({
          backgroundColor: "#22d3ee",
          borderColor: "#22d3ee",
          borderWidth: 0,
          data: todayChartData.datasets.metarPoints,
          fill: false,
          label: locale === "en-US" ? "METAR Observation" : "METAR 实测",
          order: 0,
          pointHoverRadius: 7,
          pointRadius: 5,
        });

        if (todayChartData.datasets.mgmPoints.some((value) => value != null)) {
          datasets.push({
            backgroundColor: "#facc15",
            borderColor: "#facc15",
            borderWidth: 0,
            data: todayChartData.datasets.mgmPoints,
            fill: false,
            label: locale === "en-US" ? "MGM Observation" : "MGM 实测",
            order: -1,
            pointHoverRadius: 9,
            pointRadius: 7,
            showLine: false,
          });
        }

        if (
          !todayChartData.datasets.hasMgmHourly &&
          Math.abs(todayChartData.datasets.offset) > 0.3
        ) {
          datasets.push({
            borderColor: "rgba(99, 102, 241, 0.2)",
            borderDash: [2, 4],
            borderWidth: 1,
            data: todayChartData.datasets.temps,
            fill: false,
            label: locale === "en-US" ? "OM Raw" : "OM 原始",
            pointRadius: 0,
            tension: 0.3,
          });
        }

        return {
          data: {
            datasets,
            labels: todayChartData.times,
          },
          options: {
            interaction: { intersect: false, mode: "index" },
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: {
                  color: "#94a3b8",
                  filter: (legendItem, chartData) => {
                    const text = String(legendItem.text || "");
                    if (!text) return false;
                    if (!text.includes("DEB")) return true;

                    const firstDebIndex = (chartData.datasets || []).findIndex((dataset) =>
                      String(dataset.label || "").includes("DEB"),
                    );
                    return legendItem.datasetIndex === firstDebIndex;
                  },
                  font: { family: "Inter", size: 11 },
                },
              },
              tooltip: {
                backgroundColor: "rgba(15, 23, 42, 0.96)",
                borderColor: "rgba(34, 211, 238, 0.2)",
                borderWidth: 1,
              },
            },
            responsive: true,
            scales: {
              x: {
                grid: { color: "rgba(255,255,255,0.04)" },
                ticks: {
                  callback: (_value, index) =>
                    typeof index === "number" && index % 3 === 0
                      ? todayChartData.times[index]
                      : "",
                  color: "#64748b",
                  font: { family: "Inter", size: 10 },
                  maxRotation: 0,
                },
              },
              y: {
                grid: { color: "rgba(255,255,255,0.04)" },
                max: todayChartData.max,
                min: todayChartData.min,
                ticks: {
                  callback: (value) => `${value}${detail.temp_symbol || "°C"}`,
                  color: "#64748b",
                  font: { family: "Inter", size: 10 },
                },
              },
            },
          },
          type: "line",
        } satisfies ChartConfiguration<"line">;
      }

      const labels = view.slice.map((point) => point.label);
      const unit = detail.temp_symbol || "°C";

      return {
        data: {
          datasets: [
            {
              backgroundColor: "rgba(34, 211, 238, 0.08)",
              borderColor: "#22d3ee",
              data: view.slice.map((point) => point.temp),
              fill: false,
              label: locale === "en-US" ? "Open-Meteo Temperature" : "Open-Meteo 温度",
              pointRadius: 2,
              tension: 0.28,
            },
            {
              backgroundColor: "transparent",
              borderColor: "#a78bfa",
              borderDash: [5, 4],
              data: view.slice.map((point) => point.dewPoint),
              fill: false,
              label: locale === "en-US" ? "Dew Point" : "露点",
              pointRadius: 0,
              tension: 0.24,
            },
          ],
          labels,
        },
        options: {
          interaction: { intersect: false, mode: "index" },
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: "#94a3b8",
                font: { family: "Inter", size: 11 },
              },
            },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.96)",
              borderColor: "rgba(34, 211, 238, 0.2)",
              borderWidth: 1,
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${unit}`,
              },
            },
          },
          responsive: true,
          scales: {
            x: {
              grid: { color: "rgba(255,255,255,0.04)" },
              ticks: {
                color: "#64748b",
                font: { family: "Inter", size: 10 },
                maxRotation: 0,
              },
            },
            y: {
              grid: { color: "rgba(255,255,255,0.04)" },
              ticks: {
                callback: (value) => `${value}${unit}`,
                color: "#64748b",
                font: { family: "Inter", size: 10 },
              },
            },
          },
        },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    },
    [detail, isToday, locale, todayChartData, view],
  );

  return (
    <>
      <div className="history-chart-wrapper future-chart-wrapper">
        <canvas ref={canvasRef} />
      </div>
      {isToday && (
        <div className="chart-legend">
          {todayChartData?.legendText || t("future.chartLegendEmpty")}
        </div>
      )}
    </>
  );
}

export function FutureForecastModal() {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const detail = store.selectedDetail;
  const dateStr = store.futureModalDate;

  if (!detail || !dateStr) return null;

  const isToday = dateStr === detail.local_date;
  const view = getFutureModalView(detail, dateStr, locale);
  const nowcastRows = getShortTermNowcastLines(detail, dateStr, locale);
  const riskLines = getSettlementRiskNarrative(detail, locale);
  const climateDrivers = getClimateDrivers(detail, locale);
  const ai = parseAiAnalysis(detail.ai_analysis);
  const scorePosition = `${50 + view.front.score / 2}%`;
  const barStyle = {
    "--score-position": scorePosition,
  } as CSSProperties & { "--score-position": string };
  const weatherSummary = getWeatherSummary(detail, locale);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="future-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          store.closeFutureModal();
        }
      }}
    >
      <div className="modal-content large future-modal">
        <div className="modal-header">
          <h2 id="future-modal-title">
            {isToday
              ? t("future.todayTitle", {
                  city: detail.display_name.toUpperCase(),
                })
              : t("future.dateTitle", {
                  city: detail.display_name.toUpperCase(),
                  date: dateStr,
                })}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label={isToday ? t("future.closeTodayAria") : t("future.closeDateAria")}
            onClick={store.closeFutureModal}
          >
            ×
          </button>
        </div>

        <div className="modal-body future-modal-body">
          <div className="history-stats">
            {isToday && (
              <>
                <div className="h-stat-card">
                  <span className="label">{t("future.currentObs")}</span>
                  <span className="val">
                    {detail.current?.temp ?? "--"}
                    {detail.temp_symbol} @{detail.current?.obs_time || "--"}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">{t("future.currentWeather")}</span>
                  <span className="val">
                    {weatherSummary.weatherIcon} {weatherSummary.weatherText}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">{t("future.wuRef")}</span>
                  <span className="val">
                    {detail.current?.wu_settlement ?? "--"}
                    {detail.temp_symbol}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">{t("future.sunrise")}</span>
                  <span className="val">{detail.forecast?.sunrise || "--"}</span>
                </div>
                <div className="h-stat-card">
                  <span className="label">{t("future.sunset")}</span>
                  <span className="val">{detail.forecast?.sunset || "--"}</span>
                </div>
                <div className="h-stat-card">
                  <span className="label">{t("future.sunshine")}</span>
                  <span className="val">
                    {detail.forecast?.sunshine_hours != null
                      ? `${detail.forecast.sunshine_hours}h`
                      : "--"}
                  </span>
                </div>
              </>
            )}

            <div className="h-stat-card">
              <span className="label">
                {isToday ? t("future.todayForecastHigh") : t("future.targetForecast")}
              </span>
              <span className="val">
                {view.forecastEntry?.max_temp ?? "--"}
                {detail.temp_symbol}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">{t("future.deb")}</span>
              <span className="val">
                {view.deb ?? "--"}
                {detail.temp_symbol}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">{t("future.mu")}</span>
              <span className="val">
                {view.mu != null ? `${view.mu.toFixed(1)}${detail.temp_symbol}` : "--"}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">{t("future.score")}</span>
              <span className="val">
                {view.front.score > 0 ? "+" : ""}
                {view.front.score}
              </span>
            </div>
          </div>

          <section className="future-modal-section">
            <h3>{isToday ? t("future.todayTempTrend") : t("future.targetTempTrend")}</h3>
            <DailyTemperatureChart dateStr={dateStr} />
          </section>

          <div className="future-modal-grid">
            <section className="future-modal-section">
              <h3>{t("future.probability")}</h3>
              <ProbabilityDistribution detail={detail} targetDate={dateStr} hideTitle />
            </section>
            <section className="future-modal-section">
              <h3>{t("future.models")}</h3>
              <ModelForecast detail={detail} targetDate={dateStr} hideTitle />
            </section>
          </div>

          <div className="future-modal-grid">
            <section className="future-modal-section">
              <h3>
                <span className="section-inline-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 19V5" />
                    <path d="M10 19V10" />
                    <path d="M16 19V7" />
                    <path d="M22 19V13" />
                  </svg>
                </span>
                {isToday ? t("future.structureToday") : t("future.structureDate")}
              </h3>
              <div className="future-front-score">
                <div className="future-front-bar" style={barStyle} />
                <div className="future-front-meta">
                  <span className="future-front-pill">
                    {t("future.judgement")}: {view.front.label}
                  </span>
                  <span className="future-front-pill">
                    {t("future.confidence")}:{" "}
                    {t(`confidence.${view.front.confidence}`)}
                  </span>
                  <span className="future-front-pill">
                    {t("future.maxPrecip")}: {Math.round(view.front.precipMax)}%
                  </span>
                </div>
                <div className="future-text-block">{view.front.summary}</div>
              </div>
              <div className="future-trend-grid">
                {view.front.metrics.map((metric) => (
                  <div key={metric.label} className="future-trend-card">
                    <div className="future-trend-label">{metric.label}</div>
                    <div
                      className={clsx(
                        "future-trend-value",
                        metric.tone === "warm" && "warm",
                        metric.tone === "cold" && "cold",
                      )}
                    >
                      {metric.value}
                    </div>
                    <div className="future-trend-note">{metric.note}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="future-modal-section">
              <h3>{t("future.ai")}</h3>
              <div className="future-text-block">
                {ai.summary ? <div>{ai.summary}</div> : null}

                {ai.bullets.length > 0 && (
                  <div style={{ marginTop: ai.summary ? "10px" : 0 }}>
                    {ai.bullets.map((item) => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>
                )}

                {!ai.summary && ai.bullets.length === 0 && (
                  <div>{t("future.noAi")}</div>
                )}

                <div style={{ marginTop: "14px" }}>
                  {nowcastRows.map(([label, value]) => (
                    <div key={label}>
                      <strong>{label}: </strong>
                      {value}
                    </div>
                  ))}
                </div>

                {view.front.weatherGovPeriods.length > 0 && (
                  <div style={{ marginTop: "10px" }}>
                    <strong>{t("future.weatherGov")}: </strong>
                    {view.front.weatherGovPeriods
                      .map((period) => period.short_forecast || period.detailed_forecast)
                      .filter(Boolean)
                      .join(" / ")}
                  </div>
                )}
              </div>
            </section>
          </div>

          {isToday && (
            <div className="future-modal-grid">
              <section className="future-modal-section">
                <h3>{t("future.risk")}</h3>
                <div className="risk-info">
                  {riskLines.map((line) => (
                    <div key={line} className="risk-row">
                      <span style={{ color: "var(--accent-cyan)", opacity: 0.6 }}>
                        •
                      </span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="future-modal-section">
                <h3>{t("future.climate")}</h3>
                <div className="insight-list">
                  {climateDrivers.map((driver) => (
                    <div key={driver.label} className="insight-item">
                      <div className="insight-title">{driver.label}</div>
                      <div className="insight-text">{driver.text}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
