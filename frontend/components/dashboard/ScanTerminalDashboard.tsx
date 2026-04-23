"use client";

import clsx from "clsx";
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
import { HeaderBar } from "@/components/dashboard/HeaderBar";
import {
  FilterState,
  ScanFilterPanel,
} from "@/components/dashboard/ScanFilterPanel";
import { ScanKPIBar } from "@/components/dashboard/ScanKPIBar";
import { OpportunityTable } from "@/components/dashboard/OpportunityTable";
import { DashboardStoreProvider, useDashboardStore } from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { dashboardClient } from "@/lib/dashboard-client";
import type {
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
  min_liquidity: 500,
  high_liquidity_only: false,
  market_type: "maxtemp",
  time_range: "today",
  limit: 25,
};

function formatPercent(value?: number | null, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  if (!signed) return `${numeric.toFixed(1)}%`;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
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

function formatMinutes(value?: number | null, locale = "zh-CN") {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const numeric = Math.max(0, Math.round(Number(value)));
  if (locale === "en-US") return `${numeric}m`;
  return `${numeric} 分钟`;
}

function scoreTone(score?: number | null) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return "green";
  if (numeric >= 70) return "amber";
  return "red";
}

function confidenceDotCount(score?: number | null) {
  const numeric = Number(score || 0);
  if (numeric >= 90) return 5;
  if (numeric >= 80) return 4;
  if (numeric >= 70) return 3;
  if (numeric >= 60) return 2;
  if (numeric > 0) return 1;
  return 0;
}

function getSideRow(
  marketScan: MarketScan | null | undefined,
  selectedRow: ScanOpportunityRow,
  side: "yes" | "no",
) {
  const rows = Array.isArray(marketScan?.scan_rows) ? marketScan?.scan_rows : [];
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
        <div className="scan-detail-empty">
          {isEn ? "Select a row to inspect the main signal." : "选择一条机会，查看主信号详情。"}
        </div>
      </aside>
    );
  }

  const localizedCityName = getLocalizedCityName(
    row.city,
    row.city_display_name || row.display_name || row.city,
    locale,
  );
  const localizedAirport = getLocalizedAirportName(
    row.city,
    row.airport || "",
    locale,
  );
  const detailSignal = marketScan?.primary_signal as PrimarySignal | null | undefined;
  const displayRow = detailSignal && detailSignal.market_slug === row.market_slug ? detailSignal : row;
  const distributionBias = marketScan?.distribution_bias || row.distribution_bias || null;
  const yesRow = getSideRow(marketScan, row, "yes");
  const noRow = getSideRow(marketScan, row, "no");
  const tone = scoreTone(displayRow.final_score);
  const filledDots = confidenceDotCount(displayRow.final_score);

  return (
    <aside className="scan-detail-panel">
      <div className="scan-detail-header">
        <div className="scan-detail-hero-placeholder" />
        <div className="scan-detail-city-info">
          <div className="scan-detail-city-name">{localizedCityName}</div>
          <div className="scan-detail-city-sub">
            {displayRow.market_question || displayRow.target_label || "--"}
          </div>
          <div className="scan-detail-volume">
            {formatVolume(displayRow.volume)}{" "}
            {isEn ? "24h volume" : "24h 成交量"}
            {loading ? ` · ${isEn ? "loading" : "载入中"}` : ""}
          </div>
        </div>
      </div>

      <div className="scan-detail-section">
        <div className="scan-detail-section-title">
          {isEn ? "Current Context" : "当前概况"}
        </div>
        <div className="scan-conditions-table">
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Local Time" : "当地时间"}
            </span>
            <span className="scan-condition-value">{row.local_time || "--"}</span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Current Temp" : "当前温度"}
            </span>
            <span className="scan-condition-value">
              {row.current_temp != null ? `${row.current_temp}${row.temp_symbol || ""}` : "--"}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Day High (So Far)" : "今日高点（至今）"}
            </span>
            <span className="scan-condition-value">
              {row.current_max_so_far != null
                ? `${row.current_max_so_far}${row.temp_symbol || ""}`
                : "--"}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Target" : "目标温度"}
            </span>
            <span className="scan-condition-value">
              {displayRow.target_label || "--"}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Gap To Target" : "距目标"}
            </span>
            <span
              className={clsx(
                "scan-condition-value",
                Number(displayRow.gap_to_target || 0) <= 0
                  ? "accent-green"
                  : "accent-red",
              )}
            >
              {displayRow.gap_to_target != null
                ? `${displayRow.gap_to_target >= 0 ? "+" : ""}${displayRow.gap_to_target.toFixed(1)}${row.temp_symbol || ""}`
                : "--"}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Window Left" : "剩余有效时间"}
            </span>
            <span className="scan-condition-value">
              {formatMinutes(displayRow.remaining_window_minutes, locale)}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Bias" : "分布偏移"}
            </span>
            <span className="scan-condition-value">
              {distributionBias?.direction || "--"} ·{" "}
              {distributionBias?.score != null
                ? distributionBias.score.toFixed(0)
                : "--"}
            </span>
          </div>
          <div className="scan-condition-item">
            <span className="scan-condition-label">
              {isEn ? "Airport" : "机场锚点"}
            </span>
            <span className="scan-condition-value">{localizedAirport || "--"}</span>
          </div>
        </div>
      </div>

      <div className="scan-detail-section">
        <div className="scan-detail-section-title">
          {isEn ? "Recommended Trade" : "推荐交易"}
        </div>
        <div className="scan-trade-cards">
          <div className="scan-trade-card yes">
            <div className="scan-trade-card-title">BUY YES</div>
            <div className="scan-trade-card-price">
              {formatPrice(yesRow?.ask ?? marketScan?.yes_buy)} / {formatProbability(yesRow?.model_probability)}
            </div>
            <div
              className={clsx(
                "scan-trade-card-edge",
                Number(yesRow?.edge_percent || 0) >= 0 ? "positive" : "negative",
              )}
            >
              {formatPercent(yesRow?.edge_percent, true)}
            </div>
            <div className="scan-trade-card-note">
              {isEn ? "Spread" : "点差"} {formatPrice(yesRow?.spread)} ·{" "}
              {isEn ? "Liquidity" : "流动性"} {formatVolume(yesRow?.book_liquidity ?? yesRow?.market_liquidity)}
            </div>
          </div>
          <div className="scan-trade-card no">
            <div className="scan-trade-card-title">BUY NO</div>
            <div className="scan-trade-card-price">
              {formatPrice(noRow?.ask ?? marketScan?.no_buy)} / {formatProbability(noRow?.model_probability)}
            </div>
            <div
              className={clsx(
                "scan-trade-card-edge",
                Number(noRow?.edge_percent || 0) >= 0 ? "positive" : "negative",
              )}
            >
              {formatPercent(noRow?.edge_percent, true)}
            </div>
            <div className="scan-trade-card-note">
              {isEn ? "Spread" : "点差"} {formatPrice(noRow?.spread)} ·{" "}
              {isEn ? "Liquidity" : "流动性"} {formatVolume(noRow?.book_liquidity ?? noRow?.market_liquidity)}
            </div>
          </div>
        </div>
      </div>

      <div className="scan-detail-score">
        <div>
          <div className="scan-detail-score-big">
            {Number(displayRow.final_score || 0).toFixed(0)}
            <span className="scan-detail-score-suffix">/100</span>
          </div>
          <div className="scan-detail-score-label">
            {isEn ? "Composite signal score" : "综合主信号评分"}
          </div>
        </div>
        <div className="scan-confidence-dots">
          {Array.from({ length: 5 }).map((_, index) => {
            const filled = index < filledDots;
            return (
              <span
                key={index}
                className={clsx(
                  "scan-confidence-dot",
                  filled && "filled",
                  filled && tone === "amber" && "amber",
                  filled && tone === "red" && "red",
                )}
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
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
    return (
      deferredRows.find((row) => row.id === selectedRowId) ||
      deferredRows[0] ||
      null
    );
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
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeFilters]);

  useEffect(() => {
    if (!selectedRow) return;
    void fetchDetail(selectedRow);
  }, [selectedRow, detailByRowId]);

  const selectedDetail = selectedRow ? detailByRowId[selectedRow.id] : null;

  return (
    <div
      className={clsx(
        styles.root,
        detailChromeStyles.root,
        modalChromeStyles.root,
      )}
    >
      <HeaderBar
        refreshAction={() => fetchTerminal(activeFilters, true)}
        refreshSpinning={loading || store.loadingState.refresh}
      />

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
          <div className="scan-data-grid-header">
            <div>
              <div className="scan-data-grid-title">
                {isEn ? "Tradable Opportunities" : "可交易机会"}
              </div>
              <div className="scan-data-grid-subtitle">
                {isEn
                  ? "REST-only EMOS scan with one main signal per city/date."
                  : "基于 EMOS 分布与 CLOB REST 盘口，只输出每个城市/日期的单一主信号。"}
              </div>
            </div>
            <div className="scan-data-grid-controls">
              <span className="scan-status-badge tone-neutral">
                {isEn ? "Updated" : "数据时间"} ·{" "}
                {terminalData?.generated_at
                  ? terminalData.generated_at.replace("T", " ").slice(0, 19)
                  : "--"}
              </span>
            </div>
          </div>

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

          <div className="scan-view-tabs">
            <button type="button" className="scan-view-tab active">
              {isEn ? "Opportunity List" : "机会列表"}
            </button>
          </div>

          {error ? (
            <div className="scan-detail-empty">
              {isEn ? "Scan failed." : "扫描失败。"} {error}
            </div>
          ) : (
            <OpportunityTable
              rows={deferredRows}
              selectedRowId={selectedRowId}
              onSelectRow={(row) => setSelectedRowId(row.id)}
            />
          )}
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
