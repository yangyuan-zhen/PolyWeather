"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Dashboard.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { CitySidebar } from "@/components/dashboard/CitySidebar";
import { HeaderBar } from "@/components/dashboard/HeaderBar";
import type {
  CityDetail,
  CityListItem,
  CitySummary,
  RiskLevel,
} from "@/lib/dashboard-types";
import {
  getLocalizedAirportDisplay,
  getLocalizedCityDisplay,
} from "@/lib/dashboard-home-copy";
import {
  getTemperatureChartData,
  getWeatherSummary,
} from "@/lib/dashboard-utils";
import { normalizeObservationSourceLabel } from "@/lib/source-labels";
import { Expand, Thermometer, CloudRain, Wind } from "lucide-react";

const loadHistoryModal = () =>
  import("@/components/dashboard/HistoryModal").then(
    (module) => module.HistoryModal,
  );

const loadFutureForecastModal = () =>
  import("@/components/dashboard/FutureForecastModal").then(
    (module) => module.FutureForecastModal,
  );

const MapCanvas = dynamic(
  () =>
    import("@/components/dashboard/MapCanvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => <div className="map" aria-hidden="true" />,
  },
);

const HistoryModal = dynamic(
  loadHistoryModal,
  {
    ssr: false,
    loading: () => null,
  },
);

const FutureForecastModal = dynamic(
  loadFutureForecastModal,
  {
    ssr: false,
    loading: () => null,
  },
);

type CitySnapshot = {
  city: CityListItem;
  detail?: CityDetail | null;
  score: number;
  summary?: CitySummary | null;
  tradableOpportunity: boolean;
};

const RISK_SCORE: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function getRiskCopy(level: RiskLevel | undefined, locale: string) {
  if (level === "high") return locale === "en-US" ? "High variance" : "高波动";
  if (level === "medium") return locale === "en-US" ? "Watch list" : "重点观察";
  if (level === "low") return locale === "en-US" ? "Stable" : "低波动";
  return locale === "en-US" ? "Unrated" : "待评级";
}

function getTempSymbol(
  city: CityListItem,
  summary?: CitySummary | null,
  detail?: CityDetail | null,
) {
  if (summary?.temp_symbol) return summary.temp_symbol;
  if (detail?.temp_symbol) return detail.temp_symbol;
  return city.temp_unit === "fahrenheit" ? "°F" : "°C";
}

function formatTemperature(value: number | null | undefined, symbol: string) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value))}${symbol}`;
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDelta(
  current: number | null | undefined,
  forecast: number | null | undefined,
  symbol: string,
) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(forecast))) {
    return "--";
  }
  const delta = Number(current) - Number(forecast);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}${symbol}`;
}

function buildSnapshot(
  city: CityListItem,
  summary?: CitySummary | null,
  detail?: CityDetail | null,
): CitySnapshot {
  const tier =
    city.deb_recent_tier ||
    city.risk_level ||
    summary?.risk?.level ||
    detail?.risk?.level;
  const hitRate = Number(city.deb_recent_hit_rate ?? 0);
  const sampleCount = Number(city.deb_recent_sample_count ?? 0);
  const edgePercent = Number(getMarketEdgeValue(detail));
  const normalizedEdge =
    Number.isFinite(edgePercent) && Math.abs(edgePercent) <= 1
      ? edgePercent * 100
      : edgePercent;
  const tradableOpportunity = isTradableMarketOpportunity(detail);
  const score =
    (detail?.market_scan && !tradableOpportunity ? -10_000 : 0) +
    (tradableOpportunity && Number.isFinite(normalizedEdge)
      ? 1000 + normalizedEdge * 10
      : 0) +
    (RISK_SCORE[String(tier || "")] || 0) * 100 +
    hitRate * 100 +
    Math.min(sampleCount, 60) / 10;
  return { city, detail, score, summary, tradableOpportunity };
}

function getProbabilityLabel(
  bucket: { label?: string | null; value?: number | null; bucket?: string | null },
  symbol: string,
) {
  if (bucket.label) return bucket.label;
  if (bucket.bucket) return bucket.bucket;
  if (Number.isFinite(Number(bucket.value))) {
    return `≥ ${Math.round(Number(bucket.value))}${symbol}`;
  }
  return "--";
}

function formatProbability(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized = Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

function formatCents(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized = Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}¢`;
}

function formatEdge(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized = Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(1)}%`;
}

function getModelLabels(detail?: CityDetail | null) {
  const date = detail?.local_date || "";
  const dailyModels = date ? detail?.multi_model_daily?.[date]?.models : null;
  const modelMap = dailyModels || detail?.multi_model || {};
  const labels = Object.keys(modelMap)
    .filter((key) => Number.isFinite(Number(modelMap[key])))
    .map((key) =>
      key
        .replace(/^open_meteo_/i, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    );
  return ["DEB", ...labels].slice(0, 6);
}

function buildSparklinePoints(values: number[] | undefined) {
  if (!values?.length) return "";
  const width = 92;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

type HomeWeatherIconKind =
  | "clear"
  | "partly"
  | "cloudy"
  | "rain"
  | "storm"
  | "mist"
  | "wind";

type HomeTrendChart = {
  forecastPath: string;
  legendText: string;
  observationDots: Array<{ cx: number; cy: number; key: string }>;
  hoverPoints: Array<{
    cx: number;
    cy: number;
    key: string;
    label: string;
    temperatureText: string;
  }>;
};

type HomeForecastDay = {
  key: string;
  label: string;
  maxTemp: number;
};

type HomeSummaryMetric = {
  key: string;
  label: string;
  value: string;
  accent?: "green" | "amber" | "red" | "cyan";
};

function buildDashboardSummaryMetrics(
  snapshots: CitySnapshot[],
  locale: string,
): HomeSummaryMetric[] {
  const topTradable = snapshots.filter((snapshot) => snapshot.tradableOpportunity);
  const highCount = snapshots.filter((snapshot) => snapshot.city.deb_recent_tier === "high").length;
  const mediumCount = snapshots.filter((snapshot) => snapshot.city.deb_recent_tier === "medium").length;
  const lowCount = snapshots.filter((snapshot) => snapshot.city.deb_recent_tier === "low").length;
  const avgEdge = topTradable.length
    ? topTradable.reduce((sum, snapshot) => {
        const edgeValue = Number(getMarketEdgeValue(snapshot.detail));
        const normalized =
          Number.isFinite(edgeValue) && Math.abs(edgeValue) <= 1
            ? edgeValue * 100
            : edgeValue;
        return sum + (Number.isFinite(normalized) ? normalized : 0);
      }, 0) / topTradable.length
    : 0;

  return [
    {
      key: "high",
      label: locale === "en-US" ? "High risk" : "高风险",
      value: String(highCount),
      accent: "red",
    },
    {
      key: "medium",
      label: locale === "en-US" ? "Medium risk" : "中风险",
      value: String(mediumCount),
      accent: "amber",
    },
    {
      key: "low",
      label: locale === "en-US" ? "Low risk" : "低风险",
      value: String(lowCount),
      accent: "green",
    },
    {
      key: "edge",
      label: locale === "en-US" ? "Avg. edge" : "平均优势",
      value: formatEdge(avgEdge),
      accent: "cyan",
    },
  ];
}

function HomeMapToolbar() {
  const { locale } = useI18n();
  return (
    <div className="home-map-toolbar" aria-label={locale === "en-US" ? "Map layer controls" : "地图图层控件"}>
      <div className="home-map-modes">
        <button type="button" className="active">
          <Thermometer size={14} strokeWidth={2} />
          <span>{locale === "en-US" ? "Temperature" : "温度"}</span>
        </button>
        <button type="button">
          <CloudRain size={14} strokeWidth={2} />
          <span>{locale === "en-US" ? "Precipitation" : "降水"}</span>
        </button>
        <button type="button">
          <Wind size={14} strokeWidth={2} />
          <span>{locale === "en-US" ? "Wind" : "风场"}</span>
        </button>
      </div>
      <button
        type="button"
        className="home-map-expand"
        aria-label={locale === "en-US" ? "Expand map" : "放大地图"}
      >
        <Expand size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

function projectHomeTrendPoint(
  x: number,
  y: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
) {
  const width = 296;
  const height = 78;
  const left = 10;
  const right = 10;
  const top = 8;
  const bottom = 12;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const normalizedX =
    xMax === xMin ? 0.5 : Math.min(1, Math.max(0, (x - xMin) / (xMax - xMin)));
  const normalizedY =
    yMax === yMin ? 0.5 : Math.min(1, Math.max(0, (y - yMin) / (yMax - yMin)));
  return {
    cx: Number((left + normalizedX * plotWidth).toFixed(1)),
    cy: Number((top + (1 - normalizedY) * plotHeight).toFixed(1)),
  };
}

function getHomeWeatherIconKind(detail?: CityDetail | null, locale = "zh-CN"): HomeWeatherIconKind {
  if (!detail) return "cloudy";
  const summary = getWeatherSummary(detail, locale === "en-US" ? "en-US" : "zh-CN");
  const weatherText = `${summary.weatherIcon} ${summary.weatherText} ${detail.current?.wx_desc || ""} ${detail.current?.cloud_desc || ""}`.toLowerCase();
  const cloudCover = Number(detail.hourly_next_48h?.cloud_cover?.[0]);
  const windSpeed = Number(detail.current?.wind_speed_kt ?? detail.airport_current?.wind_speed_kt);

  if (/⛈|雷|storm|thunder/.test(weatherText)) return "storm";
  if (/🌧|🌦|雨|drizzle|shower|rain/.test(weatherText)) return "rain";
  if (/🌫|雾|mist|fog|haze/.test(weatherText)) return "mist";
  if (/💨|飑|squall/.test(weatherText) || windSpeed >= 22) return "wind";
  if (/☀|晴|clear|sunny/.test(weatherText)) return "clear";
  if (/🌤|⛅|partly|few|scattered|少云|散云/.test(weatherText)) return "partly";
  if (/☁|云|cloud|overcast|阴/.test(weatherText)) return "cloudy";
  if (Number.isFinite(cloudCover) && cloudCover <= 15) return "clear";
  if (Number.isFinite(cloudCover) && cloudCover <= 55) return "partly";
  return "cloudy";
}

function buildHomeTrendChart(
  detail?: CityDetail | null,
  locale = "zh-CN",
): HomeTrendChart | null {
  if (!detail) return null;
  const chartData = getTemperatureChartData(detail, locale === "en-US" ? "en-US" : "zh-CN");
  if (!chartData) return null;
  const forecastSeries = chartData.datasets.hasMgmHourly
    ? chartData.datasets.mgmHourlySeries
    : [...chartData.datasets.debPastSeries, ...chartData.datasets.debFutureSeries];
  const observationSeries =
    chartData.datasets.metarSeries.length > 0
      ? chartData.datasets.metarSeries
      : chartData.datasets.airportMetarSeries;
  if (!forecastSeries.length && !observationSeries.length) return null;

  const forecastPath = forecastSeries
    .map((point) => {
      const projected = projectHomeTrendPoint(
        point.x,
        point.y,
        chartData.xMin,
        chartData.xMax,
        chartData.min,
        chartData.max,
      );
      return `${projected.cx},${projected.cy}`;
    })
    .join(" ");
  const observationDots = observationSeries.map((point, index) => {
    const projected = projectHomeTrendPoint(
      point.x,
      point.y,
      chartData.xMin,
      chartData.xMax,
      chartData.min,
      chartData.max,
    );
    return {
      cx: projected.cx,
      cy: projected.cy,
      key: `${point.labelTime}-${index}`,
    };
  });
  const hoverSource = observationSeries.length > 0 ? observationSeries : forecastSeries;
  const hoverPoints = hoverSource.map((point, index) => {
    const projected = projectHomeTrendPoint(
      point.x,
      point.y,
      chartData.xMin,
      chartData.xMax,
      chartData.min,
      chartData.max,
    );
    return {
      cx: projected.cx,
      cy: projected.cy,
      key: `hover-${point.labelTime}-${index}`,
      label: point.labelTime,
      temperatureText: formatTemperature(point.y, detail.temp_symbol || "°C"),
    };
  });

  return {
    forecastPath,
    legendText: chartData.legendText,
    observationDots,
    hoverPoints,
  };
}

function buildHomeForecastDays(
  detail?: CityDetail | null,
  locale = "zh-CN",
): HomeForecastDay[] {
  if (!detail) return [];
  const todayLabel = locale === "en-US" ? "Today" : "今天";
  const tomorrowLabel = locale === "en-US" ? "Tomorrow" : "明天";
  const formatter = new Intl.DateTimeFormat(locale === "en-US" ? "en-US" : "zh-CN", {
    day: "2-digit",
    month: "2-digit",
  });
  const rows = Array.isArray(detail.forecast?.daily) ? detail.forecast.daily : [];
  const byDate = new Map<string, number>();

  if (detail.local_date && Number.isFinite(Number(detail.forecast?.today_high))) {
    byDate.set(detail.local_date, Number(detail.forecast?.today_high));
  }
  rows.forEach((row) => {
    if (!row?.date || !Number.isFinite(Number(row.max_temp))) return;
    if (!byDate.has(row.date)) {
      byDate.set(row.date, Number(row.max_temp));
    }
  });

  return [...byDate.entries()].slice(0, 4).map(([date, maxTemp], index) => {
    const parsed = new Date(`${date}T00:00:00`);
    const label =
      index === 0
        ? todayLabel
        : index === 1
          ? tomorrowLabel
          : Number.isNaN(parsed.getTime())
            ? date
            : formatter.format(parsed);
    return {
      key: date,
      label,
      maxTemp,
    };
  });
}

function readNumericField(source: unknown, key: string) {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePercentValue(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function isBoundaryMarketPrice(value: number | null | undefined) {
  const percent = normalizePercentValue(value);
  return percent != null && (percent <= 2 || percent >= 98);
}

function getMarketEdgeValue(detail?: CityDetail | null) {
  const marketScan = detail?.market_scan;
  return (
    marketScan?.edge_percent ??
    marketScan?.price_analysis?.yes?.edge_percent ??
    marketScan?.price_analysis?.yes?.edge ??
    marketScan?.price_analysis?.no?.edge_percent ??
    marketScan?.price_analysis?.no?.edge
  );
}

function isTradableMarketOpportunity(detail?: CityDetail | null) {
  const marketScan = detail?.market_scan;
  if (!marketScan) return false;
  if (marketScan.available === false) return false;
  if (marketScan.primary_market?.closed === true) return false;
  if (marketScan.primary_market?.active === false) return false;

  const selectedDate = marketScan.selected_date;
  const localDate = detail?.local_date;
  if (selectedDate && localDate && selectedDate < localDate) return false;

  const endDateMs = marketScan.primary_market?.end_date
    ? Date.parse(marketScan.primary_market.end_date)
    : Number.NaN;
  if (Number.isFinite(endDateMs) && endDateMs < Date.now()) return false;

  const marketBucket = marketScan.temperature_bucket || marketScan.top_buckets?.[0] || null;
  const yesPrice =
    marketScan.yes_buy ??
    readNumericField(marketBucket, "yes_buy") ??
    marketScan.yes_token?.buy_price ??
    marketScan.yes_token?.midpoint ??
    marketScan.price_analysis?.yes?.ask;
  const noPrice =
    marketScan.no_buy ??
    readNumericField(marketBucket, "no_buy") ??
    marketScan.no_token?.buy_price ??
    marketScan.no_token?.midpoint ??
    marketScan.price_analysis?.no?.ask;
  const marketPrice =
    marketScan.market_price ??
    readNumericField(marketBucket, "market_price") ??
    yesPrice;

  if (isBoundaryMarketPrice(yesPrice) || isBoundaryMarketPrice(noPrice)) {
    return false;
  }
  if (isBoundaryMarketPrice(marketPrice)) return false;
  return Number.isFinite(Number(getMarketEdgeValue(detail)));
}

function HomeIntelligencePanel({ snapshots }: { snapshots: CitySnapshot[] }) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState<{
    cx: number;
    cy: number;
    key: string;
    label: string;
    temperatureText: string;
  } | null>(null);
  const spotlight = useMemo(
    () =>
      store.selectedCity
        ? snapshots.find((snapshot) => snapshot.city.name === store.selectedCity) || null
        : null,
    [snapshots, store.selectedCity],
  );
  const spotlightView = useMemo(() => {
    if (!spotlight) return null;

    const { city, detail, summary } = spotlight;
    const symbol = getTempSymbol(city, summary, detail);
    const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
    const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
    const maxSoFar = detail?.current?.max_so_far ?? detail?.airport_current?.max_so_far;
    const maxTime =
      detail?.current?.max_temp_time || detail?.airport_current?.max_temp_time || "--";
    const localTime = summary?.local_time || detail?.local_time || "--";
    const riskLevel =
      city.deb_recent_tier ||
      city.risk_level ||
      summary?.risk?.level ||
      detail?.risk?.level;
    const deviation = summary?.deviation_monitor || detail?.deviation_monitor;
    const observationSource = normalizeObservationSourceLabel(
      summary?.current?.settlement_source_label ||
        detail?.current?.settlement_source_label ||
        city.settlement_source_label,
      "METAR",
    );
    const probabilityBuckets =
      detail?.probabilities?.distribution ||
      (detail?.local_date
        ? detail?.multi_model_daily?.[detail.local_date]?.probabilities
        : undefined) ||
      [];
    const displayedProbabilities = probabilityBuckets.slice(0, 5);
    const modelLabels = getModelLabels(detail);
    const marketScan = detail?.market_scan;
    const marketBucket =
      marketScan?.temperature_bucket || marketScan?.top_buckets?.[0] || null;
    const yesPrice =
      marketScan?.yes_buy ??
      readNumericField(marketBucket, "yes_buy") ??
      marketScan?.yes_token?.buy_price ??
      marketScan?.yes_token?.midpoint ??
      marketScan?.price_analysis?.yes?.ask;
    const noPrice =
      marketScan?.no_buy ??
      readNumericField(marketBucket, "no_buy") ??
      marketScan?.no_token?.buy_price ??
      marketScan?.no_token?.midpoint ??
      marketScan?.price_analysis?.no?.ask;
    const marketEdge =
      marketScan?.edge_percent ??
      marketScan?.price_analysis?.yes?.edge_percent ??
      marketScan?.price_analysis?.yes?.edge ??
      marketScan?.price_analysis?.no?.edge_percent ??
      marketScan?.price_analysis?.no?.edge;

    return {
      city,
      detail,
      tradableOpportunity: spotlight.tradableOpportunity,
      symbol,
      currentTemp,
      debPrediction,
      maxSoFar,
      maxTime,
      localTime,
      riskLevel,
      observationSource,
      displayedProbabilities,
      modelLabels,
      marketScan,
      showOpportunityLabel: !marketScan || spotlight.tradableOpportunity,
      marketLabel: marketBucket
        ? getProbabilityLabel(marketBucket, symbol)
        : debPrediction != null
          ? `> ${formatTemperature(debPrediction, symbol)}`
          : "--",
      yesPrice,
      noPrice,
      marketEdge,
      marketProbability:
        marketScan?.market_price ??
        readNumericField(marketBucket, "market_price") ??
        readNumericField(marketBucket, "yes_buy") ??
        yesPrice ??
        marketScan?.model_probability,
      marketModelProbability: marketScan?.model_probability ?? marketBucket?.probability,
      sparklinePoints: buildSparklinePoints(marketScan?.sparkline),
      isLoading: store.loadingState.cityDetail && store.selectedCity === city.name,
      isPro: store.proAccess.subscriptionActive,
      cityCode: city.icao || detail?.risk?.icao || city.airport,
      localizedCityName: getLocalizedCityDisplay(city, locale, summary, detail),
      localizedAirportName: getLocalizedAirportDisplay(city, locale, detail),
      highRiskLabel:
        riskLevel === "high"
          ? locale === "en-US"
            ? "High risk"
            : "高风险"
          : getRiskCopy(riskLevel, locale),
      weatherIconKind: getHomeWeatherIconKind(detail, locale),
      trendChart: buildHomeTrendChart(detail, locale),
      debLabel: locale === "en-US" ? "DEB forecast" : "DEB 预测",
      dayMaxLabel: locale === "en-US" ? "24h max" : "24 小时最高",
      probabilityTitle: locale === "en-US" ? "EMOS probability" : "EMOS 概率",
      marketTitle: locale === "en-US" ? "Market edge" : "市场优势",
      marketEdgeLabel: locale === "en-US" ? "Edge" : "优势",
      marketImpliedLabel: locale === "en-US" ? "Implied" : "市场隐含",
      marketModelLabel: locale === "en-US" ? "Model prob" : "模型概率",
      proLabel:
        store.proAccess.subscriptionActive
          ? locale === "en-US"
            ? "Pro signal"
            : "PRO 信号"
          : locale === "en-US"
            ? "Pro locked"
            : "PRO 锁定",
      forecastDays: buildHomeForecastDays(detail, locale),
      keySignals: [
        {
          active: Number(marketEdge) > 0,
          label:
            locale === "en-US"
              ? "DEB > Market implied"
              : "DEB 高于市场隐含",
          tone: "green",
        },
        {
          active: deviation?.trend === "expanding" || deviation?.direction === "hot",
          label: locale === "en-US" ? "Rising temps trend" : "升温趋势",
          tone: "green",
        },
        {
          active: Boolean(detail?.peak?.hours?.length),
          label:
            detail?.peak?.hours?.length
              ? `${locale === "en-US" ? "High impact window" : "高影响窗口"} ${detail.peak.hours[0]}-${detail.peak.hours[detail.peak.hours.length - 1]}`
              : locale === "en-US"
                ? "High impact window pending"
                : "高影响窗口待确认",
          tone: "amber",
        },
      ],
    };
  }, [
    locale,
    spotlight,
    store.loadingState.cityDetail,
    store.proAccess.subscriptionActive,
    store.selectedCity,
  ]);

  if (!spotlightView) return null;

  const {
    city,
    detail,
    symbol,
    currentTemp,
    debPrediction,
    maxSoFar,
    maxTime,
    localTime,
    riskLevel,
    observationSource,
    displayedProbabilities,
    modelLabels,
    marketScan,
    tradableOpportunity,
    showOpportunityLabel,
    marketLabel,
    yesPrice,
    noPrice,
    marketEdge,
    marketProbability,
    marketModelProbability,
    sparklinePoints,
    isLoading,
    isPro,
    cityCode,
    localizedCityName,
    localizedAirportName,
    highRiskLabel,
    weatherIconKind,
    trendChart,
    debLabel,
    dayMaxLabel,
    probabilityTitle,
    marketTitle,
    marketEdgeLabel,
    marketImpliedLabel,
    marketModelLabel,
    proLabel,
    forecastDays,
    keySignals,
  } = spotlightView;
  const subtitle = `${cityCode} · ${localizedAirportName}`;

  return (
    <aside className="home-intelligence-panel full" aria-label={localizedCityName}>
      <div className="home-panel-glow" aria-hidden="true" />
      <button
        type="button"
        className="home-panel-close"
        aria-label={locale === "en-US" ? "Close city card" : "关闭城市卡片"}
        onClick={store.clearCityFocus}
      >
        ×
      </button>

      <div className="home-top-opportunity-label">
        {showOpportunityLabel
          ? locale === "en-US"
            ? "Today’s Top Opportunity"
            : "今日最佳机会"
          : locale === "en-US"
            ? "Focus City"
            : "重点观察城市"}
      </div>

      <div className="home-card-titlebar">
        <div>
          <h2>{localizedCityName}</h2>
          <p>{subtitle}</p>
        </div>
        <span className={clsx("home-risk-badge", String(riskLevel || "other"))}>
          {highRiskLabel}
        </span>
      </div>

      <div className="home-card-meta-row">
        <span>{locale === "en-US" ? "Local time" : "当地时间"} {localTime}</span>
        <span className="home-card-live-dot" />
        <span>
          {isLoading
            ? locale === "en-US"
              ? "Updating..."
              : "更新中..."
            : locale === "en-US"
              ? "Updated now"
              : "刚刚更新"}
        </span>
      </div>

      <div className="home-weather-hero">
        <div>
          <strong>{formatTemperature(currentTemp, symbol)}</strong>
          <span>
            {locale === "en-US" ? "Feels like" : "体感接近"}{" "}
            {formatTemperature(currentTemp, symbol)}
          </span>
        </div>
        <div
          className={clsx("home-weather-icon", `weather-${weatherIconKind}`)}
          aria-hidden="true"
        >
          <span className="sun" />
          <span className="cloud cloud-a" />
          <span className="cloud cloud-b" />
          <span className="mist mist-a" />
          <span className="mist mist-b" />
          <span className="wind wind-a" />
          <span className="wind wind-b" />
          <span className="rain rain-a" />
          <span className="rain rain-b" />
          <span className="rain rain-c" />
          <span className="bolt" />
        </div>
        <div className="home-max-so-far">
          <span>{locale === "en-US" ? "Max so far" : "当前最高"}</span>
          <strong>
            {formatTemperature(maxSoFar, symbol)} <small>{maxTime}</small>
          </strong>
        </div>
      </div>

      <div className="home-deb-card">
        <div>
          <span>
            {debLabel} <small>({dayMaxLabel})</small>
          </span>
          <strong>{formatTemperature(debPrediction, symbol)}</strong>
          <em>{formatDelta(debPrediction, currentTemp, symbol)}</em>
        </div>
      </div>

      {trendChart ? (
        <div className="home-card-section intraday">
          <h3>
            {locale === "en-US" ? "Intraday trend" : "今日日内走势"}{" "}
            <small>{locale === "en-US" ? "compact" : "简版"}</small>
          </h3>
          <div className="home-intraday-chart">
            <svg viewBox="0 0 296 78" aria-hidden="true">
              <line x1="10" y1="14" x2="286" y2="14" />
              <line x1="10" y1="36" x2="286" y2="36" />
              <line x1="10" y1="58" x2="286" y2="58" />
              {trendChart.forecastPath ? (
                <polyline points={trendChart.forecastPath} />
              ) : null}
              {trendChart.observationDots.map((point) => (
                <circle key={point.key} cx={point.cx} cy={point.cy} r="3.2" />
              ))}
            </svg>
            {trendChart.hoverPoints.map((point) => (
              <button
                key={point.key}
                type="button"
                className="home-intraday-hotspot"
                style={{ left: `${point.cx}px`, top: `${point.cy}px` }}
                aria-label={`${point.label} ${point.temperatureText}`}
                onMouseEnter={() => setHoveredTrendPoint(point)}
                onMouseLeave={() =>
                  setHoveredTrendPoint((current) =>
                    current?.key === point.key ? null : current,
                  )
                }
                onFocus={() => setHoveredTrendPoint(point)}
                onBlur={() =>
                  setHoveredTrendPoint((current) =>
                    current?.key === point.key ? null : current,
                  )
                }
              />
            ))}
            {hoveredTrendPoint ? (
              <div
                className="home-intraday-tooltip"
                style={{
                  left: `${Math.min(248, Math.max(48, hoveredTrendPoint.cx))}px`,
                  top: `${Math.max(8, hoveredTrendPoint.cy - 34)}px`,
                }}
              >
                <strong>{hoveredTrendPoint.temperatureText}</strong>
                <span>{hoveredTrendPoint.label}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {forecastDays.length ? (
        <div className="home-card-section forecast">
          <h3>{locale === "en-US" ? "Multi-day forecast" : "多日预报"}</h3>
          <div className="home-forecast-grid">
            {forecastDays.map((day) => (
              <div key={day.key} className="home-forecast-item">
                <span>{day.label}</span>
                <strong>{formatTemperature(day.maxTemp, symbol)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="home-card-section">
        <h3>{locale === "en-US" ? "Model stack" : "模型栈"}</h3>
        <div className="home-model-stack">
          {modelLabels.map((label) => (
            <span key={label}>
              <i />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="home-card-section probability">
        <h3>
          {probabilityTitle} <small>({dayMaxLabel})</small>
        </h3>
        {displayedProbabilities.length ? (
          <div className="home-probability-list">
            {displayedProbabilities.map((bucket, index) => {
              const probability = Number(bucket.probability ?? 0);
              const width = Math.max(6, Math.min(100, probability * 100));
              return (
                <div key={`${getProbabilityLabel(bucket, symbol)}-${index}`} className="home-probability-row">
                  <span>{getProbabilityLabel(bucket, symbol)}</span>
                  <div>
                    <i style={{ width: `${width}%` }} />
                    <strong>{formatProbability(probability)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="home-card-empty">
            {isLoading
              ? locale === "en-US"
                ? "Loading probabilities..."
                : "正在加载概率..."
              : locale === "en-US"
                ? "Probability layer pending."
                : "概率层待加载。"}
          </div>
        )}
      </div>

      <div className={clsx("home-card-section market", !isPro && "locked")}>
        <div className="home-market-header">
          <h3>
            {marketTitle} <small>ⓘ</small>
          </h3>
          <span>
            {marketScan && !tradableOpportunity
              ? locale === "en-US"
                ? "Market closed"
                : "市场已结束"
              : locale === "en-US"
                ? "Updated now"
                : "刚刚更新"}
          </span>
        </div>
        <div className="home-market-ticket">
          <div className="home-market-question">
            <strong>{marketLabel}</strong>
            <span>{marketScan?.selected_date || detail?.local_date || ""}</span>
          </div>
          <div className="home-market-prices">
            <span className="yes">YES {formatCents(yesPrice)}</span>
            <span className="no">NO {formatCents(noPrice)}</span>
          </div>
        </div>
        <div className="home-market-metrics">
          <span>
            {marketEdgeLabel} <strong>{formatEdge(marketEdge)}</strong>
          </span>
          <span>
            {marketImpliedLabel} <strong>{formatProbability(marketProbability)}</strong>
          </span>
          <span>
            {marketModelLabel} <strong>{formatProbability(marketModelProbability)}</strong>
          </span>
          <svg viewBox="0 0 96 32" aria-hidden="true">
            {sparklinePoints ? <polyline points={sparklinePoints} /> : null}
          </svg>
        </div>
        {!isPro ? (
          <Link href="/account" className="home-market-lock">
            {locale === "en-US" ? "Unlock market layer" : "解锁市场层"}
          </Link>
        ) : null}
      </div>

      <div className="home-card-section key-signals">
        <h3>{locale === "en-US" ? "Key signals" : "关键信号"}</h3>
        <ul>
          {keySignals.map((signal) => (
            <li key={signal.label}>
              <span>{signal.label}</span>
              <i className={clsx(signal.tone, signal.active && "active")} />
            </li>
          ))}
        </ul>
        <p>{observationSource}</p>
      </div>

      <div className={clsx("home-pro-card", isPro && "active")}>
        <div>
          <span>{proLabel}</span>
          <strong>
            {isPro
              ? locale === "en-US"
                ? "Open today intraday analysis first. History review and future-day workflow stay available after that."
                : "先打开今日日内分析，历史复盘和未来日工作流仍可继续查看。"
              : locale === "en-US"
                ? "History review and future dates stay paid."
                : "历史复盘和未来日期保持付费。"}
          </strong>
        </div>
        {isPro ? (
          <button type="button" onClick={() => void store.openTodayModal()}>
            {locale === "en-US" ? "Today intraday" : "今日日内分析"}
          </button>
        ) : (
          <Link href="/account">{locale === "en-US" ? "Upgrade" : "升级"}</Link>
        )}
      </div>
    </aside>
  );
}

function OpportunityStrip({
  snapshots,
}: {
  snapshots: CitySnapshot[];
}) {
  const { locale } = useI18n();
  const store = useDashboardStore();
  const summaryMetrics = useMemo(
    () => buildDashboardSummaryMetrics(snapshots, locale),
    [locale, snapshots],
  );
  const items = useMemo(
    () => snapshots.filter((snapshot) => snapshot.tradableOpportunity).slice(0, 5),
    [snapshots],
  );

  if (!items.length) return null;

  return (
    <section
      className="home-opportunity-strip"
      aria-label={locale === "en-US" ? "Opportunity strip" : "机会条"}
    >
      <div className="home-summary-grid">
        {summaryMetrics.map((metric) => (
          <div key={metric.key} className={clsx("home-summary-card", metric.accent && `accent-${metric.accent}`)}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className="opportunity-strip-heading">
        <div>
          <span>{locale === "en-US" ? "Today's Top Opportunities" : "今日最佳机会"}</span>
          <strong>
            {locale === "en-US" ? "Sorted by edge and tradability" : "按优势与可交易性排序"}
          </strong>
        </div>
        <Link href="/docs/intraday-signal" className="opportunity-view-all">
          {locale === "en-US" ? "View all" : "查看全部"}
        </Link>
      </div>
      <div className="opportunity-card-grid top-opportunities">
        {items.map(({ city, detail, summary }, index) => {
          const symbol = getTempSymbol(city, summary, detail);
          const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
          const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
          const localizedCityName = getLocalizedCityDisplay(city, locale, summary, detail);
          const tier =
            city.deb_recent_tier ||
            city.risk_level ||
            summary?.risk?.level ||
            detail?.risk?.level;
          return (
            <button
              key={city.name}
              type="button"
              className="opportunity-card"
              onClick={() => void store.focusCity(city.name)}
            >
              <div className="opportunity-card-header">
                <span className="opportunity-rank">{index + 1}</span>
                <span className="opportunity-city">{localizedCityName}</span>
                <span className={clsx("opportunity-pill", String(tier || "other"))}>
                  {getRiskCopy(tier as RiskLevel | undefined, locale)}
                </span>
              </div>
              <span className="opportunity-meta">
                &gt; {formatTemperature(debPrediction, symbol)}{" "}
                {locale === "en-US" ? "target" : "目标"}
              </span>
              <div className="opportunity-card-footer">
                <span className="opportunity-yes">YES {formatCents(detail?.market_scan?.yes_buy)}</span>
                <span className="opportunity-edge">{formatEdge(getMarketEdgeValue(detail))}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DashboardScreen() {
  const store = useDashboardStore();
  const { t } = useI18n();
  const didAutoFocusRef = useRef(false);
  const preloadedOpportunityRef = useRef<Set<string>>(new Set());
  const activeSummary = store.selectedCity
    ? store.citySummariesByName[store.selectedCity] || null
    : null;
  const activeCityName =
    store.selectedDetail?.display_name ||
    activeSummary?.display_name ||
    store.cities.find((city) => city.name === store.selectedCity)?.display_name ||
    store.selectedCity ||
    "";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (store.futureModalDate) {
        store.closeFutureModal();
        return;
      }
      if (store.historyState.isOpen) {
        store.closeHistory();
        return;
      }
      if (store.isPanelOpen) {
        store.closePanel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);

  // Avoid full-page flashing on initial load; only show this overlay for manual refresh.
  const showLoading =
    store.loadingState.cities ||
    store.loadingState.refresh;
  const showCitySyncToast =
    store.loadingState.cityDetail &&
    activeCityName &&
    !store.selectedDetail &&
    !activeSummary;
  const homepageSnapshots = useMemo(
    () =>
      store.cities
        .map((city) =>
          buildSnapshot(
            city,
            store.citySummariesByName[city.name] || null,
            store.cityDetailsByName[city.name] || null,
          ),
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.city.display_name.localeCompare(b.city.display_name),
        ),
    [store.cities, store.cityDetailsByName, store.citySummariesByName],
  );
  const showHomepageChrome =
    !store.historyState.isOpen && !store.futureModalDate;

  useEffect(() => {
    if (didAutoFocusRef.current) return;
    if (!showHomepageChrome) return;
    if (store.selectedCity) return;
    const topOpportunity = homepageSnapshots[0]?.city.name;
    if (!topOpportunity) return;

    didAutoFocusRef.current = true;
    void store.focusCity(topOpportunity);
  }, [homepageSnapshots, showHomepageChrome, store]);

  useEffect(() => {
    if (!showHomepageChrome) return;
    const targets = homepageSnapshots.slice(0, 4).map((snapshot) => snapshot.city.name);
    targets.forEach((cityName) => {
      if (preloadedOpportunityRef.current.has(cityName)) return;
      preloadedOpportunityRef.current.add(cityName);
      void store.ensureCityDetail(cityName, false, "panel").catch(() => {
        preloadedOpportunityRef.current.delete(cityName);
      });
    });
  }, [homepageSnapshots, showHomepageChrome, store]);

  return (
        <div
          className={clsx(
            styles.root,
        detailChromeStyles.root,
        modalChromeStyles.root,
      )}
    >
      <MapCanvas />
      <HomeMapToolbar />
      <HeaderBar />
      <CitySidebar />
      {showHomepageChrome ? (
        <>
          <HomeIntelligencePanel snapshots={homepageSnapshots} />
          <OpportunityStrip snapshots={homepageSnapshots} />
        </>
      ) : null}
      {showCitySyncToast ? (
        <div className="city-loading-toast" role="status" aria-live="polite">
          <span className="city-loading-dot" aria-hidden="true" />
          <span className="city-loading-copy">
            {t("dashboard.loading")} {activeCityName}
          </span>
        </div>
      ) : null}
      {store.historyState.isOpen && <HistoryModal />}
      {store.futureModalDate && <FutureForecastModal />}
      {showLoading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="loading-clouds" aria-hidden="true">
              <span className="loading-cloud loading-cloud-1" />
              <span className="loading-cloud loading-cloud-2" />
            </div>
            <div className="loading-windfield" aria-hidden="true">
              <span className="loading-windline loading-windline-1" />
              <span className="loading-windline loading-windline-2" />
              <span className="loading-windline loading-windline-3" />
            </div>
            <div className="loading-radar" aria-hidden="true">
              <div className="loading-radar-core" />
              <div className="loading-radar-ring loading-radar-ring-1" />
              <div className="loading-radar-ring loading-radar-ring-2" />
              <div className="loading-radar-sweep" />
              <div className="loading-radar-blip loading-radar-blip-1" />
              <div className="loading-radar-blip loading-radar-blip-2" />
            </div>
            <div className="loading-thermals" aria-hidden="true">
              <span className="loading-thermal loading-thermal-1" />
              <span className="loading-thermal loading-thermal-2" />
              <span className="loading-thermal loading-thermal-3" />
              <span className="loading-thermal loading-thermal-4" />
            </div>
            <div className="loading-drizzle" aria-hidden="true">
              <span className="loading-drizzle-drop loading-drizzle-drop-1" />
              <span className="loading-drizzle-drop loading-drizzle-drop-2" />
              <span className="loading-drizzle-drop loading-drizzle-drop-3" />
              <span className="loading-drizzle-drop loading-drizzle-drop-4" />
              <span className="loading-drizzle-drop loading-drizzle-drop-5" />
            </div>
            <div className="loading-copy">
              <strong>PolyWeather</strong>
              <span>{t("dashboard.loading")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PolyWeatherDashboard() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <DashboardScreen />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
