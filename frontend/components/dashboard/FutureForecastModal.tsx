"use client";

import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Search,
  Sun,
  Wind,
} from "lucide-react";

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import { CSSProperties, useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import {
  ModelForecast,
  ProbabilityDistribution,
} from "@/components/dashboard/PanelSections";
import {
  getFutureModalView,
  getModelView,
  getProbabilityView,
  getTodayPaceView,
  getTemperatureChartData,
  getWeatherSummary,
} from "@/lib/dashboard-utils";

function normalizeMarketValue(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100));
  return Math.max(0, Math.min(1, numeric));
}

function WeatherIcon({ emoji, size = 32 }: { emoji: string; size?: number }) {
  if (emoji === "☀️") return <Sun size={size} color="#facc15" />;
  if (emoji === "⛅" || emoji === "🌤️")
    return <CloudSun size={size} color="#38bdf8" />;
  if (emoji === "☁️") return <Cloud size={size} color="#94a3b8" />;
  if (emoji === "🌧️" || emoji === "🌦️")
    return <CloudRain size={size} color="#60a5fa" />;
  if (emoji === "⛈️") return <CloudLightning size={size} color="#c084fc" />;
  if (emoji === "❄️" || emoji === "🌨️")
    return <CloudSnow size={size} color="#7dd3fc" />;
  if (emoji === "🌫️") return <CloudFog size={size} color="#a1a1aa" />;
  if (emoji === "💨") return <Wind size={size} color="#cbd5e1" />;
  return <Search size={size} color="#64748b" />;
}

function formatMarketPercent(value?: number | null) {
  const normalized = normalizeMarketValue(value);
  if (normalized == null) return "--";
  return `${(normalized * 100).toFixed(1)}%`;
}

function formatSignedPercent(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}%`;
}

function formatBucketLabel(
  bucket?: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | null;
    temp?: number | null;
  } | null,
) {
  if (!bucket) return "--";
  const direct =
    String(bucket.label || "").trim() ||
    String(bucket.bucket || "").trim() ||
    String(bucket.range || "").trim();
  if (direct) {
    let str = direct.toUpperCase().replace(/\s+/g, "");
    str = str.replace(/°?C($|\+|-)/g, "℃$1");
    if (!str.includes("℃") && /[0-9]/.test(str)) {
      str += "℃";
    }
    return str;
  }

  const temp = Number(bucket.value ?? bucket.temp);
  if (Number.isFinite(temp)) {
    return `${Math.round(temp)}℃`;
  }
  return "--";
}

function parseBucketBoundaries(
  bucket?: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | null;
    temp?: number | null;
  } | null,
) {
  if (!bucket) return null;
  const raw =
    String(bucket.label || "").trim() ||
    String(bucket.bucket || "").trim() ||
    String(bucket.range || "").trim();
  if (!raw) return null;
  const numbers = Array.from(raw.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );
  if (!numbers.length) return null;
  if (raw.includes("+")) {
    return {
      lower: numbers[0] ?? null,
      upper: null as number | null,
      boundaryLabel: `${numbers[0]}°C`,
    };
  }
  if (numbers.length >= 2) {
    return {
      lower: numbers[0],
      upper: numbers[1],
      boundaryLabel: null as string | null,
    };
  }
  return {
    lower: numbers[0],
    upper: null as number | null,
    boundaryLabel: `${numbers[0]}°C`,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseClockMinutes(value?: string | null) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function parseLeadingNumber(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercentFromText(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 100);
  }
  const text = String(value || "").trim();
  const percentMatch = text.match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const numeric = Number(percentMatch[1]);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : null;
  }
  return parseLeadingNumber(text);
}

function getTrendMetricVisual(metric: {
  label?: string;
  value?: string;
  tone?: string;
}) {
  const label = String(metric.label || "").toLowerCase();
  const value = String(metric.value || "");
  const numeric = parseLeadingNumber(value);

  if (label.includes("降水") || label.includes("precip")) {
    const precipPercent = parsePercentFromText(value);
    if (precipPercent == null) return null;
    return {
      mode: "fill" as const,
      percent: precipPercent,
      tone: "cold" as const,
    };
  }

  if (numeric == null) return null;

  if (label.includes("温度") || label.includes("temp")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 4) * 50, 0, 100),
      tone: numeric >= 0 ? "warm" as const : "cold" as const,
    };
  }

  if (label.includes("露点") || label.includes("dew")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 3) * 50, 0, 100),
      tone: numeric >= 0 ? "warm" as const : "cold" as const,
    };
  }

  if (label.includes("气压") || label.includes("pressure")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 4) * 50, 0, 100),
      tone: numeric >= 0 ? "warm" as const : "cold" as const,
    };
  }

  if (label.includes("云量") || label.includes("cloud")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 40) * 50, 0, 100),
      tone: numeric >= 0 ? "cold" as const : "warm" as const,
    };
  }

  return null;
}

function DailyTemperatureChart({ dateStr }: { dateStr: string }) {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const detail = store.selectedDetail;
  const view = detail ? getFutureModalView(detail, dateStr, locale) : null;
  const isToday = detail ? dateStr === detail.local_date : false;
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

      if (todayChartData.datasets.hasMgmHourly) {
        datasets.push({
          backgroundColor: "rgba(234, 179, 8, 0.05)",
          borderColor: "rgba(234, 179, 8, 0.8)",
          borderWidth: 2,
          data: todayChartData.datasets.mgmHourlyPoints,
          fill: false,
          label: locale === "en-US" ? "MGM Forecast" : "MGM 预测",
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
          label: locale === "en-US" ? "DEB Forecast" : "DEB 预测",
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
          label: locale === "en-US" ? "DEB Forecast" : "DEB 预测",
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
        label:
          todayChartData.observationLabel ||
          (locale === "en-US" ? "Observation" : "观测实况"),
        order: 0,
        pointHoverRadius: 7,
        pointRadius: 5,
      });

      if (
        todayChartData.datasets.airportMetarPoints?.some((value) => value != null)
      ) {
        datasets.push({
          backgroundColor: "#60a5fa",
          borderColor: "#60a5fa",
          borderWidth: 1,
          data: todayChartData.datasets.airportMetarPoints,
          fill: false,
          label:
            locale === "en-US" ? "Airport METAR" : "机场 METAR",
          order: 0,
          pointHoverRadius: 6,
          pointRadius: 4,
          showLine: false,
        });
      }

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
      if ((todayChartData.tafMarkers || []).length > 0) {
        datasets.push({
          backgroundColor: "#f59e0b",
          borderColor: "#f59e0b",
          borderWidth: 0,
          data: todayChartData.datasets.tafCurrentMarkerPoints,
          fill: false,
          label: locale === "en-US" ? "Current TAF" : "当前 TAF",
          order: -3,
          pointHoverRadius: 8,
          pointRadius: 6,
          showLine: false,
        });
        datasets.push({
          backgroundColor: "rgba(250, 204, 21, 0.72)",
          borderColor: "rgba(250, 204, 21, 0.72)",
          borderWidth: 0,
          data: todayChartData.datasets.tafPeakWindowMarkerPoints,
          fill: false,
          label: locale === "en-US" ? "Peak-window TAF" : "峰值窗口 TAF",
          order: -2,
          pointHoverRadius: 7,
          pointRadius: 4,
          showLine: false,
        });
        datasets.push({
          backgroundColor: "#f59e0b",
          borderColor: "#f59e0b",
          borderWidth: 0,
          data: todayChartData.datasets.tafMarkerPoints,
          fill: false,
          label: locale === "en-US" ? "TAF Timing" : "TAF 时段",
          order: -4,
          pointHoverRadius: 0,
          pointRadius: 0,
          showLine: false,
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
                  if (text === "TAF Timing" || text === "TAF 时段") return false;
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
              borderColor: "rgba(34, 211, 238, 0.2)",
              borderWidth: 1,
              callbacks: {
                label: (ctx) => {
                  const label = String(ctx.dataset.label || "");
                  if (
                    label === "TAF Timing" ||
                    label === "TAF 时段" ||
                    label === "Current TAF" ||
                    label === "当前 TAF" ||
                    label === "Peak-window TAF" ||
                    label === "峰值窗口 TAF"
                  ) {
                    const marker = (todayChartData.tafMarkers || []).find(
                      (item) => item.index === ctx.dataIndex,
                    );
                    if (!marker) return label;
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
                    return `${prefix}: ${String(marker.summary || "").replace(
                      marker.markerType,
                      marker.displayType || marker.markerType,
                    )}`;
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
            label:
              locale === "en-US" ? "Open-Meteo Temperature" : "Open-Meteo 温度",
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

export function FutureForecastModal() {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const detail = store.selectedDetail;
  const marketScan = store.selectedMarketScan;
  const dateStr = store.futureModalDate;
  const isPro = store.proAccess.subscriptionActive;
  const isProLoading = store.proAccess.loading;

  if (!detail || !dateStr) return null;

  const isToday = dateStr === detail.local_date;
  const view = getFutureModalView(detail, dateStr, locale);
  const scorePosition = `${50 + view.front.score / 2}%`;
  const barStyle = {
    "--score-position": scorePosition,
  } as CSSProperties & { "--score-position": string };
  const weatherSummary = getWeatherSummary(detail, locale);
  const paceView = useMemo(
    () => (isToday ? getTodayPaceView(detail, locale) : null),
    [detail, isToday, locale],
  );
  const probabilityView = useMemo(
    () => getProbabilityView(detail, dateStr),
    [dateStr, detail],
  );
  const modelView = useMemo(() => getModelView(detail, dateStr), [dateStr, detail]);
  const topProbabilityBucket = useMemo(() => {
    const buckets = Array.isArray(probabilityView?.probabilities)
      ? probabilityView.probabilities
      : [];
    return [...buckets]
      .filter((bucket) => Number.isFinite(Number(bucket?.probability)))
      .sort((a, b) => Number(b?.probability) - Number(a?.probability))[0];
  }, [probabilityView]);
  const modelSpreadView = useMemo(() => {
    const values = Object.values(modelView?.models || {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    return {
      count: values.length,
      max,
      min,
      spread,
    };
  }, [modelView]);
  const boundaryRiskView = useMemo(() => {
    if (!isToday || !paceView) return null;
    const selectedBucket = marketScan?.temperature_bucket || null;
    const bounds = parseBucketBoundaries(selectedBucket);
    if (!bounds) return null;
    const projected =
      paceView.paceAdjustedHigh ??
      (detail.deb?.prediction != null ? Number(detail.deb.prediction) : null);
    if (projected == null || !Number.isFinite(projected)) return null;

    const distances = [bounds.lower, bounds.upper]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => ({
        boundary: value,
        gap: Math.abs(projected - value),
      }))
      .sort((a, b) => a.gap - b.gap);
    if (!distances.length) return null;

    const nearest = distances[0];
    const tone =
      nearest.gap <= 0.4 ? "amber" : nearest.gap <= 0.8 ? "blue" : "cyan";
    const status =
      nearest.gap <= 0.4
        ? locale === "en-US"
          ? "High boundary risk"
          : "边界风险高"
        : nearest.gap <= 0.8
          ? locale === "en-US"
            ? "Watch boundary"
            : "边界需观察"
          : locale === "en-US"
            ? "Boundary buffer"
            : "边界缓冲";
    const note =
      locale === "en-US"
        ? `${projected.toFixed(1)}${detail.temp_symbol} is ${nearest.gap.toFixed(1)}${detail.temp_symbol} from the nearest boundary ${nearest.boundary.toFixed(1)}°C.`
        : `${projected.toFixed(1)}${detail.temp_symbol} 距最近边界 ${nearest.boundary.toFixed(1)}°C 还有 ${nearest.gap.toFixed(1)}${detail.temp_symbol}。`;
    return {
      label: locale === "en-US" ? "Boundary risk" : "边界风险",
      note,
      status,
      tone,
      value: `${nearest.gap.toFixed(1)}${detail.temp_symbol}`,
    };
  }, [detail.deb?.prediction, detail.temp_symbol, isToday, locale, marketScan?.temperature_bucket, paceView]);
  const peakWindowStateView = useMemo(() => {
    if (!isToday || !paceView) return null;
    const firstHour = Number(detail.peak?.first_h);
    const lastHour = Number(detail.peak?.last_h);
    if (
      !Number.isFinite(firstHour) ||
      !Number.isFinite(lastHour) ||
      firstHour < 0 ||
      lastHour < firstHour
    ) {
      return null;
    }
    const currentMinutes = parseClockMinutes(detail.local_time);
    const startMinutes = firstHour * 60;
    const endMinutes = (lastHour + 1) * 60;
    let status = locale === "en-US" ? "Awaiting peak" : "未进入峰值";
    let tone: "amber" | "blue" | "cyan" = "blue";
    if (currentMinutes != null && currentMinutes >= endMinutes) {
      status = locale === "en-US" ? "Past peak" : "已过峰值";
      tone = "cyan";
    } else if (currentMinutes != null && currentMinutes >= startMinutes) {
      status = locale === "en-US" ? "Peak window live" : "峰值窗口进行中";
      tone = "amber";
    }
    const note =
      locale === "en-US"
        ? `Primary peak window ${paceView.peakWindowText}.`
        : `核心峰值窗口 ${paceView.peakWindowText}。`;
    return {
      label: locale === "en-US" ? "Peak window" : "峰值窗口状态",
      note,
      status,
      tone,
      value: paceView.peakWindowText,
    };
  }, [detail.local_time, detail.peak?.first_h, detail.peak?.last_h, isToday, locale, paceView]);
  const networkLeadView = useMemo(() => {
    if (!isToday) return null;
    const delta = Number(detail.airport_vs_network_delta);
    const leadSignal = detail.network_lead_signal;
    if (!Number.isFinite(delta)) return null;
    const leaderLabel =
      String(leadSignal?.leader_station_label || "").trim() ||
      String(leadSignal?.leader_station_code || "").trim();
    const absDelta = Math.abs(delta);
    const status =
      delta <= -0.4
        ? locale === "en-US"
          ? "Airport trailing"
          : "机场落后"
        : delta >= 0.4
          ? locale === "en-US"
            ? "Airport leading"
            : "机场领先"
          : locale === "en-US"
            ? "Tracking network"
            : "与站网齐平";
    const tone =
      delta <= -0.4 ? "amber" : delta >= 0.4 ? "cyan" : "blue";
    const note =
      delta <= -0.4
        ? locale === "en-US"
          ? `Airport anchor is ${absDelta.toFixed(1)}${detail.temp_symbol} cooler than the nearby official network${leaderLabel ? `, led by ${leaderLabel}` : ""}.`
          : `机场主站当前比周边官方站网低 ${absDelta.toFixed(1)}${detail.temp_symbol}${leaderLabel ? `，领先点位是 ${leaderLabel}` : ""}。`
        : delta >= 0.4
          ? locale === "en-US"
            ? `Airport anchor is ${absDelta.toFixed(1)}${detail.temp_symbol} hotter than the nearby official network.`
            : `机场主站当前比周边官方站网高 ${absDelta.toFixed(1)}${detail.temp_symbol}。`
          : locale === "en-US"
            ? "Airport anchor and nearby official network are broadly aligned."
            : "机场主站与周边官方站网当前大体齐平。";
    return {
      label: locale === "en-US" ? "Airport vs network" : "机场 vs 周边站",
      note,
      status,
      tone,
      value: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${detail.temp_symbol}`,
    };
  }, [detail.airport_vs_network_delta, detail.network_lead_signal, detail.temp_symbol, isToday, locale]);
  const isNoaaSettlement =
    detail.current?.settlement_source === "noaa" ||
    detail.current?.settlement_source_label === "NOAA";
  const noaaStationCode = String(
    detail.current?.station_code || detail.risk?.icao || "NOAA",
  )
    .trim()
    .toUpperCase();
  const noaaStationName =
    String(detail.current?.station_name || "").trim() ||
    String(detail.risk?.airport || "").trim() ||
    noaaStationCode;
  const topBucket = Array.isArray(marketScan?.top_buckets)
    ? [...marketScan.top_buckets]
        .map((item) => ({
          ...item,
          probability: normalizeMarketValue(item?.probability),
        }))
        .filter(
          (
            item,
          ): item is {
            label?: string | null;
            bucket?: string | null;
            range?: string | null;
            value?: number | null;
            temp?: number | null;
            probability: number;
          } => item.probability != null,
        )
        .sort((a, b) => b.probability - a.probability)[0]
    : null;
  const hottestBucketLabel = formatBucketLabel(topBucket);
  const probabilitySummary = (() => {
    if (!topProbabilityBucket) {
      return locale === "en-US"
        ? "Probability mass is still too dispersed; avoid over-reading a single bracket."
        : "当前概率还比较分散，不要只盯单一区间。";
    }
    const bucketLabel = formatBucketLabel(topProbabilityBucket);
    const bucketProb = formatMarketPercent(topProbabilityBucket.probability);
    return locale === "en-US"
      ? `Highest current hit probability is ${bucketLabel} at ${bucketProb}. Treat this as the base case, not the final settlement.`
      : `当前命中概率最高的是 ${bucketLabel}（${bucketProb}），可把它当作基准情形，但不要直接等同于最终结算。`;
  })();
  const modelSummary = (() => {
    if (!modelSpreadView) {
      return locale === "en-US"
        ? "Model spread is unavailable right now."
        : "当前拿不到可用的模型分歧。";
    }
    const modelEntries = Object.entries(modelView?.models || {}).filter(
      ([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)),
    );
    if (modelEntries.length === 1) {
      const [singleModelName, singleModelValue] = modelEntries[0];
      return locale === "en-US"
        ? `Only ${singleModelName} is available right now at ${Number(singleModelValue).toFixed(1)}${detail.temp_symbol}; multi-model spread is temporarily unavailable.`
        : `当前只收到 ${singleModelName} ${Number(singleModelValue).toFixed(1)}${detail.temp_symbol}，其他多模型暂未回传，所以这里先不判断模型分歧。`;
    }
    return locale === "en-US"
      ? `Model range runs from ${modelSpreadView.min.toFixed(1)}${detail.temp_symbol} to ${modelSpreadView.max.toFixed(1)}${detail.temp_symbol}; spread ${modelSpreadView.spread.toFixed(1)}${detail.temp_symbol}.`
      : `当前模型区间在 ${modelSpreadView.min.toFixed(1)}${detail.temp_symbol} 到 ${modelSpreadView.max.toFixed(1)}${detail.temp_symbol}，分歧 ${modelSpreadView.spread.toFixed(1)}${detail.temp_symbol}。`;
  })();
  const upperAirSignal = detail.vertical_profile_signal || {};
  const tafSignal = detail.taf?.signal || {};
  const topBucketProbability = normalizeMarketValue(topBucket?.probability);
  const numericEdge = Number(marketScan?.edge_percent);
  const hottestMatchesSettlement =
    hottestBucketLabel !== "--" &&
    formatBucketLabel(marketScan?.temperature_bucket) !== "--" &&
    hottestBucketLabel === formatBucketLabel(marketScan?.temperature_bucket);
  const marketAwareUpperAirCue = useMemo(() => {
    if (!isToday || (!upperAirSignal.source && !tafSignal.available)) return null;

    const crowded = hottestMatchesSettlement && (topBucketProbability || 0) >= 0.3;
    const setup = String(upperAirSignal.heating_setup || "neutral").toLowerCase();
    const tafSuppression = String(
      tafSignal.suppression_level || "low",
    ).toLowerCase();
    const tafDisruption = String(
      tafSignal.disruption_level || "low",
    ).toLowerCase();
    const signalLabel = String(marketScan?.signal_label || "").toUpperCase();
    const edgeAbs = Number.isFinite(numericEdge) ? Math.abs(numericEdge) : 0;
    const strongEdge = edgeAbs >= 8;
    const reasons: string[] = [];
    let score = 0;

    if (setup === "supportive") {
      score += 2;
      reasons.push(
        locale === "en-US"
          ? "upper-air structure still supports daytime heating"
          : "高空结构仍偏支持白天冲高",
      );
    } else if (setup === "suppressed") {
      score -= 2;
      reasons.push(
        locale === "en-US"
          ? "upper-air structure still leans toward capping the peak"
          : "高空结构更偏向压住峰值",
      );
    }

    if (tafSuppression === "high") {
      score -= 2;
      reasons.push(
        locale === "en-US"
          ? "TAF flags meaningful cloud/rain suppression near the peak window"
          : "TAF 在峰值窗口提示云雨压温风险偏高",
      );
    } else if (tafSuppression === "medium") {
      score -= 1;
      reasons.push(
        locale === "en-US"
          ? "TAF keeps some cloud/rain suppression risk on the table"
          : "TAF 仍提示一定的云雨压温风险",
      );
    }

    if (tafDisruption === "high") {
      score -= 1;
      reasons.push(
        locale === "en-US"
          ? "TAF also suggests a noisier afternoon regime"
          : "TAF 还提示午后扰动偏强",
      );
    } else if (tafDisruption === "medium") {
      score -= 0.5;
      reasons.push(
        locale === "en-US"
          ? "TAF keeps some afternoon timing noise in play"
          : "TAF 提示午后仍可能有时段性扰动",
      );
    }

    if (strongEdge && signalLabel === "BUY YES") {
      score += 1;
      reasons.push(
        locale === "en-US"
          ? `market edge still leans hotter (${formatSignedPercent(numericEdge)})`
          : `市场 edge 仍偏向更热一侧（${formatSignedPercent(numericEdge)}）`,
      );
    } else if (strongEdge && signalLabel === "BUY NO") {
      score -= 1;
      reasons.push(
        locale === "en-US"
          ? `market edge still leans cooler (${formatSignedPercent(numericEdge)})`
          : `市场 edge 仍偏向更冷一侧（${formatSignedPercent(numericEdge)}）`,
      );
    }

    if (crowded && score > 0) {
      score -= 0.5;
      reasons.push(
        locale === "en-US"
          ? "the target bucket is already getting crowded"
          : "目标区间已经开始变拥挤",
      );
    }

    if (score >= 1.5) {
      return {
        summary:
          locale === "en-US"
            ? "The combined upper-air, TAF, and market read still leans warmer. Do not fade lower buckets too early."
            : "高空、TAF 和市场三层信号合并后仍偏暖侧，不宜过早做更低温区间。",
        note:
          locale === "en-US"
            ? `${reasons.slice(0, 2).join("; ")}.`
            : `${reasons.slice(0, 2).join("；")}。`,
        tone: "warm",
        value: locale === "en-US" ? "Lean warmer" : "偏暖侧",
      };
    }

    if (score <= -1.5) {
      return {
        summary:
          locale === "en-US"
            ? "The combined upper-air, TAF, and market read leans more defensive. Be more careful chasing higher buckets."
            : "高空、TAF 和市场三层信号合并后更偏防守，追更高温区间要更谨慎。",
        note:
          locale === "en-US"
            ? `${reasons.slice(0, 2).join("; ")}.`
            : `${reasons.slice(0, 2).join("；")}。`,
        tone: "cold",
        value: locale === "en-US" ? "Lean cautious" : "偏谨慎",
      };
    }

    return {
      summary:
        locale === "en-US"
          ? "The combined upper-air, TAF, and market read is mixed. Let surface structure and price action decide before taking a side."
          : "高空、TAF 和市场三层信号目前偏混合，先看近地面结构和盘口变化，不急着站边。",
      note:
        locale === "en-US"
          ? `${reasons.slice(0, 2).join("; ") || "No clean edge from the upper-air layer alone"}.`
          : `${reasons.slice(0, 2).join("；") || "单看高空层还没有干净的交易边"}。`,
      tone: "",
      value: locale === "en-US" ? "Wait / confirm" : "先观察",
    };
  }, [
    tafSignal.available,
    tafSignal.disruption_level,
    tafSignal.suppression_level,
    marketScan?.signal_label,
    hottestMatchesSettlement,
    isToday,
    locale,
    numericEdge,
    topBucketProbability,
    upperAirSignal.heating_setup,
    upperAirSignal.source,
  ]);
  const topObservedTemp =
    detail.current?.max_so_far != null
      ? detail.current.max_so_far
      : detail.current?.temp;
  const currentTempText =
    detail.current?.temp != null
      ? `${detail.current.temp}${detail.temp_symbol}`
      : "--";
  const daylightProgress = (() => {
    const now = parseClockMinutes(detail.current?.obs_time);
    const sunrise = parseClockMinutes(detail.forecast?.sunrise);
    const sunset = parseClockMinutes(detail.forecast?.sunset);
    if (now == null || sunrise == null || sunset == null || sunset <= sunrise) {
      return null;
    }
    const percent = clamp(((now - sunrise) / (sunset - sunrise)) * 100, 0, 100);
    const phase =
      now < sunrise ? "夜间" : now > sunset ? "已日落" : "白昼进行中";
    return {
      phase,
      percent,
    };
  })();
  const displayedUpperAirSummary =
    marketAwareUpperAirCue?.summary || view.front.upperAirSummary;
  const displayedUpperAirMetrics = (view.front.upperAirMetrics || []).map(
    (metric, index) =>
      index === 0 &&
      (metric.label === "Trade cue" || metric.label === "交易动作") &&
      marketAwareUpperAirCue
        ? {
            ...metric,
            note: marketAwareUpperAirCue.note,
            tone: marketAwareUpperAirCue.tone,
            value: marketAwareUpperAirCue.value,
          }
        : metric,
  );
  const localizedAiCommentaryLines = useMemo(() => {
    const commentary = detail.dynamic_commentary || {};
    const headline = String(
      locale === "en-US" ? commentary.headline_en || "" : commentary.headline_zh || "",
    ).trim();
    const bullets = (
      locale === "en-US" ? commentary.bullets_en : commentary.bullets_zh
    ) as string[] | null | undefined;
    const cleanedBullets = Array.isArray(bullets)
      ? bullets.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return [headline, ...cleanedBullets].filter(Boolean).slice(0, 3);
  }, [detail.dynamic_commentary, locale]);
  const todayTradeSummaryLines = useMemo(() => {
    if (!isToday) return [] as string[];
    if (localizedAiCommentaryLines.length > 0) {
      return localizedAiCommentaryLines;
    }
    const lines: string[] = [];
    if (paceView) {
      const headline =
        paceView.biasTone === "warm"
          ? locale === "en-US"
            ? `Pace is running hot by ${paceView.deltaText}; the day high still leans above the base curve.`
            : `节奏偏热 ${paceView.deltaText}，日高仍偏向落在基础曲线之上。`
          : paceView.biasTone === "cold"
            ? locale === "en-US"
              ? `Pace is trailing by ${paceView.deltaText}; chasing higher buckets needs caution.`
              : `节奏落后 ${paceView.deltaText}，继续追更高温区间要更谨慎。`
            : locale === "en-US"
              ? "Pace is still on curve; the next move depends on the peak-window push."
              : "节奏目前贴着曲线走，下一步主要看峰值窗口还有没有上冲。";
      lines.push(headline);
    }
    if (boundaryRiskView) {
      lines.push(
        locale === "en-US"
          ? `${boundaryRiskView.label}: ${boundaryRiskView.note}`
          : `${boundaryRiskView.label}：${boundaryRiskView.note}`,
      );
    }
    if (networkLeadView) {
      lines.push(
        locale === "en-US"
          ? `${networkLeadView.label}: ${networkLeadView.note}`
          : `${networkLeadView.label}：${networkLeadView.note}`,
      );
    }
    return lines.slice(0, 3);
  }, [boundaryRiskView, isToday, locale, localizedAiCommentaryLines, networkLeadView, paceView]);

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
      {isProLoading ? (
        <div
          className="modal-content large"
          style={{ padding: "40px", textAlign: "center" }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            {t("dashboard.loading")}
          </div>
        </div>
      ) : !isPro ? (
        <ProFeaturePaywall
          feature={isToday ? "today" : "future"}
          onClose={store.closeFutureModal}
        />
      ) : (
        <div className="modal-content large future-modal">
          <div className="modal-header">
            <h2
              id="future-modal-title"
              className="future-modal-title-with-actions"
            >
              <span>
                {isToday
                  ? t("future.todayTitle", {
                      city: detail.display_name.toUpperCase(),
                    })
                  : t("future.dateTitle", {
                      city: detail.display_name.toUpperCase(),
                      date: dateStr,
                    })}
              </span>
              <button
                className={clsx(
                  "future-refresh-btn",
                  store.loadingState.marketScan && "spinning",
                )}
                disabled={!isPro || isProLoading}
                onClick={() => {
                  if (isToday) {
                    void store.openTodayModal(true);
                    return;
                  }
                  store.openFutureModal(dateStr, true);
                }}
                title={
                  !isPro
                    ? locale === "en-US"
                      ? "Pro subscription required"
                      : "需要 Pro 订阅"
                    : locale === "en-US"
                      ? "Refresh Data"
                      : "刷新数据"
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={
                isToday ? t("future.closeTodayAria") : t("future.closeDateAria")
              }
              onClick={store.closeFutureModal}
            >
              ×
            </button>
          </div>
          <div className="modal-body future-modal-body">
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
                {locale === "en-US"
                  ? `${detail.display_name} now settles against NOAA ${noaaStationCode} (${noaaStationName}). The market uses the highest rounded whole-degree Celsius reading in the Temp column after the day is finalized.`
                  : `${detail.display_name} 当前按 NOAA ${noaaStationCode}（${noaaStationName}）结算。市场最终采用该日 Temp 列完成质控后的最高整度摄氏值，不按小数温度结算。`}
              </div>
            )}
            {isToday ? (
              <div className="future-v2-layout">
                <aside className="future-v2-left">
                  <section className="future-v2-card future-v2-hero-card">
                    <div className="future-v2-card-head">
                      <h3 className="future-v2-hero-title">
                        {locale === "en-US"
                          ? "Anchor Status"
                          : "锚点状态"}
                      </h3>
                      <div className="future-v2-card-kicker">
                        {locale === "en-US"
                          ? "Settlement anchor and current clock"
                          : "结算锚点与当前时钟"}
                      </div>
                    </div>
                    <div className="future-v2-hero-main">
                      <div className="future-v2-hero-temp">
                        {currentTempText}
                      </div>
                      <div className="future-v2-hero-divider" />
                      <div className="future-v2-hero-weather">
                        <span className="future-v2-hero-icon">
                          <WeatherIcon
                            emoji={weatherSummary.weatherIcon}
                            size={42}
                          />
                        </span>
                        <span>{weatherSummary.weatherText}</span>
                      </div>
                    </div>
                    <div className="future-v2-hero-obs">
                      @{detail.current?.obs_time || "--"}
                    </div>
                    {daylightProgress ? (
                      <div className="future-v2-daylight">
                        <div className="future-v2-daylight-head">
                          <span>
                            {locale === "en-US"
                              ? "Solar Window"
                              : "昼夜进度"}
                          </span>
                          <strong>
                            {locale === "en-US"
                              ? `${daylightProgress.phase} ${Math.round(daylightProgress.percent)}%`
                              : `${daylightProgress.phase} ${Math.round(daylightProgress.percent)}%`}
                          </strong>
                        </div>
                        <div
                          className="future-v2-daylight-bar"
                          style={
                            {
                              "--daylight-progress": `${daylightProgress.percent}%`,
                            } as CSSProperties & { "--daylight-progress": string }
                          }
                        />
                        <div className="future-v2-daylight-times">
                          <span>{detail.forecast?.sunrise || "--"}</span>
                          <span>{detail.forecast?.sunset || "--"}</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="future-v2-mini-grid">
                      <div className="future-v2-mini-item">
                        <span>
                          {locale === "en-US" ? "High so far" : "日内已见高点"}
                        </span>
                        <strong>
                          {topObservedTemp ?? "--"}
                          {detail.temp_symbol}
                        </strong>
                      </div>
                      <div className="future-v2-mini-item">
                        <span>
                          {locale === "en-US" ? "Anchor clock" : "锚点时钟"}
                        </span>
                        <strong>{detail.current?.obs_time || "--"}</strong>
                      </div>
                      <div className="future-v2-mini-item">
                        <span>
                          {locale === "en-US" ? "Sunrise" : "日出时间"}
                        </span>
                        <strong>{detail.forecast?.sunrise || "--"}</strong>
                      </div>
                      <div className="future-v2-mini-item">
                        <span>
                          {locale === "en-US" ? "Sunset" : "日落时间"}
                        </span>
                        <strong>
                          {detail.forecast?.sunset || "--"}
                        </strong>
                      </div>
                    </div>
                  </section>

                  {paceView ? (
                    <section className="future-v2-card future-v2-pace-card future-v2-focus-card">
                      <div className="future-v2-card-head">
                        <h4 className="future-v2-card-title">
                          {locale === "en-US" ? "Current Pace" : "当前节奏"}
                        </h4>
                        <div className="future-v2-card-kicker">
                          {locale === "en-US"
                            ? "Expected now vs airport anchor"
                            : "此刻应到 vs 机场锚点"}
                        </div>
                      </div>
                      <div className="future-v2-pace-head">
                        <span className="future-v2-pace-kicker">
                          {paceView.kicker}
                        </span>
                        <em
                          className={clsx(
                            "future-v2-signal-tag",
                            paceView.biasTone === "cold" && "cyan",
                            paceView.biasTone === "neutral" && "blue",
                            paceView.biasTone === "warm" && "amber",
                          )}
                        >
                          {paceView.badge}
                        </em>
                      </div>
                      <div
                        className={clsx(
                          "future-v2-pace-delta",
                          paceView.biasTone === "cold" && "cold",
                          paceView.biasTone === "neutral" && "neutral",
                          paceView.biasTone === "warm" && "warm",
                        )}
                      >
                        {paceView.deltaText}
                      </div>
                      <div className="future-v2-pace-summary">
                        {paceView.summary}
                      </div>
                      <div className="future-v2-pace-meter">
                        <span className="future-v2-pace-meter-midline" />
                        <span
                          className={clsx(
                            "future-v2-pace-meter-fill",
                            paceView.biasTone === "cold" && "cold",
                            paceView.biasTone === "neutral" && "neutral",
                            paceView.biasTone === "warm" && "warm",
                          )}
                          style={
                            {
                              "--pace-left": `${paceView.meterLeft}%`,
                              "--pace-width": `${paceView.meterWidth}%`,
                            } as CSSProperties & {
                              "--pace-left": string;
                              "--pace-width": string;
                            }
                          }
                        />
                      </div>
                      <div className="future-v2-mini-grid future-v2-mini-grid-tight">
                        <div className="future-v2-mini-item">
                          <span>
                            {locale === "en-US" ? "Expected now" : "预期此刻"}
                          </span>
                          <strong>
                            {paceView.expectedNow.toFixed(1)}
                            {detail.temp_symbol}
                          </strong>
                        </div>
                        <div className="future-v2-mini-item">
                          <span>{paceView.observedLabel}</span>
                          <strong>
                            {paceView.observedNow.toFixed(1)}
                            {detail.temp_symbol}
                          </strong>
                        </div>
                        <div className="future-v2-mini-item">
                          <span>{paceView.paceAdjustedLabel}</span>
                          <strong>
                            {paceView.paceAdjustedHigh != null
                              ? `${paceView.paceAdjustedHigh.toFixed(1)}${detail.temp_symbol}`
                              : "--"}
                          </strong>
                        </div>
                        <div className="future-v2-mini-item">
                          <span>
                            {locale === "en-US" ? "Peak window" : "峰值窗口"}
                          </span>
                          <strong>{paceView.peakWindowText}</strong>
                        </div>
                      </div>
                      <div className="future-v2-pace-signal-grid">
                        {[boundaryRiskView, peakWindowStateView, networkLeadView]
                          .filter((item) => item != null)
                          .map((item) => (
                            <div key={item.label} className="future-v2-pace-signal-card">
                              <div className="future-v2-signal-head">
                                <span>{item.label}</span>
                                <em
                                  className={clsx(
                                    "future-v2-signal-tag",
                                    item.tone === "cyan" && "cyan",
                                    item.tone === "blue" && "blue",
                                    item.tone === "amber" && "amber",
                                  )}
                                >
                                  {item.status}
                                </em>
                              </div>
                              <strong>{item.value}</strong>
                              <div className="future-v2-pace-signal-note">
                                {item.note}
                              </div>
                            </div>
                          ))}
                      </div>
                    </section>
                  ) : null}

                </aside>

                <main className="future-v2-right">
                  <section className="future-modal-section future-v2-main-chart">
                    <h3>
                      {locale === "en-US"
                        ? "Today's temperature forecast (obs + market)"
                        : "今日气温预测（观测 + 市场）"}
                    </h3>
                    <DailyTemperatureChart dateStr={dateStr} />
                  </section>

                  <div className="future-modal-grid">
                    <section className="future-modal-section">
                      <h3>
                        {locale === "en-US" ? "Current Hit Odds" : "当前命中胜率"}
                      </h3>
                      <div className="future-text-block" style={{ marginBottom: "12px" }}>
                        {probabilitySummary}
                      </div>
                      <div style={{ position: "relative", minHeight: "120px" }}>
                        {/* Loading Overlay */}
                        {store.loadingState.marketScan && (
                          <div className="market-layer-loading-overlay">
                            <div
                              className="loading-spinner"
                              style={{
                                marginBottom: "8px",
                                width: "24px",
                                height: "24px",
                                borderWidth: "2px",
                              }}
                            />
                            {locale === "en-US"
                              ? "Crunching Polymarket Edges..."
                              : "正在同步市场挂单..."}
                          </div>
                        )}
                        <ProbabilityDistribution
                          detail={detail}
                          targetDate={dateStr}
                          hideTitle
                          marketScan={marketScan}
                        />
                      </div>
                    </section>
                    <section className="future-modal-section">
                      <h3>
                        {locale === "en-US" ? "Model Range & Spread" : "模型区间与分歧"}
                      </h3>
                      <div className="future-text-block" style={{ marginBottom: "12px" }}>
                        {modelSummary}
                      </div>
                      <ModelForecast
                        detail={detail}
                        targetDate={dateStr}
                        hideTitle
                      />
                    </section>
                  </div>

                  <section className="future-modal-section">
                    <h3>{t("future.structureToday")}</h3>
                    <div className="future-front-score">
                      <div className="future-front-bar" style={barStyle}>
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: "50%",
                            width: "2px",
                            background: "rgba(255, 255, 255, 0.2)",
                            transform: "translateX(-50%)",
                            zIndex: 1,
                          }}
                        />
                      </div>
                    <div className="future-front-meta">
                      <span className="future-front-pill">
                        {t("future.judgement")}: {view.front.label}
                        </span>
                        <span className="future-front-pill">
                          {t("future.confidence")}:{" "}
                          {t(`confidence.${view.front.confidence}`)}
                        </span>
                        <span className="future-front-pill">
                          {t("future.maxPrecip")}:{" "}
                          {Math.round(view.front.precipMax)}%
                        </span>
                      </div>
                      {todayTradeSummaryLines.length > 0 ? (
                        <div className="future-trend-summary">
                          {todayTradeSummaryLines.map((line, index) => (
                            <div key={`${index}-${line}`}>{line}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="future-subsection-title">
                      {locale === "en-US" ? "Surface Structure" : "近地面信号"}
                    </div>
                    <div className="future-trend-grid">
                      {view.front.metrics.slice(0, 6).map((metric) => (
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
                          {getTrendMetricVisual(metric) ? (
                            <div
                              className={clsx(
                                "future-trend-meter",
                                getTrendMetricVisual(metric)?.mode === "center" &&
                                  "center",
                              )}
                            >
                              {getTrendMetricVisual(metric)?.mode === "center" ? (
                                <span className="future-trend-meter-midline" />
                              ) : null}
                              <div
                                className={clsx(
                                  "future-trend-meter-fill",
                                  getTrendMetricVisual(metric)?.tone === "warm" &&
                                    "warm",
                                  getTrendMetricVisual(metric)?.tone === "cold" &&
                                    "cold",
                                )}
                                style={{
                                  width: `${getTrendMetricVisual(metric)?.percent ?? 0}%`,
                                }}
                              />
                            </div>
                          ) : null}
                          <div className="future-trend-note">{metric.note}</div>
                        </div>
                      ))}
                    </div>
                    <>
                      <div className="future-subsection-title">
                        {locale === "en-US" ? "Upper-Air Structure" : "高空结构信号"}
                      </div>
                      {displayedUpperAirSummary ? (
                        <div className="future-trend-summary">
                          {displayedUpperAirSummary}
                        </div>
                      ) : (
                        <div className="future-trend-summary future-trend-summary-muted">
                          {locale === "en-US"
                            ? "Upper-air structure is temporarily unavailable for this city. For now, lean on surface structure and TAF timing."
                            : "该城市当前暂无可用的高空结构数据，先以近地面结构和 TAF 时段作为主判断。"}
                        </div>
                      )}
                      {displayedUpperAirMetrics.length > 0 ? (
                        <div className="future-trend-grid">
                          {displayedUpperAirMetrics.map((metric) => (
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
                              {getTrendMetricVisual(metric) ? (
                                <div
                                  className={clsx(
                                    "future-trend-meter",
                                    getTrendMetricVisual(metric)?.mode === "center" &&
                                      "center",
                                  )}
                                >
                                  {getTrendMetricVisual(metric)?.mode === "center" ? (
                                    <span className="future-trend-meter-midline" />
                                  ) : null}
                                  <div
                                    className={clsx(
                                      "future-trend-meter-fill",
                                      getTrendMetricVisual(metric)?.tone === "warm" &&
                                        "warm",
                                      getTrendMetricVisual(metric)?.tone === "cold" &&
                                        "cold",
                                    )}
                                    style={{
                                      width: `${getTrendMetricVisual(metric)?.percent ?? 0}%`,
                                    }}
                                  />
                                </div>
                              ) : null}
                              <div className="future-trend-note">{metric.note}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="future-trend-card future-trend-card-empty">
                          <div className="future-trend-label">
                            {locale === "en-US" ? "Upper-air source" : "高空数据源"}
                          </div>
                          <div className="future-trend-value">
                            {locale === "en-US" ? "Not available" : "暂不可用"}
                          </div>
                          <div className="future-trend-note">
                            {locale === "en-US"
                              ? "No upper-air diagnostic feed is attached to this city right now."
                              : "当前该城市未接入可用的高空诊断源，所以这里先保留说明卡片。"}
                          </div>
                        </div>
                      )}
                    </>
                  </section>
                </main>
              </div>
            ) : (
              <>
                <div className="history-stats">
                  <div className="h-stat-card">
                    <span className="label">{t("future.targetForecast")}</span>
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
                      {view.mu != null
                        ? `${view.mu.toFixed(1)}${detail.temp_symbol}`
                        : "--"}
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
                  <h3>{t("future.targetTempTrend")}</h3>
                  <DailyTemperatureChart dateStr={dateStr} />
                </section>

                <div className="future-modal-grid">
                  <section className="future-modal-section">
                    <h3>{t("future.probability")}</h3>
                    <ProbabilityDistribution
                      detail={detail}
                      targetDate={dateStr}
                      hideTitle
                      marketScan={marketScan}
                    />
                  </section>
                  <section className="future-modal-section">
                    <h3>{t("future.models")}</h3>
                    <ModelForecast
                      detail={detail}
                      targetDate={dateStr}
                      hideTitle
                    />
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
