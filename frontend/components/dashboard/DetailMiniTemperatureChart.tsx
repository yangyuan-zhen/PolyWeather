"use client";

import type { ChartConfiguration } from "chart.js";
import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useI18n } from "@/hooks/useI18n";
import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";

export function DetailMiniTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale, t } = useI18n();
  const chartData = useMemo(
    () => getTemperatureChartData(detail, locale),
    [detail, locale],
  );
  const forecastLabel = chartData?.datasets.hasMgmHourly
    ? locale === "en-US"
      ? "MGM Forecast"
      : "MGM 预测"
    : locale === "en-US"
      ? "DEB Forecast"
      : "DEB 预测";
  const observationLabel =
    chartData?.observationLabel ||
    (locale === "en-US" ? "METAR Observation" : "METAR 实况");

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
            label: forecastLabel,
            pointRadius: 0,
            spanGaps: true,
            tension: 0.28,
          },
          {
            backgroundColor: "#4DA3FF",
            borderColor: "#4DA3FF",
            borderWidth: 0,
            data: chartData.datasets.metarPoints,
            fill: false,
            label: observationLabel,
            pointHoverRadius: 5,
            pointRadius: 3.2,
            showLine: false,
          },
        ],
        labels: chartData.times,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        layout: { padding: { bottom: 0, left: 0, right: 6, top: 4 } },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            borderColor: "rgba(77, 163, 255, 0.28)",
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
              color: "#6B7A90",
              font: { size: 10 },
              maxTicksLimit: 6,
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.03)" },
            max: chartData.max,
            min: chartData.min,
            ticks: {
              callback: (value) =>
                `${Number(value).toFixed(chartData.yTickStep < 1 ? 1 : 0)}${detail.temp_symbol || "°C"}`,
              color: "#6B7A90",
              font: { size: 10 },
              maxTicksLimit: 5,
              stepSize: chartData.yTickStep,
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [chartData, detail.temp_symbol, forecastLabel, observationLabel]);

  return (
    <div className="detail-mini-chart-wrap">
      <div className="detail-mini-chart">
        <canvas ref={canvasRef} />
      </div>
      {chartData ? (
        <div className="detail-mini-chart-legend">
          <span>
            <i className="forecast" />
            {forecastLabel}
          </span>
          <span>
            <i className="observation" />
            {observationLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
