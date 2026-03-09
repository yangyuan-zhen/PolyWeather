"use client";

import { ChartConfiguration } from "chart.js/auto";
import clsx from "clsx";
import { CSSProperties } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import {
  ModelForecast,
  ProbabilityDistribution,
} from "@/components/dashboard/PanelSections";
import {
  getFutureModalView,
  getShortTermNowcastLines,
  getTemperatureChartData,
  getWeatherSummary,
  parseAiAnalysis,
} from "@/lib/dashboard-utils";

function getConfidenceLabel(confidence: string) {
  return (
    {
      high: "高",
      medium: "中",
      low: "低",
    }[confidence] || confidence
  );
}

function DailyTemperatureChart({ dateStr }: { dateStr: string }) {
  const store = useDashboardStore();
  const detail = store.selectedDetail;
  const view = detail ? getFutureModalView(detail, dateStr) : null;
  const isToday = detail ? dateStr === detail.local_date : false;
  const todayChartData = detail && isToday ? getTemperatureChartData(detail) : null;

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
            label: "MGM 预报",
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
            label: "DEB 预报",
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
            label: "DEB 预报",
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
          label: "METAR 实测",
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
            label: "MGM 实测",
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
            label: "OM 原始",
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
              label: "Open-Meteo 温度",
              pointRadius: 2,
              tension: 0.28,
            },
            {
              backgroundColor: "transparent",
              borderColor: "#a78bfa",
              borderDash: [5, 4],
              data: view.slice.map((point) => point.dewPoint),
              fill: false,
              label: "露点",
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
    [detail, isToday, todayChartData, view],
  );

  return (
    <>
      <div className="history-chart-wrapper future-chart-wrapper">
        <canvas ref={canvasRef} />
      </div>
      {isToday && (
        <div className="chart-legend">
          {todayChartData?.legendText || "暂无机场报文或小时级实测数据"}
        </div>
      )}
    </>
  );
}

export function FutureForecastModal() {
  const store = useDashboardStore();
  const detail = store.selectedDetail;
  const dateStr = store.futureModalDate;

  if (!detail || !dateStr) return null;

  const isToday = dateStr === detail.local_date;
  const view = getFutureModalView(detail, dateStr);
  const nowcastRows = getShortTermNowcastLines(detail, dateStr);
  const ai = parseAiAnalysis(detail.ai_analysis);
  const scorePosition = `${50 + view.front.score / 2}%`;
  const barStyle = {
    "--score-position": scorePosition,
  } as CSSProperties & { "--score-position": string };
  const weatherSummary = getWeatherSummary(detail);

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
              ? `${detail.display_name.toUpperCase()} · 今日日内分析`
              : `${detail.display_name.toUpperCase()} · ${dateStr} 未来日期分析`}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label={isToday ? "关闭今日日内分析" : "关闭未来日期分析"}
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
                  <span className="label">当前实测</span>
                  <span className="val">
                    {detail.current?.temp ?? "--"}
                    {detail.temp_symbol} @{detail.current?.obs_time || "--"}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">当前天气</span>
                  <span className="val">
                    {weatherSummary.weatherIcon} {weatherSummary.weatherText}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">WU 结算参考</span>
                  <span className="val">
                    {detail.current?.wu_settlement ?? "--"}
                    {detail.temp_symbol}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">日出时间</span>
                  <span className="val">{detail.forecast?.sunrise || "--"}</span>
                </div>
                <div className="h-stat-card">
                  <span className="label">日落时间</span>
                  <span className="val">{detail.forecast?.sunset || "--"}</span>
                </div>
                <div className="h-stat-card">
                  <span className="label">日照时长</span>
                  <span className="val">
                    {detail.forecast?.sunshine_hours != null
                      ? `${detail.forecast.sunshine_hours}h`
                      : "--"}
                  </span>
                </div>
              </>
            )}

            <div className="h-stat-card">
              <span className="label">{isToday ? "今日预报高温" : "目标日预报"}</span>
              <span className="val">
                {view.forecastEntry?.max_temp ?? "--"}
                {detail.temp_symbol}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">DEB 预测</span>
              <span className="val">
                {view.deb ?? "--"}
                {detail.temp_symbol}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">动态分布中心</span>
              <span className="val">
                {view.mu != null ? `${view.mu.toFixed(1)}${detail.temp_symbol}` : "--"}
              </span>
            </div>
            <div className="h-stat-card">
              <span className="label">趋势评分</span>
              <span className="val">
                {view.front.score > 0 ? "+" : ""}
                {view.front.score}
              </span>
            </div>
          </div>

          <section className="future-modal-section">
            <h3>{isToday ? "今日温度走势" : "目标日小时走势"}</h3>
            <DailyTemperatureChart dateStr={dateStr} />
          </section>

          <div className="future-modal-grid">
            <section className="future-modal-section">
              <h3>结算概率分布</h3>
              <ProbabilityDistribution detail={detail} targetDate={dateStr} hideTitle />
            </section>
            <section className="future-modal-section">
              <h3>多模型预报</h3>
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
                {isToday ? "今日日内结构信号" : "未来 6-48 小时趋势"}
              </h3>
              <div className="future-front-score">
                <div className="future-front-bar" style={barStyle} />
                <div className="future-front-meta">
                  <span className="future-front-pill">判断: {view.front.label}</span>
                  <span className="future-front-pill">
                    置信度: {getConfidenceLabel(view.front.confidence)}
                  </span>
                  <span className="future-front-pill">
                    最大降水概率: {Math.round(view.front.precipMax)}%
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
              <h3>AI 深度分析</h3>
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
                  <div>暂无 AI 分析，当前以结构化气象与模型数据为主。</div>
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
                    <strong>weather.gov 文本: </strong>
                    {view.front.weatherGovPeriods
                      .map((period) => period.short_forecast || period.detailed_forecast)
                      .filter(Boolean)
                      .join(" / ")}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
