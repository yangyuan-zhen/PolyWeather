"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import type {
  CityDetail,
  CityListItem,
  CitySummary,
  MarketScan,
  MarketTopBucket,
  ProbabilityBucket,
  RiskLevel,
} from "@/lib/dashboard-types";
import type {
  AssistantContextPayload,
  AssistantOpportunityContext,
} from "@/lib/dashboard-client";
import { dashboardClient, getCityRevision } from "@/lib/dashboard-client";
import {
  getLocalizedAirportDisplay,
  getLocalizedCityDisplay,
} from "@/lib/dashboard-home-copy";
import {
  getTemperatureChartData,
  getWeatherSummary,
} from "@/lib/dashboard-utils";

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
    import("@/components/dashboard/MapCanvas").then(
      (module) => module.MapCanvas,
    ),
  {
    ssr: false,
    loading: () => <div className="map" aria-hidden="true" />,
  },
);

const HistoryModal = dynamic(loadHistoryModal, {
  ssr: false,
  loading: () => null,
});

const FutureForecastModal = dynamic(loadFutureForecastModal, {
  ssr: false,
  loading: () => null,
});

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
  bucket: {
    label?: string | null;
    value?: number | null;
    bucket?: string | null;
  },
  symbol: string,
) {
  if (bucket.label) return bucket.label;
  if (bucket.bucket) return bucket.bucket;
  if (Number.isFinite(Number(bucket.value))) {
    return `≥ ${Math.round(Number(bucket.value))}${symbol}`;
  }
  return "--";
}

function parseBucketThreshold(bucket?: {
  label?: string | null;
  value?: number | null;
  temp?: number | null;
  bucket?: string | null;
  range?: string | null;
}) {
  const directValue = bucket?.value ?? bucket?.temp;
  if (Number.isFinite(Number(directValue))) return Number(directValue);
  const text = String(bucket?.label || bucket?.bucket || bucket?.range || "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBucketMatchKey(bucket?: {
  label?: string | null;
  value?: number | null;
  temp?: number | null;
  bucket?: string | null;
  range?: string | null;
}) {
  const threshold = parseBucketThreshold(bucket);
  if (threshold != null) return `t:${threshold.toFixed(2)}`;
  return `l:${String(bucket?.label || bucket?.bucket || bucket?.range || "").trim().toLowerCase()}`;
}

function normalizeProbabilityValue(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric : numeric / 100;
}

function buildMarketAlignedProbabilities(
  marketScan: MarketScan | null | undefined,
  probabilityBuckets: ProbabilityBucket[],
  symbol: string,
) {
  const modelByKey = new Map(
    probabilityBuckets.map((bucket) => [getBucketMatchKey(bucket), bucket]),
  );
  const marketBuckets: Array<MarketTopBucket | ProbabilityBucket> = [
    ...(Array.isArray(marketScan?.all_buckets) ? marketScan.all_buckets : []),
    ...(Array.isArray(marketScan?.top_buckets) ? marketScan.top_buckets : []),
    ...(marketScan?.temperature_bucket ? [marketScan.temperature_bucket] : []),
  ];
  const aligned: ProbabilityBucket[] = [];
  const seen = new Set<string>();

  for (const marketBucket of marketBuckets) {
    const key = getBucketMatchKey(marketBucket);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const matchedModelBucket = modelByKey.get(key);
    aligned.push({
      label: getProbabilityLabel(marketBucket, symbol),
      value:
        marketBucket.value ??
        ("temp" in marketBucket ? marketBucket.temp : undefined) ??
        matchedModelBucket?.value ??
        null,
      bucket:
        ("bucket" in marketBucket ? marketBucket.bucket : undefined) ??
        matchedModelBucket?.bucket ??
        null,
      range:
        ("range" in marketBucket ? marketBucket.range : undefined) ??
        matchedModelBucket?.range ??
        null,
      unit:
        marketBucket.unit ??
        matchedModelBucket?.unit ??
        (symbol === "°F" ? "F" : "C"),
      probability:
        normalizeProbabilityValue(matchedModelBucket?.probability) ?? null,
    });
  }

  return aligned.length ? aligned.slice(0, 4) : probabilityBuckets.slice(0, 4);
}

function formatProbability(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized =
    Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

function formatCents(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized =
    Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}¢`;
}

function formatEdge(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  const normalized =
    Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value);
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(1)}%`;
}

function normalizeEdgePercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function getBestSide(detail?: CityDetail | null) {
  const bestSide = String(
    detail?.market_scan?.price_analysis?.best_side || "",
  ).toLowerCase();
  if (bestSide.includes("yes")) return "yes";
  if (bestSide.includes("no")) return "no";
  return null;
}

function isLiveMarketScan(detail?: CityDetail | null) {
  const marketScan = detail?.market_scan;
  if (!marketScan) return false;
  if (marketScan.available === false) return false;
  if (marketScan.primary_market?.closed === true) return false;
  if (marketScan.primary_market?.active === false) return false;
  if (marketScan.selected_date && detail?.local_date) {
    if (marketScan.selected_date < detail.local_date) return false;
  }
  const endDateMs = marketScan.primary_market?.end_date
    ? Date.parse(marketScan.primary_market.end_date)
    : Number.NaN;
  if (Number.isFinite(endDateMs) && endDateMs < Date.now()) return false;
  return true;
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
      const x =
        values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  cached?: boolean;
};

type OpportunityScanState = "pending" | "complete" | "empty" | "error";

type AssistantDockPosition = {
  right: number;
  bottom: number;
};

type AssistantDockDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  right: number;
  bottom: number;
  hasMoved: boolean;
};

const HOME_AI_DOCK_POSITION_STORAGE_KEY =
  "polyweather_home_ai_dock_position_v1";

function readAssistantDockPosition() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOME_AI_DOCK_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssistantDockPosition | null;
    if (
      parsed &&
      Number.isFinite(Number(parsed.right)) &&
      Number.isFinite(Number(parsed.bottom))
    ) {
      return {
        right: Number(parsed.right),
        bottom: Number(parsed.bottom),
      };
    }
  } catch {
    // Ignore malformed dock position cache.
  }
  return null;
}

function writeAssistantDockPosition(position: AssistantDockPosition | null) {
  if (typeof window === "undefined") return;
  if (!position) {
    window.localStorage.removeItem(HOME_AI_DOCK_POSITION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    HOME_AI_DOCK_POSITION_STORAGE_KEY,
    JSON.stringify(position),
  );
}

function getDefaultAssistantDockPosition() {
  if (typeof window === "undefined" || window.innerWidth <= 960) {
    return null;
  }
  const detailPanel = document.querySelector(
    ".home-intelligence-panel.full",
  ) as HTMLElement | null;
  const opportunityStrip = document.querySelector(
    ".home-opportunity-strip",
  ) as HTMLElement | null;
  const panelRect = detailPanel?.getBoundingClientRect();
  const stripRect = opportunityStrip?.getBoundingClientRect();
  return {
    right: panelRect
      ? Math.max(24, window.innerWidth - panelRect.left + 18)
      : 408,
    bottom: stripRect
      ? Math.max(24, window.innerHeight - stripRect.top + 18)
      : 340,
  };
}

function clampAssistantDockPosition(
  position: AssistantDockPosition | null,
  dockElement?: HTMLElement | null,
) {
  if (typeof window === "undefined" || window.innerWidth <= 960) {
    return null;
  }
  const rect = dockElement?.getBoundingClientRect();
  const width = rect?.width || 380;
  const height = rect?.height || 88;
  const minOffset = 24;
  const maxRight = Math.max(minOffset, window.innerWidth - width - minOffset);
  const maxBottom = Math.max(
    minOffset,
    window.innerHeight - height - minOffset,
  );
  const base = position || getDefaultAssistantDockPosition();
  if (!base) return null;
  return {
    right: Math.min(maxRight, Math.max(minOffset, Number(base.right))),
    bottom: Math.min(maxBottom, Math.max(minOffset, Number(base.bottom))),
  };
}

function hashSnapshotText(source: string) {
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33) ^ source.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function normalizeAssistantPercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function normalizeAssistantCents(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function buildAssistantOpportunityContext(
  snapshot: CitySnapshot,
  locale: string,
): AssistantOpportunityContext {
  const { city, detail, summary, tradableOpportunity } = snapshot;
  const symbol = getTempSymbol(city, summary, detail);
  const marketScan = detail?.market_scan;
  const marketBucket =
    marketScan?.temperature_bucket || marketScan?.top_buckets?.[0] || null;
  const marketQuestion =
    marketScan?.primary_market?.question ||
    (marketBucket
      ? `${getProbabilityLabel(marketBucket, symbol)} ${
          marketScan?.selected_date || detail?.local_date || ""
        }`
      : null);
  const localizedCityName = getLocalizedCityDisplay(
    city,
    locale,
    summary,
    detail,
  );
  const localizedAirport = getLocalizedAirportDisplay(city, locale, detail);
  const marketProbability =
    marketScan?.market_price ??
    readNumericField(marketBucket, "market_price") ??
    readNumericField(marketBucket, "yes_buy") ??
    marketScan?.yes_buy;
  const modelProbability =
    marketScan?.model_probability ?? marketBucket?.probability ?? null;
  return {
    city_name: city.name,
    city_display_name: localizedCityName,
    airport: localizedAirport,
    risk_level: String(
      city.deb_recent_tier ||
        city.risk_level ||
        summary?.risk?.level ||
        detail?.risk?.level ||
        "",
    ),
    tradable: tradableOpportunity,
    local_time: summary?.local_time || detail?.local_time || null,
    current_temperature:
      summary?.current?.temp ?? detail?.current?.temp ?? null,
    deb_prediction: summary?.deb?.prediction ?? detail?.deb?.prediction ?? null,
    market_question: marketQuestion,
    market_label: marketBucket ? getProbabilityLabel(marketBucket, symbol) : null,
    selected_date: marketScan?.selected_date || detail?.local_date || null,
    best_side: marketScan?.price_analysis?.best_side || null,
    yes_price: normalizeAssistantCents(
      marketScan?.yes_buy ??
        readNumericField(marketBucket, "yes_buy") ??
        marketScan?.yes_token?.buy_price ??
        marketScan?.yes_token?.midpoint,
    ),
    no_price: normalizeAssistantCents(
      marketScan?.no_buy ??
        readNumericField(marketBucket, "no_buy") ??
        marketScan?.no_token?.buy_price ??
        marketScan?.no_token?.midpoint,
    ),
    edge_percent: normalizeAssistantPercent(getMarketEdgeValue(detail)),
    market_probability: normalizeAssistantPercent(marketProbability),
    model_probability: normalizeAssistantPercent(modelProbability),
    status: tradableOpportunity
      ? "tradable"
      : marketScan
        ? "inactive"
        : "market_pending",
  };
}

function buildAssistantContextPayload(
  snapshots: CitySnapshot[],
  selectedCity: string | null,
  locale: string,
): AssistantContextPayload {
  const opportunities = snapshots.map((snapshot) =>
    buildAssistantOpportunityContext(snapshot, locale),
  );
  const revisionSeed = snapshots
    .map((snapshot) => {
      const revision =
        getCityRevision(snapshot.detail) || getCityRevision(snapshot.summary);
      return `${snapshot.city.name}:${revision}:${snapshot.tradableOpportunity ? 1 : 0}`;
    })
    .join("|");
  const snapshotId = `home-${hashSnapshotText(revisionSeed || String(Date.now()))}`;
  const selected =
    opportunities.find((item) => item.city_name === selectedCity) || null;

  return {
    snapshot_id: snapshotId,
    locale,
    generated_at: new Date().toISOString(),
    totals: {
      cities: snapshots.length,
      tradable_markets: opportunities.filter((item) => item.tradable).length,
      high_risk: opportunities.filter((item) => item.risk_level === "high").length,
      medium_risk: opportunities.filter((item) => item.risk_level === "medium")
        .length,
      low_risk: opportunities.filter((item) => item.risk_level === "low").length,
    },
    selected_city: selected,
    opportunities,
    glossary:
      locale === "en-US"
        ? [
            {
              term: "edge",
              meaning:
                "Edge is the gap between model probability and market-implied probability. Positive edge means the model is more optimistic than the market.",
            },
            {
              term: "market probability",
              meaning:
                "Market probability is the implied probability backed out from the live YES/NO price.",
            },
            {
              term: "DEB",
              meaning:
                "DEB is the internal forecast anchor for the day-max settlement temperature.",
            },
            {
              term: "EMOS",
              meaning:
                "EMOS is the calibrated probability ladder for the 24-hour max-temperature outcome buckets.",
            },
          ]
        : [
            {
              term: "edge",
              meaning:
                "edge 是模型概率和市场隐含概率之间的差值。正值表示模型比市场更乐观。",
            },
            {
              term: "市场概率",
              meaning: "市场概率来自 YES/NO 实时价格的隐含概率，而不是模型输出。",
            },
            {
              term: "DEB",
              meaning: "DEB 是系统对当日结算最高温的核心预测锚点之一。",
            },
            {
              term: "EMOS",
              meaning: "EMOS 是 24 小时最高温结果分桶使用的校准概率分布。",
            },
          ],
  };
}

function buildAssistantGreeting(locale: string, selectedCityName?: string | null) {
  if (locale === "en-US") {
    return selectedCityName
      ? `Ask about ${selectedCityName}, current opportunities, edge ranking, or how the metrics should be read.`
      : "Ask about current opportunities, edge ranking, or how the metrics should be read.";
  }
  return selectedCityName
    ? `可以直接问我 ${selectedCityName}、当前值得参与的市场、edge 排序，或者指标怎么解读。`
    : "可以直接问我当前值得参与的市场、edge 排序，或者指标怎么解读。";
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
  hourlyReports: Array<{
    key: string;
    label: string;
    temperatureText: string;
  }>;
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

type HomeSummaryCard = {
  key: string;
  title: string;
  linkLabel?: string;
  items: Array<{
    label: string;
    value: string;
    accent?: "green" | "amber" | "red" | "cyan";
  }>;
};

function buildDashboardSummaryCards(
  snapshots: CitySnapshot[],
  locale: string,
): HomeSummaryCard[] {
  const topTradable = snapshots.filter(
    (snapshot) => snapshot.tradableOpportunity,
  );
  const highCount = snapshots.filter(
    (snapshot) => snapshot.city.deb_recent_tier === "high",
  ).length;
  const mediumCount = snapshots.filter(
    (snapshot) => snapshot.city.deb_recent_tier === "medium",
  ).length;
  const lowCount = snapshots.filter(
    (snapshot) => snapshot.city.deb_recent_tier === "low",
  ).length;
  const strongAgreement = snapshots.filter(
    (snapshot) => Number(snapshot.city.deb_recent_hit_rate ?? 0) >= 0.66,
  ).length;
  const mediumAgreement = snapshots.filter((snapshot) => {
    const rate = Number(snapshot.city.deb_recent_hit_rate ?? 0);
    return rate >= 0.4 && rate < 0.66;
  }).length;
  const weakAgreement = Math.max(
    snapshots.length - strongAgreement - mediumAgreement,
    0,
  );
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
      key: "opportunities",
      title: locale === "en-US" ? "Current Opportunities" : "当前机会分布",
      items: [
        {
          label: locale === "en-US" ? "High risk" : "高风险",
          value: String(highCount),
          accent: "red",
        },
        {
          label: locale === "en-US" ? "Medium risk" : "中风险",
          value: String(mediumCount),
          accent: "amber",
        },
        {
          label: locale === "en-US" ? "Low risk" : "低风险",
          value: String(lowCount),
          accent: "green",
        },
      ],
    },
    {
      key: "market-summary",
      title: locale === "en-US" ? "Market Summary" : "市场概览",
      items: [
        {
          label: locale === "en-US" ? "Total markets" : "总市场数",
          value: String(snapshots.length),
        },
        {
          label: locale === "en-US" ? "Active" : "活跃市场",
          value: String(topTradable.length),
          accent: "cyan",
        },
        {
          label: locale === "en-US" ? "Avg. edge" : "平均优势",
          value: formatEdge(avgEdge),
          accent: "green",
        },
      ],
    },
    {
      key: "model-agreement",
      title: locale === "en-US" ? "Model Agreement" : "模型一致性",
      items: [
        {
          label: locale === "en-US" ? "High" : "高",
          value: `${strongAgreement}`,
          accent: "green",
        },
        {
          label: locale === "en-US" ? "Medium" : "中",
          value: `${mediumAgreement}`,
          accent: "amber",
        },
        {
          label: locale === "en-US" ? "Low" : "低",
          value: `${weakAgreement}`,
          accent: "red",
        },
      ],
    },
    {
      key: "impact-window",
      title: locale === "en-US" ? "High Impact Window" : "高影响窗口",
      items: [
        {
          label: locale === "en-US" ? "Next 6 hours" : "未来 6 小时",
          value:
            locale === "en-US"
              ? `${Math.min(topTradable.length, 12)} markets`
              : `${Math.min(topTradable.length, 12)} 个市场`,
        },
        {
          label: locale === "en-US" ? "Focus city" : "焦点城市",
          value: topTradable[0]?.city.display_name || "--",
          accent: "cyan",
        },
        {
          label: locale === "en-US" ? "Best edge" : "最佳优势",
          value:
            topTradable.length > 0
              ? formatEdge(getMarketEdgeValue(topTradable[0]?.detail))
              : "--",
          accent: "green",
        },
      ],
    },
  ];
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

function getHomeWeatherIconKind(
  detail?: CityDetail | null,
  locale = "zh-CN",
): HomeWeatherIconKind {
  if (!detail) return "cloudy";
  const summary = getWeatherSummary(
    detail,
    locale === "en-US" ? "en-US" : "zh-CN",
  );
  const weatherText =
    `${summary.weatherIcon} ${summary.weatherText} ${detail.current?.wx_desc || ""} ${detail.current?.cloud_desc || ""}`.toLowerCase();
  const cloudCover = Number(detail.hourly_next_48h?.cloud_cover?.[0]);
  const windSpeed = Number(
    detail.current?.wind_speed_kt ?? detail.airport_current?.wind_speed_kt,
  );

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
  const chartData = getTemperatureChartData(
    detail,
    locale === "en-US" ? "en-US" : "zh-CN",
  );
  if (!chartData) return null;
  const forecastSeries = chartData.datasets.hasMgmHourly
    ? chartData.datasets.mgmHourlySeries
    : [
        ...chartData.datasets.debPastSeries,
        ...chartData.datasets.debFutureSeries,
      ];
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
  const hoverSource =
    observationSeries.length > 0 ? observationSeries : forecastSeries;
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
  const hourlyReports = hoverSource
    .filter((point) => {
      const label = String(point.labelTime || "");
      return /(^|\D)\d{1,2}:00($|\D)/.test(label) || hoverSource.length <= 8;
    })
    .slice(-6)
    .map((point, index) => ({
      key: `hourly-${point.labelTime}-${index}`,
      label: point.labelTime,
      temperatureText: formatTemperature(point.y, detail.temp_symbol || "°C"),
    }));

  return {
    forecastPath,
    legendText: chartData.legendText,
    observationDots,
    hourlyReports,
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
  const formatter = new Intl.DateTimeFormat(
    locale === "en-US" ? "en-US" : "zh-CN",
    {
      day: "2-digit",
      month: "2-digit",
    },
  );
  const rows = Array.isArray(detail.forecast?.daily)
    ? detail.forecast.daily
    : [];
  const byDate = new Map<string, number>();

  if (
    detail.local_date &&
    Number.isFinite(Number(detail.forecast?.today_high))
  ) {
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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

  const marketBucket =
    marketScan.temperature_bucket || marketScan.top_buckets?.[0] || null;
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
        ? snapshots.find(
            (snapshot) => snapshot.city.name === store.selectedCity,
          ) || null
        : null,
    [snapshots, store.selectedCity],
  );
  const spotlightView = useMemo(() => {
    if (!spotlight) return null;

    const { city, detail, summary } = spotlight;
    const symbol = getTempSymbol(city, summary, detail);
    const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
    const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
    const maxSoFar =
      detail?.current?.max_so_far ?? detail?.airport_current?.max_so_far;
    const maxTime =
      detail?.current?.max_temp_time ||
      detail?.airport_current?.max_temp_time ||
      "--";
    const localTime = summary?.local_time || detail?.local_time || "--";
    const riskLevel =
      city.deb_recent_tier ||
      city.risk_level ||
      summary?.risk?.level ||
      detail?.risk?.level;
    const probabilityBuckets =
      detail?.probabilities?.distribution ||
      (detail?.local_date
        ? detail?.multi_model_daily?.[detail.local_date]?.probabilities
        : undefined) ||
      [];
    const marketScan = detail?.market_scan;
    const displayedProbabilities = buildMarketAlignedProbabilities(
      marketScan,
      probabilityBuckets,
      symbol,
    );
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
      displayedProbabilities,
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
      marketModelProbability:
        marketScan?.model_probability ?? marketBucket?.probability,
      sparklinePoints: buildSparklinePoints(marketScan?.sparkline),
      isLoading:
        store.loadingState.cityDetail && store.selectedCity === city.name,
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
      proLabel: store.proAccess.subscriptionActive
        ? locale === "en-US"
          ? "Pro signal"
          : "PRO 信号"
        : locale === "en-US"
          ? "Pro locked"
          : "PRO 锁定",
      forecastDays: buildHomeForecastDays(detail, locale),
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
    displayedProbabilities,
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
  } = spotlightView;
  const subtitle = `${cityCode} · ${localizedAirportName}`;
  const proCard = (
    <div className={clsx("home-pro-card", isPro && "active")}>
      <div>
        <span>{proLabel}</span>
        <strong>
          {isPro
            ? locale === "en-US"
              ? "Today intraday analysis is the primary paid workflow."
              : "今日日内分析是当前主要付费工作流。"
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
  );

  return (
    <aside
      className="home-intelligence-panel full"
      aria-label={localizedCityName}
    >
      <div className="home-panel-glow" aria-hidden="true" />

      <div className="home-panel-header">
        <div className="home-panel-header-left">
          <span className="home-panel-live-indicator" aria-hidden="true" />
          <span className="home-focus-title">
            {showOpportunityLabel
              ? locale === "en-US"
                ? "TOP OPPORTUNITY"
                : "最佳机会"
              : locale === "en-US"
                ? "FOCUS CITY"
              : "焦点城市"}
          </span>
        </div>
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
        <span>
          {locale === "en-US" ? "Local time" : "当地时间"} {localTime}
        </span>
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

      {proCard}

      <div className="home-weather-hero">
        <div className="home-weather-main">
          <span className="home-weather-label">
            {locale === "en-US" ? "Observed now" : "当前实况"}
          </span>
          <strong>{formatTemperature(currentTemp, symbol)}</strong>
          <span className="home-weather-sub">
            {locale === "en-US" ? "Feels near" : "体感接近"}{" "}
            {formatTemperature(currentTemp, symbol)}
          </span>
        </div>
        <div className="home-weather-side">
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
          <div className="home-weather-stat">
            <span>{locale === "en-US" ? "Day high" : "日内高点"}</span>
            <strong>{formatTemperature(maxSoFar, symbol)}</strong>
            <small>{maxTime}</small>
          </div>
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
            {locale === "en-US" ? "Hourly reports" : "小时准点报"}{" "}
            <small>{locale === "en-US" ? "1h cadence" : "1h 级别"}</small>
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
          {trendChart.hourlyReports.length ? (
            <div className="home-intraday-reports">
              {trendChart.hourlyReports.map((report) => (
                <span key={report.key}>
                  <b>{report.label}</b>
                  <strong>{report.temperatureText}</strong>
                </span>
              ))}
            </div>
          ) : null}
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

      <div className="home-card-section probability">
        <h3>
          {probabilityTitle} <small>{dayMaxLabel}</small>
        </h3>
        {displayedProbabilities.length ? (
          <div className="home-probability-ladder">
            {displayedProbabilities.map((bucket, index) => {
              const probability = normalizeProbabilityValue(bucket.probability);
              const width =
                probability == null
                  ? 6
                  : Math.max(6, Math.min(100, probability * 100));
              return (
                <div
                  key={`${getProbabilityLabel(bucket, symbol)}-${index}`}
                  className="home-probability-ladder-row"
                >
                  <span className="home-probability-threshold">
                    {getProbabilityLabel(bucket, symbol)}
                  </span>
                  <div className="home-probability-track">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <strong>{formatProbability(probability)}</strong>
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

      {tradableOpportunity ? (
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
            {marketImpliedLabel}{" "}
            <strong>{formatProbability(marketProbability)}</strong>
          </span>
          <span>
            {marketModelLabel}{" "}
            <strong>{formatProbability(marketModelProbability)}</strong>
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
      ) : null}

    </aside>
  );
}

function OpportunityStrip({
  snapshots,
  marketScanStatusByCity,
  scanTargetNames,
}: {
  snapshots: CitySnapshot[];
  marketScanStatusByCity: Record<string, OpportunityScanState>;
  scanTargetNames: string[];
}) {
  const { locale } = useI18n();
  const store = useDashboardStore();
  const stripState = useMemo(() => {
    const targetSet = new Set(scanTargetNames);
    const targetedSnapshots = (scanTargetNames.length
      ? snapshots.filter((snapshot) => targetSet.has(snapshot.city.name))
      : snapshots
    ).slice(0, Math.max(scanTargetNames.length, 1));
    const effectiveStatusByCity = Object.fromEntries(
      targetedSnapshots.map((snapshot) => [
        snapshot.city.name,
        marketScanStatusByCity[snapshot.city.name] ||
          (snapshot.detail?.market_scan ? "complete" : undefined),
      ]),
    ) as Record<string, OpportunityScanState | undefined>;
    const completedCount = scanTargetNames.filter((cityName) => {
      const status = effectiveStatusByCity[cityName];
      return status === "complete" || status === "empty";
    }).length;
    const pendingCount = scanTargetNames.filter(
      (cityName) => effectiveStatusByCity[cityName] === "pending",
    ).length;
    const errorCount = scanTargetNames.filter(
      (cityName) => effectiveStatusByCity[cityName] === "error",
    ).length;
    const liveSnapshots = targetedSnapshots.filter((snapshot) =>
      isLiveMarketScan(snapshot.detail),
    );
    const tradableSnapshots = targetedSnapshots
      .filter((snapshot) => snapshot.tradableOpportunity)
      .sort((left, right) => {
        const leftEdge = normalizeEdgePercent(getMarketEdgeValue(left.detail));
        const rightEdge = normalizeEdgePercent(getMarketEdgeValue(right.detail));
        return (
          Number(rightEdge ?? Number.NEGATIVE_INFINITY) -
            Number(leftEdge ?? Number.NEGATIVE_INFINITY) || right.score - left.score
        );
      });
    const yesCount = liveSnapshots.filter(
      (snapshot) => getBestSide(snapshot.detail) === "yes",
    ).length;
    const noCount = liveSnapshots.filter(
      (snapshot) => getBestSide(snapshot.detail) === "no",
    ).length;
    const avgTradableEdge = tradableSnapshots.length
      ? tradableSnapshots.reduce((sum, snapshot) => {
          const edge = normalizeEdgePercent(getMarketEdgeValue(snapshot.detail));
          return sum + (edge ?? 0);
        }, 0) / tradableSnapshots.length
      : null;
    const bestTradableSnapshot = tradableSnapshots[0] || null;
    const bestTradableCityName = bestTradableSnapshot
      ? getLocalizedCityDisplay(
          bestTradableSnapshot.city,
          locale,
          bestTradableSnapshot.summary,
          bestTradableSnapshot.detail,
        )
      : "--";
    const highCount = snapshots.filter(
      (snapshot) => snapshot.city.deb_recent_tier === "high",
    ).length;
    const mediumCount = snapshots.filter(
      (snapshot) => snapshot.city.deb_recent_tier === "medium",
    ).length;
    const lowCount = snapshots.filter(
      (snapshot) => snapshot.city.deb_recent_tier === "low",
    ).length;

    return {
      items: tradableSnapshots.slice(0, 5),
      completedCount,
      pendingCount,
      errorCount,
      liveCount: liveSnapshots.length,
      tradableCount: tradableSnapshots.length,
      yesCount,
      noCount,
      summaryCards: [
        {
          key: "scan-progress",
          title: locale === "en-US" ? "Scan Progress" : "扫描进度",
          items: [
            {
              label: locale === "en-US" ? "Completed" : "已完成",
              value: `${completedCount}/${scanTargetNames.length || snapshots.length}`,
              accent: "cyan" as const,
            },
            {
              label: locale === "en-US" ? "Scanning" : "扫描中",
              value: String(pendingCount),
              accent: "amber" as const,
            },
            {
              label: locale === "en-US" ? "Errors" : "异常",
              value: String(errorCount),
              accent: errorCount > 0 ? ("red" as const) : ("green" as const),
            },
          ],
        },
        {
          key: "market-live",
          title: locale === "en-US" ? "Market Status" : "盘口状态",
          items: [
            {
              label: locale === "en-US" ? "Live" : "在线",
              value: String(liveSnapshots.length),
              accent: "green" as const,
            },
            {
              label: locale === "en-US" ? "Tradable" : "可交易",
              value: String(tradableSnapshots.length),
              accent: "cyan" as const,
            },
            {
              label: locale === "en-US" ? "No edge" : "无机会",
              value: String(Math.max(completedCount - tradableSnapshots.length, 0)),
            },
          ],
        },
        {
          key: "market-quality",
          title: locale === "en-US" ? "Opportunity Quality" : "机会质量",
          items: [
            {
              label: locale === "en-US" ? "Avg. edge" : "平均优势",
              value: formatEdge(avgTradableEdge),
              accent: "green" as const,
            },
            {
              label: locale === "en-US" ? "Best edge" : "最高优势",
              value: bestTradableSnapshot
                ? formatEdge(getMarketEdgeValue(bestTradableSnapshot.detail))
                : "--",
              accent: "cyan" as const,
            },
            {
              label: locale === "en-US" ? "Focus" : "最佳城市",
              value: bestTradableCityName,
              accent: "amber" as const,
            },
          ],
        },
        {
          key: "risk-summary",
          title: locale === "en-US" ? "Risk Layer" : "风险层",
          items: [
            {
              label: locale === "en-US" ? "High" : "高",
              value: String(highCount),
              accent: "red" as const,
            },
            {
              label: locale === "en-US" ? "Medium" : "中",
              value: String(mediumCount),
              accent: "amber" as const,
            },
            {
              label: locale === "en-US" ? "Low" : "低",
              value: String(lowCount),
              accent: "green" as const,
            },
          ],
        },
      ],
      headingTitle:
        tradableSnapshots.length > 0
          ? locale === "en-US"
            ? `${tradableSnapshots.length} tradable markets · focus ${bestTradableCityName}`
            : `发现 ${tradableSnapshots.length} 个可交易市场 · 当前最佳 ${bestTradableCityName}`
          : pendingCount > 0
            ? locale === "en-US"
              ? `Scanning ${completedCount}/${scanTargetNames.length || snapshots.length} cities`
              : `正在扫描 ${completedCount}/${scanTargetNames.length || snapshots.length} 个城市市场层`
            : locale === "en-US"
              ? `Completed ${completedCount} scans · no tradable market`
              : `已完成 ${completedCount} 个城市扫描 · 当前无可交易市场`,
      yesCountLabel:
        locale === "en-US" ? `YES bias ${yesCount}` : `YES 倾向 ${yesCount}`,
      noCountLabel:
        locale === "en-US" ? `NO bias ${noCount}` : `NO 倾向 ${noCount}`,
    };
  }, [locale, marketScanStatusByCity, scanTargetNames, snapshots]);

  if (!snapshots.length) return null;

  return (
    <section
      className="home-opportunity-strip"
      aria-label={locale === "en-US" ? "Opportunity strip" : "机会条"}
    >
      <div className="home-summary-grid">
        {stripState.summaryCards.map((card) => (
          <div key={card.key} className="home-summary-card">
            <div className="home-summary-card-head">
              <strong>{card.title}</strong>
            </div>
            <div className="home-summary-card-body">
              {card.items.map((item) => (
                <div
                  key={`${card.key}-${item.label}`}
                  className="home-summary-stat"
                >
                  <b
                    className={
                      item.accent ? `accent-${item.accent}` : undefined
                    }
                  >
                    {item.value}
                  </b>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="opportunity-strip-heading">
        <div>
          <span>
            {locale === "en-US"
              ? "Live Market Scan"
              : "实时市场扫描"}
          </span>
          <strong>{stripState.headingTitle}</strong>
        </div>
        <div className="opportunity-strip-status" aria-live="polite">
          <span className={clsx("opportunity-status-chip", "live")}>
            {locale === "en-US"
              ? `Live ${stripState.liveCount}`
              : `在线 ${stripState.liveCount}`}
          </span>
          <span
            className={clsx(
              "opportunity-status-chip",
              stripState.pendingCount > 0 ? "pending" : "muted",
            )}
          >
            {locale === "en-US"
              ? `Pending ${stripState.pendingCount}`
              : `待补齐 ${stripState.pendingCount}`}
          </span>
          <span
            className={clsx(
              "opportunity-status-chip",
              stripState.tradableCount > 0 ? "tradable" : "muted",
            )}
          >
            {locale === "en-US"
              ? `Tradable ${stripState.tradableCount}`
              : `可交易 ${stripState.tradableCount}`}
          </span>
          <span className={clsx("opportunity-status-chip", "side")}>
            {stripState.yesCountLabel}
          </span>
          <span className={clsx("opportunity-status-chip", "side")}>
            {stripState.noCountLabel}
          </span>
        </div>
      </div>
      {stripState.items.length > 0 ? (
        <div className="opportunity-card-grid top-opportunities">
          {stripState.items.map(({ city, detail, summary }, index) => {
                const symbol = getTempSymbol(city, summary, detail);
                const debPrediction =
                  summary?.deb?.prediction ?? detail?.deb?.prediction;
                const localizedCityName = getLocalizedCityDisplay(
                  city,
                  locale,
                  summary,
                  detail,
                );
                const tier =
                  city.deb_recent_tier ||
                  city.risk_level ||
                  summary?.risk?.level ||
                  detail?.risk?.level;
                const marketBucket = detail?.market_scan?.temperature_bucket;
                const marketQuestion =
                  detail?.market_scan?.primary_market?.question ||
                  `${getProbabilityLabel(marketBucket || {}, symbol)} ${
                    detail?.market_scan?.selected_date ||
                    detail?.local_date ||
                    ""
                  }`;
                const opportunitySparkline = buildSparklinePoints(
                  detail?.market_scan?.sparkline?.length
                    ? detail.market_scan.sparkline
                    : [
                        Number(
                          summary?.current?.temp ?? detail?.current?.temp ?? 0,
                        ),
                        Number(debPrediction ?? 0),
                        Number(
                          detail?.forecast?.today_high ?? debPrediction ?? 0,
                        ),
                      ],
                );
                return (
                  <button
                    key={city.name}
                    type="button"
                    className="opportunity-card"
                    onClick={() => void store.focusCity(city.name)}
                  >
                    <div className="opportunity-card-header">
                      <span className="opportunity-rank">{index + 1}</span>
                      <span className="opportunity-city">
                        {localizedCityName}
                      </span>
                      <span
                        className={clsx(
                          "opportunity-pill",
                          String(tier || "other"),
                        )}
                      >
                        {getRiskCopy(tier as RiskLevel | undefined, locale)}
                      </span>
                    </div>
                    <span className="opportunity-meta">
                      {marketQuestion}
                    </span>
                    <div className="opportunity-card-footer">
                      <div className="opportunity-price-pair">
                        <span className="opportunity-yes">
                          YES {formatCents(detail?.market_scan?.yes_buy)}
                        </span>
                        <span className="opportunity-no">
                          NO {formatCents(detail?.market_scan?.no_buy)}
                        </span>
                      </div>
                      <span className="opportunity-edge">
                        {formatEdge(getMarketEdgeValue(detail))}
                      </span>
                    </div>
                    <svg className="opportunity-sparkline" viewBox="0 0 92 28" aria-hidden="true">
                      {opportunitySparkline ? (
                        <polyline points={opportunitySparkline} />
                      ) : null}
                    </svg>
                  </button>
                );
              })}
        </div>
      ) : (
        <div className="opportunity-empty-state">
          <div className="opportunity-empty-copy">
            <strong>
              {stripState.pendingCount > 0
                ? locale === "en-US"
                  ? "Scanning current market layers..."
                  : "正在扫描当前市场层..."
                : locale === "en-US"
                  ? "No tradable market at the moment"
                  : "当前没有满足条件的可交易市场"}
            </strong>
            <span>
              {locale === "en-US"
                ? `Completed ${stripState.completedCount} cities, live ${stripState.liveCount}, tradable ${stripState.tradableCount}.`
                : `已完成 ${stripState.completedCount} 个城市扫描，在线盘口 ${stripState.liveCount} 个，可交易机会 ${stripState.tradableCount} 个。`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function HomeAssistantDock({ snapshots }: { snapshots: CitySnapshot[] }) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dockPosition, setDockPosition] =
    useState<AssistantDockPosition | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockPositionRef = useRef<AssistantDockPosition | null>(null);
  const dragStateRef = useRef<AssistantDockDragState | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedSnapshot = useMemo(
    () =>
      store.selectedCity
        ? snapshots.find((snapshot) => snapshot.city.name === store.selectedCity) ||
          null
        : null,
    [snapshots, store.selectedCity],
  );
  const selectedCityName = selectedSnapshot
    ? getLocalizedCityDisplay(
        selectedSnapshot.city,
        locale,
        selectedSnapshot.summary,
        selectedSnapshot.detail,
      )
    : null;
  const assistantContext = useMemo(
    () => buildAssistantContextPayload(snapshots, store.selectedCity, locale),
    [locale, snapshots, store.selectedCity],
  );
  const starterPrompts = useMemo(() => {
    if (locale === "en-US") {
      return [
        "Which market is worth buying now?",
        "Rank the current markets by edge",
        selectedCityName
          ? `Why is ${selectedCityName} not recommended?`
          : "Explain what edge means",
      ];
    }
    return [
      "当前有哪些值得参与的市场？",
      "按 edge 排序",
      selectedCityName ? `为什么 ${selectedCityName} 不建议参与？` : "解释一下 edge 是什么",
    ];
  }, [locale, selectedCityName]);

  useEffect(() => {
    if (messages.length) return;
    setMessages([
      {
        id: "assistant-greeting",
        role: "assistant",
        content: buildAssistantGreeting(locale, selectedCityName),
      },
    ]);
  }, [locale, messages.length, selectedCityName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
  }, [loading, messages]);

  useEffect(() => {
    dockPositionRef.current = dockPosition;
  }, [dockPosition]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDockPosition = () => {
      if (window.innerWidth <= 960) {
        setDockPosition(null);
        return;
      }
      setDockPosition((current) =>
        clampAssistantDockPosition(
          current || readAssistantDockPosition() || getDefaultAssistantDockPosition(),
          dockRef.current,
        ),
      );
    };

    syncDockPosition();
    window.addEventListener("resize", syncDockPosition);
    return () => {
      window.removeEventListener("resize", syncDockPosition);
    };
  }, [isOpen]);

  const openAssistant = () => {
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false;
      return;
    }
    if (!store.proAccess.subscriptionActive) {
      setShowPaywall(true);
      return;
    }
    setIsOpen(true);
  };

  const beginDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (typeof window === "undefined" || window.innerWidth <= 960) return;
    const basePosition = clampAssistantDockPosition(
      dockPositionRef.current ||
        readAssistantDockPosition() ||
        getDefaultAssistantDockPosition(),
      dockRef.current,
    );
    if (!basePosition) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      right: basePosition.right,
      bottom: basePosition.bottom,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dockPositionRef.current = basePosition;
    setDockPosition(basePosition);
    setIsDragging(true);
  };

  const updateDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.hasMoved && Math.abs(deltaX) + Math.abs(deltaY) >= 6) {
      dragState.hasMoved = true;
    }
    const nextPosition = clampAssistantDockPosition(
      {
        right: dragState.right - deltaX,
        bottom: dragState.bottom - deltaY,
      },
      dockRef.current,
    );
    if (!nextPosition) return;
    dockPositionRef.current = nextPosition;
    setDockPosition(nextPosition);
  };

  const endDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }
    const finalPosition = clampAssistantDockPosition(
      dockPositionRef.current || {
        right: dragState.right,
        bottom: dragState.bottom,
      },
      dockRef.current,
    );
    if (dragState.hasMoved) {
      suppressLauncherClickRef.current = true;
    }
    dockPositionRef.current = finalPosition;
    setDockPosition(finalPosition);
    writeAssistantDockPosition(finalPosition);
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleLauncherKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openAssistant();
  };

  const sendQuestion = async (rawQuestion?: string) => {
    const question = String(rawQuestion ?? input).trim();
    if (!question || loading) return;
    if (!store.proAccess.subscriptionActive) {
      setShowPaywall(true);
      return;
    }

    setIsOpen(true);
    setError(null);
    setLoading(true);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: question,
      },
    ]);
    setInput("");

    try {
      const reply = await dashboardClient.askAssistant({
        question,
        locale,
        snapshotId: assistantContext.snapshot_id,
        context: assistantContext,
      });
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: reply.answer,
          cached: reply.cached,
        },
      ]);
    } catch (submitError) {
      const message = String(submitError);
      if (message.includes("HTTP 402")) {
        setShowPaywall(true);
      } else {
        setError(
          locale === "en-US"
            ? "Assistant is temporarily unavailable."
            : "AI 助手暂时不可用。",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendQuestion();
  };

  return (
    <>
      <div
        ref={dockRef}
        className={clsx("home-ai-assistant", isDragging && "dragging")}
        style={
          dockPosition
            ? {
                right: `${dockPosition.right}px`,
                bottom: `${dockPosition.bottom}px`,
              }
            : undefined
        }
      >
        {!isOpen ? (
          <div
            className="home-ai-launcher"
            role="button"
            tabIndex={0}
            onClick={openAssistant}
            onKeyDown={handleLauncherKeyDown}
            onPointerDown={beginDockDrag}
            onPointerMove={updateDockDrag}
            onPointerUp={endDockDrag}
            onPointerCancel={endDockDrag}
          >
            <span className="home-ai-launcher-badge">AI</span>
            <div className="home-ai-launcher-copy">
              <strong>
                {locale === "en-US" ? "Market Assistant" : "AI 对话助手"}
              </strong>
              <span>
                {store.proAccess.subscriptionActive
                  ? locale === "en-US"
                    ? "Ask using the current market snapshot"
                    : "基于当前市场快照直接提问"
                  : locale === "en-US"
                    ? "Pro only"
                    : "Pro 专属"}
              </span>
            </div>
            <span
              className="home-ai-drag-handle"
              title={locale === "en-US" ? "Move assistant" : "拖动助手"}
              aria-hidden="true"
            >
              ⋮⋮
            </span>
          </div>
        ) : (
          <section
            className="home-ai-panel"
            aria-label={locale === "en-US" ? "AI assistant" : "AI 助手"}
          >
            <div className="home-ai-header">
              <div>
                <strong>{locale === "en-US" ? "AI assistant" : "AI 对话助手"}</strong>
                <span>
                  {locale === "en-US"
                    ? `Snapshot ${assistantContext.snapshot_id}`
                    : `快照 ${assistantContext.snapshot_id}`}
                </span>
              </div>
              <div className="home-ai-header-actions">
                <span
                  className="home-ai-drag-handle"
                  title={locale === "en-US" ? "Move assistant" : "拖动助手"}
                  aria-hidden="true"
                  onPointerDown={beginDockDrag}
                  onPointerMove={updateDockDrag}
                  onPointerUp={endDockDrag}
                  onPointerCancel={endDockDrag}
                >
                  ⋮⋮
                </span>
                <button
                  type="button"
                  className="home-ai-close"
                  onClick={() => setIsOpen(false)}
                  aria-label={locale === "en-US" ? "Close assistant" : "关闭 AI 助手"}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="home-ai-disclaimer">
              {locale === "en-US"
                ? "Only explains the current system snapshot. It does not scan markets or calculate probabilities."
                : "只解释当前系统快照，不参与市场扫描、概率计算或核心决策。"}
            </div>

            <div className="home-ai-messages">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={clsx(
                    "home-ai-message",
                    message.role === "user" ? "user" : "assistant",
                  )}
                >
                  <p>{message.content}</p>
                  {message.cached ? (
                    <small>{locale === "en-US" ? "Cache hit" : "命中缓存"}</small>
                  ) : null}
                </div>
              ))}
              {loading ? (
                <div className="home-ai-message assistant loading">
                  <p>{locale === "en-US" ? "Thinking..." : "正在整理答案..."}</p>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <div className="home-ai-starters">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="home-ai-starter"
                  onClick={() => void sendQuestion(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <form className="home-ai-composer" onSubmit={submitForm}>
              <textarea
                className="home-ai-input"
                rows={3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  locale === "en-US"
                    ? "Ask about current opportunities, a city, or edge..."
                    : "问当前机会、某个城市，或者 edge 怎么看..."
                }
              />
              <div className="home-ai-composer-actions">
                {error ? <span className="home-ai-error">{error}</span> : <span />}
                <button
                  type="submit"
                  className="home-ai-send"
                  disabled={loading || !input.trim()}
                >
                  {locale === "en-US" ? "Ask" : "发送"}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>

      {showPaywall ? (
        <div className="home-ai-paywall-backdrop" onClick={() => setShowPaywall(false)}>
          <div
            className="home-ai-paywall-shell"
            onClick={(event) => event.stopPropagation()}
          >
            <ProFeaturePaywall
              feature="assistant"
              onClose={() => setShowPaywall(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function DashboardScreen() {
  const store = useDashboardStore();
  const { t } = useI18n();
  const didAutoFocusRef = useRef(false);
  const marketScanInflightRef = useRef<Set<string>>(new Set());
  const [marketScanStatusByCity, setMarketScanStatusByCity] = useState<
    Record<string, OpportunityScanState>
  >({});
  const activeSummary = store.selectedCity
    ? store.citySummariesByName[store.selectedCity] || null
    : null;
  const activeCityName =
    store.selectedDetail?.display_name ||
    activeSummary?.display_name ||
    store.cities.find((city) => city.name === store.selectedCity)
      ?.display_name ||
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
  const showLoading = store.loadingState.cities || store.loadingState.refresh;
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
  const marketScanTargetNames = useMemo(
    () => homepageSnapshots.map((snapshot) => snapshot.city.name),
    [homepageSnapshots],
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
    if (store.loadingState.refresh) {
      marketScanInflightRef.current.clear();
      setMarketScanStatusByCity({});
    }
  }, [store.loadingState.refresh]);

  useEffect(() => {
    if (store.proAccess.loading) return;
    if (store.proAccess.authenticated) return;
    marketScanInflightRef.current.clear();
    setMarketScanStatusByCity({});
  }, [store.proAccess.authenticated, store.proAccess.loading]);

  useEffect(() => {
    if (!showHomepageChrome) return;
    if (store.proAccess.loading || !store.proAccess.authenticated) return;
    if (!marketScanTargetNames.length) return;

    let cancelled = false;
    const queue = marketScanTargetNames.filter((cityName) => {
      const status = marketScanStatusByCity[cityName];
      const existingMarketScan = store.cityDetailsByName[cityName]?.market_scan;
      return (
        !status &&
        !existingMarketScan &&
        !marketScanInflightRef.current.has(cityName)
      );
    });
    if (!queue.length) return;

    const runWorker = async () => {
      while (!cancelled) {
        const cityName = queue.shift();
        if (!cityName) return;
        marketScanInflightRef.current.add(cityName);
        setMarketScanStatusByCity((current) => ({
          ...current,
          [cityName]: "pending",
        }));
        try {
          const detail = await store.ensureCityDetail(cityName, false, "panel");
          if (cancelled) return;
          const marketScan =
            detail.market_scan ||
            (await store.ensureCityMarketScan(cityName, false));
          if (cancelled) return;
          setMarketScanStatusByCity((current) => ({
            ...current,
            [cityName]: marketScan ? "complete" : "empty",
          }));
        } catch {
          if (cancelled) return;
          setMarketScanStatusByCity((current) => ({
            ...current,
            [cityName]: "error",
          }));
        } finally {
          marketScanInflightRef.current.delete(cityName);
        }
      }
    };

    void Promise.allSettled(
      Array.from({ length: Math.min(4, queue.length) }, () => runWorker()),
    );

    return () => {
      cancelled = true;
    };
  }, [
    marketScanStatusByCity,
    marketScanTargetNames,
    showHomepageChrome,
    store,
  ]);

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
          <OpportunityStrip
            snapshots={homepageSnapshots}
            marketScanStatusByCity={marketScanStatusByCity}
            scanTargetNames={marketScanTargetNames}
          />
          <HomeAssistantDock snapshots={homepageSnapshots} />
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
