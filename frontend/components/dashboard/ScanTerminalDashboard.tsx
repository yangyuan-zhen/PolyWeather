"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  Activity,
  ChevronLeft,
  GraduationCap,
  LineChart,
  Menu,
  Search,
  Table2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProAccessState, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getInitialLocaleFromNavigator } from "@/lib/i18n";
import { isBrowserLocalFullAccess } from "@/lib/local-dev-access";
import { sortRowsByUserTime } from "@/components/dashboard/scan-terminal/decision-utils";
import { ProductAccessRequired } from "@/components/dashboard/scan-terminal/ProductAccessRequired";
import {
  type ContinentGroup,
  buildContinentGroups,
  formatPrice,
  formatSpreadLiquidity,
  GAP_COLOR_MAP,
  getDefaultExpanded,
  getGapColor,
  getSignalLabel,
  getSignalState,
  TRADING_REGIONS,
} from "@/components/dashboard/scan-terminal/continent-grouping";
import { MobileCityCard } from "@/components/dashboard/scan-terminal/MobileCityCard";
import { MobileRegionTabs } from "@/components/dashboard/scan-terminal/MobileRegionTabs";
import { useScanTerminalQuery } from "@/components/dashboard/scan-terminal/use-scan-terminal-query";
import {
  useScanTerminalTheme,
  useUserLocalClock,
} from "@/components/dashboard/scan-terminal/use-scan-terminal-ui-state";
import { ScanTerminalLoadingScreen } from "@/components/dashboard/scan-terminal/ScanTerminalShellParts";
import { scanRootClass } from "@/components/dashboard/scan-root-styles";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { GroupedMarketTable } from "@/components/dashboard/scan-terminal/GroupedMarketTable";
import { TrainingDashboard } from "@/components/dashboard/scan-terminal/TrainingDashboard";
import { LiveTemperatureThresholdChart } from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";
import { MarketOverviewView } from "@/components/dashboard/scan-terminal/MarketOverviewView";
import { rowName, pct, money, temp, edgeClass } from "@/components/dashboard/scan-terminal/utils";

function createEmptyAccess(loading = true): ProAccessState {
  return {
    loading,
    authenticated: false,
    userId: null,
    subscriptionActive: false,
    subscriptionPlanCode: null,
    subscriptionExpiresAt: null,
    subscriptionTotalExpiresAt: null,
    subscriptionQueuedDays: 0,
    points: 0,
    error: null,
  };
}

function createLocalAccess(): ProAccessState {
  return {
    loading: false,
    authenticated: true,
    userId: "local-dev",
    subscriptionActive: true,
    subscriptionPlanCode: "local-full-access",
    subscriptionExpiresAt: "2099-12-31T23:59:59Z",
    subscriptionTotalExpiresAt: "2099-12-31T23:59:59Z",
    subscriptionQueuedDays: 0,
    points: 999_999,
    error: null,
  };
}



const TERM = {
  cityContract: { en: "City / Contract", zh: "城市 / 合约" },
  live: { en: "Live", zh: "实测" },
  deb: { en: "DEB", zh: "DEB" },
  mkt: { en: "Mkt", zh: "市场" },
  edge: { en: "Edge", zh: "优势" },
  liq: { en: "Liq", zh: "流动性" },
  signal: { en: "Signal", zh: "信号" },
  searchPlaceholder: { en: "Search city, contract, station, or signal", zh: "搜索城市、合约、站点或信号" },
  weatherContracts: { en: "Weather Contracts", zh: "天气合约" },
  selectedContractMonitor: { en: "Selected Contract Monitor", zh: "选中合约监控" },
  probabilityDistribution: { en: "Probability Distribution", zh: "概率分布" },
  marketList: { en: "Market List", zh: "市场列表" },
  watchlist: { en: "Watchlist", zh: "观察列表" },
  rows: { en: "Rows", zh: "行数" },
  avgEdge: { en: "Avg Edge", zh: "平均优势" },
  liquidity: { en: "Liquidity", zh: "流动性" },
  intradayPerformance: { en: "Intraday Performance", zh: "日内表现" },
  spread: { en: "Spread", zh: "价差" },
  model: { en: "Model", zh: "模型" },
  noData: { en: "No data", zh: "无数据" },
  noDistributionData: { en: "No distribution data", zh: "无分布数据" },
  selectContract: {
    en: "Select a weather contract to inspect model edge, market price, and live evidence.",
    zh: "选择天气合约以查看模型优势、市场价格和实况证据。",
  },
  signInToContinue: { en: "Sign in to continue", zh: "请先登录" },
  signInHint: {
    en: "The terminal is only available to registered users. Please sign in or create an account.",
    zh: "决策台仅对注册用户开放。请登录或创建账号。",
  },
  logIn: { en: "Log in", zh: "登录" },
  createAccount: { en: "Create an account", zh: "注册账号" },
  learnAbout: { en: "Learn about PolyWeather", zh: "了解 PolyWeather" },
  proAccessRequired: { en: "Pro Access Required", zh: "需要付费订阅" },
  proDesc: {
    en: "The PolyWeather terminal is a paid product. Subscribe to unlock real-time weather-market intelligence.",
    zh: "PolyWeather 决策台为付费产品。订阅以解锁实时天气市场情报。",
  },
  subscriptionTerms: {
    en: "Billed monthly. Cancel anytime. Payment via USDC on Polygon.",
    zh: "按月计费，随时可取消。通过 Polygon 链 USDC 支付。",
  },
  month: { en: "/ month", zh: "/ 月" },
  subscribeNow: { en: "Subscribe Now — $10/mo", zh: "立即订阅 — $10/月" },
  subscribePrompt: {
    en: "You need an active subscription to access the terminal.",
    zh: "你需要开通有效订阅才能访问决策台。",
  },
  backToProduct: { en: "Back to product overview", zh: "返回产品介绍页" },
  dashboard: { en: "PolyWeather Terminal", zh: "PolyWeather 交易决策台" },
  refresh: { en: "Refresh", zh: "刷新" },
  switchLang: { en: "Switch to Chinese", zh: "切换到英文" },
  globalWeatherFactors: { en: "Global Weather Factors", zh: "全球天气因子" },
  heat: { en: "Heat", zh: "高温风险" },
  active: { en: "Active", zh: "活跃" },
  watch: { en: "Watch", zh: "观察" },
  tradable: { en: "Tradable", zh: "可交易" },
  primary: { en: "Primary", zh: "主信号" },
  ai: { en: "AI", zh: "AI" },
  closed: { en: "Closed", zh: "已关闭" },
} as const;

function t(key: keyof typeof TERM, isEn: boolean) {
  return isEn ? TERM[key].en : TERM[key].zh;
}

function decisionLabel(row?: ScanOpportunityRow | null) {
  const raw =
    row?.ai_decision ||
    row?.v4_metar_decision ||
    row?.action ||
    row?.signal_status ||
    "";
  const value = String(raw || "").toLowerCase();
  if (value.includes("approve")) return "Approve";
  if (value.includes("veto")) return "Veto";
  if (value.includes("watch")) return "Watch";
  if (value.includes("downgrade")) return "Downgrade";
  if (row?.tradable) return "Tradable";
  return "Monitor";
}

function tablePrice(row: ScanOpportunityRow) {
  return formatPrice(row.midpoint, row.ask, row.bid);
}

function KoyfinRowsTable({
  compact = false,
  isEn,
  onSelect,
  rows,
  selectedId,
}: {
  compact?: boolean;
  isEn: boolean;
  onSelect: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  selectedId?: string | null;
}) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-b border-slate-200 bg-[#f3f5f7] text-[9px] uppercase tracking-wide text-slate-500">
          <th className="w-5 px-2 py-1 text-left font-black">
            <span className="block h-3 w-3 rounded-[2px] border border-slate-300 bg-white" />
          </th>
          <th className="px-1.5 py-1 text-left font-black">
            {isEn ? "Weather Contract" : "天气合约"}
          </th>
          <th className="px-1.5 py-1 text-right font-black">
            {isEn ? "Price" : "价格"}
          </th>
          <th className="px-1.5 py-1 text-right font-black">
            {isEn ? "Chg" : "变化"}
          </th>
          <th className="px-2 py-1 text-right font-black">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const edge = Number(row.edge_percent ?? row.signed_gap ?? row.gap ?? 0);
          const positive = edge >= 0;
          return (
            <tr
              key={row.id}
              onClick={() => onSelect(row)}
              className={clsx(
                "cursor-pointer border-b border-slate-100 hover:bg-blue-50/70",
                selectedId === row.id && "bg-blue-50",
              )}
            >
              <td className="px-2 py-1">
                <span className="block h-3 w-3 rounded-[2px] border border-slate-300 bg-white" />
              </td>
              <td className="px-1.5 py-1">
                <div className="truncate font-bold text-slate-800">
                  {rowName(row)}
                </div>
                <div className="truncate text-[9px] font-medium text-slate-400">
                  {row.target_label || row.market_question || row.airport || "--"}
                </div>
              </td>
              <td className="px-1.5 py-1 text-right font-mono font-bold text-slate-800">
                {tablePrice(row)}
              </td>
              <td
                className={clsx(
                  "px-1.5 py-1 text-right font-mono font-bold",
                  positive ? "text-emerald-700" : "text-red-600",
                )}
              >
                {Number.isFinite(edge) ? `${positive ? "+" : ""}${edge.toFixed(1)}` : "--"}
              </td>
              <td
                className={clsx(
                  "px-2 py-1 text-right font-mono font-bold",
                  positive ? "text-emerald-700" : "text-red-600",
                )}
              >
                {pct(row.market_probability ?? row.market_event_probability ?? row.model_probability)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KoyfinMarketPanel({
  compact,
  isEn,
  onSelect,
  rows,
  selectedId,
  title,
}: {
  compact?: boolean;
  isEn: boolean;
  onSelect: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  selectedId?: string | null;
  title: string;
}) {
  return (
    <Panel title={title}>
      <KoyfinRowsTable
        compact={compact}
        isEn={isEn}
        onSelect={onSelect}
        rows={rows}
        selectedId={selectedId}
      />
    </Panel>
  );
}

function PolyWeatherTerminal({
  generatedText,
  isEn,
  locale,
  onRefresh,
  refreshing,
  rows,
  selectedRow,
  setSelectedRow,
  toggleLocale,
  userLocalTime,
  searchQuery,
  setSearchQuery,
  searchInputRef,
}: {
  generatedText: string;
  isEn: boolean;
  locale: "zh-CN" | "en-US";
  onRefresh: () => void;
  refreshing: boolean;
  rows: ScanOpportunityRow[];
  selectedRow: ScanOpportunityRow | null;
  setSelectedRow: (row: ScanOpportunityRow) => void;
  toggleLocale: () => void;
  userLocalTime: string;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl instanceof HTMLElement && activeEl.isContentEditable));
      if (e.key === "/" && !isInputFocused) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === "Escape" && activeEl === searchInputRef.current) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchInputRef, setSearchQuery]);
  const [navExpanded, setNavExpanded] = useState(false);
  const [activeNavKey, setActiveNavKey] = useState<string>("contracts");
  const [selectedRegionKey, setSelectedRegionKey] = useState<string>("east_asia");

  const NAV_ITEMS = [
    { key: "contracts", Icon: Table2, labelEn: "Contracts", labelZh: "天气合约" },
    { key: "signals", Icon: LineChart, labelEn: "Signals", labelZh: "交易信号" },
    { key: "markets", Icon: Activity, labelEn: "Markets", labelZh: "市场概览" },
    { key: "training", Icon: GraduationCap, labelEn: "Training", labelZh: "训练数据" },
  ];

  const filteredRegionRows = useMemo(() => {
    return rows.filter(
      (row) =>
        String(row.trading_region).toLowerCase() === selectedRegionKey &&
        row.is_primary_signal !== false,
    );
  }, [rows, selectedRegionKey]);

  const watchRows = useMemo(() => {
    return filteredRegionRows
      .filter((row) => decisionLabel(row) === "Watch" || !row.tradable)
      .slice(0, 8);
  }, [filteredRegionRows]);
  const topRows = filteredRegionRows.slice(0, 18);
  const heatRows = filteredRegionRows
    .filter((row) => row.risk_level === "high" || Number(row.current_temp ?? 0) >= 30)
    .slice(0, 10);
  const liquidRows = [...filteredRegionRows]
    .sort(
      (a, b) =>
        Number(b.book_liquidity || b.market_liquidity || b.volume || 0) -
        Number(a.book_liquidity || a.market_liquidity || a.volume || 0),
    )
    .slice(0, 9);
  const negativeRows = filteredRegionRows
    .filter((row) => Number(row.edge_percent ?? row.signed_gap ?? row.gap ?? 0) < 0)
    .slice(0, 8);

  const selectedSignal = selectedRow ? getSignalState(selectedRow) : "data" as const;
  const selectedLabel = selectedRow ? getSignalLabel(selectedSignal, isEn) : "";

  const continentGroups = useMemo(
    () => buildContinentGroups(filteredRegionRows, isEn),
    [filteredRegionRows, isEn]
  );
  const [mobileTab, setMobileTab] = useState<string>("active_signals");
  const mobileActiveGroup = useMemo(
    () => continentGroups.find((g) => g.key === mobileTab) || continentGroups[0],
    [continentGroups, mobileTab]
  );
  useEffect(() => {
    if (continentGroups.length > 0 && !continentGroups.find((g) => g.key === mobileTab)) {
      setMobileTab(continentGroups[0].key);
    }
  }, [continentGroups, mobileTab]);
  useEffect(() => {
    if (!filteredRegionRows.length) return;
    if (!selectedRow || !filteredRegionRows.some((row) => row.id === selectedRow.id)) {
      setSelectedRow(filteredRegionRows[0]);
    }
  }, [filteredRegionRows, selectedRow, setSelectedRow]);

  const avgEdge = useMemo(() => {
    const list = filteredRegionRows;
    return list.reduce((sum, row) => sum + Number(row.edge_percent || 0), 0) / Math.max(list.length, 1);
  }, [filteredRegionRows]);

  const totalLiquidity = useMemo(() => {
    const list = filteredRegionRows;
    return list.reduce(
      (sum, row) => sum + Number(row.book_liquidity || row.market_liquidity || row.volume || 0),
      0
    );
  }, [filteredRegionRows]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#e9edf3] text-[#202833]">
      <aside
        className={clsx(
          "flex shrink-0 flex-col bg-[#11161d] py-3 text-slate-400 transition-all duration-200",
          navExpanded ? "w-[172px] items-start px-3" : "w-[52px] items-center gap-2",
        )}
      >
        {/* Logo row */}
        <div className={clsx(
          "flex items-center w-full",
          navExpanded ? "gap-3 mb-3 px-1" : "justify-center mb-2",
        )}>
          <Link
            href="/"
            className="block h-7 w-7 shrink-0 overflow-hidden rounded transition hover:opacity-90"
            title="PolyWeather"
          >
            <img src="/apple-touch-icon.png" alt="PolyWeather" className="h-full w-full object-cover" />
          </Link>
          {navExpanded && (
            <span className="text-sm font-black text-white tracking-tight truncate">
              PolyWeather
            </span>
          )}
        </div>

        {/* Toggle button */}
        <button
          type="button"
          onClick={() => setNavExpanded((prev) => !prev)}
          className={clsx(
            "flex items-center gap-3 transition-colors hover:text-white",
            navExpanded
              ? "w-full h-8 px-1 mb-2"
              : "grid h-9 w-full place-items-center mb-2",
          )}
        >
          {navExpanded ? (
            <>
              <ChevronLeft size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {isEn ? "Collapse" : "收起"}
              </span>
            </>
          ) : (
            <Menu size={18} />
          )}
        </button>

        {/* Nav items */}
        {NAV_ITEMS.map(({ key, Icon, labelEn, labelZh }) => {
          const isActive = activeNavKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => { setActiveNavKey(key); }}
              className={clsx(
                "flex items-center gap-3 transition-colors rounded",
                navExpanded
                  ? "w-full h-9 px-2 text-left"
                  : "grid h-9 w-full place-items-center border-l-4",
                isActive
                  ? navExpanded
                    ? "bg-white/8 text-white"
                    : "border-blue-500 bg-white/5 text-white"
                  : navExpanded
                    ? "hover:bg-white/5 hover:text-white"
                    : "border-transparent hover:bg-white/5 hover:text-white",
              )}
              title={isEn ? labelEn : labelZh}
            >
              <Icon size={16} className="shrink-0" />
              {navExpanded && (
                <span className="text-xs font-semibold whitespace-nowrap">
                  {isEn ? labelEn : labelZh}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#d2d9e2] bg-white px-4 text-slate-800">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-8 min-w-[320px] items-center gap-2 rounded border border-[#cfd6df] bg-[#f8fafc] px-2.5 text-slate-600">
              <Search size={14} className="text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder", isEn)}
                className="w-full bg-transparent text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  ✕
                </button>
              )}
              <kbd className="ml-auto rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                /
              </kbd>
            </div>
            <div className="hidden items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:flex">
              <Activity size={13} />
              {t("dashboard", isEn)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="hidden font-mono md:inline text-slate-500">{userLocalTime}</span>
            <button
              type="button"
              onClick={toggleLocale}
              className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              title={t("switchLang", isEn)}
            >
              {isEn ? "中文" : "EN"}
            </button>
            <Link
              href="/account"
              className="grid h-7 w-7 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="User Account"
            >
              <UserRound size={13} />
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden flex flex-col p-2 bg-[#eef2f6]">
          {activeNavKey === "training" ? (
            <TrainingDashboard isEn={isEn} />
          ) : activeNavKey === "markets" ? (
            <MarketOverviewView
              isEn={isEn}
              rows={rows}
              onSelectRow={(row) => {
                const regionKey = String(row.trading_region || "").toLowerCase();
                if (regionKey) setSelectedRegionKey(regionKey);
                setSelectedRow(row);
                setActiveNavKey("contracts");
              }}
            />
          ) : (
            <>
              {/* Region tabs */}
              <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-[4px] border border-[#cfd6df] bg-white p-1 mb-2 scrollbar-none">
                {TRADING_REGIONS.map((r) => ({
                    key: r.key,
                    labelEn: r.labelEn.toUpperCase(),
                    labelZh: r.labelZh,
                  })).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedRegionKey(tab.key)}
                    className={clsx(
                      "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-[3px] transition-all whitespace-nowrap",
                      selectedRegionKey === tab.key
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    )}
                  >
                    {isEn ? tab.labelEn : tab.labelZh}
                  </button>
                ))}
              </div>
              {/* Mobile layout */}
              <div className="flex flex-col gap-2 lg:hidden overflow-auto flex-1 pb-6">
                <MobileRegionTabs
                  activeTab={mobileTab}
                  groups={continentGroups}
                  isEn={isEn}
                  onSelectTab={setMobileTab}
                />
                <div className="space-y-2 px-1">
                  {mobileActiveGroup?.rows.map((row) => (
                    <MobileCityCard
                      key={row.id}
                      row={row}
                      isEn={isEn}
                      onClick={setSelectedRow}
                    />
                  ))}
                </div>
                {/* Mobile Selected Row Detail */}
                {selectedRow && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-black text-slate-900 mb-2">{rowName(selectedRow)}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        ["Obs", temp(selectedRow.current_temp, selectedRow.temp_symbol)],
                        ["High", temp(selectedRow.current_max_so_far, selectedRow.temp_symbol)],
                        ["DEB", temp(selectedRow.deb_prediction, selectedRow.temp_symbol)],
                        ["Gap", temp(selectedRow.signed_gap ?? selectedRow.gap_to_target, selectedRow.temp_symbol)],
                        ["Edge", pct(selectedRow.edge_percent)],
                        ["Market", formatPrice(selectedRow.midpoint, selectedRow.ask, selectedRow.bid)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded border border-slate-200 bg-slate-50 p-2">
                          <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
                          <div className="font-mono font-bold text-slate-900">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Desktop layout */}
              <div className="hidden h-full min-h-0 lg:grid lg:grid-cols-[0.96fr_1.72fr] gap-2">
                <div className="flex min-h-0 flex-col gap-2">
                  <KoyfinMarketPanel
                    isEn={isEn}
                    onSelect={setSelectedRow}
                    rows={filteredRegionRows}
                    selectedId={selectedRow?.id}
                    title={isEn ? "Weather Contract Markets" : "天气合约市场"}
                  />
                </div>

                <div className="min-h-0">
                  <LiveTemperatureThresholdChart isEn={isEn} row={selectedRow} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function ScanTerminalScreen() {
  const [proAccess, setProAccess] = useState<ProAccessState>(() =>
    createEmptyAccess(true),
  );
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const isEn = locale === "en-US";
  const toggleLocale = () =>
    setLocale((prev) => (prev === "zh-CN" ? "en-US" : "zh-CN"));
  const [hydrated, setHydrated] = useState(false);
  const [localFullAccess, setLocalFullAccess] = useState(false);
  const canUseLocalFullAccess = hydrated && localFullAccess;
  const isAuthenticated =
    hydrated && (proAccess.authenticated || canUseLocalFullAccess);
  const isPro =
    hydrated && (proAccess.subscriptionActive || canUseLocalFullAccess);
  const userLocalTime = useUserLocalClock();
  const { themeMode } = useScanTerminalTheme();

  useEffect(() => {
    let cancelled = false;
    setHydrated(true);
    setLocale(getInitialLocaleFromNavigator());
    const localAccess = isBrowserLocalFullAccess();
    setLocalFullAccess(localAccess);
    if (localAccess) {
      setProAccess(createLocalAccess());
      return () => {
        cancelled = true;
      };
    }
    if (typeof fetch !== "function") {
      setProAccess(createEmptyAccess(false));
      return () => {
        cancelled = true;
      };
    }
    fetch("/api/auth/me", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          authenticated?: boolean;
          user_id?: string | null;
          subscription_active?: boolean | null;
          subscription_plan_code?: string | null;
          subscription_expires_at?: string | null;
          subscription_total_expires_at?: string | null;
          subscription_queued_days?: number | null;
          points?: number | null;
        }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setProAccess({
          loading: false,
          authenticated: Boolean(payload.authenticated),
          userId: payload.user_id ?? null,
          subscriptionActive: payload.subscription_active === true,
          subscriptionPlanCode: payload.subscription_plan_code ?? null,
          subscriptionExpiresAt: payload.subscription_expires_at ?? null,
          subscriptionTotalExpiresAt:
            payload.subscription_total_expires_at ??
            payload.subscription_expires_at ??
            null,
          subscriptionQueuedDays: Math.max(
            0,
            Number(payload.subscription_queued_days ?? 0),
          ),
          points: Number(payload.points ?? 0),
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setProAccess({
          ...createEmptyAccess(false),
          error: String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { refreshScanTerminalManually, scanLoading, terminalData } =
    useScanTerminalQuery({
      isPro,
      proAccessLoading: !hydrated || (proAccess.loading && !canUseLocalFullAccess),
    });
  const rows = useMemo(
    () => sortRowsByUserTime(terminalData?.rows || []),
    [terminalData?.rows],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((row) => {
      const haystack = [
        row.city,
        row.city_display_name,
        row.display_name,
        row.airport,
        row.trading_region_label,
        row.trading_region_label_zh,
        row.market_question,
        row.target_label,
        row.ai_decision,
        row.v4_metar_decision,
        row.signal_status,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return haystack.some((s) => s.includes(q));
    });
  }, [rows, searchQuery]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRow = useMemo(
    () => filteredRows.find((row) => row.id === selectedId) || filteredRows[0] || null,
    [filteredRows, selectedId],
  );
  const generatedText = useRelativeTime(terminalData?.generated_at ?? null);

  if (!hydrated || (proAccess.loading && !canUseLocalFullAccess)) {
    return (
      <ScanTerminalLoadingScreen
        isEn={isEn}
        rootClassName={scanRootClass}
        themeMode={themeMode}
        userLocalTime={userLocalTime}
      />
    );
  }

  if (!isAuthenticated || !isPro) {
    return (
      <ProductAccessRequired
        isAuthenticated={isAuthenticated}
        isEn={isEn}
        userLocalTime={userLocalTime}
      />
    );
  }

  return (
    <PolyWeatherTerminal
      generatedText={generatedText || ""}
      isEn={isEn}
      locale={locale}
      onRefresh={refreshScanTerminalManually}
      refreshing={scanLoading}
      rows={filteredRows}
      selectedRow={selectedRow}
      setSelectedRow={(row) => setSelectedId(row.id)}
      toggleLocale={toggleLocale}
      userLocalTime={userLocalTime}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchInputRef={searchInputRef}
    />
  );
}

export function ScanTerminalDashboard() {
  return <ScanTerminalScreen />;
}
