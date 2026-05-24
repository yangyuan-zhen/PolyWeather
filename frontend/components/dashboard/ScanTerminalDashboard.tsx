"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bell,
  CloudSun,
  CreditCard,
  Gauge,
  LineChart,
  LockKeyhole,
  LogIn,
  Menu,
  RefreshCw,
  Search,
  Table2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProAccessState, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getInitialLocaleFromNavigator } from "@/lib/i18n";
import { isBrowserLocalFullAccess } from "@/lib/local-dev-access";
import { sortRowsByUserTime } from "@/components/dashboard/scan-terminal/decision-utils";
import { useScanTerminalQuery } from "@/components/dashboard/scan-terminal/use-scan-terminal-query";
import {
  useScanTerminalTheme,
  useUserLocalClock,
} from "@/components/dashboard/scan-terminal/use-scan-terminal-ui-state";
import { useRelativeTime } from "@/hooks/useRelativeTime";

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

function rowName(row?: ScanOpportunityRow | null) {
  return row?.city_display_name || row?.display_name || row?.city || "--";
}

function pct(value: unknown, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(digits)}%`;
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `$${Math.round(n).toLocaleString()}`;
}

function temp(value: unknown, unit?: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}${unit || "°"}`;
}

function edgeClass(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "text-slate-500";
  return n > 0 ? "text-emerald-700" : "text-red-600";
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
  approvedSignals: { en: "Approved Signals", zh: "已确认信号" },
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
  dashboard: { en: "Weather Market Dashboard", zh: "天气市场数据仪表盘" },
  refresh: { en: "Refresh", zh: "刷新" },
  switchLang: { en: "Switch to Chinese", zh: "切换到英文" },
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

function decisionClass(label: string) {
  if (label === "Approve" || label === "Tradable") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (label === "Veto" || label === "Downgrade") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function SparkArea({
  color = "#2563eb",
  data,
  isEn = true,
}: {
  color?: string;
  data: { v: number }[];
  isEn?: boolean;
}) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        {t("noData", isEn)}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`fill-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#fill-${color})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ProbabilityDistributionChart({
  points,
  isEn = true,
}: {
  points?: ScanOpportunityRow["distribution_preview"];
  isEn?: boolean;
}) {
  if (!points?.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        {t("noDistributionData", isEn)}
      </div>
    );
  }
  const chartData = points.map((p) => ({
    label: p.label || "",
    model: Number((p.model_probability ?? 0) * 100),
    market: Number((p.market_probability ?? 0) * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ReBarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 4,
            border: "1px solid #e2e8f0",
            fontSize: 12,
            fontFamily: "monospace",
          }}
          formatter={(value: unknown) =>
            `${Number(value).toFixed(1)}%`
          }
        />
        <Bar dataKey="model" fill="#2563eb" radius={[2, 2, 0, 0]} name={t("model", isEn)} />
        <Bar dataKey="market" fill="#059669" radius={[2, 2, 0, 0]} name={t("mkt", isEn)} />
      </ReBarChart>
    </ResponsiveContainer>
  );
}

function Panel({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section
      className={clsx(
        "overflow-hidden rounded-[4px] border border-[#cfd6df] bg-white shadow-sm",
        className,
      )}
    >
      <div className="flex h-9 items-center justify-between border-b border-[#dce2e9] bg-[#eef2f6] px-3">
        <h2 className="text-[15px] font-black leading-none text-[#202833]">
          {title}
        </h2>
        <span className="grid h-5 w-5 place-items-center rounded border border-slate-300 bg-white text-slate-500">
          ↗
        </span>
      </div>
      {children}
    </section>
  );
}

function MarketTable({
  onSelect,
  rows,
  selectedId,
  isEn = true,
}: {
  onSelect: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  selectedId?: string | null;
  isEn?: boolean;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#f5f7fa] text-left text-[11px] uppercase text-slate-500">
            <th className="px-3 py-2 font-black">{t("cityContract", isEn)}</th>
            <th className="px-2 py-2 text-right font-black">{t("live", isEn)}</th>
            <th className="px-2 py-2 text-right font-black">{t("deb", isEn)}</th>
            <th className="px-2 py-2 text-right font-black">{t("mkt", isEn)}</th>
            <th className="px-2 py-2 text-right font-black">{t("edge", isEn)}</th>
            <th className="px-2 py-2 text-right font-black">{t("liq", isEn)}</th>
            <th className="px-3 py-2 font-black">{t("signal", isEn)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = decisionLabel(row);
            return (
              <tr
                key={row.id}
                className={clsx(
                  "cursor-pointer border-b border-slate-100 hover:bg-blue-50/70",
                  selectedId === row.id && "bg-blue-50",
                )}
                onClick={() => onSelect(row)}
              >
                <td className="px-3 py-2">
                  <div className="font-bold text-slate-900">{rowName(row)}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {row.target_label || row.market_question || row.airport || "--"}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono font-bold">
                  {temp(row.current_max_so_far ?? row.current_temp, row.temp_symbol)}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {temp(row.deb_prediction, row.temp_symbol)}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {pct(row.market_probability ?? row.market_event_probability)}
                </td>
                <td
                  className={clsx(
                    "px-2 py-2 text-right font-mono font-black",
                    edgeClass(row.edge_percent ?? row.signed_gap ?? row.gap),
                  )}
                >
                  {pct(row.edge_percent ?? row.signed_gap ?? row.gap)}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {money(row.book_liquidity ?? row.market_liquidity ?? row.volume)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={clsx(
                      "inline-flex rounded border px-2 py-1 text-[11px] font-black",
                      decisionClass(label),
                    )}
                  >
                    {label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KoyfinWeatherTerminal({
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
}) {
  const topRows = rows.slice(0, 18);
  const approveRows = rows
    .filter((row) => ["Approve", "Tradable"].includes(decisionLabel(row)))
    .slice(0, 8);
  const watchRows = rows
    .filter((row) => decisionLabel(row) === "Watch" || !row.tradable)
    .slice(0, 8);
  const selectedLabel = decisionLabel(selectedRow);
  const avgEdge =
    rows.reduce((sum, row) => sum + Number(row.edge_percent || 0), 0) /
    Math.max(rows.length, 1);
  const totalLiquidity = rows.reduce(
    (sum, row) =>
      sum + Number(row.book_liquidity || row.market_liquidity || row.volume || 0),
    0,
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#e9edf3] text-[#202833]">
      <aside className="flex w-[52px] shrink-0 flex-col items-center gap-2 bg-[#171d24] py-4 text-slate-300">
        <Link
          href="/"
          className="mb-2 block h-8 w-8 overflow-hidden rounded transition hover:opacity-90"
          title="PolyWeather"
        >
          <img src="/apple-touch-icon.png" alt="PolyWeather" className="h-full w-full object-cover" />
        </Link>
        <Menu size={23} className="mb-3" />
        {[CloudSun, Table2, BarChart3, LineChart, Gauge, Bell].map((Icon, i) => (
          <button
            key={i}
            className={clsx(
              "grid h-10 w-full place-items-center border-l-4",
              i === 0
                ? "border-blue-500 bg-white/5 text-white"
                : "border-transparent hover:bg-white/5",
            )}
            type="button"
          >
            <Icon size={19} />
          </button>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[64px] shrink-0 items-center justify-between bg-[#171d24] px-4 text-white">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 min-w-[320px] items-center gap-3 rounded border border-slate-600 bg-[#29323d] px-3 text-slate-300">
              <Search size={19} />
              <span className="truncate text-sm font-semibold">
                {t("searchPlaceholder", isEn)}
              </span>
              <kbd className="ml-auto rounded border border-slate-500 px-2 py-0.5 text-xs">
                /
              </kbd>
            </div>
            <div className="hidden items-center gap-2 text-xs font-bold uppercase text-slate-400 lg:flex">
              <Activity size={15} />
              {t("dashboard", isEn)}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="hidden font-mono md:inline">{userLocalTime}</span>
            {/* Language toggle — matches landing page style */}
            <button
              type="button"
              aria-label={t("switchLang", isEn)}
              title={t("switchLang", isEn)}
              onClick={toggleLocale}
              className="inline-flex h-9 items-center gap-0.5 rounded border border-slate-600 bg-[#29323d] p-1 text-xs font-bold text-slate-400 hover:border-slate-400"
            >
              <span
                className={clsx(
                  "rounded px-2 py-1 transition-colors",
                  locale === "zh-CN"
                    ? "bg-blue-600 text-white"
                    : "hover:text-slate-200",
                )}
              >
                中文
              </span>
              <span
                className={clsx(
                  "rounded px-2 py-1 transition-colors",
                  locale === "en-US"
                    ? "bg-blue-600 text-white"
                    : "hover:text-slate-200",
                )}
              >
                EN
              </span>
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex h-9 items-center gap-2 rounded border border-slate-600 bg-[#29323d] px-3 font-bold hover:bg-[#323c49] disabled:opacity-60"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              {t("refresh", isEn)}
            </button>
            <Link
              href="/account"
              className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-slate-900"
            >
              <UserRound size={18} />
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-2">
          <div className="grid min-h-full grid-cols-1 gap-2 xl:grid-cols-[1.12fr_1.6fr_1.1fr]">
            <div className="grid min-h-0 gap-2">
              <Panel title={t("weatherContracts", isEn)}>
                <div className="grid grid-cols-3 border-b border-slate-200 text-center">
                  <div className="p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      {t("rows", isEn)}
                    </div>
                    <div className="font-mono text-xl font-black">{rows.length}</div>
                  </div>
                  <div className="border-x border-slate-200 p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      {t("avgEdge", isEn)}
                    </div>
                    <div className={clsx("font-mono text-xl font-black", edgeClass(avgEdge))}>
                      {pct(avgEdge)}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      {t("liquidity", isEn)}
                    </div>
                    <div className="font-mono text-xl font-black">
                      {money(totalLiquidity)}
                    </div>
                  </div>
                </div>
                <MarketTable
                  rows={topRows}
                  selectedId={selectedRow?.id}
                  onSelect={setSelectedRow}
                  isEn={isEn}
                />
              </Panel>

              <Panel title={t("approvedSignals", isEn)}>
                <div className="divide-y divide-slate-100">
                  {(approveRows.length ? approveRows : topRows.slice(0, 5)).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedRow(row)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-left hover:bg-blue-50"
                    >
                      <span>
                        <b className="block text-sm">{rowName(row)}</b>
                        <small className="text-slate-500">
                          {row.ai_reason_en || row.ai_city_thesis_en || row.target_label || "--"}
                        </small>
                      </span>
                      <span className={clsx("font-mono text-sm font-black", edgeClass(row.edge_percent))}>
                        {pct(row.edge_percent)}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-2">
              <Panel title={t("selectedContractMonitor", isEn)}>
                <div className="grid gap-4 p-4 lg:grid-cols-[1fr_220px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-black leading-tight">
                        {rowName(selectedRow)}
                      </h1>
                      <span
                        className={clsx(
                          "rounded border px-2 py-1 text-xs font-black",
                          decisionClass(selectedLabel),
                        )}
                      >
                        {selectedLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedRow?.ai_city_thesis_en ||
                        selectedRow?.ai_reason_en ||
                        selectedRow?.market_question ||
                        t("selectContract", isEn)}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                      {[
                        [t("live", isEn), temp(selectedRow?.current_max_so_far ?? selectedRow?.current_temp, selectedRow?.temp_symbol)],
                        [t("deb", isEn), temp(selectedRow?.deb_prediction, selectedRow?.temp_symbol)],
                        [t("model", isEn), pct(selectedRow?.model_probability ?? selectedRow?.model_event_probability)],
                        [t("mkt", isEn), pct(selectedRow?.market_probability ?? selectedRow?.market_event_probability)],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-black uppercase text-slate-500">
                            {label}
                          </div>
                          <div className="font-mono text-lg font-black">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-[#f7f9fb] p-3">
                    <div className="mb-2 text-xs font-black uppercase text-slate-500">
                      {t("intradayPerformance", isEn)}
                    </div>
                    <div className="h-20">
                      <SparkArea
                        isEn={isEn}
                        color={
                          Number(selectedRow?.edge_percent || 0) >= 0
                            ? "#059669"
                            : "#dc2626"
                        }
                        data={
                          selectedRow?.distribution_preview?.map((p) => ({
                            v:
                              typeof p === "number"
                                ? p
                                : p.model_probability ?? 0,
                          })) || []
                        }
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <span className="rounded bg-white p-2">
                        {t("edge", isEn)} <b className={edgeClass(selectedRow?.edge_percent)}>{pct(selectedRow?.edge_percent)}</b>
                      </span>
                      <span className="rounded bg-white p-2">
                        {t("spread", isEn)} <b>{pct(selectedRow?.spread)}</b>
                      </span>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title={t("probabilityDistribution", isEn)}>
                <div className="h-48 p-2">
                  <ProbabilityDistributionChart
                    isEn={isEn}
                    points={
                      selectedRow?.distribution_preview ??
                      selectedRow?.distribution_full
                    }
                  />
                </div>
              </Panel>

              <Panel title={t("marketList", isEn)}>
                <MarketTable
                  rows={rows.slice(0, 24)}
                  selectedId={selectedRow?.id}
                  onSelect={setSelectedRow}
                  isEn={isEn}
                />
              </Panel>
            </div>

            <div className="grid min-h-0 gap-2">
              <Panel title={t("watchlist", isEn)}>
                <div className="divide-y divide-slate-100">
                  {(watchRows.length ? watchRows : topRows.slice(0, 8)).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedRow(row)}
                      className="grid w-full grid-cols-[1fr_auto] gap-3 px-3 py-2 text-left hover:bg-blue-50"
                    >
                      <span>
                        <b className="block text-sm">{rowName(row)}</b>
                        <small className="text-slate-500">
                          {row.airport || row.trading_region_label || row.local_time || "--"}
                        </small>
                      </span>
                      <span className={clsx("font-mono text-sm font-black", edgeClass(row.signed_gap ?? row.gap))}>
                        {pct(row.signed_gap ?? row.gap)}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Global Weather Factors">
                <div className="grid grid-cols-3 gap-2 p-3 text-center">
                  {[
                    ["Heat", rows.filter((r) => r.risk_level === "high").length],
                    ["Active", rows.filter((r) => r.active).length],
                    ["Tradable", rows.filter((r) => r.tradable).length],
                    ["Primary", rows.filter((r) => r.is_primary_signal).length],
                    ["AI", rows.filter((r) => r.ai_decision).length],
                    ["Closed", rows.filter((r) => r.closed).length],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="font-mono text-lg font-black">{value}</div>
                      <div className="text-[11px] font-black uppercase text-slate-500">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Terminal Status">
                <div className="space-y-3 p-3 text-sm">
                  <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 p-3">
                    <span className="font-semibold">Data</span>
                    <span className="font-mono text-emerald-700">
                      {generatedText || "live"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 p-3">
                    <span className="font-semibold">Access</span>
                    <span className="font-mono text-blue-700">paid</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 p-3">
                    <span className="font-semibold">Layout</span>
                    <span className="font-mono">Koyfin-style grid</span>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Layer 2: Authenticated but no active subscription ───────────────────────
// Shown inside the terminal shell after middleware has confirmed the user is
// logged in (Layer 1). Presents a targeted upgrade prompt.
function SubscriptionGate({ isEn }: { isEn: boolean }) {
  const features = isEn
    ? [
        "Real-time METAR observations across 500+ stations",
        "DEB forecast blends with 0–240h horizon",
        "AI decision cards with Poly-score ranking",
        "Historical backtesting & weather market signals",
      ]
    : [
        "500+ 气象站实时 METAR 实况",
        "DEB 智能融合预测（0–240 小时）",
        "AI 决策卡片 + Poly-score 排名",
        "历史回测与天气市场交易信号",
      ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#e9edf3] p-6">
      <div className="w-full max-w-lg">
        {/* Header badge */}
        <div className="mb-6 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700">
            <LockKeyhole size={12} />
            {t("proAccessRequired", isEn)}
          </span>
        </div>

        {/* Main card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          {/* Card top band */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white">
            <h1 className="text-xl font-black tracking-tight">
              {isEn
                ? "Unlock the Weather Terminal"
                : "解锁天气交易决策台"}
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              {isEn
                ? "Your account is verified. One step away from full access."
                : "账号已验证，只差一步即可获得完整访问权限。"}
            </p>
          </div>

          <div className="p-8">
            {/* Price */}
            <div className="mb-6 flex items-baseline gap-1">
              <span className="text-4xl font-black text-slate-900">$10</span>
              <span className="text-base text-slate-500">
                {t("month", isEn)}
              </span>
            </div>

            {/* Feature list */}
            <ul className="mb-8 space-y-3">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Link
              href="/account"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
            >
              <CreditCard size={16} />
              {t("subscribeNow", isEn)}
            </Link>

            <p className="mt-4 text-center text-[11px] text-slate-400">
              {isEn
                ? "Cancel anytime · No hidden fees · Instant access after payment"
                : "随时取消 · 无隐藏费用 · 付款后立即解锁"}
            </p>
          </div>
        </div>

        {/* Back link */}
        <div className="mt-5 text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← {t("backToProduct", isEn)}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Layer 1 fallback: Should not normally appear (middleware handles it) ─────
// Shown only when middleware is not configured (no Supabase env).
function UnauthenticatedGate({
  isEn,
  userLocalTime,
}: {
  isEn: boolean;
  userLocalTime: string;
}) {
  return (
    <div className="flex h-screen w-full bg-[#e9edf3] text-slate-950">
      <aside className="w-[52px] bg-[#171d24]" />
      <main className="flex flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between bg-[#171d24] px-4 text-white">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
            <span className="text-sm font-semibold tracking-tight text-white/90">Terminal</span>
          </Link>
          <div className="font-mono text-sm text-slate-300">{userLocalTime}</div>
        </header>
        <section className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-600">
              <LogIn size={24} />
            </div>
            <h1 className="text-xl font-black text-slate-900">
              {t("signInToContinue", isEn)}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {isEn
                ? "The weather terminal is for verified subscribers only."
                : "天气决策台仅对已验证的付费用户开放。"}
            </p>
            <Link
              href="/auth/login?next=%2Fterminal"
              className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white transition hover:bg-slate-700"
            >
              <LogIn size={15} />
              {isEn ? "Log in" : "登录"}
            </Link>
            <Link
              href="/auth/login?next=%2Fterminal&mode=signup"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              {isEn ? "Create an account" : "注册账号"}
            </Link>
            <Link
              href="/"
              className="mt-4 block text-xs text-slate-400 hover:text-slate-700 transition-colors"
            >
              {isEn ? "← Learn about PolyWeather" : "← 了解 PolyWeather"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Unified access gate — routes to the correct layer based on auth state */
function ProductAccessRequired({
  isAuthenticated,
  isEn,
  userLocalTime,
}: {
  isAuthenticated: boolean;
  isEn: boolean;
  userLocalTime: string;
}) {
  // Layer 1 fallback (middleware should catch this first in production)
  if (!isAuthenticated) {
    return <UnauthenticatedGate isEn={isEn} userLocalTime={userLocalTime} />;
  }
  // Layer 2: logged in, no subscription
  return (
    <div className="flex h-screen w-full bg-[#e9edf3] text-slate-950">
      <aside className="w-[52px] bg-[#171d24]" />
      <main className="flex flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between bg-[#171d24] px-4 text-white">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
            <span className="text-sm font-semibold tracking-tight text-white/90">Terminal</span>
          </Link>
          <div className="font-mono text-sm text-slate-300">{userLocalTime}</div>
        </header>
        <SubscriptionGate isEn={isEn} />
      </main>
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
  useScanTerminalTheme();

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) || rows[0] || null,
    [rows, selectedId],
  );
  const generatedText = useRelativeTime(terminalData?.generated_at ?? null);

  if (!hydrated || (proAccess.loading && !canUseLocalFullAccess)) {
    return (
      <div className="grid h-screen w-full place-items-center bg-[#e9edf3]">
        <div className="rounded border border-slate-300 bg-white px-5 py-4 text-sm font-bold text-slate-600 shadow-sm">
          Loading paid terminal...
        </div>
      </div>
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
    <KoyfinWeatherTerminal
      generatedText={generatedText || ""}
      isEn={isEn}
      locale={locale}
      onRefresh={refreshScanTerminalManually}
      refreshing={scanLoading}
      rows={rows}
      selectedRow={selectedRow}
      setSelectedRow={(row) => setSelectedId(row.id)}
      toggleLocale={toggleLocale}
      userLocalTime={userLocalTime}
    />
  );
}

export function ScanTerminalDashboard() {
  return <ScanTerminalScreen />;
}
