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
}: {
  color?: string;
  data: { v: number }[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        No data
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
}: {
  points?: ScanOpportunityRow["distribution_preview"];
}) {
  if (!points?.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        No distribution data
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
        <Bar dataKey="model" fill="#2563eb" radius={[2, 2, 0, 0]} name="Model" />
        <Bar dataKey="market" fill="#059669" radius={[2, 2, 0, 0]} name="Market" />
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
}: {
  onSelect: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  selectedId?: string | null;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#f5f7fa] text-left text-[11px] uppercase text-slate-500">
            <th className="px-3 py-2 font-black">City / Contract</th>
            <th className="px-2 py-2 text-right font-black">Live</th>
            <th className="px-2 py-2 text-right font-black">DEB</th>
            <th className="px-2 py-2 text-right font-black">Mkt</th>
            <th className="px-2 py-2 text-right font-black">Edge</th>
            <th className="px-2 py-2 text-right font-black">Liq</th>
            <th className="px-3 py-2 font-black">Signal</th>
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
  onRefresh,
  refreshing,
  rows,
  selectedRow,
  setSelectedRow,
  userLocalTime,
}: {
  generatedText: string;
  isEn: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  rows: ScanOpportunityRow[];
  selectedRow: ScanOpportunityRow | null;
  setSelectedRow: (row: ScanOpportunityRow) => void;
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
          className="mb-2 grid h-8 w-8 place-items-center rounded bg-blue-600 text-white transition hover:bg-blue-700"
          title="PolyWeather"
        >
          <CloudSun size={18} />
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
                Search city, contract, station, or signal
              </span>
              <kbd className="ml-auto rounded border border-slate-500 px-2 py-0.5 text-xs">
                /
              </kbd>
            </div>
            <div className="hidden items-center gap-2 text-xs font-bold uppercase text-slate-400 lg:flex">
              <Activity size={15} />
              {isEn ? "Weather Market Dashboard" : "天气市场数据仪表盘"}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="hidden font-mono md:inline">{userLocalTime}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex h-9 items-center gap-2 rounded border border-slate-600 bg-[#29323d] px-3 font-bold hover:bg-[#323c49] disabled:opacity-60"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
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
              <Panel title="Weather Contracts">
                <div className="grid grid-cols-3 border-b border-slate-200 text-center">
                  <div className="p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      Rows
                    </div>
                    <div className="font-mono text-xl font-black">{rows.length}</div>
                  </div>
                  <div className="border-x border-slate-200 p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      Avg Edge
                    </div>
                    <div className={clsx("font-mono text-xl font-black", edgeClass(avgEdge))}>
                      {pct(avgEdge)}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-[11px] font-black uppercase text-slate-500">
                      Liquidity
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
                />
              </Panel>

              <Panel title="Approved Signals">
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
              <Panel title="Selected Contract Monitor">
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
                        "Select a weather contract to inspect model edge, market price, and live evidence."}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                      {[
                        ["Live", temp(selectedRow?.current_max_so_far ?? selectedRow?.current_temp, selectedRow?.temp_symbol)],
                        ["DEB", temp(selectedRow?.deb_prediction, selectedRow?.temp_symbol)],
                        ["Model", pct(selectedRow?.model_probability ?? selectedRow?.model_event_probability)],
                        ["Market", pct(selectedRow?.market_probability ?? selectedRow?.market_event_probability)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded border border-slate-200 bg-slate-50 p-3">
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
                      Intraday Performance
                    </div>
                    <div className="h-20">
                      <SparkArea
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
                        Edge <b className={edgeClass(selectedRow?.edge_percent)}>{pct(selectedRow?.edge_percent)}</b>
                      </span>
                      <span className="rounded bg-white p-2">
                        Spread <b>{pct(selectedRow?.spread)}</b>
                      </span>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Probability Distribution">
                <div className="h-48 p-2">
                  <ProbabilityDistributionChart
                    points={
                      selectedRow?.distribution_preview ??
                      selectedRow?.distribution_full
                    }
                  />
                </div>
              </Panel>

              <Panel title="Market List">
                <MarketTable
                  rows={rows.slice(0, 24)}
                  selectedId={selectedRow?.id}
                  onSelect={setSelectedRow}
                />
              </Panel>
            </div>

            <div className="grid min-h-0 gap-2">
              <Panel title="Watchlist">
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

function ProductAccessRequired({
  isAuthenticated,
  isEn,
  userLocalTime,
}: {
  isAuthenticated: boolean;
  isEn: boolean;
  userLocalTime: string;
}) {
  return (
    <div className="flex h-screen w-full bg-[#e9edf3] text-slate-950">
      <aside className="w-[52px] bg-[#171d24]" />
      <main className="flex flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between bg-[#171d24] px-4 text-white">
          <Link href="/" className="flex items-center gap-3 font-black hover:opacity-90">
            <span className="grid h-8 w-8 place-items-center rounded bg-blue-600 text-white">
              <CloudSun size={18} />
            </span>
            <span>PolyWeather Terminal</span>
          </Link>
          <div className="font-mono text-sm text-slate-300">{userLocalTime}</div>
        </header>
        <section className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-xl rounded border border-slate-300 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded bg-blue-50 text-blue-700">
              <LockKeyhole size={28} />
            </div>
            <h1 className="text-2xl font-black">
              {isAuthenticated
                ? isEn
                  ? "Subscription required"
                  : "需要开通订阅"
                : isEn
                  ? "Sign in and subscribe to enter"
                  : "登录并付费后进入产品"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {isAuthenticated
                ? isEn
                  ? "Your account is signed in, but the Koyfin-style weather terminal is locked until payment is active."
                  : "你已登录，但 Koyfin 风格天气交易终端会在付款生效后解锁。"
                : isEn
                  ? "The landing page is public. The decision terminal is paid-only."
                  : "落地页公开展示；天气交易决策台仅向付费用户开放。"}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {isAuthenticated ? (
                <Link
                  href="/account"
                  className="inline-flex min-h-10 items-center gap-2 rounded border border-blue-700 bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
                >
                  <CreditCard size={16} />
                  {isEn ? "Subscribe in Account" : "去账户中心付费"}
                </Link>
              ) : (
                <Link
                  href="/auth/login?next=%2Fterminal"
                  className="inline-flex min-h-10 items-center gap-2 rounded border border-blue-700 bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
                >
                  <LogIn size={16} />
                  {isEn ? "Log in to continue" : "登录后继续"}
                </Link>
              )}
              <Link
                href="/"
                className="inline-flex min-h-10 items-center rounded border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                {isEn ? "Product overview" : "产品介绍"}
              </Link>
            </div>
          </div>
        </section>
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
      onRefresh={refreshScanTerminalManually}
      refreshing={scanLoading}
      rows={rows}
      selectedRow={selectedRow}
      setSelectedRow={(row) => setSelectedId(row.id)}
      userLocalTime={userLocalTime}
    />
  );
}

export function ScanTerminalDashboard() {
  return <ScanTerminalScreen />;
}
