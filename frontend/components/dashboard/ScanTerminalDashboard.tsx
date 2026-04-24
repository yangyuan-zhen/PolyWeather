"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  LogIn,
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
import { DetailPanel as CityDetailPanel } from "@/components/dashboard/DetailPanel";
import { FutureForecastModal } from "@/components/dashboard/FutureForecastModal";
import { MapCanvas } from "@/components/dashboard/MapCanvas";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import { ScanKPIBar } from "@/components/dashboard/ScanKPIBar";
import { OpportunityTable } from "@/components/dashboard/OpportunityTable";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { dashboardClient } from "@/lib/dashboard-client";
import type {
  ScanOpportunityRow,
  ScanTerminalFilters,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
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

const SCAN_AUTO_REFRESH_MS = 5 * 60 * 1000;

interface FilterState extends ScanTerminalFilters {}

type ContentView = "list" | "map" | "calendar";
type ThemeMode = "dark" | "light";
type ScanAiLogTone = "info" | "success" | "warning" | "error";

type ScanAiLogEntry = {
  id: string;
  time: string;
  tone: ScanAiLogTone;
  title: string;
  detail?: string | null;
};

function formatLogTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

function formatDuration(ms?: number | null) {
  if (ms == null || !Number.isFinite(Number(ms))) return "--";
  if (Number(ms) < 1000) return `${Math.round(Number(ms))}ms`;
  return `${(Number(ms) / 1000).toFixed(1)}s`;
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

function formatCountdownMinutes(value?: number | null, locale = "zh-CN") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const minutes = Math.max(0, Math.round(Math.abs(numeric)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m`;
    if (remains <= 0) return `${hours}h`;
    return `${hours}h ${remains}m`;
  }
  if (hours <= 0) return `${remains} 分钟`;
  if (remains <= 0) return `${hours} 小时`;
  return `${hours} 小时 ${remains} 分钟`;
}

function getPeakWindowLabel(row: ScanOpportunityRow) {
  const direct = String(row.peak_window_label || "").trim();
  if (direct) return direct;
  const start = String(row.peak_window_start || "").trim();
  const end = String(row.peak_window_end || "").trim();
  if (start && end) return `${start}-${end}`;
  return "--";
}

function getPeakCountdownMeta(row: ScanOpportunityRow, locale = "zh-CN") {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const startDelta = Number(row.minutes_until_peak_start);
  const endDelta = Number(row.minutes_until_peak_end);
  const hasStart = Number.isFinite(startDelta);
  const hasEnd = Number.isFinite(endDelta);

  if (phase === "active_peak" || (hasStart && startDelta <= 0 && hasEnd && endDelta >= 0)) {
    return {
      key: "active",
      groupLabel: isEn ? "Peak window now" : "峰值窗口进行中",
      tone: "active",
      sort: 0,
      title: isEn ? "At peak window" : "已进入峰值窗口",
      detail:
        hasEnd && endDelta >= 0
          ? isEn
            ? `${formatCountdownMinutes(endDelta, locale)} left`
            : `剩余 ${formatCountdownMinutes(endDelta, locale)}`
          : getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 180) {
    return {
      key: "next",
      groupLabel: isEn ? "Next 3 hours" : "未来 3 小时到峰值",
      tone: "next",
      sort: 1000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 1440) {
    return {
      key: "today",
      groupLabel: isEn ? "Later today" : "今日稍后",
      tone: "upcoming",
      sort: 2000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 1440) {
    return {
      key: "later",
      groupLabel: isEn ? "Later sessions" : "后续交易时段",
      tone: "later",
      sort: 3000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  return {
    key: "past",
    groupLabel: isEn ? "Past peak" : "峰值已过",
    tone: "past",
    sort: 9000 + Math.abs(startDelta || 0),
    title:
      hasEnd && endDelta < 0
        ? isEn
          ? `Peak passed ${formatCountdownMinutes(endDelta, locale)} ago`
          : `峰值已过 ${formatCountdownMinutes(endDelta, locale)}`
        : isEn
          ? "Peak window passed"
          : "峰值窗口已过",
    detail: getPeakWindowLabel(row),
  };
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

function getRowAiReason(row: ScanOpportunityRow, locale: string) {
  const isEn = locale === "en-US";
  return (
    (isEn ? row.ai_reason_en || row.ai_reason_zh : row.ai_reason_zh || row.ai_reason_en) ||
    row.ai_model_cluster_note ||
    (isEn
      ? row.ai_watchlist_reason_en || row.ai_watchlist_reason_zh
      : row.ai_watchlist_reason_zh || row.ai_watchlist_reason_en) ||
    null
  );
}

function getAiDecisionLabel(row: ScanOpportunityRow, locale: string) {
  const decision = String(row.ai_decision || "neutral").toLowerCase();
  if (decision === "veto") return locale === "en-US" ? "Excluded" : "排除";
  if (decision === "downgrade") return locale === "en-US" ? "Downgraded" : "降级";
  if (decision === "watchlist") return locale === "en-US" ? "Watch" : "观察";
  if (row.ai_rank != null || decision === "approve") {
    return locale === "en-US" ? `Pick ${row.ai_rank || ""}`.trim() : `推荐 ${row.ai_rank || ""}`.trim();
  }
  return locale === "en-US" ? "Unreviewed" : "未复核";
}

function ScanAiAnalysisView({
  response,
  rows,
  logs,
  error,
  locale,
}: {
  response: ScanTerminalResponse | null;
  rows: ScanOpportunityRow[];
  logs: ScanAiLogEntry[];
  error?: string | null;
  locale: string;
}) {
  const isEn = locale === "en-US";
  const aiScan = response?.ai_scan || null;
  const theses = aiScan?.city_theses || [];
  const thesisByCity = useMemo(
    () => new Map(theses.map((item) => [normalizeCityKey(item.city), item])),
    [theses],
  );
  const groups = useMemo(() => {
    const map = new Map<string, ScanOpportunityRow[]>();
    rows.forEach((row) => {
      const key = normalizeCityKey(row.city || row.city_display_name || row.display_name);
      if (!key) return;
      const current = map.get(key) || [];
      current.push(row);
      map.set(key, current);
    });
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      rows: items,
      city:
        items[0]?.city_display_name ||
        items[0]?.display_name ||
        items[0]?.city ||
        key,
      thesis: thesisByCity.get(key),
    }));
  }, [rows, thesisByCity]);

  if (!rows.length) {
    return (
      <div className="scan-ai-analysis-view empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "Run a rule scan first" : "先完成规则扫描"}
          </div>
          <div className="scan-empty-copy">
            {isEn
              ? "V4 needs the current city candidates before it can analyze them."
              : "V4 需要先拿到当前城市候选，才能做城市级研判。"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-ai-analysis-view">
      <section className="scan-ai-summary-card">
        <div>
          <strong>{isEn ? "V4 city analysis" : "V4 城市级分析"}</strong>
          <p>
            {aiScan?.status === "ready"
              ? (isEn ? aiScan.summary_en || aiScan.summary_zh : aiScan.summary_zh || aiScan.summary_en) ||
                (isEn ? "V4 has reviewed the grouped city snapshot." : "V4 已复核城市分组快照。")
              : error ||
                aiScan?.reason ||
                (isEn
                  ? "V4 analysis appears inside each opportunity row when AI review data is available."
                  : "当 AI 复核数据可用时，V4 分析会展示在每条机会的展开层中。")}
          </p>
        </div>
      </section>

      <section className="scan-ai-log-panel in-tab">
        <div className="scan-ai-log-head">
          <strong>{isEn ? "Run log" : "运行日志"}</strong>
          <span>
            {aiScan?.status === "ready"
              ? isEn
                ? `${aiScan.sent_cities ?? "--"} cities · ${aiScan.sent_contracts ?? aiScan.sent_rows ?? "--"} contracts`
                : `${aiScan.sent_cities ?? "--"} 城 · ${aiScan.sent_contracts ?? aiScan.sent_rows ?? "--"} 合约`
              : isEn
                ? "No V4 result yet"
                : "暂无 V4 结果"}
          </span>
        </div>
        <div className="scan-ai-log-list">
          {logs.length ? (
            logs.map((entry) => (
              <div key={entry.id} className={`scan-ai-log-item ${entry.tone}`}>
                <span className="scan-ai-log-time">{entry.time}</span>
                <div>
                  <b>{entry.title}</b>
                  {entry.detail ? <small>{entry.detail}</small> : null}
                </div>
              </div>
            ))
          ) : (
            <div className="scan-ai-log-empty">
              {isEn ? "No request has been sent." : "还没有发起请求。"}
            </div>
          )}
        </div>
      </section>

      <div className="scan-ai-city-list">
        {groups.map((group) => {
          const cityThesis =
            (isEn
              ? group.thesis?.thesis_en || group.thesis?.summary_en || group.rows[0]?.ai_city_thesis_en
              : group.thesis?.thesis_zh || group.thesis?.summary_zh || group.rows[0]?.ai_city_thesis_zh) ||
            (isEn ? "Waiting for V4 city thesis." : "等待 V4 城市研判。");
          const clusterNote =
            group.thesis?.model_cluster_note || group.rows[0]?.ai_city_model_cluster_note || null;
          return (
            <section key={group.key} className="scan-ai-city-card">
              <div className="scan-ai-city-head">
                <div>
                  <strong>{group.city}</strong>
                  <p>{cityThesis}</p>
                </div>
                {group.thesis?.confidence || group.rows[0]?.ai_city_confidence ? (
                  <span>{group.thesis?.confidence || group.rows[0]?.ai_city_confidence}</span>
                ) : null}
              </div>
              {clusterNote ? (
                <div className="scan-ai-cluster-note">{clusterNote}</div>
              ) : null}
              <div className="scan-ai-contracts">
                {group.rows.map((row) => {
                  const decision = String(row.ai_decision || "neutral").toLowerCase();
                  const reason = getRowAiReason(row, locale);
                  const tempSymbol = row.temp_symbol || row.target_unit || "°C";
                  return (
                    <div key={row.id} className={`scan-ai-contract ${decision}`}>
                      <div>
                        <b>
                          {normalizeTemperatureLabel(row.action || row.target_label, tempSymbol) ||
                            row.market_question ||
                            row.id}
                        </b>
                        <small>
                          {row.deb_prediction != null
                            ? `DEB ${formatTemperatureValue(row.deb_prediction, tempSymbol)} · `
                            : ""}
                          {row.edge_percent != null ? `edge ${Number(row.edge_percent).toFixed(1)}%` : "--"}
                        </small>
                      </div>
                      <span>{getAiDecisionLabel(row, locale)}</span>
                      {reason ? <p>{reason}</p> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ScanAiLogPanel({
  response,
  logs,
  locale,
  loading,
  error,
}: {
  response: ScanTerminalResponse | null;
  logs: ScanAiLogEntry[];
  locale: string;
  loading: boolean;
  error?: string | null;
}) {
  const isEn = locale === "en-US";
  const aiScan = response?.ai_scan || null;
  return (
    <details className="scan-ai-log-panel compact">
      <summary className="scan-ai-log-summary">
        <span>{isEn ? "Debug log" : "调试日志"}</span>
        <strong>
          {loading
            ? isEn
              ? "V4 running"
              : "V4 运行中"
            : error
              ? isEn
                ? "V4 failed"
                : "V4 失败"
              : aiScan?.status === "ready"
                ? isEn
                  ? `${aiScan.sent_cities ?? "--"} cities · ${aiScan.sent_contracts ?? aiScan.sent_rows ?? "--"} contracts`
                  : `${aiScan.sent_cities ?? "--"} 城 · ${aiScan.sent_contracts ?? aiScan.sent_rows ?? "--"} 合约`
                : isEn
                  ? "Collapsed"
                  : "已折叠"}
        </strong>
      </summary>
      <div className="scan-ai-log-list">
        {logs.length ? (
          logs.map((entry) => (
            <div key={entry.id} className={`scan-ai-log-item ${entry.tone}`}>
              <span className="scan-ai-log-time">{entry.time}</span>
              <div>
                <b>{entry.title}</b>
                {entry.detail ? <small>{entry.detail}</small> : null}
              </div>
            </div>
          ))
        ) : (
          <div className="scan-ai-log-empty">
            {isEn ? "No request has been sent." : "还没有发起请求。"}
          </div>
        )}
      </div>
    </details>
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
    const order = ["active", "next", "today", "later", "past"];
    const byPhase = new Map<
      string,
      {
        label: string;
        sort: number;
        items: Array<{ row: ScanOpportunityRow; meta: ReturnType<typeof getPeakCountdownMeta> }>;
      }
    >();
    rows.forEach((row) => {
      const meta = getPeakCountdownMeta(row, locale);
      const current = byPhase.get(meta.key) || {
        label: meta.groupLabel,
        sort: order.indexOf(meta.key) >= 0 ? order.indexOf(meta.key) : order.length,
        items: [],
      };
      current.items.push({ row, meta });
      byPhase.set(meta.key, current);
    });
    return Array.from(byPhase.entries())
      .sort(([, left], [, right]) => left.sort - right.sort)
      .map(([key, group]) => ({
        key,
        label: group.label,
        items: group.items.sort((left, right) => {
          if (left.meta.sort !== right.meta.sort) return left.meta.sort - right.meta.sort;
          return Number(right.row.edge_percent || 0) - Number(left.row.edge_percent || 0);
        }),
      }));
  }, [locale, rows]);

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
      {groups.map((group) => (
        <section key={group.key} className="scan-calendar-group">
          <div className="scan-calendar-group-head">
            <div>
              <div className="scan-calendar-date">{group.label}</div>
              <div className="scan-calendar-subtitle">
                {locale === "en-US"
                  ? "Ordered by DEB peak-window countdown"
                  : "按 DEB 峰值窗口倒计时排序"}
              </div>
            </div>
            <div className="scan-calendar-count">
              {locale === "en-US" ? `${group.items.length} rows` : `${group.items.length} 条`}
            </div>
          </div>
          <div className="scan-calendar-grid">
            {group.items.map(({ row, meta }) => (
              <button
                key={row.id}
                type="button"
                className={`scan-calendar-card peak-${meta.tone} ${selectedRowId === row.id ? "selected" : ""}`}
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
                <div className="scan-calendar-countdown">
                  {meta.title}
                  <small>{meta.detail}</small>
                </div>
                <div className="scan-calendar-action">
                  <span>{locale === "en-US" ? "DEB high" : "DEB 预测高点"}</span>
                  <b>
                    {row.deb_prediction != null
                      ? formatTemperatureValue(row.deb_prediction, tempSymbol)
                      : "--"}
                  </b>
                </div>
                <div className="scan-calendar-meta">
                  <span>
                    {formatShortDate(row.selected_date || row.local_date, locale)} · {row.local_time || "--"}
                  </span>
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

function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = store.proAccess.subscriptionActive;
  const accountHref = store.proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const [activeFilters, setActiveFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [terminalData, setTerminalData] = useState<ScanTerminalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ContentView>("list");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const [aiLogs, setAiLogs] = useState<ScanAiLogEntry[]>([]);
  const [userLocalTime, setUserLocalTime] = useState("--");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const deferredRows = useDeferredValue(terminalData?.rows || []);
  const preloadedSnapshotRef = useRef<string | null>(null);

  const prependAiLogs = (entries: ScanAiLogEntry[]) => {
    setAiLogs((current) => [...entries, ...current].slice(0, 8));
  };
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
      market_question: isEn ? "City briefing" : "城市简报",
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
    if (!isPro) return;
    setLoading(true);
    setAiError(null);
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
      prependAiLogs([
        {
          id: `rule-${Date.now()}`,
          time: formatLogTime(),
          tone: response.rows.length ? "success" : "warning",
          title: isEn ? "Rule scan snapshot ready" : "规则扫描快照已就绪",
          detail: isEn
            ? `snapshot ${response.snapshot_id || "--"} · ${response.rows.length} visible rows`
            : `快照 ${response.snapshot_id || "--"} · 可见候选 ${response.rows.length} 条`,
        },
      ]);
    } catch (fetchError) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const runAiReview = async () => {
    if (aiLoading) return;
    if (!terminalData?.rows.length) {
      prependAiLogs([
        {
          id: `no-rows-${Date.now()}`,
          time: formatLogTime(),
          tone: "warning",
          title: isEn ? "V4 not started" : "V4 未启动",
          detail: isEn
            ? "Run the rule scan first. V4 only reviews existing candidate rows."
            : "需要先完成规则扫描。V4 只复核已有候选，不会凭空抓市场。",
        },
      ]);
      return;
    }
    const snapshotId = terminalData.snapshot_id || null;
    const rowCount = terminalData.rows.length;
    prependAiLogs([
      {
        id: `queued-${Date.now()}`,
        time: formatLogTime(),
        tone: "info",
        title: isEn ? "V4 review queued" : "V4 复核已排队",
        detail: isEn
          ? `snapshot ${snapshotId || "--"} · ${rowCount} rule candidates grouped by city`
          : `快照 ${snapshotId || "--"} · ${rowCount} 条候选将按城市分组`,
      },
      {
        id: `send-${Date.now() + 1}`,
        time: formatLogTime(),
        tone: "info",
        title: isEn ? "Sending city-level context" : "正在发送城市级上下文",
        detail: isEn
          ? "Each city includes EMOS distribution, model cluster and contracts."
          : "每城包含 EMOS 分布、模型集群和候选合约。",
      },
    ]);
    setActiveView("list");
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await dashboardClient.reviewScanTerminalWithAi({
        filters: terminalData.filters || activeFilters,
        snapshotId,
      });
      const review = response.ai_scan;
      startTransition(() => {
        setTerminalData(response);
        setActiveFilters(response.filters || activeFilters);
        setError(response.status === "failed" ? response.stale_reason || null : null);
        setSelectedRowId((current) => {
          if (current && response.rows.some((row) => row.id === current)) {
            return current;
          }
          return sortRowsByUserTime(response.rows)[0]?.id || response.top_signal?.id || null;
        });
      });
      prependAiLogs([
        {
          id: `done-${Date.now()}`,
          time: formatLogTime(),
          tone: review?.status === "ready" ? "success" : "warning",
          title:
            review?.status === "ready"
              ? review.cached
                ? isEn
                  ? "V4 cache hit"
                  : "V4 命中缓存"
                : isEn
                  ? "V4 review completed"
                  : "V4 复核完成"
              : isEn
                ? "V4 fell back to rule scan"
                : "V4 已回退规则扫描",
          detail:
            review?.status === "ready"
              ? isEn
                ? `${review.model || "V4"} · ${formatDuration(review.duration_ms)} · ${review.sent_cities ?? "--"} cities / ${review.sent_contracts ?? review.sent_rows ?? "--"} contracts · ${review.recommended_count ?? 0} picks / ${review.vetoed_count ?? 0} veto`
                : `${review.model || "V4"} · ${formatDuration(review.duration_ms)} · ${review.sent_cities ?? "--"} 城 / ${review.sent_contracts ?? review.sent_rows ?? "--"} 合约 · 推荐 ${review.recommended_count ?? 0} / 排除 ${review.vetoed_count ?? 0}`
              : review?.reason || (isEn ? "No AI result returned." : "没有返回 AI 结果。"),
        },
        ...(review?.usage
          ? [
              {
                id: `usage-${Date.now() + 1}`,
                time: formatLogTime(),
                tone: "info" as const,
                title: isEn ? "Token usage" : "Token 用量",
                detail: isEn
                  ? `input ${review.usage.prompt_tokens ?? "--"} · output ${review.usage.completion_tokens ?? "--"} · total ${review.usage.total_tokens ?? "--"}`
                  : `输入 ${review.usage.prompt_tokens ?? "--"} · 输出 ${review.usage.completion_tokens ?? "--"} · 总计 ${review.usage.total_tokens ?? "--"}`,
              },
            ]
          : []),
      ]);
    } catch (reviewError) {
      setAiError(String(reviewError));
      prependAiLogs([
        {
          id: `error-${Date.now()}`,
          time: formatLogTime(),
          tone: "error",
          title: isEn ? "V4 request failed" : "V4 请求失败",
          detail: String(reviewError),
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!isPro) return;
    void fetchTerminal(DEFAULT_FILTERS, false);
  }, [isPro]);

  useEffect(() => {
    if (!isPro || !terminalData?.rows.length) return;
    const snapshotKey =
      terminalData.snapshot_id ||
      terminalData.generated_at ||
      terminalData.rows.map((row) => row.id).join("|");
    if (!snapshotKey || preloadedSnapshotRef.current === snapshotKey) return;
    preloadedSnapshotRef.current = snapshotKey;

    const seen = new Set<string>();
    const cities = sortRowsByUserTime(terminalData.rows)
      .map((row) => String(row.city || row.city_display_name || row.display_name || "").trim())
      .filter((city) => {
        const key = normalizeCityKey(city);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);

    cities.forEach((cityName) => {
      void store.ensureCityDetail(cityName, true, "market").catch(() => {});
    });
  }, [
    isPro,
    store.ensureCityDetail,
    terminalData?.rows,
    terminalData?.generated_at,
    terminalData?.snapshot_id,
  ]);

  useEffect(() => {
    if (!isPro) return;
    const intervalId = window.setInterval(() => {
      void fetchTerminal(activeFilters, false);
    }, SCAN_AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [activeFilters, isPro]);

  useEffect(() => {
    if (!store.proAccess.loading && !isPro && activeView !== "map") {
      setActiveView("map");
    }
  }, [activeView, isPro, store.proAccess.loading]);

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
  const scanStatus = terminalData?.status || (loading ? "loading" : error ? "failed" : "ready");
  const staleReason =
    terminalData?.stale_reason || error || null;
  const aiScan = terminalData?.ai_scan || null;
  const aiStatusText = aiLoading
    ? isEn
      ? "V4 reviewing"
      : "V4 复核中"
    : aiError
      ? isEn
        ? "V4 failed"
        : "V4 失败"
      : aiScan?.status === "ready"
        ? isEn
          ? aiScan.cached
            ? "V4 cached"
            : "V4 reviewed"
          : aiScan.cached
            ? "V4 缓存"
            : "V4 已复核"
        : aiScan?.status
          ? isEn
            ? "Rule scan"
            : "使用规则扫描"
          : null;

  useEffect(() => {
    if (!activeDetailRow) return;
    if (!store.cityDetailsByName[activeDetailRow.city]) {
      void store.ensureCityDetail(activeDetailRow.city, false, "panel").catch(() => {});
    }
  }, [activeDetailRow, store.cityDetailsByName, store.ensureCityDetail]);

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    const matchedRow = findRowForCity(timeSortedRows, cityName);
    setSelectedRowId(matchedRow?.id || null);
    void store.selectCity(cityName);
  }, [store, timeSortedRows]);

  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    setSelectedRowId(row.id);
    void store.selectCity(row.city);
  }, [store]);

  const openScanPaywall = useCallback(() => {
    setShowScanPaywall(true);
  }, []);

  const renderMainView = () => {
    if (resolvedView === "map") {
      return (
        <div className="scan-map-view">
          <div className="scan-map-shell">
            <MapCanvas
              onCitySelect={handleMapCitySelect}
              selectionMode="select"
            />
          </div>
        </div>
      );
    }
    if (!isPro) {
      return (
        <div className="scan-table-shell empty">
          <div className="scan-empty-state">
            <div className="scan-empty-title">
              {isEn ? "Scan is available on Pro" : "扫描功能需 Pro 权限"}
            </div>
            <div className="scan-empty-copy">
              {isEn
                ? "Distribution view and city briefing remain available."
                : "分布视图和右侧城市简报仍可查看。"}
            </div>
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
          cityDetailsByName={store.cityDetailsByName}
        />
      </>
    );
  };

  if (store.proAccess.loading) {
    return (
      <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
        <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
          <main className="scan-data-grid">
            <div className="scan-empty-state">
              <div className="scan-empty-title">{isEn ? "Checking access" : "正在检查权限"}</div>
              <div className="scan-empty-copy">
                {isEn ? "Preparing your market scan terminal." : "正在准备市场扫描台。"}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
      <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
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
                      ? isPro
                        ? "Read-only market scan with peak-first main signal"
                        : "Free preview: distribution view and city briefing"
                      : isPro
                        ? "只读市场扫描，主信号按 EMOS 主峰优先"
                        : "免费预览：分布视图和城市简报可查看"}
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
              {isPro ? null : store.proAccess.authenticated ? (
                <button
                  type="button"
                  className="scan-primary-button"
                  onClick={openScanPaywall}
                >
                  <UserRound size={14} />
                  {isEn ? "Upgrade Pro" : "升级 Pro"}
                </button>
              ) : (
                <Link href={accountHref} className="scan-primary-button">
                  <LogIn size={14} />
                  {isEn ? "Sign in" : "登录"}
                </Link>
              )}
              <button
                type="button"
                className="scan-theme-button"
                aria-label={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                title={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              >
                {themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}
              </button>
              {isPro ? (
                <button type="button" className="scan-ghost-button" onClick={() => void fetchTerminal(activeFilters, true)}>
                  <RefreshCw size={14} className={loading ? "spin" : undefined} />
                  {isEn ? "Refresh" : "刷新"}
                </button>
              ) : null}
              {store.proAccess.authenticated ? (
                <Link
                  href={accountHref}
                  className="scan-account-button"
                  aria-label={isEn ? "Account" : "账户"}
                  title={isEn ? "Account" : "账户"}
                >
                  <UserRound size={15} />
                </Link>
              ) : null}
            </div>
          </div>

          {isPro ? (
            <ScanKPIBar
              response={terminalData}
              rows={timeSortedRows}
              totalCities={store.cities.length}
              loading={loading}
            />
          ) : null}

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs">
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
                  className={resolvedView === "list" ? "active" : ""}
                  title={!isPro ? (isEn ? "Pro scan required" : "扫描需 Pro") : undefined}
                  onClick={() => {
                    if (!isPro) {
                      openScanPaywall();
                      return;
                    }
                    setActiveView("list");
                  }}
                >
                  {isEn ? "Opportunity List" : "机会列表"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "calendar" ? "active" : ""}
                  title={!isPro ? (isEn ? "Pro scan required" : "扫描需 Pro") : undefined}
                  onClick={() => {
                    if (!isPro) {
                      openScanPaywall();
                      return;
                    }
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
                {aiStatusText ? (
                  <span className={`scan-status-chip ${aiScan?.status === "ready" ? "ai" : "stale"}`}>
                    {aiStatusText}
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
              <>
                {renderMainView()}
                {isPro ? (
                  <ScanAiLogPanel
                    response={terminalData}
                    logs={aiLogs}
                    locale={locale}
                    loading={aiLoading}
                    error={aiError}
                  />
                ) : null}
              </>
            )}
          </section>
        </main>

        <CityDetailPanel variant="rail" />
      </div>
      <FutureForecastModal />
      {showScanPaywall ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? "Unlock market scan" : "解锁市场扫描"}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowScanPaywall(false);
            }
          }}
        >
          <ProFeaturePaywall
            feature="scan"
            onClose={() => setShowScanPaywall(false)}
          />
        </div>
      ) : null}
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
