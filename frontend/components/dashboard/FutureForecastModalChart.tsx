"use client";

import type { ChartConfiguration } from "chart.js";
import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardSelection } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { getTemperatureChartData } from "@/lib/chart-utils";
import { getFutureModalView } from "@/lib/dashboard-utils";
import { formatMinuteAxisLabel } from "./FutureForecastModal.utils";

export function DailyTemperatureChart({
  dateStr,
  forceToday = false,
}: {
  dateStr: string;
  forceToday?: boolean;
}) {
  const { selectedDetail: detail } = useDashboardSelection();
  const { locale, t } = useI18n();
  const view = detail ? getFutureModalView(detail, dateStr, locale) : null;
  const isToday =
    forceToday || (detail ? dateStr === detail.local_date : false);
  const todayChartData = useMemo(
    () => (detail && isToday ? getTemperatureChartData(detail, locale) : null),
    [detail, isToday, locale],
  );

  const canvasRef = useChart(() => {
    if (!detail || !view) {
      return {
        data: { datasets: [], labels: [] },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    }

    if (isToday && todayChartData) {
      const datasets: NonNullable<
        ChartConfiguration<"line">["data"]
      >["datasets"] = [];

      datasets.push({
        borderColor: "rgba(100, 116, 139, 0.72)",
        borderDash: [6, 4],
        borderWidth: 1.6,
        data: todayChartData.datasets.debSeries,
        fill: false,
        label: locale === "en-US" ? "DEB baseline" : "DEB 原始路径",
        parsing: false,
        pointRadius: 0,
        tension: 0.3,
      });

      if (todayChartData.datasets.calibratedFutureSeries.length > 0) {
        datasets.push({
          borderColor: "#38bdf8",
          borderWidth: 2.4,
          data: todayChartData.datasets.calibratedFutureSeries,
          fill: false,
          label:
            locale === "en-US"
              ? "METAR-calibrated path"
              : "METAR 修正路径",
          parsing: false,
          pointHoverRadius: 5,
          pointRadius: 0,
          tension: 0.32,
        });
      }

      if (todayChartData.datasets.hasMgmHourly) {
        datasets.push({
          backgroundColor: "rgba(234, 179, 8, 0.05)",
          borderColor: "rgba(234, 179, 8, 0.8)",
          borderDash: [3, 3],
          borderWidth: 1.2,
          data: todayChartData.datasets.mgmHourlySeries,
          fill: false,
          label: locale === "en-US" ? "MGM Forecast" : "MGM 预测",
          parsing: false,
          pointHoverRadius: 6,
          pointRadius: 0,
          spanGaps: true,
          tension: 0.3,
        });
      }

      datasets.push({
        backgroundColor: "#22c55e",
        borderColor: "#22c55e",
        borderWidth: 0,
        data: todayChartData.datasets.metarSeries,
        fill: false,
        label:
          todayChartData.observationLabel ||
          (locale === "en-US" ? "Observation" : "观测实况"),
        order: 0,
        parsing: false,
        pointHoverRadius: 7,
        pointRadius: 5,
        showLine: false,
      });

      if (todayChartData.datasets.airportMetarSeries?.length > 0) {
        datasets.push({
          backgroundColor: "#86efac",
          borderColor: "#86efac",
          borderWidth: 1,
          data: todayChartData.datasets.airportMetarSeries,
          fill: false,
          label: locale === "en-US" ? "Airport METAR" : "机场 METAR",
          order: 0,
          parsing: false,
          pointHoverRadius: 6,
          pointRadius: 4,
          showLine: false,
        });
      }

      if (todayChartData.datasets.mgmSeries?.length > 0) {
        datasets.push({
          backgroundColor: "#facc15",
          borderColor: "#facc15",
          borderWidth: 0,
          data: todayChartData.datasets.mgmSeries,
          fill: false,
          label: locale === "en-US" ? "MGM Observation" : "MGM 实测",
          order: -1,
          parsing: false,
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
          borderColor: "rgba(77, 163, 255, 0.22)",
          borderDash: [2, 4],
          borderWidth: 1,
          data: todayChartData.datasets.tempsSeries,
          fill: false,
          label: locale === "en-US" ? "OM Raw" : "OM 原始",
          parsing: false,
          pointRadius: 0,
          tension: 0.3,
        });
      }
      if ((todayChartData.tafMarkers || []).length > 0) {
        datasets.push({
          backgroundColor: "#f59e0b",
          borderColor: "#f59e0b",
          borderWidth: 0,
          data: todayChartData.datasets.tafCurrentMarkerSeries,
          fill: false,
          label: locale === "en-US" ? "Current TAF" : "当前 TAF",
          order: -3,
          parsing: false,
          pointHoverRadius: 8,
          pointRadius: 6,
          showLine: false,
        });
        datasets.push({
          backgroundColor: "rgba(250, 204, 21, 0.72)",
          borderColor: "rgba(250, 204, 21, 0.72)",
          borderWidth: 0,
          data: todayChartData.datasets.tafPeakWindowMarkerSeries,
          fill: false,
          label: locale === "en-US" ? "Peak-window TAF" : "峰值窗口 TAF",
          order: -2,
          parsing: false,
          pointHoverRadius: 7,
          pointRadius: 4,
          showLine: false,
        });
        datasets.push({
          backgroundColor: "#f59e0b",
          borderColor: "#f59e0b",
          borderWidth: 0,
          data: todayChartData.datasets.tafMarkerSeries,
          fill: false,
          label: locale === "en-US" ? "TAF Timing" : "TAF 时段",
          order: -4,
          parsing: false,
          pointHoverRadius: 0,
          pointRadius: 0,
          showLine: false,
        });
      }

      return {
        data: {
          datasets,
          labels: [],
        },
        options: {
          interaction: { intersect: false, mode: "nearest" },
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: "#9FB2C7",
                filter: (legendItem, chartData) => {
                  const text = String(legendItem.text || "");
                  if (!text) return false;
                  if (text === "TAF Timing" || text === "TAF 时段")
                    return false;
                  if (!text.includes("DEB")) return true;

                  const firstDebIndex = (chartData.datasets || []).findIndex(
                    (dataset) => String(dataset.label || "").includes("DEB"),
                  );
                  return legendItem.datasetIndex === firstDebIndex;
                },
                font: { family: "Inter", size: 11 },
              },
            },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.96)",
              borderColor: "rgba(77, 163, 255, 0.24)",
              borderWidth: 1,
              callbacks: {
                title: (items) => {
                  const rawX = items?.[0]?.parsed?.x;
                  return rawX != null
                    ? formatMinuteAxisLabel(Number(rawX))
                    : "";
                },
                label: (ctx) => {
                  const label = String(ctx.dataset.label || "");
                  const raw = ctx.raw as
                    | {
                        marker?: {
                          summary?: string;
                          markerType?: string;
                          displayType?: string;
                          isCurrent?: boolean;
                          isPeakWindow?: boolean;
                        };
                      }
                    | undefined;
                  if (
                    label === "TAF Timing" ||
                    label === "TAF 时段" ||
                    label === "Current TAF" ||
                    label === "当前 TAF" ||
                    label === "Peak-window TAF" ||
                    label === "峰值窗口 TAF"
                  ) {
                    const marker = raw?.marker;
                    if (!marker) return label;
                    const markerType = String(marker.markerType || "");
                    const displayType = String(
                      marker.displayType || marker.markerType || "",
                    );
                    const summary = String(marker.summary || "");
                    const prefix =
                      marker.isCurrent && marker.isPeakWindow
                        ? locale === "en-US"
                          ? "Current / peak-window TAF"
                          : "当前 / 峰值窗口 TAF"
                        : marker.isCurrent
                          ? locale === "en-US"
                            ? "Current TAF"
                            : "当前 TAF"
                          : marker.isPeakWindow
                            ? locale === "en-US"
                              ? "Peak-window TAF"
                              : "峰值窗口 TAF"
                            : label;
                    return `${prefix}: ${
                      markerType
                        ? summary.replace(markerType, displayType)
                        : summary
                    }`;
                  }
                  const value = ctx.parsed.y;
                  if (value == null) return label;
                  return `${label}: ${value.toFixed(1)}${detail.temp_symbol || "°C"}`;
                },
              },
            },
          },
          responsive: true,
          scales: {
            x: {
              max: todayChartData.xMax,
              min: todayChartData.xMin,
              grid: { color: "rgba(255,255,255,0.04)" },
              type: "linear",
              ticks: {
                callback: (value) => {
                  const num = Number(value);
                  if (!Number.isFinite(num)) return "";
                  const minutes = Math.round(num);
                  if (
                    minutes !== todayChartData.xMin &&
                    minutes !== todayChartData.xMax &&
                    minutes % 120 !== 0
                  ) {
                    return "";
                  }
                  return formatMinuteAxisLabel(minutes);
                },
                color: "#6B7A90",
                font: { family: "Inter", size: 10 },
                maxRotation: 0,
              },
            },
            y: {
              grid: { color: "rgba(255,255,255,0.04)" },
              max: todayChartData.max,
              min: todayChartData.min,
              ticks: {
                callback: (value) =>
                  `${Number(value).toFixed(todayChartData.yTickStep < 1 ? 1 : 0)}${detail.temp_symbol || "°C"}`,
                color: "#6B7A90",
                font: { family: "Inter", size: 10 },
                stepSize: todayChartData.yTickStep,
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
            backgroundColor: "rgba(77, 163, 255, 0.08)",
            borderColor: "#4DA3FF",
            data: view.slice.map((point) => point.temp),
            fill: false,
            label:
              locale === "en-US" ? "Open-Meteo Temperature" : "Open-Meteo 温度",
            pointRadius: 2,
            tension: 0.28,
          },
          {
            backgroundColor: "transparent",
            borderColor: "#93C5FD",
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
              color: "#9FB2C7",
              font: { family: "Inter", size: 11 },
            },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            borderColor: "rgba(77, 163, 255, 0.24)",
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
              color: "#6B7A90",
              font: { family: "Inter", size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              callback: (value) => `${value}${unit}`,
              color: "#6B7A90",
              font: { family: "Inter", size: 10 },
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [detail, isToday, locale, todayChartData, view]);

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
