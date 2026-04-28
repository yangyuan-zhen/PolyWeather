import type { ChartConfiguration } from "chart.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { CityDetail } from "@/lib/dashboard-types";
import { useChart } from "@/hooks/useChart";
import { useI18n } from "@/hooks/useI18n";
import { getTemperatureChartData } from "@/lib/chart-utils";

type TemperatureChartData = NonNullable<ReturnType<typeof getTemperatureChartData>>;

function compactSeries<T extends { time?: string | null; temp?: number | null }>(
  rows?: T[] | null,
) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => `${String(row?.time || "").trim()}=${Number(row?.temp)}`)
    .join("|");
}

function buildTemperatureChartSignature(detail: CityDetail) {
  const hourly = detail.hourly || {};
  const mgmHourly = Array.isArray(detail.mgm?.hourly) ? detail.mgm?.hourly || [] : [];
  const tafMarkers = Array.isArray(detail.taf?.signal?.markers)
    ? detail.taf?.signal?.markers || []
    : [];
  return [
    detail.name,
    detail.local_date,
    detail.temp_symbol,
    (hourly.times || []).join("|"),
    (hourly.temps || []).map((value) => Number(value)).join("|"),
    detail.forecast?.today_high ?? "",
    detail.deb?.prediction ?? "",
    detail.mgm?.temp ?? "",
    detail.mgm?.time ?? "",
    mgmHourly
      .map((row) => `${String(row?.time || "").trim()}=${Number(row?.temp)}`)
      .join("|"),
    compactSeries(detail.metar_today_obs),
    compactSeries(detail.settlement_today_obs),
    compactSeries(detail.trend?.recent),
    detail.current?.temp ?? "",
    detail.current?.obs_time ?? "",
    detail.airport_current?.temp ?? "",
    detail.airport_current?.obs_time ?? "",
    detail.peak?.first_h ?? "",
    detail.peak?.last_h ?? "",
    tafMarkers
      .map((marker) =>
        [
          marker?.marker_type,
          marker?.label_time,
          marker?.start_local,
          marker?.end_local,
          marker?.summary_zh,
          marker?.summary_en,
        ]
          .map((value) => String(value || "").trim())
          .join("="),
      )
      .join("|"),
  ].join("::");
}

export function AiCityTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale } = useI18n();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [shouldRenderChart, setShouldRenderChart] = useState(false);
  const cityKey = `${detail.name || detail.display_name || ""}:${detail.local_date || ""}`;
  const chartSignature = useMemo(
    () => (shouldRenderChart ? buildTemperatureChartSignature(detail) : ""),
    [detail, shouldRenderChart],
  );
  const computedChartData = useMemo(
    () => (shouldRenderChart ? getTemperatureChartData(detail, locale) : null),
    [chartSignature, detail, locale, shouldRenderChart],
  );
  const lastChartDataRef = useRef<{
    cityKey: string;
    data: TemperatureChartData;
  } | null>(null);
  if (computedChartData) {
    lastChartDataRef.current = { cityKey, data: computedChartData };
  }
  const chartData =
    computedChartData ||
    (lastChartDataRef.current?.cityKey === cityKey
      ? lastChartDataRef.current.data
      : null);
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
        animation: false,
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
        transitions: {
          active: { animation: { duration: 0 } },
          hide: { animation: { duration: 0 } },
          resize: { animation: { duration: 0 } },
          show: { animation: { duration: 0 } },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [chartData, detail.temp_symbol, forecastLabel, observationLabel]);

  useEffect(() => {
    if (shouldRenderChart) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setShouldRenderChart(true);
      return;
    }
    const target = sectionRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldRenderChart(true);
        observer.disconnect();
      },
      { rootMargin: "220px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldRenderChart]);

  return (
    <section className="scan-ai-city-section chart" ref={sectionRef}>
      <div className="scan-ai-city-section-title">
        <BarChart3 size={15} />
        <span>{locale === "en-US" ? "Evidence · intraday path" : "证据 · 今日日内路径"}</span>
      </div>
      <div className="scan-ai-city-chart">
        {shouldRenderChart ? (
          <canvas ref={canvasRef} />
        ) : (
          <div className="scan-ai-city-chart-placeholder">
            {locale === "en-US" ? "Chart will render when visible" : "图表进入视口后再渲染"}
          </div>
        )}
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

