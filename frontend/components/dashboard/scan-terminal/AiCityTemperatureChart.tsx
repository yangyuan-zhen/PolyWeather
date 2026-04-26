import type { ChartConfiguration } from "chart.js";
import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import type { CityDetail } from "@/lib/dashboard-types";
import { useChart } from "@/hooks/useChart";
import { useI18n } from "@/hooks/useI18n";
import { getTemperatureChartData } from "@/lib/dashboard-utils";

export function AiCityTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale } = useI18n();
  const chartData = useMemo(
    () => getTemperatureChartData(detail, locale),
    [detail, locale],
  );
  const forecastLabel = chartData?.datasets.hasMgmHourly
    ? locale === "en-US"
      ? "MGM forecast"
      : "MGM 预测"
    : locale === "en-US"
      ? "DEB forecast"
      : "DEB 预测";
  const observationLabel =
    chartData?.observationLabel ||
    (locale === "en-US" ? "METAR obs" : "METAR 实况");
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
            borderColor: "#4DA3FF",
            borderWidth: 2,
            data: forecastPoints,
            fill: false,
            label: forecastLabel,
            pointRadius: 0,
            spanGaps: true,
            tension: 0.32,
          },
          {
            backgroundColor: "#22C55E",
            borderColor: "#22C55E",
            borderWidth: 0,
            data: chartData.datasets.metarPoints,
            fill: false,
            label: observationLabel,
            pointHoverRadius: 5,
            pointRadius: 3.5,
            showLine: false,
          },
        ],
        labels: chartData.times,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        layout: { padding: { bottom: 2, left: 0, right: 8, top: 8 } },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(11, 18, 32, 0.96)",
            borderColor: "rgba(77, 163, 255, 0.38)",
            borderWidth: 1,
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { color: "rgba(159, 178, 199, 0.08)" },
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
            grid: { color: "rgba(159, 178, 199, 0.08)" },
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
    <section className="scan-ai-city-section chart">
      <div className="scan-ai-city-section-title">
        <BarChart3 size={15} />
        <span>{locale === "en-US" ? "Evidence · intraday path" : "证据 · 今日日内路径"}</span>
      </div>
      <div className="scan-ai-city-chart">
        <canvas ref={canvasRef} />
      </div>
      {chartData ? (
        <div className="scan-ai-city-chart-legend">
          <span><i className="forecast" />{forecastLabel}</span>
          <span><i className="observation" />{observationLabel}</span>
        </div>
      ) : null}
    </section>
  );
}

