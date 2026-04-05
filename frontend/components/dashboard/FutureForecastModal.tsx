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
import { IntradaySignalScene } from "@/components/dashboard/IntradaySignalScene";
import {
  ModelForecast,
  ProbabilityDistribution,
} from "@/components/dashboard/PanelSections";
import {
  getFutureModalView,
  getAirportNarrative,
  parseAiAnalysis,
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

function formatMarketPriceCents(value?: number | null) {
  const normalized = normalizeMarketValue(value);
  if (normalized == null) return "--";
  const cents = normalized * 100;
  const rounded = Math.round(cents * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}¢`;
}

function formatSignedPercent(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}%`;
}

function formatSpreadPercent(low?: number | null, high?: number | null) {
  const a = normalizeMarketValue(low);
  const b = normalizeMarketValue(high);
  if (a == null || b == null) return "--";
  const spreadCents = Math.abs((b - a) * 100);
  const rounded = Math.round(spreadCents * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}¢`;
}

function resolveCounterPrice(
  directValue?: number | null,
  mirrorValue?: number | null,
) {
  const direct = normalizeMarketValue(directValue);
  if (direct != null) return direct;
  const mirror = normalizeMarketValue(mirrorValue);
  if (mirror == null) return null;
  return Math.max(0, Math.min(1, 1 - mirror));
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

function parseMetarSignedInt(token: string) {
  if (!token) return null;
  const normalized = token.toUpperCase();
  if (!/^[M]?\d{2}$/.test(normalized)) return null;
  const value = Number(normalized.replace("M", ""));
  if (!Number.isFinite(value)) return null;
  return normalized.startsWith("M") ? -value : value;
}

function parseMetarTempDew(rawMetar?: string | null) {
  const text = String(rawMetar || "").toUpperCase();
  if (!text)
    return { tempC: null as number | null, dewC: null as number | null };
  const match = text.match(/\s(M?\d{2})\/(M?\d{2})(?:\s|$)/);
  if (!match)
    return { tempC: null as number | null, dewC: null as number | null };
  return {
    tempC: parseMetarSignedInt(match[1]),
    dewC: parseMetarSignedInt(match[2]),
  };
}

function estimateHumidityFromTempDew(
  tempC?: number | null,
  dewC?: number | null,
) {
  const t = Number(tempC);
  const d = Number(dewC);
  if (!Number.isFinite(t) || !Number.isFinite(d)) return null;
  const es = Math.exp((17.625 * t) / (243.04 + t));
  const ed = Math.exp((17.625 * d) / (243.04 + d));
  const rh = (ed / es) * 100;
  if (!Number.isFinite(rh)) return null;
  return Math.max(0, Math.min(100, rh));
}

function parseVisibilityText(
  rawMetar?: string | null,
  visibilityMi?: number | null,
) {
  const direct = Number(visibilityMi);
  if (Number.isFinite(direct)) {
    return `${direct} mi`;
  }

  const text = String(rawMetar || "").toUpperCase();
  if (!text) return "--";
  if (text.includes("CAVOK")) return ">=6 mi";

  const sm = text.match(/\s(\d{1,2}(?:\/\d)?)SM(?:\s|$)/);
  if (sm) {
    return `${sm[1]} mi`;
  }
  return "--";
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

function parseVisibilityMiles(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || text === "--") return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseLeadingNumber(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function getCurrentMetricDescriptor(
  kind: "humidity" | "dewpoint" | "wind" | "visibility",
  value: string,
  numeric: number | null,
  aux?: number | null,
) {
  if (kind === "humidity") {
    const percent = numeric != null ? clamp(numeric, 0, 100) : null;
    const hint =
      percent == null
        ? "--"
        : percent >= 75
          ? "偏湿"
          : percent >= 45
            ? "适中"
            : "偏干";
    const tone =
      percent == null ? "neutral" : percent >= 75 ? "cyan" : percent >= 45 ? "blue" : "amber";
    return { fill: percent, hint, tone, value };
  }

  if (kind === "dewpoint") {
    const spread = aux != null && numeric != null ? aux - numeric : null;
    const closeness =
      spread != null ? clamp(100 - spread * 12, 0, 100) : null;
    const hint =
      spread == null
        ? "--"
        : spread <= 2
          ? "近饱和"
          : spread <= 6
            ? "偏湿"
            : "偏干";
    const tone =
      spread == null ? "neutral" : spread <= 2 ? "cyan" : spread <= 6 ? "blue" : "amber";
    return { fill: closeness, hint, tone, value };
  }

  if (kind === "wind") {
    const percent = numeric != null ? clamp((numeric / 25) * 100, 0, 100) : null;
    const hint =
      numeric == null
        ? "--"
        : numeric >= 18
          ? "偏强"
          : numeric >= 8
            ? "中等"
            : "较弱";
    const tone =
      numeric == null ? "neutral" : numeric >= 18 ? "amber" : numeric >= 8 ? "blue" : "cyan";
    return { fill: percent, hint, tone, value };
  }

  const percent = numeric != null ? clamp((numeric / 10) * 100, 0, 100) : null;
  const hint =
    numeric == null
      ? "--"
      : numeric >= 6
        ? "通透"
        : numeric >= 3
          ? "一般"
          : "受限";
  const tone =
    numeric == null ? "neutral" : numeric >= 6 ? "cyan" : numeric >= 3 ? "blue" : "amber";
  return { fill: percent, hint, tone, value };
}

function getTrendMetricVisual(metric: {
  label?: string;
  value?: string;
  tone?: string;
}) {
  const label = String(metric.label || "").toLowerCase();
  const value = String(metric.value || "");
  const numeric = parseLeadingNumber(value);

  if (numeric == null) return null;

  if (label.includes("降水") || label.includes("precip")) {
    return {
      mode: "fill" as const,
      percent: clamp(numeric, 0, 100),
      tone: "cold" as const,
    };
  }

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
  const marketMidpoint = formatMarketPercent(
    marketScan?.market_price ?? marketScan?.yes_token?.implied_probability,
  );
  const modelProbability = formatMarketPercent(marketScan?.model_probability);
  const marketYesBuy = formatMarketPriceCents(marketScan?.yes_buy);
  const marketYesSell = formatMarketPriceCents(marketScan?.yes_sell);
  const marketNoBuy = formatMarketPriceCents(
    resolveCounterPrice(marketScan?.no_buy, marketScan?.yes_buy),
  );
  const marketNoSell = formatMarketPriceCents(
    resolveCounterPrice(marketScan?.no_sell, marketScan?.yes_sell),
  );
  const marketEdge = formatSignedPercent(marketScan?.edge_percent);
  const marketSpread = formatSpreadPercent(
    marketScan?.yes_buy,
    marketScan?.yes_sell,
  );
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
  const settlementBucketLabel = formatBucketLabel(
    marketScan?.temperature_bucket,
  );
  const hottestBucketLabel = formatBucketLabel(topBucket);
  const hottestBucketProb = formatMarketPercent(topBucket?.probability);
  const marketSignal = marketScan?.signal_label
    ? `${marketScan.signal_label}${
        marketScan.confidence ? ` / ${marketScan.confidence}` : ""
      }`
    : "--";
  const upperAirSignal = detail.vertical_profile_signal || {};
  const tafSignal = detail.taf?.signal || {};
  const topBucketProbability = normalizeMarketValue(topBucket?.probability);
  const numericEdge = Number(marketScan?.edge_percent);
  const hottestMatchesSettlement =
    hottestBucketLabel !== "--" &&
    settlementBucketLabel !== "--" &&
    hottestBucketLabel === settlementBucketLabel;
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
  const metarParsed = parseMetarTempDew(detail.current?.raw_metar);
  const fallbackDewpoint =
    detail.current?.dewpoint ??
    metarParsed.dewC ??
    (Array.isArray(detail.hourly_next_48h?.dew_point)
      ? detail.hourly_next_48h?.dew_point?.[0]
      : null);
  const fallbackHumidity =
    detail.current?.humidity ??
    estimateHumidityFromTempDew(
      detail.current?.temp ?? metarParsed.tempC,
      fallbackDewpoint,
    );
  const topObservedTemp =
    detail.current?.max_so_far != null
      ? detail.current.max_so_far
      : detail.current?.temp;
  const currentTempText =
    detail.current?.temp != null
      ? `${detail.current.temp}${detail.temp_symbol}`
      : "--";
  const humidityText =
    fallbackHumidity != null ? `${Math.round(fallbackHumidity)}%` : "--";
  const dewpointText =
    fallbackDewpoint != null
      ? `${fallbackDewpoint}${detail.temp_symbol}`
      : "--";
  const windText =
    detail.current?.wind_speed_kt != null
      ? `${detail.current.wind_speed_kt} kt`
      : "--";
  const visibilityText = parseVisibilityText(
    detail.current?.raw_metar,
    detail.current?.visibility_mi,
  );
  const humidityValue =
    fallbackHumidity != null ? Math.round(fallbackHumidity) : null;
  const windValue =
    detail.current?.wind_speed_kt != null
      ? Number(detail.current.wind_speed_kt)
      : null;
  const visibilityValue = parseVisibilityMiles(visibilityText);
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
  const currentMetricVisuals = [
    {
      key: "humidity",
      label: locale === "en-US" ? "Humidity" : "湿度",
      ...getCurrentMetricDescriptor("humidity", humidityText, humidityValue),
    },
    {
      key: "dewpoint",
      label: locale === "en-US" ? "Dew Point" : "露点",
      ...getCurrentMetricDescriptor(
        "dewpoint",
        dewpointText,
        fallbackDewpoint != null ? Number(fallbackDewpoint) : null,
        detail.current?.temp != null ? Number(detail.current.temp) : null,
      ),
    },
    {
      key: "wind",
      label: locale === "en-US" ? "Wind" : "风速",
      ...getCurrentMetricDescriptor("wind", windText, windValue),
    },
    {
      key: "visibility",
      label: locale === "en-US" ? "Visibility" : "能见度",
      ...getCurrentMetricDescriptor("visibility", visibilityText, visibilityValue),
    },
  ];
  const ai = getAirportNarrative(detail, locale);
  const risk = detail.risk || {};
  const settlementSourceCode = String(
    detail.current?.settlement_source || "",
  ).toLowerCase();
  const isOfficialSettlementSource =
    settlementSourceCode === "hko" ||
    settlementSourceCode === "cwa" ||
    settlementSourceCode === "noaa" ||
    settlementSourceCode === "wunderground";
  const settlementProfileLabel = isOfficialSettlementSource
    ? locale === "en-US"
      ? "Settlement station"
      : "结算站点"
    : t("section.airport");
  const settlementProfileValue =
    settlementSourceCode === "noaa"
      ? locale === "en-US"
        ? `${noaaStationName}${noaaStationCode ? ` (${noaaStationCode})` : ""}`
        : `${noaaStationName}${noaaStationCode ? `（${noaaStationCode}）` : ""}`
      : detail.current?.station_name
        ? `${detail.current.station_name}${
            detail.current?.station_code ? ` (${detail.current.station_code})` : ""
          }`
        : risk.airport
          ? `${risk.airport}${risk.icao ? ` (${risk.icao})` : ""}`
          : "--";
  const airportCurrentText =
    detail.airport_current?.temp != null
      ? `${detail.airport_current.temp}${detail.temp_symbol}${
          detail.airport_current?.obs_time
            ? ` @${detail.airport_current.obs_time}`
            : ""
        }`
      : "--";
  const airportMaxText =
    detail.airport_current?.max_so_far != null
      ? `${detail.airport_current.max_so_far}${detail.temp_symbol}${
          detail.airport_current?.max_temp_time
            ? ` @${detail.airport_current.max_temp_time}`
            : ""
        }`
      : "--";
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
                    <h3 className="future-v2-hero-title">
                      {locale === "en-US"
                        ? "Current Conditions"
                        : "实况与气象特征"}
                    </h3>
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
                          {locale === "en-US" ? "High So Far" : "目前最高温"}
                        </span>
                        <strong>
                          {topObservedTemp ?? "--"}
                          {detail.temp_symbol}
                        </strong>
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
                        <strong>{detail.forecast?.sunset || "--"}</strong>
                      </div>
                      <div className="future-v2-mini-item">
                        <span>
                          {locale === "en-US" ? "Sunshine" : "日照时长"}
                        </span>
                        <strong>
                          {detail.forecast?.sunshine_hours != null
                            ? `${detail.forecast.sunshine_hours}h`
                            : "--"}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="future-v2-card">
                    <h4 className="future-v2-card-title">
                      {locale === "en-US" ? "Current Metrics" : "当前指标"}
                    </h4>
                    <IntradaySignalScene
                      metrics={currentMetricVisuals}
                      score={view.front.score}
                    />
                    <div className="future-v2-mini-grid future-v2-mini-grid-tight">
                      {currentMetricVisuals.map((metric) => (
                        <div key={metric.key} className="future-v2-mini-item future-v2-signal-item">
                          <div className="future-v2-signal-head">
                            <span>{metric.label}</span>
                            <em
                              className={clsx(
                                "future-v2-signal-tag",
                                metric.tone === "cyan" && "cyan",
                                metric.tone === "blue" && "blue",
                                metric.tone === "amber" && "amber",
                              )}
                            >
                              {metric.hint}
                            </em>
                          </div>
                          <strong>{metric.value}</strong>
                          <div className="future-v2-signal-meter">
                            <div
                              className={clsx(
                                "future-v2-signal-fill",
                                metric.tone === "cyan" && "cyan",
                                metric.tone === "blue" && "blue",
                                metric.tone === "amber" && "amber",
                              )}
                              style={{
                                width:
                                  metric.fill != null ? `${metric.fill}%` : "18%",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="future-v2-card">
                    <h4 className="future-v2-card-title">
                      {locale === "en-US" ? "Market Alignment" : "市场对照"}
                    </h4>
                    <div className="future-v2-market-v3">
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
                            : "正在计算市场对手盘..."}
                        </div>
                      )}

                      {/* Layer 1: Target & Edge */}
                      <div className="market-layer-target">
                        <div className="market-target-header">
                          <span>
                            {locale === "en-US"
                              ? "Target Bucket:"
                              : "结算温度区间："}
                          </span>
                          <strong className="market-target-bucket">
                            {settlementBucketLabel}
                          </strong>
                        </div>
                      </div>

                      {/* Layer 3: Context */}
                      <div className="market-layer-context">
                        <div className="market-sub-title">
                          👀 {locale === "en-US" ? "Market Radar" : "情绪雷达"}
                        </div>
                        <div className="market-context-row">
                          <span>
                            {locale === "en-US"
                              ? "Top Volume Bucket:"
                              : "市场当前押注最热:"}
                          </span>
                          <strong>
                            {hottestBucketLabel}{" "}
                            {hottestBucketProb !== "--"
                              ? `(${hottestBucketProb})`
                              : ""}
                          </strong>
                        </div>
                      </div>
                    </div>
                    <div className="future-v2-market-signal mt-3">
                      {locale === "en-US" ? "Signal" : "信号"}:{" "}
                      <strong>{marketSignal}</strong>
                    </div>
                  </section>

                  <section className="future-v2-card">
                    <h4 className="future-v2-card-title">
                      {locale === "en-US"
                        ? "City Risk Profile & Airport Narrative"
                        : "城市风险档案与机场报文解读"}
                    </h4>
                    <div className="future-v2-stack">
                      <div className="future-v2-subpanel">
                        <h5 className="future-v2-subpanel-title">
                          {locale === "en-US" ? "City Risk Profile" : "城市风险档案"}
                        </h5>
                        <div className="risk-info" style={{ marginTop: "10px" }}>
                          {!risk.airport ? (
                            <span style={{ color: "var(--text-muted)" }}>
                              {t("section.noRiskProfile")}
                            </span>
                          ) : (
                            <>
                              <div className="risk-row">
                                <span className="risk-label">
                                  {settlementProfileLabel}
                                </span>
                                <span>{settlementProfileValue}</span>
                              </div>
                              <div className="risk-row">
                                <span className="risk-label">
                                  {t("section.distance")}
                                </span>
                                <span>{risk.distance_km ?? "--"}km</span>
                              </div>
                              {risk.warning ? (
                                <div className="risk-row">
                                  <span className="risk-label">
                                    {t("section.note")}
                                  </span>
                                  <span>{risk.warning}</span>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="future-v2-subpanel">
                        <h5 className="future-v2-subpanel-title">
                          {locale === "en-US" ? "Airport Narrative" : "机场报文解读"}
                        </h5>
                        <div className="ai-box" style={{ marginTop: "10px" }}>
                          {!ai.summary && ai.bullets.length === 0 ? (
                            <span className="ai-placeholder">
                              {t("future.noAi")}
                            </span>
                          ) : (
                            <>
                              {ai.summary ? (
                                <div className="ai-summary">{ai.summary}</div>
                              ) : null}
                              {ai.bullets.length > 0 ? (
                                <ul className="ai-list">
                                  {ai.bullets.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
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
                      <h3>{t("future.probability")}</h3>
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
                      <h3>{t("future.models")}</h3>
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
                      {view.front.summary ? (
                        <div className="future-trend-summary">
                          {Array.isArray(view.front.summaryLines) &&
                          view.front.summaryLines.length > 0
                            ? view.front.summaryLines.map((line, index) => (
                                <div key={`${index}-${line}`}>{line}</div>
                              ))
                            : view.front.summary}
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
