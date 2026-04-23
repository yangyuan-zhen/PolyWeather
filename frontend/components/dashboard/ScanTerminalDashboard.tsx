"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  Bell,
  Menu,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import {
  startTransition,
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
  const { locale } = useI18n();
  const isEn = locale === "en-US";

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
  const yesRow = getSideRow(marketScan, row, "yes");
  const noRow = getSideRow(marketScan, row, "no");
  const comparisonBuckets = buildComparisonBuckets(marketScan, row);
  const maxBar = Math.max(
    1,
    ...comparisonBuckets.flatMap((bucket) => [bucket.model, bucket.market]),
  );
  const scoreClass = scoreTone(displayRow.final_score);
  const phaseMeta = getWindowPhaseMeta(displayRow, locale);

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
        <button type="button" className="scan-detail-icon-button" aria-label="close">
          <X size={16} />
        </button>
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
              {row.current_temp != null ? `${row.current_temp}${row.temp_symbol || ""}` : "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Day High (So Far)" : "今日最高（至今）"}</span>
            <strong>
              {row.current_max_so_far != null
                ? `${row.current_max_so_far}${row.temp_symbol || ""}`
                : "--"}
            </strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Target" : "目标温度"}</span>
            <strong>{displayRow.target_label || "--"}</strong>
          </div>
          <div className="scan-kv">
            <span>{isEn ? "Gap To Target" : "距离目标"}</span>
            <strong className={Number(displayRow.gap_to_target || 0) <= 0 ? "warn" : "danger"}>
              {displayRow.gap_to_target != null
                ? `${displayRow.gap_to_target >= 0 ? "+" : ""}${displayRow.gap_to_target.toFixed(1)}${row.temp_symbol || ""}`
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
          <span>00:00</span>
          <span>23:59</span>
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
          {phaseMeta.label}
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
              {isEn ? "Buy Yes" : "买入 Yes"} {displayRow.target_label || ""}
            </div>
            <p>
              {formatPrice(yesRow?.ask ?? marketScan?.yes_buy)} →{" "}
              {formatProbability(yesRow?.model_probability)}
            </p>
            <p className="positive">{formatPercent(yesRow?.edge_percent, true)} {isEn ? "edge" : "边际优势"}</p>
            <p>{isEn ? "Spread" : "点差"} {formatPrice(yesRow?.spread)}</p>
          </div>
          <div className="scan-trade-card sell">
            <div className="scan-trade-card-title">
              {isEn ? "Buy No" : "买入 No"} {displayRow.target_label || ""}
            </div>
            <p>
              {formatPrice(noRow?.ask ?? marketScan?.no_buy)} →{" "}
              {formatProbability(noRow?.model_probability)}
            </p>
            <p className={Number(noRow?.edge_percent || 0) >= 0 ? "positive" : "negative"}>
              {formatPercent(noRow?.edge_percent, true)} {isEn ? "edge" : "边际优势"}
            </p>
            <p>{isEn ? "Spread" : "点差"} {formatPrice(noRow?.spread)}</p>
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
  const deferredRows = useDeferredValue(terminalData?.rows || []);

  const selectedRow = useMemo(() => {
    if (!deferredRows.length) return null;
    return deferredRows.find((row) => row.id === selectedRowId) || deferredRows[0] || null;
  }, [deferredRows, selectedRowId]);

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
          return response.top_signal?.id || response.rows[0]?.id || null;
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
    if (!selectedRow) return;
    void fetchDetail(selectedRow);
  }, [selectedRow, detailByRowId]);

  const selectedDetail = selectedRow ? detailByRowId[selectedRow.id] : null;

  return (
    <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
      <div className="scan-terminal">
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
                  className={`scan-topbar-tab ${index === 0 ? "active" : ""}`}
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
                {selectedRow?.local_time || terminalData?.generated_at?.replace("T", " ").slice(11, 19) || "--"}
              </span>
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
                <button type="button" className="active">
                  {isEn ? "Opportunity List" : "机会列表"}
                </button>
                <button type="button">{isEn ? "Distribution View" : "分布视图"}</button>
                <button type="button">{isEn ? "Calendar View" : "日历视图"}</button>
              </div>
              <div className="scan-list-controls">
                <div className="scan-sort-pill">
                  {isEn ? "Sort: Score" : "排序：综合得分"}
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
              <>
                <OpportunityTable
                  rows={deferredRows}
                  selectedRowId={selectedRowId}
                  onSelectRow={(row) => setSelectedRowId(row.id)}
                />
                {deferredRows.length ? (
                  <div className="scan-view-all-wrap">
                    <button type="button" className="scan-view-all-button">
                      {isEn
                        ? `View all ${deferredRows.length} opportunities`
                        : `查看全部 ${deferredRows.length} 个机会`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </main>

        <DetailPanel
          row={selectedRow}
          marketScan={selectedDetail}
          loading={detailLoadingId === selectedRow?.id}
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
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
