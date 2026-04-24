"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  RefreshCw,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Dashboard.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import {
  FilterState,
  ScanFilterPanel,
} from "@/components/dashboard/ScanFilterPanel";
import { FutureForecastModal } from "@/components/dashboard/FutureForecastModal";
import { MapCanvas } from "@/components/dashboard/MapCanvas";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import { ScanKPIBar } from "@/components/dashboard/ScanKPIBar";
import { OpportunityTable } from "@/components/dashboard/OpportunityTable";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import {
  dashboardClient,
  type AssistantContextPayload,
  type AssistantOpportunityContext,
} from "@/lib/dashboard-client";
import type {
  DistributionPreviewPoint,
  MarketScan,
  PrimarySignal,
  ScanOpportunityRow,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";
import {
  getLocalizedAirportName,
  getLocalizedCityName,
} from "@/lib/dashboard-home-copy";
import {
  formatTemperatureValue,
  normalizeTemperatureLabel,
} from "@/lib/dashboard-utils";

const DEFAULT_FILTERS: FilterState = {
  scan_mode: "tradable",
  min_price: 0.05,
  max_price: 0.95,
  min_edge_pct: 2,
  min_liquidity: 1000,
  high_liquidity_only: false,
  market_type: "maxtemp",
  time_range: "today",
  limit: 28,
};

type ContentView = "list" | "map" | "calendar";
type ThemeMode = "dark" | "light";
type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

function formatPercent(value?: number | null, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  return `${signed && numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function formatProbability(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function formatPrice(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}¢`;
}

function formatVolume(value?: number | null) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "--";
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(0)}K`;
  return `$${numeric.toFixed(0)}`;
}

function formatRemainingWindow(value?: number | null, locale = "zh-CN") {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const numeric = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(numeric / 60);
  const minutes = numeric % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  }
  if (hours <= 0) return `${minutes} 分钟`;
  return `${hours}h ${minutes}m`;
}

function scoreTone(score?: number | null) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return "green";
  if (numeric >= 70) return "yellow";
  return "red";
}

function confidenceLabel(score?: number | null, locale = "zh-CN") {
  const numeric = Number(score || 0);
  if (locale === "en-US") {
    if (numeric >= 85) return "High";
    if (numeric >= 70) return "Medium";
    return "Watch";
  }
  if (numeric >= 85) return "高";
  if (numeric >= 70) return "中";
  return "观察";
}

function formatShortDate(value?: string | null, locale = "zh-CN") {
  const text = String(value || "").trim();
  if (!text) return "--";
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return locale === "en-US"
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatUserLocalTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

function getLocalDateIndex(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function getPhaseUrgency(row: ScanOpportunityRow) {
  const phase = String(row.window_phase || "").toLowerCase();
  if (phase === "active_peak") return 0;
  if (phase === "setup_today") return 1;
  if (phase === "early_today") return 2;
  if (phase === "post_peak") return 3;
  if (phase === "tomorrow") return 4;
  if (phase === "week_ahead") return 5;
  return 6;
}

function sortRowsByUserTime(rows: ScanOpportunityRow[]) {
  return [...rows].sort((left, right) => {
    const leftDateIndex = getLocalDateIndex(left.selected_date || left.local_date);
    const rightDateIndex = getLocalDateIndex(right.selected_date || right.local_date);
    if (leftDateIndex !== rightDateIndex) return leftDateIndex - rightDateIndex;

    const leftRemaining = Number.isFinite(Number(left.remaining_window_minutes))
      ? Number(left.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    const rightRemaining = Number.isFinite(Number(right.remaining_window_minutes))
      ? Number(right.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

    const leftPhase = getPhaseUrgency(left);
    const rightPhase = getPhaseUrgency(right);
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;

    const scoreDelta = Number(right.final_score || 0) - Number(left.final_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(right.edge_percent || 0) - Number(left.edge_percent || 0);
  });
}

function normalizeCityKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function rowMatchesCity(row: ScanOpportunityRow, cityName: string) {
  const cityKey = normalizeCityKey(cityName);
  if (!cityKey) return false;
  return [row.city, row.city_display_name, row.display_name].some(
    (value) => normalizeCityKey(value) === cityKey,
  );
}

function findRowForCity(rows: ScanOpportunityRow[], cityName?: string | null) {
  const normalized = normalizeCityKey(cityName);
  if (!normalized) return null;
  return rows.find((row) => rowMatchesCity(row, cityName || "")) || null;
}

function getSideRow(
  marketScan: MarketScan | null | undefined,
  selectedRow: ScanOpportunityRow,
  side: "yes" | "no",
) {
  const rows = Array.isArray(marketScan?.scan_rows) ? marketScan.scan_rows : [];
  const matched = rows.find(
    (row) =>
      row.market_slug === selectedRow.market_slug &&
      row.selected_date === selectedRow.selected_date &&
      row.side === side,
  );
  if (matched) return matched;
  if (selectedRow.side === side) return selectedRow;
  return null;
}

function getDetailSideAsk(
  scanRow: ScanOpportunityRow | null,
  marketScan: MarketScan | null | undefined,
  side: "yes" | "no",
) {
  if (scanRow?.ask != null) return scanRow.ask;
  if (side === "yes") {
    if (scanRow?.yes_ask != null) return scanRow.yes_ask;
    return marketScan?.yes_buy ?? null;
  }
  if (scanRow?.no_ask != null) return scanRow.no_ask;
  return marketScan?.no_buy ?? null;
}

function getDetailSideBid(
  scanRow: ScanOpportunityRow | null,
  marketScan: MarketScan | null | undefined,
  side: "yes" | "no",
) {
  if (scanRow?.bid != null) return scanRow.bid;
  if (side === "yes") {
    if (scanRow?.yes_bid != null) return scanRow.yes_bid;
    return marketScan?.yes_sell ?? null;
  }
  if (scanRow?.no_bid != null) return scanRow.no_bid;
  return marketScan?.no_sell ?? null;
}

function buildComparisonBuckets(
  marketScan: MarketScan | null | undefined,
  row: ScanOpportunityRow | null,
) {
  const rowPreview = Array.isArray(row?.distribution_preview)
    ? row.distribution_preview.filter(
        (item): item is DistributionPreviewPoint =>
          Boolean(item && (item.label || item.value != null)),
      )
    : [];
  if (rowPreview.length) {
    return rowPreview.slice(0, 6).map((item) => ({
      label: String(item.label ?? item.value ?? "--"),
      model: Number(item.model_probability ?? 0) * 100,
      market: Number(item.market_probability ?? 0) * 100,
      highlighted: Boolean(item.highlighted),
    }));
  }
  const buckets = Array.isArray(marketScan?.top_buckets)
    ? marketScan?.top_buckets
    : Array.isArray(marketScan?.all_buckets)
      ? marketScan?.all_buckets?.slice(0, 6)
      : [];
  if (buckets.length) {
    return buckets
      .slice(0, 6)
      .map((bucket) => ({
        label: String(bucket.temp ?? bucket.value ?? bucket.label ?? "--"),
        model: Number(bucket.probability ?? 0) * 100,
        market: Number(bucket.market_price ?? bucket.yes_buy ?? 0) * 100,
        highlighted: false,
      }))
      .filter((bucket) => bucket.label !== "--");
  }

  if (!row) return [];
  return [
    {
      label: row.target_label || "--",
      model: Number(row.model_event_probability || 0) * 100,
      market: Number(row.market_event_probability || 0) * 100,
      highlighted: true,
    },
  ];
}

function hashClientText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

function normalizeAssistantProbability(value?: number | null) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric : numeric / 100;
}

function getAssistantSidePrice(row: ScanOpportunityRow, side: "yes" | "no") {
  if (side === "yes") {
    return row.yes_ask ?? (String(row.side || "").toLowerCase() === "yes" ? row.ask : null);
  }
  return row.no_ask ?? (String(row.side || "").toLowerCase() === "no" ? row.ask : null);
}

function buildAssistantOpportunity(
  row: ScanOpportunityRow,
  locale: string,
): AssistantOpportunityContext {
  const tempSymbol = row.temp_symbol || "°C";
  const marketLabel =
    normalizeTemperatureLabel(row.target_label, tempSymbol) ||
    row.market_question ||
    row.target_label ||
    null;
  const bestSide = String(row.side || "").toUpperCase();

  return {
    city_name: row.city,
    city_display_name: getLocalizedCityName(
      row.city,
      row.city_display_name || row.display_name || row.city,
      locale,
    ),
    airport: getLocalizedAirportName(row.city, row.airport || "", locale),
    risk_level: row.risk_level || "low",
    tradable:
      row.tradable === true &&
      row.closed !== true &&
      row.active !== false &&
      row.accepting_orders !== false,
    local_time: row.local_time || null,
    current_temperature: Number.isFinite(Number(row.current_temp))
      ? Number(row.current_temp)
      : null,
    deb_prediction: Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null,
    temp_symbol: tempSymbol,
    today_high: Number.isFinite(Number(row.current_max_so_far))
      ? Number(row.current_max_so_far)
      : Number.isFinite(Number(row.deb_prediction))
        ? Number(row.deb_prediction)
        : null,
    market_question: row.market_question || null,
    market_label: marketLabel,
    selected_date: row.selected_date || row.local_date || null,
    best_side: bestSide === "YES" || bestSide === "NO" ? bestSide : null,
    yes_price: getAssistantSidePrice(row, "yes"),
    no_price: getAssistantSidePrice(row, "no"),
    edge_percent: Number.isFinite(Number(row.edge_percent))
      ? Number(row.edge_percent)
      : null,
    market_probability: normalizeAssistantProbability(
      row.market_event_probability ?? row.market_probability,
    ),
    model_probability: normalizeAssistantProbability(
      row.model_event_probability ?? row.model_probability,
    ),
    status: row.closed ? "closed" : row.tradable ? "tradable" : "watch",
  };
}

function buildAssistantContext(params: {
  terminalData: ScanTerminalResponse | null;
  rows: ScanOpportunityRow[];
  selectedRow: ScanOpportunityRow | null;
  locale: string;
  totalCities: number;
}): AssistantContextPayload {
  const opportunities = params.rows
    .slice(0, 52)
    .map((row) => buildAssistantOpportunity(row, params.locale));
  const selectedCity = params.selectedRow
    ? buildAssistantOpportunity(params.selectedRow, params.locale)
    : opportunities[0] || null;
  const source = JSON.stringify({
    generated_at: params.terminalData?.generated_at || "",
    rows: params.rows.slice(0, 20).map((row) => [
      row.id,
      row.city,
      row.market_slug,
      row.side,
      row.edge_percent,
      row.yes_ask,
      row.no_ask,
    ]),
  });

  return {
    snapshot_id:
      params.terminalData?.snapshot_id ||
      `home-${hashClientText(source)}`,
    locale: params.locale,
    generated_at: params.terminalData?.generated_at || new Date().toISOString(),
    totals: {
      cities: params.totalCities || params.rows.length,
      tradable_markets:
        params.terminalData?.summary?.tradable_market_count ??
        opportunities.filter((item) => item.tradable).length,
      high_risk: params.rows.filter((row) => row.risk_level === "high").length,
      medium_risk: params.rows.filter((row) => row.risk_level === "medium").length,
      low_risk: params.rows.filter((row) => row.risk_level === "low").length,
    },
    selected_city: selectedCity,
    opportunities,
    glossary:
      params.locale === "en-US"
        ? [
            {
              term: "edge",
              meaning:
                "Edge is model probability minus market-implied probability. Positive edge means the model is more favorable than the market price.",
            },
            {
              term: "EMOS",
              meaning:
                "EMOS is the calibrated probability distribution for max-temperature buckets.",
            },
            {
              term: "DEB",
              meaning:
                "DEB is PolyWeather's forecast anchor for the 24-hour maximum temperature.",
            },
          ]
        : [
            {
              term: "edge",
              meaning:
                "edge 是模型概率减去市场隐含概率。正 edge 表示模型判断比市场价格更有利。",
            },
            {
              term: "EMOS",
              meaning: "EMOS 是最高温分桶的校准概率分布。",
            },
            {
              term: "DEB",
              meaning: "DEB 是 PolyWeather 对 24 小时最高温的预测锚点。",
            },
          ],
  };
}

function DetailPanel({
  row,
  marketScan,
  loading,
}: {
  row: ScanOpportunityRow | null;
  marketScan?: MarketScan | null;
  loading?: boolean;
}) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = store.proAccess.subscriptionActive;

  if (!row) {
    return (
      <aside className="scan-detail-panel">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "Pick a market row" : "选择一条机会"}
          </div>
          <div className="scan-empty-copy">
            {isEn ? "The right rail will show the main signal details." : "右侧会展示主信号详情。"}
          </div>
        </div>
      </aside>
    );
  }

  const localizedCityName = getLocalizedCityName(
    row.city,
    row.city_display_name || row.display_name || row.city,
    locale,
  );
  const localizedAirport = getLocalizedAirportName(row.city, row.airport || "", locale);
  const detailSignal = marketScan?.primary_signal as PrimarySignal | null | undefined;
  const displayRow =
    detailSignal && detailSignal.market_slug === row.market_slug
      ? detailSignal
      : row;
  const tempSymbol = row.temp_symbol || displayRow.temp_symbol || "°C";
  const yesRow = getSideRow(marketScan, row, "yes");
  const noRow = getSideRow(marketScan, row, "no");
  const comparisonBuckets = buildComparisonBuckets(marketScan, row);
  const maxBar = Math.max(
    1,
    ...comparisonBuckets.flatMap((bucket) => [bucket.model, bucket.market]),
  );
  const scoreClass = scoreTone(displayRow.final_score);
  const phaseMeta = getWindowPhaseMeta(displayRow, locale);
  const isCitySnapshot =
    String(row.window_phase || "").toLowerCase() === "city_snapshot" ||
    !row.market_slug;
  const cityDetail =
    store.selectedDetail?.name?.toLowerCase() === row.city.toLowerCase()
      ? store.selectedDetail
      : store.cityDetailsByName[row.city] || null;

  const openTodayAnalysis = async () => {
    if (!row.city) return;
    await store.selectCity(row.city);
    await store.openTodayModal();
  };

  return (
    <aside className="scan-detail-panel">
      <div className="scan-detail-header">
        <div className="scan-detail-top">
          <div className="scan-detail-title-wrap">
            <div className="scan-detail-city-name">{localizedCityName}</div>
            <div className="scan-detail-city-sub">
              {displayRow.market_question || displayRow.target_label || "--"}
            </div>
            <div className={`scan-phase-badge ${phaseMeta.tone}`}>
              {phaseMeta.label}
            </div>
          </div>
        </div>
      </div>

      <div className="scan-detail-volume-row">
        <div>
          <div className="scan-detail-volume-big">{formatVolume(displayRow.volume)}</div>
          <div className="scan-detail-volume-caption">
            {isEn ? "24h volume" : "24h 成交量"}
            {loading ? ` · ${isEn ? "loading" : "载入中"}` : ""}
          </div>
        </div>
      </div>

      <div className="scan-detail-primary-actions">
        <button
          type="button"
          className="scan-detail-analysis-button"
          onClick={() => void openTodayAnalysis()}
        >
          {isPro
            ? isEn
              ? "Today's Intraday Analysis"
              : "今日日内分析"
            : isEn
              ? "Today's Intraday Analysis · Pro"
              : "今日日内分析 · Pro"}
        </button>
      </div>

      <section className="scan-detail-section">
        <div className="scan-detail-section-title">
          {isEn ? "Current Context" : "当前概况"}
        </div>
        <div className="scan-kv-list">
          <div className="scan-kv">
            <span>{isEn ? "Local Time" : "当前时间"}</span>
            <strong>{row.local_time || "--"}</strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Current Temp" : "当前温度"}</span>
            <strong>
              {row.current_temp != null
                ? formatTemperatureValue(row.current_temp, tempSymbol)
                : "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Day High (So Far)" : "今日最高（至今）"}</span>
            <strong>
              {row.current_max_so_far != null
                ? formatTemperatureValue(row.current_max_so_far, tempSymbol)
                : "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Target" : "目标温度"}</span>
            <strong>
              {normalizeTemperatureLabel(displayRow.target_label, tempSymbol) || "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Gap To Target" : "距离目标"}</span>
            <strong className={Number(displayRow.gap_to_target || 0) <= 0 ? "warn" : "danger"}>
              {displayRow.gap_to_target != null
                ? formatTemperatureValue(displayRow.gap_to_target, tempSymbol, {
                    signed: true,
                    digits: 1,
                  })
                : "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Time To Peak" : "距离预测峰值"}</span>
            <strong>{formatRemainingWindow(displayRow.remaining_window_minutes, locale)}</strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Airport" : "机场锚点"}</span>
            <strong>{localizedAirport || "--"}</strong>
          </div>
        </div>
      </section>

      <section className="scan-detail-section">
        <div className="scan-timeline-head">
          <span>{cityDetail?.forecast?.sunrise || "--"}</span>
          <span>{cityDetail?.forecast?.sunset || "--"}</span>
        </div>
        <div className="scan-timeline-bar">
          <span
            className="scan-timeline-knob"
            style={{
              left: `${Math.max(
                8,
                Math.min(
                  92,
                  100 - Math.min(100, Number(displayRow.remaining_window_minutes || 0) / 9),
                ),
              )}%`,
            }}
          />
        </div>
        <div className="scan-timeline-caption">
          {isEn ? "Sunrise / Sunset" : "日出 / 日落"} · {phaseMeta.label}
        </div>
      </section>

      <section className="scan-detail-section">
        <div className="scan-detail-section-title">
          {isEn ? "Probability Comparison" : "概率分布对比"}
        </div>
        <div className="scan-chart-legend">
          <span>
            <i className="dot green" />
            {isEn ? "Model" : "模型预测"}
          </span>
          <span>
            <i className="dot blue" />
            {isEn ? "Market" : "市场隐含"}
          </span>
        </div>
        <div className="scan-chart-bars">
          {comparisonBuckets.map((bucket) => (
            <div
              key={bucket.label}
              className={`scan-chart-group ${bucket.highlighted ? "highlighted" : ""}`}
            >
              <div
                className="scan-chart-col model"
                style={{ height: `${Math.max(8, (bucket.model / maxBar) * 120)}px` }}
              />
              <div
                className="scan-chart-col market"
                style={{ height: `${Math.max(8, (bucket.market / maxBar) * 120)}px` }}
              />
              <div className="scan-chart-label">{bucket.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="scan-detail-section">
        <div className="scan-detail-section-title">
          {isEn ? "Main Signal" : "主信号概况"}
        </div>
        <div className="scan-kv-list compact">
          <div className="scan-kv">
            <span>{isEn ? "Best Side" : "主方向"}</span>
            <strong>
              {isCitySnapshot
                ? isEn
                  ? "Watch"
                  : "观察"
                : displayRow.side === "no"
                  ? "NO"
                  : "YES"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Best Buy" : "最优买价"}</span>
            <strong>
              {isCitySnapshot
                ? "--"
                : displayRow.side === "no"
                  ? formatPrice(getDetailSideAsk(noRow, marketScan, "no"))
                  : formatPrice(getDetailSideAsk(yesRow, marketScan, "yes"))}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "EMOS" : "EMOS 概率"}</span>
            <strong>
              {isCitySnapshot
                ? "--"
                : displayRow.side === "no"
                  ? formatProbability(noRow?.model_probability)
                  : formatProbability(yesRow?.model_probability)}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Edge" : "边际优势"}</span>
            <strong className={Number(displayRow.edge_percent || 0) >= 0 ? "positive" : "negative"}>
              {isCitySnapshot ? "--" : formatPercent(displayRow.edge_percent, true)}
            </strong>
          </div>
        </div>
      </section>

      <section className="scan-detail-score-block">
        <div className="scan-detail-score-head">
          <div>
            <div className="scan-detail-score-label-text">
              {isEn ? "Composite Score" : "综合得分"}
            </div>
            <div className="scan-detail-score-meta">
              {isEn ? "Confidence" : "置信度"}: {confidenceLabel(displayRow.final_score, locale)}
            </div>
          </div>
          <div className={`scan-detail-score-value ${scoreClass}`}>
            {isCitySnapshot ? "--" : Number(displayRow.final_score || 0).toFixed(0)}
            {!isCitySnapshot ? <span>/100</span> : null}
          </div>
        </div>
        <div className="scan-detail-score-line">
          <span style={{ width: `${Math.max(0, Math.min(100, Number(displayRow.final_score || 0)))}%` }} />
        </div>
      </section>
    </aside>
  );
}

function CalendarView({
  rows,
  locale,
  selectedRowId,
  onSelectRow,
}: {
  rows: ScanOpportunityRow[];
  locale: string;
  selectedRowId: string | null;
  onSelectRow: (row: ScanOpportunityRow) => void;
}) {
  const groups = useMemo(() => {
    const byDate = new Map<string, ScanOpportunityRow[]>();
    rows.forEach((row) => {
      const key = String(row.selected_date || row.local_date || "unknown");
      const list = byDate.get(key) || [];
      list.push(row);
      byDate.set(key, list);
    });
    return Array.from(byDate.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [rows]);

  if (!groups.length) {
    return (
      <div className="scan-empty-state compact">
        <div className="scan-empty-title">
          {locale === "en-US" ? "No dated opportunities" : "当前没有日期机会"}
        </div>
      </div>
    );
  }

  return (
    <div className="scan-calendar-view">
      {groups.map(([date, items]) => (
        <section key={date} className="scan-calendar-group">
          <div className="scan-calendar-group-head">
            <div className="scan-calendar-date">{formatShortDate(date, locale)}</div>
            <div className="scan-calendar-count">
              {locale === "en-US" ? `${items.length} rows` : `${items.length} 条`}
            </div>
          </div>
          <div className="scan-calendar-grid">
            {items.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`scan-calendar-card ${selectedRowId === row.id ? "selected" : ""}`}
                onClick={() => onSelectRow(row)}
              >
                {(() => {
                  const tempSymbol = row.temp_symbol || "°C";
                  const phaseMeta = getWindowPhaseMeta(row, locale);
                  return (
                    <>
                <div className="scan-calendar-city">
                  {getLocalizedCityName(
                    row.city,
                    row.city_display_name || row.display_name || row.city,
                    locale,
                  )}
                </div>
                <div className="scan-calendar-action">
                  {locale === "en-US" ? "DEB high" : "DEB 预测高点"} ·{" "}
                  {row.deb_prediction != null
                    ? formatTemperatureValue(row.deb_prediction, tempSymbol)
                    : "--"}
                </div>
                <div className="scan-calendar-meta">
                  <span>{row.local_time || "--"}</span>
                  <span>{phaseMeta.label}</span>
                </div>
                    </>
                  );
                })()}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OverviewMapView({ locale }: { locale: string }) {
  const store = useDashboardStore();

  return (
    <div className="scan-map-view">
      <div className="scan-map-shell">
        <MapCanvas />
      </div>
      <div className="scan-map-caption">
        {locale === "en-US"
          ? `Monitoring ${store.cities.length} cities on the original map canvas.`
          : `正在用原地图画布监控 ${store.cities.length} 个城市。`}
      </div>
    </div>
  );
}

function AssistantWidget({
  terminalData,
  rows,
  selectedRow,
  locale,
  totalCities,
}: {
  terminalData: ScanTerminalResponse | null;
  rows: ScanOpportunityRow[];
  selectedRow: ScanOpportunityRow | null;
  locale: string;
  totalCities: number;
}) {
  const isEn = locale === "en-US";
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>(() => [
    {
      id: "initial",
      role: "assistant",
      content: isEn
        ? "Ask about current opportunities, edge ranking, one city, or the forecast high. I only use the current scan data."
        : "可以问当前机会、edge 排序、某个城市是否值得参与，或今天预测最高温。我只使用当前扫描数据。",
    },
  ]);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const context = useMemo(
    () =>
      buildAssistantContext({
        terminalData,
        rows,
        selectedRow,
        locale,
        totalCities,
      }),
    [locale, rows, selectedRow, terminalData, totalCities],
  );

  useEffect(() => {
    setMessages((current) =>
      current[0]?.id === "initial"
        ? [
            {
              id: "initial",
              role: "assistant",
              content: isEn
                ? "Ask about current opportunities, edge ranking, one city, or the forecast high. I only use the current scan data."
                : "可以问当前机会、edge 排序、某个城市是否值得参与，或今天预测最高温。我只使用当前扫描数据。",
            },
            ...current.slice(1),
          ]
        : current,
    );
  }, [isEn]);

  useEffect(() => {
    const stored = window.localStorage.getItem("polyweather_ai_position_v1");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { x?: number; y?: number };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          setPosition({
            x: Math.min(Math.max(Number(parsed.x), 12), window.innerWidth - 72),
            y: Math.min(Math.max(Number(parsed.y), 76), window.innerHeight - 72),
          });
          return;
        }
      } catch {
        // Ignore invalid localStorage state.
      }
    }
    setPosition({
      x: Math.max(16, window.innerWidth - 88),
      y: Math.max(88, window.innerHeight - 96),
    });
  }, []);

  useEffect(() => {
    if (!position) return;
    window.localStorage.setItem(
      "polyweather_ai_position_v1",
      JSON.stringify(position),
    );
  }, [position]);

  const clampPosition = useCallback((nextX: number, nextY: number, isPanel: boolean) => {
    const width = isPanel ? Math.min(380, window.innerWidth - 32) : 56;
    const height = isPanel ? Math.min(520, window.innerHeight - 96) : 56;
    return {
      x: Math.min(Math.max(nextX, 12), Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(Math.max(nextY, 76), Math.max(76, window.innerHeight - height - 12)),
    };
  }, []);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!position) return;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
        moved: false,
      };
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [position],
  );

  const updateDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
        dragState.moved = true;
      }
      setPosition(
        clampPosition(dragState.originX + deltaX, dragState.originY + deltaY, open),
      );
    },
    [clampPosition, open],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (dragState?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDragging(false);
      if (dragState.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 160);
      }
      window.setTimeout(() => {
        dragStateRef.current = null;
      }, 0);
    }
  }, []);

  const starterQuestions = useMemo(() => {
    const cityName =
      context.selected_city?.city_display_name ||
      (isEn ? "the focus city" : "当前焦点城市");
    return isEn
      ? [
          "Which market is worth buying now?",
          "Rank opportunities by edge",
          `What is today's forecast high for ${cityName}?`,
        ]
      : [
          "当前有哪些值得参与的市场？",
          "按 edge 排序",
          `${cityName} 今天预测最高温是多少？`,
        ];
  }, [context.selected_city?.city_display_name, isEn]);

  const submitQuestion = useCallback(
    async (rawQuestion?: string) => {
      const nextQuestion = String(rawQuestion ?? question).trim();
      if (!nextQuestion || submitting) return;
      const userMessage: AssistantMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: nextQuestion,
      };
      setMessages((current) => [...current, userMessage]);
      setQuestion("");
      setError(null);
      setSubmitting(true);
      try {
        const response = await dashboardClient.askAssistant({
          question: nextQuestion,
          locale,
          snapshotId: context.snapshot_id,
          context,
        });
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: response.answer,
          },
        ]);
      } catch (submitError) {
        const message = String(submitError);
        const paywall =
          message.includes("402") || message.includes("assistant_requires_pro");
        setError(
          paywall
            ? isEn
              ? "PolyWeather AI assistant is a Pro feature."
              : "AI 对话助手属于 Pro 功能，请先开通后使用。"
            : isEn
              ? "Assistant request failed. Try again after the market scan refreshes."
              : "AI 请求失败。请等市场扫描刷新后再试。",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [context, isEn, locale, question, submitting],
  );

  const handleLauncherClick = useCallback(() => {
    if (suppressClickRef.current || dragStateRef.current?.moved) return;
    setOpen(true);
    setPosition((current) => {
      const next = current || {
        x: window.innerWidth - 420,
        y: window.innerHeight - 520,
      };
      return clampPosition(next.x, next.y, true);
    });
  }, [clampPosition]);

  if (!position) return null;

  return (
    <div
      className={clsx("home-ai-assistant", !open && "collapsed", dragging && "dragging")}
      style={{
        left: position.x,
        top: position.y,
        right: "auto",
        bottom: "auto",
        width: open ? "min(380px, calc(100vw - 32px))" : 56,
      }}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {!open ? (
        <button
          type="button"
          className="home-ai-launcher"
          aria-label={isEn ? "Open AI assistant" : "打开 AI 对话助手"}
          title={isEn ? "Open AI assistant" : "打开 AI 对话助手"}
          onPointerDown={startDrag}
          onClick={handleLauncherClick}
        >
          <img src="/favicon-32x32.png" alt="" className="home-ai-launcher-icon" />
        </button>
      ) : (
        <section className="home-ai-panel" aria-label={isEn ? "AI assistant" : "AI 对话助手"}>
          <div className="home-ai-header">
            <div>
              <strong>{isEn ? "AI Assistant" : "AI 对话助手"}</strong>
              <span>
                {isEn ? "Current market snapshot only" : "仅基于当前市场快照"}
              </span>
            </div>
            <div className="home-ai-header-actions">
              <button
                type="button"
                className="home-ai-drag-handle"
                aria-label={isEn ? "Move assistant" : "移动助手"}
                title={isEn ? "Move assistant" : "移动助手"}
                onPointerDown={startDrag}
              >
                ⋮⋮
              </button>
              <button
                type="button"
                className="home-ai-close"
                aria-label={isEn ? "Collapse assistant" : "收起助手"}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </div>

          <div className="home-ai-disclaimer">
            {isEn
              ? "Uses only scan data already provided by PolyWeather; no invented prices, probabilities, or cities."
              : "只使用 PolyWeather 当前扫描数据，不编造价格、概率或城市。"}
          </div>

          <div className="home-ai-messages" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={clsx("home-ai-message", message.role)}>
                <p>{message.content}</p>
              </div>
            ))}
            {submitting ? (
              <div className="home-ai-message assistant loading">
                <p>{isEn ? "Reading the current scan..." : "正在读取当前扫描数据..."}</p>
              </div>
            ) : null}
          </div>

          <div className="home-ai-starters">
            {starterQuestions.map((starter) => (
              <button
                key={starter}
                type="button"
                className="home-ai-starter"
                onClick={() => void submitQuestion(starter)}
              >
                {starter}
              </button>
            ))}
          </div>

          <div className="home-ai-composer">
            <textarea
              className="home-ai-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                isEn
                  ? "Ask about current opportunities, one city, or edge..."
                  : "询问当前机会、某个城市、edge 排序..."
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submitQuestion();
                }
              }}
            />
            <div className="home-ai-composer-actions">
              <span className="home-ai-error">{error}</span>
              <button
                type="button"
                className="home-ai-send"
                disabled={!question.trim() || submitting}
                onClick={() => void submitQuestion()}
              >
                {isEn ? "Send" : "发送"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const accountHref = store.proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [terminalData, setTerminalData] = useState<ScanTerminalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [detailByRowId, setDetailByRowId] = useState<Record<string, MarketScan | null>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ContentView>("list");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [userLocalTime, setUserLocalTime] = useState("--");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const deferredRows = useDeferredValue(terminalData?.rows || []);
  const timeSortedRows = useMemo(
    () => sortRowsByUserTime(deferredRows),
    [deferredRows],
  );

  const selectedRow = useMemo(() => {
    if (!timeSortedRows.length) return null;
    return timeSortedRows.find((row) => row.id === selectedRowId) || timeSortedRows[0] || null;
  }, [timeSortedRows, selectedRowId]);

  const mapFocusedRow = useMemo(() => {
    return findRowForCity(
      timeSortedRows,
      mapSelectedCityName || store.selectedCity,
    );
  }, [mapSelectedCityName, store.selectedCity, timeSortedRows]);

  const mapFallbackRow = useMemo(() => {
    const rawCityName = mapSelectedCityName || store.selectedCity;
    const cityKey = normalizeCityKey(rawCityName);
    if (!cityKey || mapFocusedRow) return null;
    const selectedDetail =
      store.selectedDetail && normalizeCityKey(store.selectedDetail.name) === cityKey
        ? store.selectedDetail
        : Object.values(store.cityDetailsByName).find(
            (detail) => normalizeCityKey(detail?.name) === cityKey,
          ) || null;
    const selectedSummary =
      Object.values(store.citySummariesByName).find(
        (summary) => normalizeCityKey(summary?.name) === cityKey,
      ) || null;
    const selectedCityItem =
      store.cities.find(
        (city) =>
          normalizeCityKey(city.name) === cityKey ||
          normalizeCityKey(city.display_name) === cityKey,
      ) || null;
    const canonicalCity =
      selectedDetail?.name ||
      selectedSummary?.name ||
      selectedCityItem?.name ||
      String(rawCityName || "").trim();
    if (!canonicalCity) return null;

    const tempSymbol =
      selectedDetail?.temp_symbol ||
      selectedSummary?.temp_symbol ||
      (selectedCityItem?.temp_unit === "fahrenheit" ? "°F" : "°C");
    const displayName =
      selectedDetail?.display_name ||
      selectedSummary?.display_name ||
      selectedCityItem?.display_name ||
      canonicalCity;
    const currentTemp =
      selectedDetail?.current?.temp ?? selectedSummary?.current?.temp ?? null;

    return {
      id: `map-city:${canonicalCity}`,
      city: canonicalCity,
      city_display_name: displayName,
      display_name: displayName,
      selected_date: selectedDetail?.local_date || null,
      local_date: selectedDetail?.local_date || null,
      local_time: selectedDetail?.local_time || selectedSummary?.local_time || null,
      temp_symbol: tempSymbol,
      current_temp: currentTemp,
      current_max_so_far:
        selectedDetail?.current?.max_so_far ?? currentTemp ?? null,
      deb_prediction:
        selectedDetail?.deb?.prediction ??
        selectedSummary?.deb?.prediction ??
        null,
      airport:
        selectedDetail?.risk?.airport ||
        selectedCityItem?.airport ||
        selectedCityItem?.settlement_station_label ||
        null,
      risk_level:
        selectedDetail?.risk?.level ||
        selectedSummary?.risk?.level ||
        selectedCityItem?.risk_level ||
        "low",
      market_slug: null,
      market_question: isEn ? "Current city snapshot" : "当前城市概况",
      target_label: isEn ? "City snapshot" : "城市概况",
      side: null,
      edge_percent: null,
      final_score: null,
      window_phase: "city_snapshot",
      tradable: false,
      active: false,
      closed: false,
      accepting_orders: false,
    } satisfies ScanOpportunityRow;
  }, [
    isEn,
    mapFocusedRow,
    mapSelectedCityName,
    store.cityDetailsByName,
    store.citySummariesByName,
    store.cities,
    store.selectedCity,
    store.selectedDetail,
  ]);

  const fetchTerminal = async (filters: FilterState, force = false) => {
    setLoading(true);
    try {
      const response = await dashboardClient.getScanTerminal(filters, { force });
      startTransition(() => {
        setTerminalData(response);
        setActiveFilters(filters);
        setError(response.status === "failed" ? response.stale_reason || null : null);
        setSelectedRowId((current) => {
          if (current && response.rows.some((row) => row.id === current)) {
            return current;
          }
          return sortRowsByUserTime(response.rows)[0]?.id || response.top_signal?.id || null;
        });
      });
    } catch (fetchError) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (row: ScanOpportunityRow) => {
    if (!row.market_slug || !row.selected_date || row.closed) return;
    if (detailByRowId[row.id] !== undefined) return;
    setDetailLoadingId(row.id);
    try {
      const response = await dashboardClient.getCityMarketScan(row.city, {
        force: false,
        marketSlug: row.market_slug,
        targetDate: row.selected_date,
      });
      setDetailByRowId((current) => ({
        ...current,
        [row.id]: response.market_scan || null,
      }));
    } catch {
      setDetailByRowId((current) => ({
        ...current,
        [row.id]: null,
      }));
    } finally {
      setDetailLoadingId((current) => (current === row.id ? null : current));
    }
  };

  useEffect(() => {
    void fetchTerminal(DEFAULT_FILTERS, false);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchTerminal(activeFilters, false);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [activeFilters]);

  useEffect(() => {
    setUserLocalTime(formatUserLocalTime());
    const intervalId = window.setInterval(() => {
      setUserLocalTime(formatUserLocalTime());
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("polyweather_scan_theme");
    if (stored === "light") {
      setThemeMode("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("polyweather_scan_theme", themeMode);
  }, [themeMode]);

  const resolvedView: ContentView = activeView;
  const mapFocusedCity = mapSelectedCityName || store.selectedCity;
  const activeDetailRow =
    resolvedView === "map" && mapFocusedCity
      ? mapFocusedRow || mapFallbackRow
      : selectedRow;
  const selectedDetail = activeDetailRow ? detailByRowId[activeDetailRow.id] : null;
  const scanStatus = terminalData?.status || (loading ? "loading" : error ? "failed" : "ready");
  const staleReason =
    terminalData?.stale_reason || error || null;

  useEffect(() => {
    if (!activeDetailRow) return;
    void fetchDetail(activeDetailRow);
    if (!store.cityDetailsByName[activeDetailRow.city]) {
      void store.ensureCityDetail(activeDetailRow.city, false, "panel").catch(() => {});
    }
  }, [activeDetailRow, detailByRowId]);

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    const matchedRow = findRowForCity(timeSortedRows, cityName);
    setSelectedRowId(matchedRow?.id || null);
  }, [timeSortedRows]);

  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    setSelectedRowId(row.id);
  }, []);

  const renderMainView = () => {
    if (resolvedView === "map") {
      return (
        <div className="scan-map-view">
          <div className="scan-map-shell">
            <MapCanvas onCitySelect={handleMapCitySelect} />
          </div>
          <div className="scan-map-caption">
            {locale === "en-US"
              ? `Monitoring ${store.cities.length} cities on the original map canvas.`
              : `正在用原地图画布监控 ${store.cities.length} 个城市。`}
          </div>
        </div>
      );
    }
    if (resolvedView === "calendar") {
      return (
        <CalendarView
          rows={timeSortedRows}
          locale={locale}
          selectedRowId={selectedRowId}
          onSelectRow={handleSelectRow}
        />
      );
    }
    return (
      <>
        <OpportunityTable
          rows={timeSortedRows}
          status={scanStatus}
          stale={Boolean(terminalData?.stale)}
          staleReason={staleReason}
          loading={loading}
          selectedRowId={selectedRowId}
          onSelectRow={handleSelectRow}
        />
      </>
    );
  };

  return (
    <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
      <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
        <ScanFilterPanel
          value={draftFilters}
          onChange={setDraftFilters}
          onScan={(filters) => {
            setDraftFilters(filters);
            void fetchTerminal(filters, true);
          }}
          isScanning={loading}
        />

        <main className="scan-data-grid">
          <div className="scan-topbar">
            <div className="scan-topbar-title">
              <strong>{isEn ? "Market Scan Terminal" : "市场扫描台"}</strong>
              <span>
                {loading
                  ? isEn
                    ? "Refreshing current market snapshot"
                    : "正在刷新当前市场快照"
                  : terminalData?.stale
                    ? isEn
                      ? "Showing the last successful snapshot"
                      : "当前显示上次成功快照"
                    : isEn
                      ? "Read-only market scan with peak-first main signal"
                      : "只读市场扫描，主信号按 EMOS 主峰优先"}
              </span>
            </div>
            <div className="scan-topbar-actions">
              <button
                type="button"
                className="scan-locale-switch"
                aria-label={isEn ? "Switch to Chinese" : "切换到英文"}
                title={isEn ? "Switch to Chinese" : "切换到英文"}
                onClick={toggleLocale}
              >
                <span className={clsx(locale === "zh-CN" && "active")}>中文</span>
                <span className={clsx(locale === "en-US" && "active")}>EN</span>
              </button>
              <span className="scan-topbar-time">
                {userLocalTime}
              </span>
              <button
                type="button"
                className="scan-theme-button"
                aria-label={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                title={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              >
                {themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}
              </button>
              <button type="button" className="scan-ghost-button" onClick={() => void fetchTerminal(activeFilters, true)}>
                <RefreshCw size={14} className={loading ? "spin" : undefined} />
                {isEn ? "Refresh" : "刷新"}
              </button>
              <Link
                href={accountHref}
                className="scan-account-button"
                aria-label={isEn ? "Account" : "账户"}
                title={isEn ? "Account" : "账户"}
              >
                <UserRound size={15} />
              </Link>
            </div>
          </div>

          <ScanKPIBar
            response={terminalData}
            rows={timeSortedRows}
            totalCities={store.cities.length}
            loading={loading}
          />

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs">
                <button
                  type="button"
                  className={resolvedView === "list" ? "active" : ""}
                  onClick={() => {
                    setActiveView("list");
                  }}
                >
                  {isEn ? "Opportunity List" : "机会列表"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "map" ? "active" : ""}
                  onClick={() => {
                    setActiveView("map");
                  }}
                >
                  {isEn ? "Distribution View" : "分布视图"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "calendar" ? "active" : ""}
                  onClick={() => {
                    setActiveView("calendar");
                  }}
                >
                  {isEn ? "Calendar View" : "日历视图"}
                </button>
              </div>
              <div className="scan-list-status">
                {terminalData?.stale ? (
                  <span className="scan-status-chip stale">
                    {isEn ? "Delayed snapshot" : "延迟快照"}
                  </span>
                ) : null}
                {loading ? (
                  <span className="scan-status-chip live">
                    {isEn ? "Refreshing" : "刷新中"}
                  </span>
                ) : null}
              </div>
            </div>

            {scanStatus === "failed" && !terminalData ? (
              <div className="scan-empty-state">
                <div className="scan-empty-title">
                  {isEn ? "Scan failed" : "扫描失败"}
                </div>
                <div className="scan-empty-copy">{staleReason}</div>
              </div>
            ) : (
              renderMainView()
            )}
          </section>
        </main>

        <DetailPanel
          row={activeDetailRow}
          marketScan={selectedDetail}
          loading={detailLoadingId === activeDetailRow?.id}
        />
        <AssistantWidget
          terminalData={terminalData}
          rows={timeSortedRows}
          selectedRow={activeDetailRow}
          locale={locale}
          totalCities={store.cities.length}
        />
      </div>
    </div>
  );
}

export function ScanTerminalDashboard() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <ScanTerminalScreen />
        <FutureForecastModal />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
