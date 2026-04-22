"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
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
  tickLabels: Array<{ key: string; label: string; x: number }>;
};

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
  const tickLabels = chartData.tickLabels
    .map((label, index) => {
      if (!label) return null;
      const minutes = Number.parseInt(String(chartData.times[index] || "0").split(":")[0] || "0", 10) * 60;
      const projected = projectHomeTrendPoint(
        minutes,
        chartData.min,
        chartData.xMin,
        chartData.xMax,
        chartData.min,
        chartData.max,
      );
      return {
        key: `${label}-${index}`,
        label,
        x: projected.cx,
      };
    })
    .filter((item): item is { key: string; label: string; x: number } => item != null);

  return {
    forecastPath,
    legendText: chartData.legendText,
    observationDots,
    tickLabels,
  };
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
  const selectedSnapshot = store.selectedCity
    ? snapshots.find((snapshot) => snapshot.city.name === store.selectedCity)
    : null;
  const spotlight = selectedSnapshot || null;

  if (!spotlight) return null;

  const { city, detail, summary } = spotlight;
  const symbol = getTempSymbol(city, summary, detail);
  const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
  const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
  const maxSoFar = detail?.current?.max_so_far ?? detail?.airport_current?.max_so_far;
  const maxTime = detail?.current?.max_temp_time || detail?.airport_current?.max_temp_time || "--";
  const localTime = summary?.local_time || detail?.local_time || "--";
  const riskLevel =
    city.deb_recent_tier ||
    city.risk_level ||
    summary?.risk?.level ||
    detail?.risk?.level;
  const deviation = summary?.deviation_monitor || detail?.deviation_monitor;
  const observationSource =
    normalizeObservationSourceLabel(
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
  const hasMarketScan = Boolean(marketScan);
  const showOpportunityLabel = !hasMarketScan || spotlight.tradableOpportunity;
  const marketBucket = marketScan?.temperature_bucket || marketScan?.top_buckets?.[0] || null;
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
  const marketLabel = marketBucket
    ? getProbabilityLabel(marketBucket, symbol)
    : debPrediction != null
      ? `> ${formatTemperature(debPrediction, symbol)}`
      : "--";
  const marketProbability =
    marketScan?.market_price ??
    readNumericField(marketBucket, "market_price") ??
    readNumericField(marketBucket, "yes_buy") ??
    yesPrice ??
    marketScan?.model_probability;
  const marketModelProbability = marketScan?.model_probability ?? marketBucket?.probability;
  const sparklinePoints = buildSparklinePoints(marketScan?.sparkline);
  const isLoading = store.loadingState.cityDetail && store.selectedCity === city.name;
  const isPro = store.proAccess.subscriptionActive;
  const cityCode = city.icao || detail?.risk?.icao || city.airport;
  const localizedCityName = getLocalizedCityDisplay(city, locale, summary, detail);
  const localizedAirportName = getLocalizedAirportDisplay(city, locale, detail);
  const subtitle = `${cityCode} · ${localizedAirportName}`;
  const highRiskLabel =
    riskLevel === "high"
      ? locale === "en-US"
        ? "High risk"
        : "高风险"
      : getRiskCopy(riskLevel, locale);
  const weatherIconKind = getHomeWeatherIconKind(detail, locale);
  const trendChart = buildHomeTrendChart(detail, locale);
  const debLabel = locale === "en-US" ? "DEB forecast" : "DEB 预测";
  const dayMaxLabel = locale === "en-US" ? "24h max" : "24 小时最高";
  const probabilityTitle = locale === "en-US" ? "EMOS probability" : "EMOS 概率";
  const marketTitle = locale === "en-US" ? "Market edge" : "市场优势";
  const marketEdgeLabel = locale === "en-US" ? "Edge" : "优势";
  const marketImpliedLabel = locale === "en-US" ? "Implied" : "市场隐含";
  const marketModelLabel = locale === "en-US" ? "Model prob" : "模型概率";
  const proLabel = isPro
    ? locale === "en-US"
      ? "Pro signal"
      : "PRO 信号"
    : locale === "en-US"
      ? "Pro locked"
      : "PRO 锁定";
  const keySignals = [
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
  ];

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
        <svg viewBox="0 0 110 34" aria-hidden="true">
          <polyline points="4,26 22,22 38,14 55,20 72,16 88,8 106,10" />
          <circle cx="88" cy="8" r="2.5" />
        </svg>
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
            <div className="home-intraday-axis">
              {trendChart.tickLabels.map((tick) => (
                <span key={tick.key} style={{ left: `${tick.x}px` }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          <div className="home-intraday-meta">
            {trendChart.legendText ||
              (locale === "en-US"
                ? "Intraday observations pending."
                : "日内观测序列待补充。")}
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
            {hasMarketScan && !spotlight.tradableOpportunity
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

function OpportunityStrip({ snapshots }: { snapshots: CitySnapshot[] }) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const items = snapshots.slice(0, 4);

  if (!items.length) return null;

  return (
    <section
      className="home-opportunity-strip"
      aria-label={locale === "en-US" ? "Opportunity strip" : "机会条"}
    >
      <div className="opportunity-strip-heading">
        <span>{locale === "en-US" ? "Today focus" : "今日焦点"}</span>
        <strong>
          {locale === "en-US" ? "Cities worth opening first" : "优先打开的城市"}
        </strong>
      </div>
      <div className="opportunity-card-grid">
        {items.map(({ city, detail, summary }) => {
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
              <span className={clsx("opportunity-risk-dot", String(tier || "other"))} />
              <span className="opportunity-city">{localizedCityName}</span>
              <span className="opportunity-meta">
                {formatTemperature(currentTemp, symbol)} / DEB{" "}
                {formatTemperature(debPrediction, symbol)}
              </span>
              <span className="opportunity-hit">
                {locale === "en-US" ? "Hit" : "命中"}{" "}
                {formatPercent(city.deb_recent_hit_rate)}
              </span>
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
