"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  Bell,
  Menu,
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
import { dashboardClient } from "@/lib/dashboard-client";
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

const NAV_ITEMS = [
  { zh: "扫描台", en: "Terminal" },
  { zh: "市场", en: "Markets" },
  { zh: "分析", en: "Analysis" },
  { zh: "组合", en: "Portfolio" },
  { zh: "监控", en: "Monitor" },
  { zh: "设置", en: "Settings" },
];

type TopSection = "terminal" | "markets" | "analysis" | "portfolio" | "monitor" | "settings";
type ContentView = "list" | "map" | "calendar";
type ThemeMode = "dark" | "light";
const TOP_SECTION_ORDER: TopSection[] = [
  "terminal",
  "markets",
  "analysis",
  "portfolio",
  "monitor",
  "settings",
];

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
        <button type="button" className="scan-detail-action-button">
          {isEn ? "Add Watch" : "添加自选"}
        </button>
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
            <span>{isEn ? "Window Left" : "剩余有效时间"}</span>
            <strong>{formatRemainingWindow(displayRow.remaining_window_minutes, locale)}</strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Bias" : "分布偏移"}</span>
            <strong>
              {displayRow.distribution_bias_direction || "--"} ·{" "}
              {displayRow.distribution_bias_score != null
                ? displayRow.distribution_bias_score.toFixed(0)
                : "--"}
            </strong>
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
        <div className="scan-trade-cards">
          <div className="scan-trade-card buy">
            <div className="scan-trade-card-title">
              {isEn ? "Buy Yes" : "买入 Yes"}{" "}
              {normalizeTemperatureLabel(displayRow.target_label, tempSymbol) || ""}
            </div>
            <p>
              {formatPrice(getDetailSideAsk(yesRow, marketScan, "yes"))} →{" "}
              {formatProbability(yesRow?.model_probability)}
            </p>
            <p className="positive">{formatPercent(yesRow?.edge_percent, true)} {isEn ? "edge" : "边际优势"}</p>
            <p>
              {isEn ? "Bid / Ask" : "买卖价"} {formatPrice(getDetailSideBid(yesRow, marketScan, "yes"))} /{" "}
              {formatPrice(getDetailSideAsk(yesRow, marketScan, "yes"))}
            </p>
          </div>
          <div className="scan-trade-card sell">
            <div className="scan-trade-card-title">
              {isEn ? "Buy No" : "买入 No"}{" "}
              {normalizeTemperatureLabel(displayRow.target_label, tempSymbol) || ""}
            </div>
            <p>
              {formatPrice(getDetailSideAsk(noRow, marketScan, "no"))} →{" "}
              {formatProbability(noRow?.model_probability)}
            </p>
            <p className={Number(noRow?.edge_percent || 0) >= 0 ? "positive" : "negative"}>
              {formatPercent(noRow?.edge_percent, true)} {isEn ? "edge" : "边际优势"}
            </p>
            <p>
              {isEn ? "Bid / Ask" : "买卖价"} {formatPrice(getDetailSideBid(noRow, marketScan, "no"))} /{" "}
              {formatPrice(getDetailSideAsk(noRow, marketScan, "no"))}
            </p>
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
            {Number(displayRow.final_score || 0).toFixed(0)}
            <span>/100</span>
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
                <div className="scan-calendar-city">
                  {getLocalizedCityName(
                    row.city,
                    row.city_display_name || row.display_name || row.city,
                    locale,
                  )}
                </div>
                <div className={`scan-calendar-action ${row.side === "no" ? "sell" : "buy"}`}>
                  {row.action || row.target_label || "--"}
                </div>
                <div className="scan-calendar-meta">
                  <span>{row.local_time || "--"}</span>
                  <span>{formatPercent(row.edge_percent, true)}</span>
                </div>
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

function PortfolioView({
  rows,
  locale,
}: {
  rows: ScanOpportunityRow[];
  locale: string;
}) {
  const yesCount = rows.filter((row) => row.side === "yes").length;
  const noCount = rows.filter((row) => row.side === "no").length;
  const avgScore =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + Number(row.final_score || 0), 0) / rows.length
      : null;

  return (
    <div className="scan-summary-grid">
      <div className="scan-summary-card">
        <div className="scan-summary-label">{locale === "en-US" ? "YES Ideas" : "YES 机会"}</div>
        <div className="scan-summary-value">{yesCount}</div>
      </div>
      <div className="scan-summary-card">
        <div className="scan-summary-label">{locale === "en-US" ? "NO Ideas" : "NO 机会"}</div>
        <div className="scan-summary-value">{noCount}</div>
      </div>
      <div className="scan-summary-card wide">
        <div className="scan-summary-label">{locale === "en-US" ? "Avg Score" : "平均评分"}</div>
        <div className="scan-summary-value">
          {avgScore != null ? `${avgScore.toFixed(0)}/100` : "--"}
        </div>
      </div>
    </div>
  );
}

function MonitorView({
  rows,
  locale,
}: {
  rows: ScanOpportunityRow[];
  locale: string;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, number>();
    rows.forEach((row) => {
      const label = getWindowPhaseMeta(row, locale).label;
      result.set(label, (result.get(label) || 0) + 1);
    });
    return Array.from(result.entries());
  }, [rows, locale]);

  return (
    <div className="scan-summary-grid monitor">
      {groups.map(([label, count]) => (
        <div key={label} className="scan-summary-card">
          <div className="scan-summary-label">{label}</div>
          <div className="scan-summary-value">{count}</div>
        </div>
      ))}
    </div>
  );
}

function SettingsView({ locale }: { locale: string }) {
  return (
    <div className="scan-settings-view">
      <div className="scan-settings-card">
        <div className="scan-summary-label">{locale === "en-US" ? "Market Discovery" : "市场发现"}</div>
        <div className="scan-settings-copy">
          {locale === "en-US" ? "Gamma REST refreshes every 60s." : "Gamma REST 每 60 秒刷新一次。"}
        </div>
      </div>
      <div className="scan-settings-card">
        <div className="scan-summary-label">{locale === "en-US" ? "Price Layer" : "价格层"}</div>
        <div className="scan-settings-copy">
          {locale === "en-US"
            ? "CLOB REST prices and books refresh every 30s."
            : "CLOB REST 价格和盘口每 30 秒刷新一次。"}
        </div>
      </div>
      <div className="scan-settings-card">
        <div className="scan-summary-label">{locale === "en-US" ? "Server Profile" : "服务器配置"}</div>
        <div className="scan-settings-copy">
          {locale === "en-US"
            ? "2GB profile: one polling loop, cached REST, no websocket fan-out."
            : "2G 配置：单轮询、REST 缓存优先、不做 websocket 扇出。"}
        </div>
      </div>
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
  const [activeSection, setActiveSection] = useState<TopSection>("terminal");
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
    const cityName = String(mapSelectedCityName || store.selectedCity || "").toLowerCase();
    if (!cityName) return null;
    return (
      timeSortedRows.find(
        (row) =>
          row.city.toLowerCase() === cityName ||
          String(row.city_display_name || row.display_name || "").toLowerCase() === cityName,
      ) || null
    );
  }, [mapSelectedCityName, store.selectedCity, timeSortedRows]);

  const fetchTerminal = async (filters: FilterState, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardClient.getScanTerminal(filters, { force });
      startTransition(() => {
        setTerminalData(response);
        setActiveFilters(filters);
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
    if (!row.market_slug || !row.selected_date) return;
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

  const mapFocusedCity = mapSelectedCityName || store.selectedCity;
  const resolvedView: ContentView =
    activeSection === "markets"
      ? "map"
      : activeSection === "analysis"
        ? "calendar"
        : activeView;
  const activeDetailRow = resolvedView === "map" && mapFocusedCity ? mapFocusedRow : selectedRow;
  const selectedDetail = activeDetailRow ? detailByRowId[activeDetailRow.id] : null;

  useEffect(() => {
    if (!activeDetailRow) return;
    void fetchDetail(activeDetailRow);
    if (!store.cityDetailsByName[activeDetailRow.city]) {
      void store.ensureCityDetail(activeDetailRow.city, false, "panel").catch(() => {});
    }
  }, [activeDetailRow, detailByRowId]);

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    const matchedRow =
      timeSortedRows.find(
        (row) =>
          row.city.toLowerCase() === cityName.toLowerCase() ||
          String(row.city_display_name || row.display_name || "").toLowerCase() === cityName.toLowerCase(),
      ) || null;
    setSelectedRowId(matchedRow?.id || null);
  }, [timeSortedRows]);

  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    setSelectedRowId(row.id);
  }, []);

  const renderMainView = () => {
    if (activeSection === "portfolio") {
      return <PortfolioView rows={timeSortedRows} locale={locale} />;
    }
    if (activeSection === "monitor") {
      return <MonitorView rows={timeSortedRows} locale={locale} />;
    }
    if (activeSection === "settings") {
      return <SettingsView locale={locale} />;
    }
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
            <div className="scan-topbar-tabs">
              {NAV_ITEMS.map((item, index) => (
                <button
                  key={item.zh}
                  type="button"
                  className={`scan-topbar-tab ${
                    TOP_SECTION_ORDER[index] === activeSection ? "active" : ""
                  }`}
                  onClick={() => setActiveSection(TOP_SECTION_ORDER[index])}
                >
                  {isEn ? item.en : item.zh}
                </button>
              ))}
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
                {isEn ? "Refresh" : "筛选"}
              </button>
              <button type="button" className="scan-cta-ghost">
                <Bell size={14} />
                {isEn ? "Custom Alerts" : "自定义提醒"}
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

          <section className="scan-hero">
            <h1>{isEn ? "Tradable Opportunities" : "可交易机会"}</h1>
            <p>
              {isEn
                ? "Use EMOS distribution, live order book, and timing windows to isolate the one actionable signal."
                : "基于当前时间、实况数据和模型预测，筛选出最具交易价值的市场。"}
            </p>
          </section>

          <ScanKPIBar
            data={
              terminalData?.summary || {
                recommended_count: 0,
                visible_count: 0,
                candidate_total: 0,
                avg_edge_percent: null,
                avg_primary_confidence: null,
                tradable_market_count: 0,
                total_volume: 0,
                resolved_market_type: "maxtemp",
              }
            }
          />

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs">
                <button
                  type="button"
                  className={activeSection === "terminal" && resolvedView === "list" ? "active" : ""}
                  onClick={() => {
                    setActiveSection("terminal");
                    setActiveView("list");
                  }}
                >
                  {isEn ? "Opportunity List" : "机会列表"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "map" ? "active" : ""}
                  onClick={() => {
                    setActiveSection("terminal");
                    setActiveView("map");
                  }}
                >
                  {isEn ? "Distribution View" : "分布视图"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "calendar" ? "active" : ""}
                  onClick={() => {
                    setActiveSection("terminal");
                    setActiveView("calendar");
                  }}
                >
                  {isEn ? "Calendar View" : "日历视图"}
                </button>
              </div>
              <div className="scan-list-controls">
                <div className="scan-sort-pill">
                  {isEn
                    ? resolvedView === "calendar"
                      ? "Sort: Date"
                    : resolvedView === "map"
                        ? "Sort: City Map"
                        : "Sort: Your Time"
                    : resolvedView === "calendar"
                      ? "排序：日期"
                      : resolvedView === "map"
                        ? "排序：地图"
                        : "排序：用户时区时间"}
                </div>
                <button type="button" className="scan-icon-pill" aria-label="menu">
                  <Menu size={16} />
                </button>
              </div>
            </div>

            {error ? (
              <div className="scan-empty-state">
                <div className="scan-empty-title">
                  {isEn ? "Scan failed" : "扫描失败"}
                </div>
                <div className="scan-empty-copy">{error}</div>
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
