"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  BookOpenCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Menu,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CityListItem, ProAccessState, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getInitialLocaleFromNavigator } from "@/lib/i18n";
import { isBrowserLocalFullAccess } from "@/lib/local-dev-access";
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from "@/lib/supabase/client";
import { sortRowsByUserTime } from "@/components/dashboard/scan-terminal/decision-utils";
import { ProductAccessRequired } from "@/components/dashboard/scan-terminal/ProductAccessRequired";
import {
  type ContinentGroup,
  buildContinentGroups,
  GAP_COLOR_MAP,
  getDefaultExpanded,
  getGapColor,
  getSignalLabel,
  getSignalState,
  getCityRegion,
  REGIONS,
  getDefaultRegion,
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
import { UsageGuideDashboard } from "@/components/dashboard/scan-terminal/UsageGuideDashboard";
import { LiveTemperatureThresholdChart, clearCityDetailCache } from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";
import { KoyfinRowsTable } from "@/components/dashboard/scan-terminal/KoyfinRowsTable";
import { rowName, pct, money, temp, edgeClass } from "@/components/dashboard/scan-terminal/utils";
import { CitySelectorDropdown } from "@/components/dashboard/scan-terminal/CitySelectorDropdown";
import { GridLayoutSelector } from "@/components/dashboard/scan-terminal/GridLayoutSelector";
import {
  mergeAccessStateWithAuthPayload,
  type AuthProfilePayload,
} from "@/components/dashboard/scan-terminal/terminal-access-state";
import { loadTerminalAuthProfile } from "@/components/dashboard/scan-terminal/terminal-auth-bootstrap";
import {
  cityListItemsToScanRows,
  mergeScanRowsWithCityFallbackRows,
} from "@/components/dashboard/scan-terminal/city-fallback-rows";
import { markAnalyticsOnce, trackAppEvent } from "@/lib/app-analytics";
import { STATIC_CITY_LIST } from "@/lib/static-cities";

const TrainingDashboard = dynamic(
  () =>
    import("@/components/dashboard/scan-terminal/TrainingDashboard").then(
      (mod) => mod.TrainingDashboard,
    ),
  {
    loading: () => (
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs font-semibold text-slate-400">
        Loading analytics...
      </div>
    ),
  },
);

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

function createTransientAccess(error: unknown): ProAccessState {
  return {
    ...createEmptyAccess(true),
    authenticated: true,
    error: String(error),
  };
}

const TERM = {
  cityThreshold: { en: "City / Threshold", zh: "城市 / 阈值" },
  live: { en: "Live", zh: "实测" },
  deb: { en: "DEB", zh: "DEB" },
  mkt: { en: "Mkt", zh: "信号" },
  edge: { en: "Edge", zh: "优势" },
  liq: { en: "Liq", zh: "流动性" },
  signal: { en: "Signal", zh: "信号" },
  searchPlaceholder: { en: "Search city, threshold, station, or signal", zh: "搜索城市、阈值、站点或信号" },
  weatherThresholds: { en: "Weather Decisions", zh: "天气决策" },
  selectedThresholdMonitor: { en: "Selected Threshold Monitor", zh: "选中阈值监控" },
  probabilityDistribution: { en: "Probability Distribution", zh: "概率分布" },
  signalList: { en: "Signal List", zh: "信号列表" },
  watchlist: { en: "Watchlist", zh: "观察列表" },
  rows: { en: "Rows", zh: "行数" },
  avgEdge: { en: "Avg Edge", zh: "平均优势" },
  liquidity: { en: "Liquidity", zh: "流动性" },
  intradayPerformance: { en: "Intraday Performance", zh: "日内表现" },
  spread: { en: "Spread", zh: "价差" },
  model: { en: "Model", zh: "模型" },
  noData: { en: "No data", zh: "无数据" },
  noDistributionData: { en: "No distribution data", zh: "无分布数据" },
  selectThreshold: {
    en: "Select a weather threshold to inspect model edge, signal price, and live evidence.",
    zh: "选择天气阈值以查看模型优势、信号价格和实况证据。",
  },
  signInToContinue: { en: "Sign in to continue", zh: "请先登录" },
  signInHint: {
    en: "The terminal is only available to registered users. Please sign in or create an account.",
    zh: "决策台仅对注册用户开放。请登录或创建账号。",
  },
  logIn: { en: "Log in", zh: "登录" },
  createAccount: { en: "Create an account", zh: "注册账号" },
  learnAbout: { en: "Learn about PolyWeather", zh: "了解 PolyWeather" },
  proAccessRequired: { en: "Pro subscription required", zh: "需要开通 Pro" },
  proDesc: {
    en: "The PolyWeather terminal is a paid product. Subscribe to unlock real-time weather-signal intelligence.",
    zh: "PolyWeather 决策台为付费产品。订阅以解锁实时天气信号情报。",
  },
  subscriptionTerms: {
    en: "Billed monthly. Cancel anytime. Payment via USDC on Polygon.",
    zh: "按月计费，随时可取消。通过 Polygon 链 USDC 支付。",
  },
  month: { en: "/ month", zh: "/ 月" },
  subscribeNow: { en: "View Pro plans", zh: "查看订阅方案" },
  subscribePrompt: {
    en: "You need an active subscription to access the terminal.",
    zh: "你需要开通有效订阅才能访问决策台。",
  },
  backToProduct: { en: "Back to product overview", zh: "返回产品介绍页" },
  dashboard: { en: "PolyWeather Terminal", zh: "PolyWeather 天气决策台" },
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

const MAX_TERMINAL_GRID_SIDE = 3;
const MAX_TERMINAL_CHARTS = 9;
const MOBILE_TERMINAL_CHARTS = 1;
const DEFAULT_TERMINAL_GRID_SIDE = 2;

function clampGridSide(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_GRID_SIDE;
  return Math.max(1, Math.min(MAX_TERMINAL_GRID_SIDE, Math.floor(value)));
}

function getStoredGridSide(key: string) {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_GRID_SIDE;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_TERMINAL_GRID_SIDE;
    return clampGridSide(parseInt(raw, 10));
  } catch {}
  return DEFAULT_TERMINAL_GRID_SIDE;
}

function getSlotCount(cols: number, rows: number) {
  return Math.min(MAX_TERMINAL_CHARTS, clampGridSide(cols) * clampGridSide(rows));
}

function normalizeSlotList(slots: Array<string | null>, totalSlots: number) {
  if (slots.length === totalSlots) return slots;
  if (slots.length > totalSlots) return slots.slice(0, totalSlots);
  return [...slots, ...Array(totalSlots - slots.length).fill(null)];
}

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

function CityRegionList({
  isEn,
  rows,
  selectedCity,
  onSelectCity,
  slots = [],
  activeSlotIndex = 0,
}: {
  isEn: boolean;
  rows: ScanOpportunityRow[];
  selectedCity: string | null;
  onSelectCity: (city: string) => void;
  slots?: Array<string | null>;
  activeSlotIndex?: number;
}) {
  const cities = useMemo(() => {
    const seen = new Set<string>();
    const result: { city: string; name: string; localTime: string | null }[] = [];
    rows.forEach((row) => {
      const key = String(row.city || "").toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        city: key,
        name: rowName(row),
        localTime: row.local_time || null,
      });
    });
    return result;
  }, [rows]);

  return (
    <Panel title={isEn ? "Cities" : "城市"}>
      <div className="divide-y divide-slate-100 max-h-[calc(100vh-140px)] overflow-y-auto">
        {cities.map(({ city, name, localTime }) => {
          const isActive = selectedCity === city;
          const displaySlotIndices = slots
            .map((s, idx) => (s === city ? idx : -1))
            .filter((idx) => idx !== -1);
          
          return (
            <button
              key={city}
              type="button"
              onClick={() => onSelectCity(city)}
              className={clsx(
                "flex w-full items-center justify-between px-3 py-2 text-left hover:bg-blue-50/70 transition-colors",
                isActive && "bg-blue-50 border-l-2 border-blue-500 pl-2.5",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-slate-800 truncate">{name}</div>
                <div className="text-[11px] text-slate-400">{localTime}</div>
              </div>
              
              {/* Slot indicators */}
              {displaySlotIndices.length > 0 && (
                <div className="flex gap-0.5 ml-2">
                  {displaySlotIndices.map((idx) => (
                    <span
                      key={idx}
                      className={clsx(
                        "grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold",
                        idx === activeSlotIndex
                          ? "bg-blue-500 text-white"
                          : "bg-slate-200 text-slate-600"
                      )}
                      title={isEn ? `Slot ${idx + 1}` : `槽位 ${idx + 1}`}
                    >
                      {idx + 1}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function EmptySlotCard({
  slotIndex,
  isActive,
  isEn,
  onSelectSlot,
  onOpenSearch,
}: {
  slotIndex: number;
  isActive: boolean;
  isEn: boolean;
  onSelectSlot: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <div
      onClick={() => {
        onSelectSlot();
        onOpenSearch();
      }}
      className={clsx(
        "flex flex-col items-center justify-center h-full rounded-[4px] border-2 border-dashed p-6 cursor-pointer bg-slate-50/50 transition-all",
        isActive
          ? "border-blue-500 bg-blue-50/10 ring-2 ring-blue-500/20"
          : "border-slate-300 hover:border-slate-400 hover:bg-slate-50/80"
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-2">
        <span className="text-xl font-bold">+</span>
      </div>
      <div className="text-[12px] font-bold text-slate-700 mb-1">
        {isEn ? `Slot ${slotIndex + 1}: Empty` : `槽位 ${slotIndex + 1}: 空白`}
      </div>
      <div className="text-[10px] text-slate-400 text-center mb-3 max-w-[180px]">
        {isEn
          ? "Click to choose a city weather chart for this slot."
          : "点击为该槽位选择一个城市天气图表。"}
      </div>
      <button
        type="button"
        className="text-[11px] font-semibold text-white px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm outline-none"
      >
        {isEn ? "Choose City..." : "选择城市..."}
      </button>
    </div>
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
  selectedCity,
  setSelectedCity,
  selectedRegionKey,
  setSelectedRegionKey,
  visibleRegions,
  toggleRegion,
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
  selectedCity: string | null;
  setSelectedCity: (city: string | null) => void;
  selectedRegionKey: string;
  setSelectedRegionKey: (key: string) => void;
  visibleRegions: Set<string>;
  toggleRegion: (key: string) => void;
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
  const [activeNavKey, setActiveNavKey] = useState<string>("thresholds");
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchOnline = () => {
      fetch("/api/ops/online-users", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.online != null) setOnlineCount(d.online); })
        .catch(() => {});
    };
    fetchOnline();
    const id = setInterval(fetchOnline, 60_000);
    return () => clearInterval(id);
  }, []);

  const [gridCols, setGridCols] = useState<number>(() => {
    return getStoredGridSide("polyweather_terminal_grid_cols");
  });

  const [gridRows, setGridRows] = useState<number>(() => {
    return getStoredGridSide("polyweather_terminal_grid_rows");
  });

  const totalSlots = getSlotCount(gridCols, gridRows);

  const [slots, setSlots] = useState<Array<string | null>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("polyweather_terminal_slots");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            return normalizeSlotList(parsed, MAX_TERMINAL_CHARTS);
          }
        }
      } catch {}
    }
    return Array(MAX_TERMINAL_CHARTS).fill(null);
  });
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);
  const [maximizedSlotIndex, setMaximizedSlotIndex] = useState<number | null>(null);
  const [activeSearchSlotIndex, setActiveSearchSlotIndex] = useState<number | null>(null);
  const visibleSlots = useMemo(() => slots.slice(0, totalSlots), [slots, totalSlots]);

  const handleSetGridSize = (cols: number, rows: number) => {
    const safeCols = clampGridSide(cols);
    const safeRows = clampGridSide(rows);
    const nextTotalSlots = getSlotCount(safeCols, safeRows);
    
    setGridCols(safeCols);
    setGridRows(safeRows);
    
    try {
      localStorage.setItem("polyweather_terminal_grid_cols", String(safeCols));
      localStorage.setItem("polyweather_terminal_grid_rows", String(safeRows));
    } catch {}

    if (activeSlotIndex >= nextTotalSlots) {
      setActiveSlotIndex(0);
    }
    if (maximizedSlotIndex !== null && maximizedSlotIndex >= nextTotalSlots) {
      setMaximizedSlotIndex(null);
    }
    if (activeSearchSlotIndex !== null && activeSearchSlotIndex >= nextTotalSlots) {
      setActiveSearchSlotIndex(null);
    }
  };

  const NAV_ITEMS = [
    { key: "thresholds", Icon: Activity, labelEn: "Decision", labelZh: "天气决策" },
    { key: "training", Icon: GraduationCap, labelEn: "Training", labelZh: "训练数据" },
    { key: "guide", Icon: BookOpenCheck, labelEn: "Guide", labelZh: "使用指南" },
  ];

  useEffect(() => {
    setSelectedCity(null);
  }, [selectedRegionKey, setSelectedCity]);

  const filteredRegionRows = useMemo(() => {
    if (selectedRegionKey === "all") return rows;
    return rows.filter(
      (row) => getCityRegion(row) === selectedRegionKey,
    );
  }, [rows, selectedRegionKey]);

  useEffect(() => {
    if (filteredRegionRows.length && slots.every((s) => s === null)) {
      const next = Array(MAX_TERMINAL_CHARTS)
        .fill(null)
        .map((_, idx) => filteredRegionRows[idx]?.city || null);
      setSlots(next);
      try {
        localStorage.setItem("polyweather_terminal_slots", JSON.stringify(next));
      } catch {}
    }
  }, [filteredRegionRows, slots]);

  const handleSelectCityForSlot = (index: number, city: string | null) => {
    if (index < 0 || index >= MAX_TERMINAL_CHARTS) return;
    const next = [...slots];
    next[index] = city;
    setSlots(next);
    try {
      localStorage.setItem("polyweather_terminal_slots", JSON.stringify(next));
    } catch {}
  };

  const availableCities = useMemo(() => {
    const seen = new Set<string>();
    const result: { city: string; name: string }[] = [];
    filteredRegionRows.forEach((row) => {
      const key = String(row.city || "").toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        city: key,
        name: rowName(row),
      });
    });
    return result;
  }, [filteredRegionRows]);

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
  const mobileChartRow = useMemo(
    () =>
      selectedRow ||
      mobileActiveGroup?.rows.slice(0, MOBILE_TERMINAL_CHARTS)[0] ||
      filteredRegionRows[0] ||
      null,
    [filteredRegionRows, mobileActiveGroup?.rows, selectedRow],
  );
  useEffect(() => {
    if (!filteredRegionRows.length) return;
    if (!selectedRow || !filteredRegionRows.some((row) => row.id === selectedRow.id)) {
      setSelectedRow(filteredRegionRows[0]);
    }
  }, [filteredRegionRows, selectedRow, setSelectedRow]);

  useEffect(() => {
    if (!selectedCity) return;
    const cityRows = filteredRegionRows.filter((r) => String(r.city || "").toLowerCase() === selectedCity);
    if (cityRows.length && (!selectedRow || !cityRows.some((r) => r.id === selectedRow.id))) {
      setSelectedRow(cityRows[0]);
    }
  }, [selectedCity, filteredRegionRows, selectedRow, setSelectedRow]);

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
          "flex shrink-0 flex-col bg-white border-r border-[#d2d9e2] py-3 text-slate-500 transition-all duration-200",
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
            <span className="text-sm font-black text-slate-800 tracking-tight truncate">
              PolyWeather
            </span>
          )}
        </div>

        {/* Toggle button */}
        <button
          type="button"
          onClick={() => setNavExpanded((prev) => !prev)}
          className={clsx(
            "flex items-center gap-3 transition-colors hover:text-slate-800",
            navExpanded
              ? "w-full h-8 px-1 mb-2"
              : "grid h-9 w-full place-items-center mb-2",
          )}
        >
          {navExpanded ? (
            <>
              <ChevronLeft size={14} />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
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
                    ? "bg-blue-50 text-blue-600 font-bold"
                    : "border-blue-500 bg-blue-50/50 text-blue-600"
                  : navExpanded
                    ? "hover:bg-slate-50 hover:text-slate-900"
                    : "border-transparent hover:bg-slate-50 hover:text-slate-700",
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
            <div className="hidden items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:flex">
              <Activity size={13} />
              {t("dashboard", isEn)}
            </div>
            {onlineCount != null && (
              <div className="hidden items-center gap-1 text-[10px] font-medium text-slate-400 lg:flex">
                <Users size={12} />
                <span>{onlineCount}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="hidden font-mono md:inline text-slate-500">{userLocalTime}</span>
            <div className="hidden lg:block">
              <GridLayoutSelector
                isEn={isEn}
                cols={gridCols}
                rows={gridRows}
                onSelectGrid={handleSetGridSize}
              />
            </div>
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
          ) : activeNavKey === "guide" ? (
            <UsageGuideDashboard isEn={isEn} />
          ) : (
            <>
              {/* Mobile layout */}
              <div className="flex flex-col gap-2 lg:hidden overflow-auto flex-1 pb-6">
                <MobileRegionTabs
                  activeTab={mobileTab}
                  groups={continentGroups}
                  isEn={isEn}
                  onSelectTab={setMobileTab}
                />
                <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-semibold leading-4 text-blue-700">
                  {isEn
                    ? "Mobile renders one chart. Rotate to landscape to inspect the full terminal grid."
                    : "手机端仅渲染 1 个图表。建议横屏查看完整终端网格。"}
                </div>
                {mobileChartRow && (
                  <div className="h-[420px] min-h-[420px] overflow-hidden rounded border border-[#d2d9e2] bg-white">
                    <LiveTemperatureThresholdChart
                      isEn={isEn}
                      row={mobileChartRow}
                      allRows={filteredRegionRows}
                      compact={false}
                      disableClose={true}
                    />
                  </div>
                )}
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
                        ["Market", "--"],
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
              <div className="hidden h-full min-h-0 lg:block">
                <div className="h-full w-full min-h-0">
                  {maximizedSlotIndex !== null ? (
                    // Maximized view
                    <div
                      onClick={() => setActiveSlotIndex(maximizedSlotIndex)}
                      className={clsx(
                        "relative h-full rounded-[4px] border border-blue-500 ring-2 ring-blue-500/20 shadow-md z-10",
                        activeSearchSlotIndex === maximizedSlotIndex ? "" : "overflow-hidden"
                      )}
                    >
                      <LiveTemperatureThresholdChart
                        isEn={isEn}
                        row={filteredRegionRows.find((r) => String(r.city || "").toLowerCase() === visibleSlots[maximizedSlotIndex]) || null}
                        allRows={filteredRegionRows}
                        compact={false}
                        onSearchClick={() => setActiveSearchSlotIndex(maximizedSlotIndex)}
                        onMaximize={() => setMaximizedSlotIndex(null)}
                        onClose={() => {
                          handleSelectCityForSlot(maximizedSlotIndex, null);
                          setMaximizedSlotIndex(null);
                        }}
                        isMaximized={true}
                        disableClose={visibleSlots.filter(Boolean).length <= 1}
                      />

                      {activeSearchSlotIndex === maximizedSlotIndex && (
                        <CitySelectorDropdown
                          isEn={isEn}
                          rows={filteredRegionRows}
                          onSelectCity={(city) => {
                            handleSelectCityForSlot(maximizedSlotIndex, city);
                            setActiveSearchSlotIndex(null);
                          }}
                          onClose={() => setActiveSearchSlotIndex(null)}
                          className="absolute left-3 top-9 z-50 w-[380px] bg-white border border-slate-200 rounded shadow-lg p-2"
                        />
                      )}
                    </div>
                  ) : (
                    // Custom grid layout
                    <div
                      className="grid gap-2 h-full"
                      style={{
                        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                        gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                      }}
                    >
                      {visibleSlots.map((cityInSlot, slotIndex) => {
                        const isSlotActive = activeSlotIndex === slotIndex;
                        const rowForSlot = cityInSlot
                          ? filteredRegionRows.find(
                              (r) => String(r.city || "").toLowerCase() === cityInSlot
                            ) || null
                          : null;

                        if (!cityInSlot || !rowForSlot) {
                          return (
                            <div key={slotIndex} className="relative h-full">
                              <EmptySlotCard
                                slotIndex={slotIndex}
                                isActive={isSlotActive}
                                isEn={isEn}
                                onSelectSlot={() => setActiveSlotIndex(slotIndex)}
                                onOpenSearch={() => setActiveSearchSlotIndex(slotIndex)}
                              />
                              
                              {activeSearchSlotIndex === slotIndex && (
                                <CitySelectorDropdown
                                  isEn={isEn}
                                  rows={filteredRegionRows}
                                  onSelectCity={(city) => {
                                    handleSelectCityForSlot(slotIndex, city);
                                    setActiveSearchSlotIndex(null);
                                  }}
                                  onClose={() => setActiveSearchSlotIndex(null)}
                                  className="absolute left-1/2 top-12 z-50 w-[380px] -translate-x-1/2 bg-white border border-slate-200 rounded shadow-lg p-2"
                                />
                              )}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={slotIndex}
                            onClick={() => setActiveSlotIndex(slotIndex)}
                            className={clsx(
                              "relative h-full rounded-[4px] border transition-all",
                              isSlotActive
                                ? "border-blue-500 ring-2 ring-blue-500/20 shadow-md z-10"
                                : "border-[#d2d9e2] hover:border-slate-400",
                              activeSearchSlotIndex === slotIndex ? "" : "overflow-hidden"
                            )}
                          >
                            <LiveTemperatureThresholdChart
                              isEn={isEn}
                              row={rowForSlot}
                              allRows={filteredRegionRows}
                              compact={true}
                              isActive={isSlotActive}
                              slotIndex={slotIndex}
                              onSearchClick={() => setActiveSearchSlotIndex(slotIndex)}
                              onMaximize={() => {
                                setMaximizedSlotIndex(slotIndex);
                                setActiveSlotIndex(slotIndex);
                              }}
                              onClose={() => {
                                handleSelectCityForSlot(slotIndex, null);
                              }}
                              isMaximized={false}
                              disableClose={visibleSlots.filter(Boolean).length <= 1}
                            />

                            {activeSearchSlotIndex === slotIndex && (
                              <CitySelectorDropdown
                                isEn={isEn}
                                rows={filteredRegionRows}
                                onSelectCity={(city) => {
                                  handleSelectCityForSlot(slotIndex, city);
                                  setActiveSearchSlotIndex(null);
                                }}
                                onClose={() => setActiveSearchSlotIndex(null)}
                                className="absolute left-3 top-9 z-50 w-[380px] bg-white border border-slate-200 rounded shadow-lg p-2"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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

  const loadAuthProfile = useCallback(
    async (
      accessToken?: string | null,
      options?: { preferSnapshot?: boolean },
    ): Promise<AuthProfilePayload> => {
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = String(accessToken || "").trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(
        options?.preferSnapshot
          ? "/api/auth/me?prefer_snapshot=1"
          : "/api/auth/me",
        {
          cache: "no-store",
          headers,
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<AuthProfilePayload>;
    },
    [],
  );

  const refreshLiveAuthProfile = useCallback(async () => {
    const supabaseEnabled = hasSupabasePublicEnv();
    const payload = await loadTerminalAuthProfile({
      getSession: () =>
        supabaseEnabled
          ? getSupabaseBrowserClient().auth.getSession()
          : Promise.resolve({ data: { session: null } }),
      hasSupabasePublicEnv: supabaseEnabled,
      loadAuthProfile: (accessToken) =>
        loadAuthProfile(accessToken, { preferSnapshot: false }),
    });
    setProAccess((prev) => mergeAccessStateWithAuthPayload(prev, payload));
  }, [loadAuthProfile]);

  // Listen to Supabase auth events (e.g. token refreshed, signed out)
  useEffect(() => {
    if (!hasSupabasePublicEnv()) return;
    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_OUT") {
          try {
            const {
              data: { session: currentSession },
            } = await supabase.auth.getSession();
            const accessToken =
              currentSession?.access_token || session?.access_token || null;
            if (accessToken) {
              const payload = await loadAuthProfile(accessToken);
              setProAccess((prev) => mergeAccessStateWithAuthPayload(prev, payload));
              return;
            }
          } catch {}
          setProAccess(createEmptyAccess(false));
        } else if (
          event === "INITIAL_SESSION" ||
          event === "TOKEN_REFRESHED" ||
          event === "SIGNED_IN"
        ) {
          try {
            if (!session?.access_token) return;
            const payload = await loadAuthProfile(session?.access_token);
            setProAccess((prev) => mergeAccessStateWithAuthPayload(prev, payload));
          } catch {}
        }
      });
      return () => {
        subscription.unsubscribe();
      };
    } catch {}
  }, []);

  // Periodically touch the session to trigger background refresh if near expiry
  useEffect(() => {
    if (!hasSupabasePublicEnv()) return;
    const supabase = getSupabaseBrowserClient();
    const interval = setInterval(async () => {
      try {
        await supabase.auth.getSession();
      } catch {}
    }, 15 * 60 * 1000); // every 15 minutes
    
    return () => clearInterval(interval);
  }, []);
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
  const accessDecisionPending =
    !hydrated || (proAccess.loading && !canUseLocalFullAccess);
  const shouldShowPaywall = !accessDecisionPending && (!isAuthenticated || !isPro);
  const userLocalTime = useUserLocalClock();
  const { themeMode } = useScanTerminalTheme();
  const [selectedRegionKey, setSelectedRegionKey] = useState<string>("all");
  const [localTimezoneOffsetSeconds, setLocalTimezoneOffsetSeconds] = useState<number | null>(null);
  const [useLocalTimezoneDefault, setUseLocalTimezoneDefault] = useState(false);
  const [visibleRegions, setVisibleRegions] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("polyweather_visible_regions");
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set(REGIONS.map((r) => r.key));
  });
  const toggleRegion = useCallback((key: string) => {
    setVisibleRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev; // keep at least one
        next.delete(key);
      } else {
        next.add(key);
      }
      try { localStorage.setItem("polyweather_visible_regions", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

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
    const supabaseEnabled = hasSupabasePublicEnv();
    loadTerminalAuthProfile({
      getSession: () =>
        supabaseEnabled
          ? getSupabaseBrowserClient().auth.getSession()
          : Promise.resolve({ data: { session: null } }),
      hasSupabasePublicEnv: supabaseEnabled,
      loadAuthProfile,
    })
      .then((payload) => {
        if (cancelled) return;
        setProAccess((prev) => mergeAccessStateWithAuthPayload(prev, payload));
        if (payload.entitlement_snapshot === true) {
          window.setTimeout(() => {
            if (!cancelled) void refreshLiveAuthProfile();
          }, 0);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setProAccess((prev) => (
          prev.subscriptionActive
            ? { ...prev, loading: false, error: String(error) }
            : createTransientAccess(error)
        ));
      });
    return () => {
      cancelled = true;
    };
  }, [loadAuthProfile, refreshLiveAuthProfile]);

  useEffect(() => {
    if (
      !hydrated ||
      canUseLocalFullAccess ||
      !proAccess.authenticated ||
      !proAccess.loading ||
      proAccess.subscriptionActive ||
      typeof fetch !== "function"
    ) {
      return;
    }

    let cancelled = false;
    const supabaseEnabled = hasSupabasePublicEnv();
    const retryAuthProfile = async () => {
      try {
        const payload = await loadTerminalAuthProfile({
          getSession: () =>
            supabaseEnabled
              ? getSupabaseBrowserClient().auth.getSession()
              : Promise.resolve({ data: { session: null } }),
          hasSupabasePublicEnv: supabaseEnabled,
          loadAuthProfile,
        });
        if (cancelled) return;
        setProAccess((prev) => mergeAccessStateWithAuthPayload(prev, payload));
      } catch (error) {
        if (cancelled) return;
        setProAccess((prev) =>
          prev.loading && prev.authenticated && !prev.subscriptionActive
            ? { ...prev, error: String(error) }
            : prev,
        );
      }
    };

    const firstRetry = window.setTimeout(() => {
      void retryAuthProfile();
    }, 1500);
    const interval = window.setInterval(() => {
      void retryAuthProfile();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(firstRetry);
      window.clearInterval(interval);
    };
  }, [
    canUseLocalFullAccess,
    hydrated,
    loadAuthProfile,
    proAccess.authenticated,
    proAccess.loading,
    proAccess.subscriptionActive,
  ]);

  useEffect(() => {
    setSelectedRegionKey("all");
    setLocalTimezoneOffsetSeconds(-new Date().getTimezoneOffset() * 60);
  }, []);

  const selectRegionManually = useCallback((key: string) => {
    setUseLocalTimezoneDefault(false);
    setSelectedRegionKey(key);
  }, []);

  const { refreshScanTerminalManually, scanLoading, terminalData } =
    useScanTerminalQuery({
      isPro,
      proAccessLoading: !hydrated || (proAccess.loading && !canUseLocalFullAccess),
      timezoneOffsetSeconds: useLocalTimezoneDefault ? localTimezoneOffsetSeconds : null,
      tradingRegion: selectedRegionKey,
    });

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !isPro) return;
    const actorKey = String(proAccess.userId || "local").toLowerCase();
    if (markAnalyticsOnce(`enter_terminal:${actorKey}`, "session")) {
      trackAppEvent("enter_terminal", {
        entry: "terminal",
        user_id: proAccess.userId || null,
      });
    }
  }, [hydrated, isAuthenticated, isPro, proAccess.userId]);
  const handleRefresh = useCallback(() => {
    clearCityDetailCache();
    refreshScanTerminalManually();
  }, [refreshScanTerminalManually]);

  const [cityFallbackRows, setCityFallbackRows] = useState<ScanOpportunityRow[]>(() =>
    cityListItemsToScanRows(STATIC_CITY_LIST),
  );
  const rows = useMemo(
    () => {
      const scanRows = terminalData?.rows || [];
      return sortRowsByUserTime(
        mergeScanRowsWithCityFallbackRows(scanRows, cityFallbackRows),
      );
    },
    [cityFallbackRows, terminalData?.rows],
  );

  const fallbackFetchedRef = useRef(false);
  useEffect(() => {
    if (!isPro || typeof fetch !== "function") return;
    if (fallbackFetchedRef.current) return;
    const controller = new AbortController();
    fetch("/api/cities", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ cities?: CityListItem[] }>;
      })
      .then((payload) => {
        if (!payload || !Array.isArray(payload.cities)) return;
        fallbackFetchedRef.current = true;
        setCityFallbackRows(cityListItemsToScanRows(payload.cities));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isPro]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredRows = useMemo(() => {
    if (!deferredSearchQuery.trim()) return rows;
    const q = deferredSearchQuery.toLowerCase().trim();
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
  }, [rows, deferredSearchQuery]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const selectedRow = useMemo(
    () => filteredRows.find((row) => row.id === selectedId) || filteredRows[0] || null,
    [filteredRows, selectedId],
  );
  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    setSelectedId(row.id);
  }, []);
  const generatedText = useRelativeTime(terminalData?.generated_at ?? null);

  if (accessDecisionPending) {
    return (
      <ScanTerminalLoadingScreen
        isEn={isEn}
        rootClassName={scanRootClass}
        themeMode={themeMode}
        userLocalTime={userLocalTime}
      />
    );
  }

  if (shouldShowPaywall) {
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
      onRefresh={handleRefresh}
      refreshing={scanLoading}
      rows={filteredRows}
      selectedRow={selectedRow}
      setSelectedRow={handleSelectRow}
      toggleLocale={toggleLocale}
      userLocalTime={userLocalTime}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchInputRef={searchInputRef}
      selectedCity={selectedCity}
      setSelectedCity={setSelectedCity}
      selectedRegionKey={selectedRegionKey}
      setSelectedRegionKey={selectRegionManually}
      visibleRegions={visibleRegions}
      toggleRegion={toggleRegion}
    />
  );
}

export function ScanTerminalDashboard() {
  return <ScanTerminalScreen />;
}
