"use client";

import type { ChartConfiguration } from "chart.js";
import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useI18n } from "@/hooks/useI18n";
import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";

export function DetailMiniTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale } = useI18n();
  const chartData = useMemo(
    () => getTemperatureChartData(detail, locale),
    [detail, locale],
  );
  const forecastLabel = locale === "en-US" ? "DEB baseline" : "DEB 原始路径";
  const calibratedLabel =
    locale === "en-US"
      ? "METAR-calibrated path"
      : "METAR 修正路径";
  const observationLabel =
    chartData?.observationLabel ||
    (locale === "en-US" ? "METAR Observation" : "METAR 实况");
  const hasCalibratedPath = Boolean(
    chartData?.datasets.calibratedFuture.some((value) => value != null),
  );

  const canvasRef = useChart(() => {
    if (!chartData) {
      return {
        data: { datasets: [], labels: [] },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    }

    const datasets: NonNullable<
      ChartConfiguration<"line">["data"]
    >["datasets"] = [
      {
        borderColor: "rgba(100, 116, 139, 0.72)",
        borderDash: [6, 4],
        borderWidth: 1.5,
        data: chartData.datasets.debPast.map(
          (value, index) => value ?? chartData.datasets.debFuture[index],
        ),
        fill: false,
        label: forecastLabel,
        pointRadius: 0,
        spanGaps: true,
        tension: 0.28,
      },
    ];

    if (hasCalibratedPath) {
      datasets.push({
        borderColor: "#38bdf8",
        borderWidth: 2.1,
        data: chartData.datasets.calibratedFuture,
        fill: false,
        label: calibratedLabel,
        pointRadius: 0,
        spanGaps: true,
        tension: 0.3,
      });
    }

    datasets.push({
      backgroundColor: "#22c55e",
      borderColor: "#22c55e",
      borderWidth: 0,
      data: chartData.datasets.metarPoints,
      fill: false,
      label: observationLabel,
      pointHoverRadius: 5,
      pointRadius: 3.2,
      showLine: false,
    });

    return {
      data: {
        datasets,
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
              callback: (value, index) =>
                typeof index === "number" && index % 4 === 0
                  ? String(value)
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
  }, [
    calibratedLabel,
    chartData,
    detail.temp_symbol,
    forecastLabel,
    hasCalibratedPath,
    observationLabel,
  ]);

  return (
    <div className="detail-mini-chart-wrap">
      <div className="detail-mini-chart">
        <canvas ref={canvasRef} />
      </div>
      {chartData ? (
        <div className="detail-mini-chart-legend">
          <span>
            <i className="forecast baseline" />
            {forecastLabel}
          </span>
          {hasCalibratedPath ? (
            <span>
              <i className="forecast calibrated" />
              {calibratedLabel}
            </span>
          ) : null}
          <span>
            <i className="observation" />
            {observationLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
