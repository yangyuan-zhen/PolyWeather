"use client";

import { ChartConfiguration } from "chart.js/auto";
import clsx from "clsx";
import { useChart } from "@/hooks/useChart";
import { useCityData, useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { CityDetail } from "@/lib/dashboard-types";
import {
  getHeroMetaItems,
  getModelView,
  getProbabilityView,
  getRiskBadgeLabel,
  getTemperatureChartData,
  getWeatherSummary,
  parseAiAnalysis,
} from "@/lib/dashboard-utils";

function EmptyState({ text }: { text: string }) {
  return <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{text}</div>;
}

export function HeroSummary() {
  const { data } = useCityData();
  const { locale } = useI18n();
  if (!data) return null;

  const { weatherIcon, weatherText } = getWeatherSummary(data, locale);
  const metaItems = getHeroMetaItems(data, locale);
  const current = data.current || {};
  const isMax =
    current.max_so_far != null &&
    current.temp != null &&
    current.max_so_far <= current.temp;

  return (
    <section className="hero-section">
      <div className="hero-weather">
        <span>
          {weatherIcon} {weatherText}
        </span>
      </div>
      <div className="hero-temp">
        <span className="hero-value">
          {current.temp != null ? current.temp.toFixed(1) : "--"}
        </span>
        <span className="hero-unit">{data.temp_symbol || "°C"}</span>
      </div>
      <div className="hero-max-time">
        {isMax && current.max_temp_time
          ? locale === "en-US"
            ? `Today's peak temperature appeared at local time ${current.max_temp_time}`
            : `该城市今日最高温出现在当地时间 ${current.max_temp_time}`
          : ""}
      </div>
      <div className="hero-details">
        <div className="hero-item">
          <span className="label">{locale === "en-US" ? "Current Obs" : "当前实测"}</span>
          <span className="value">
            {current.temp != null
              ? `${current.temp}${data.temp_symbol} @${current.obs_time || "--"}`
              : "--"}
          </span>
        </div>
        <div className="hero-item">
          <span className="label">
            {locale === "en-US" ? "WU Settlement Ref" : "WU 结算参考"}
          </span>
          <span className="value highlight">
            {current.wu_settlement != null
              ? `${current.wu_settlement}${data.temp_symbol}`
              : "--"}
          </span>
        </div>
        <div className="hero-item">
          <span className="label">{locale === "en-US" ? "DEB Forecast" : "DEB 预测"}</span>
          <span className="value">
            {data.deb?.prediction != null
              ? `${data.deb.prediction}${data.temp_symbol}`
              : "--"}
          </span>
        </div>
      </div>
      <div className="hero-sub">
        {metaItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

export function TemperatureChart() {
  const { data } = useCityData();
  const { locale, t } = useI18n();
  const chartData = data ? getTemperatureChartData(data, locale) : null;

  const canvasRef = useChart(
    () => {
      if (!data || !chartData) {
        return {
          data: { datasets: [], labels: [] },
          type: "line",
        } satisfies ChartConfiguration<"line">;
      }

      const datasets: NonNullable<ChartConfiguration<"line">["data"]>["datasets"] = [];

      if (chartData.datasets.hasMgmHourly) {
        datasets.push({
          backgroundColor: "rgba(234, 179, 8, 0.05)",
          borderColor: "rgba(234, 179, 8, 0.8)",
          borderWidth: 2,
          data: chartData.datasets.mgmHourlyPoints,
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
          data: chartData.datasets.debPast,
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
          data: chartData.datasets.debFuture,
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
        data: chartData.datasets.metarPoints,
        fill: false,
        label: locale === "en-US" ? "METAR Observation" : "METAR 实测",
        order: 0,
        pointHoverRadius: 7,
        pointRadius: 5,
      });

      if (chartData.datasets.mgmPoints.some((value) => value != null)) {
        datasets.push({
          backgroundColor: "#facc15",
          borderColor: "#facc15",
          borderWidth: 0,
          data: chartData.datasets.mgmPoints,
          fill: false,
          label: locale === "en-US" ? "MGM Observation" : "MGM 实测",
          order: -1,
          pointHoverRadius: 9,
          pointRadius: 7,
          showLine: false,
        });
      }

      if (
        !chartData.datasets.hasMgmHourly &&
        Math.abs(chartData.datasets.offset) > 0.3
      ) {
        datasets.push({
          borderColor: "rgba(99, 102, 241, 0.2)",
          borderDash: [2, 4],
          borderWidth: 1,
          data: chartData.datasets.temps,
          fill: false,
          label: locale === "en-US" ? "OM Raw" : "OM 原始",
          pointRadius: 0,
          tension: 0.3,
        });
      }

      return {
        data: {
          datasets,
          labels: chartData.times,
        },
        options: {
          interaction: { intersect: false, mode: "index" },
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.9)",
              borderColor: "rgba(52, 211, 153, 0.3)",
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
                    ? chartData.times[index]
                    : "",
                color: "#64748b",
                maxRotation: 0,
              },
            },
            y: {
              grid: { color: "rgba(255,255,255,0.04)" },
              max: chartData.max,
              min: chartData.min,
              ticks: {
                callback: (value) => `${value}${data.temp_symbol || "°C"}`,
                color: "#64748b",
              },
            },
          },
        },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    },
    [data, chartData, locale],
  );

  return (
    <section className="chart-section">
      <h3>{t("section.todayTempTrend")}</h3>
      <div className="chart-wrapper">
        <canvas ref={canvasRef} />
      </div>
      <div className="chart-legend">{chartData?.legendText || t("section.chartEmpty")}</div>
    </section>
  );
}

export function ProbabilityDistribution({
  detail,
  hideTitle = false,
  targetDate,
}: {
  detail: CityDetail;
  hideTitle?: boolean;
  targetDate?: string | null;
}) {
  const { t } = useI18n();
  const view = getProbabilityView(detail, targetDate);

  return (
    <section className="prob-section">
      {!hideTitle && <h3>{t("section.probability")}</h3>}
      <div className="prob-bars">
        {view.mu != null && (
          <div
            style={{ color: "var(--text-muted)", fontSize: "11px", marginBottom: "6px" }}
          >
            {t("section.mu", {
              unit: detail.temp_symbol || "",
              value: view.mu.toFixed(1),
            })}
          </div>
        )}
        {view.probabilities.length === 0 ? (
          <EmptyState text={t("section.noProb")} />
        ) : (
          view.probabilities.slice(0, 6).map((bucket, index) => {
            const probability = Math.round(Number(bucket.probability || 0) * 100);
            return (
              <div key={`${bucket.label || bucket.value || index}`} className="prob-row">
                <div className="prob-label">
                  {bucket.label || `${bucket.value}${detail.temp_symbol}`}
                </div>
                <div className="prob-bar-track">
                  <div
                    className={clsx("prob-bar-fill", `rank-${index}`)}
                    style={{ width: `${Math.max(probability, 8)}%` }}
                  >
                    {probability}%
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function ModelForecast({
  detail,
  hideTitle = false,
  targetDate,
}: {
  detail: CityDetail;
  hideTitle?: boolean;
  targetDate?: string | null;
}) {
  const { t } = useI18n();
  const view = getModelView(detail, targetDate);
  const modelEntries = Object.entries(view.models).filter(([, value]) =>
    Number.isFinite(Number(value)),
  );
  const numericValues = modelEntries.map(([, value]) => Number(value));
  const comparisonValues =
    view.deb != null ? [...numericValues, Number(view.deb)] : numericValues;
  const minValue = comparisonValues.length ? Math.min(...comparisonValues) - 1 : 0;
  const maxValue = comparisonValues.length ? Math.max(...comparisonValues) + 1 : 1;
  const range = Math.max(maxValue - minValue, 1);

  return (
    <section className="models-section">
      {!hideTitle && <h3>{t("section.models")}</h3>}
      <div className="model-bars">
        {!modelEntries.length ? (
          <EmptyState text={t("section.noModels")} />
        ) : (
          <>
            {modelEntries
              .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
              .map(([name, value]) => {
                const numeric = Number(value);
                const width = ((numeric - minValue) / range) * 100;
                const debLine =
                  view.deb != null
                    ? ((Number(view.deb) - minValue) / range) * 100
                    : null;

                return (
                  <div key={name} className="model-row">
                    <div className="model-name" title={name}>
                      {name}
                    </div>
                    <div className="model-bar-track">
                      <div className="model-bar-fill" style={{ width: `${width}%` }}>
                        {numeric}
                        {detail.temp_symbol}
                      </div>
                      {debLine != null && (
                        <div className="model-deb-line" style={{ left: `${debLine}%` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            {view.deb != null && (
              <div
                className="model-row"
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  marginTop: "6px",
                  paddingTop: "6px",
                }}
              >
                <div
                  className="model-name"
                  style={{ color: "var(--accent-cyan)", fontWeight: 700 }}
                >
                  DEB
                </div>
                <div className="model-bar-track">
                  <div
                    className="model-bar-fill deb"
                    style={{
                      width: `${((Number(view.deb) - minValue) / range) * 100}%`,
                    }}
                  >
                    {Number(view.deb)}
                    {detail.temp_symbol}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function ForecastTable() {
  const store = useDashboardStore();
  const { data } = useCityData();
  const { t } = useI18n();
  if (!data) return null;

  const daily = data.forecast?.daily || [];
  return (
    <section className="forecast-section">
      <h3>{t("forecast.title")}</h3>
      <div className="forecast-table">
        {daily.length === 0 ? (
          <EmptyState text={t("forecast.empty")} />
        ) : (
          daily.map((day, index) => {
            const isToday = day.date === data.local_date || index === 0;
            const isSelected =
              store.futureModalDate === day.date ||
              store.selectedForecastDate === day.date;
            return (
              <button
                key={day.date}
                type="button"
                className={clsx("forecast-day", isToday && "today", isSelected && "selected")}
                onClick={() => {
                  store.openFutureModal(day.date);
                }}
              >
                <div className="f-date">
                  {isToday ? t("forecast.today") : day.date.substring(5).replace("-", "/")}
                </div>
                <div className="f-temp">
                  {day.max_temp}
                  {data.temp_symbol}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

export function AiAnalysis() {
  const { data } = useCityData();
  const { t } = useI18n();
  if (!data) return null;
  const ai = parseAiAnalysis(data.ai_analysis);

  return (
    <section className="ai-section">
      <h3>{t("section.ai")}</h3>
      <div className="ai-box">
        {!ai.summary && ai.bullets.length === 0 ? (
          <span className="ai-placeholder">{t("section.aiEmpty")}</span>
        ) : (
          <>
            {ai.summary && <div className="ai-summary">{ai.summary}</div>}
            {ai.bullets.length > 0 && (
              <ul className="ai-list">
                {ai.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function RiskInfo() {
  const { data } = useCityData();
  const { t } = useI18n();
  if (!data) return null;
  const risk = data.risk || {};

  return (
    <section className="risk-section">
      <h3>{t("section.risk")}</h3>
      <div className="risk-info">
        {!risk.airport ? (
          <span style={{ color: "var(--text-muted)" }}>{t("section.noRiskProfile")}</span>
        ) : (
          <>
            <div className="risk-row">
              <span className="risk-label">{t("section.airport")}</span>
              <span>
                {risk.airport} ({risk.icao})
              </span>
            </div>
            <div className="risk-row">
              <span className="risk-label">{t("section.distance")}</span>
              <span>{risk.distance_km}km</span>
            </div>
            {risk.warning && (
              <div className="risk-row">
                <span className="risk-label">{t("section.note")}</span>
                <span>{risk.warning}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
