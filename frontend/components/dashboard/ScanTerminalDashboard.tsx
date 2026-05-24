"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronLeft,
  Gauge,
  LineChart,
  Menu,
  Search,
  Table2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  terminalStatus: { en: "Terminal Status", zh: "终端状态" },
  tsData: { en: "Data", zh: "数据" },
  tsAccess: { en: "Access", zh: "访问权限" },
  tsLayout: { en: "Layout", zh: "布局" },
  tsLayoutValue: { en: "Multi-panel grid", zh: "多面板网格" },
  tsDataLive: { en: "live", zh: "实时" },
  tsAccessPaid: { en: "paid", zh: "付费" },
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
  const l = label.toLowerCase();
  if (l.includes("approve") || l.includes("active") || l.includes("活跃")) {
    return "bg-emerald-50 border-emerald-200 text-emerald-700";
  }
  if (l.includes("watch") || l.includes("观察") || l.includes("monitor")) {
    return "bg-amber-50 border-amber-200 text-amber-700";
  }
  if (l.includes("veto") || l.includes("downgrade") || l.includes("closed") || l.includes("关闭")) {
    return "bg-slate-50 border-slate-200 text-slate-500";
  }
  return "bg-blue-50 border-blue-200 text-blue-700";
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

function tablePrice(row: ScanOpportunityRow) {
  return formatPrice(row.midpoint, row.ask, row.bid);
}

function ticker(row: ScanOpportunityRow) {
  return String(row.airport || row.market_key || row.city || "--")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
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
          {!compact && (
            <th className="px-1.5 py-1 text-left font-black">
              {isEn ? "Ticker" : "代码"}
            </th>
          )}
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
              {!compact && (
                <td className="px-1.5 py-1 font-mono font-bold text-slate-600">
                  {ticker(row)}
                </td>
              )}
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

function WeatherNewsPanel({
  isEn,
  rows,
}: {
  isEn: boolean;
  rows: ScanOpportunityRow[];
}) {
  const items = rows.slice(0, 3).map((row) => ({
    title:
      (isEn ? row.ai_city_thesis_en || row.ai_reason_en : row.ai_city_thesis_zh || row.ai_reason_zh) ||
      row.market_question ||
      `${rowName(row)} ${isEn ? "weather contract update" : "天气合约更新"}`,
    source: row.airport || "PolyWeather",
    time: row.local_time || row.selected_date || "--",
  }));
  return (
    <Panel title={isEn ? "Weather Market News" : "天气市场新闻"}>
      <div className="divide-y divide-slate-100 text-[11px]">
        {items.map((item, index) => (
          <div
            key={`${item.source}-${index}`}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-1.5 hover:bg-slate-50"
          >
            <div className="truncate font-semibold text-slate-700">
              {item.title}
            </div>
            <div className="font-medium text-slate-400">{item.source}</div>
            <div className="font-mono text-slate-400">{item.time}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function performanceSeries(row: ScanOpportunityRow | null) {
  return buildEvidenceChart(row).data;
}

type ObsPoint = { time?: string | null; temp?: number | null };

type EvidenceSeries = {
  key: string;
  label: string;
  source: string;
  color: string;
  dashed?: boolean;
  featured?: boolean;
  values: Array<number | null>;
};

type RunwayObsPayload = {
  runway_pairs?: Array<[string, string] | string[] | null> | null;
  temperatures?: Array<[number | null, number | null] | Array<number | null> | null> | null;
  point_temperatures?: Array<{
    runway?: string | null;
    tdz_temp?: number | null;
    mid_temp?: number | null;
    end_temp?: number | null;
  } | null> | null;
};

function validNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeObs(points?: ObsPoint[] | null, limit = 88) {
  return (points || [])
    .filter((point) => validNumber(point.temp) !== null)
    .slice(-limit)
    .map((point, index) => ({
      label: point.time || String(index + 1),
      value: Number(point.temp),
    }));
}

function formatChartLabel(value: string) {
  if (!value) return "";
  const maybeDate = new Date(value);
  if (!Number.isNaN(maybeDate.getTime())) {
    return maybeDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return value.length > 8 ? value.slice(-8) : value;
}

function seriesStats(values: Array<number | null>) {
  const nums = values.filter((value): value is number => validNumber(value) !== null);
  const latest = nums.length ? nums[nums.length - 1] : null;
  const high = nums.length ? Math.max(...nums) : null;
  const first15 = nums.length > 1 ? nums[Math.max(0, nums.length - 15)] : null;
  const delta15 = latest !== null && first15 !== null ? latest - first15 : null;
  return { latest, high, delta15 };
}

function buildModelPoints(row: ScanOpportunityRow | null, length: number) {
  const modelEntries = Object.entries(row?.model_cluster_sources || {})
    .map(([label, value]) => [label, validNumber(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)
    .slice(0, 4);
  const constants: EvidenceSeries[] = modelEntries.map(([label, value], index) => ({
    key: `model_${index}`,
    label,
    source: "Multi-model",
    color: ["#2563eb", "#14b8a6", "#7c3aed", "#64748b"][index] || "#64748b",
    dashed: true,
    values: Array.from({ length }, () => value),
  }));
  const deb = validNumber(row?.deb_prediction);
  if (deb !== null) {
    constants.unshift({
      key: "deb",
      label: "DEB",
      source: "DEB",
      color: "#f97316",
      dashed: true,
      values: Array.from({ length }, () => deb),
    });
  }
  return constants;
}

function extractRunwayPointSeries(row: ScanOpportunityRow | null, length: number): EvidenceSeries[] {
  const payload = row as
    | (ScanOpportunityRow & {
        amos?: { runway_obs?: RunwayObsPayload | null; source_label?: string | null; source?: string | null } | null;
        runway_obs?: RunwayObsPayload | null;
      })
    | null;
  const runwayObs = payload?.amos?.runway_obs || payload?.runway_obs;
  if (!runwayObs) return [];
  const pairs = runwayObs.runway_pairs || [];
  const runwayTemps = runwayObs.temperatures || [];
  const pointTemps = runwayObs.point_temperatures || [];
  const source = payload?.amos?.source_label || payload?.amos?.source || "Runway";
  const series: EvidenceSeries[] = [];
  pairs.forEach((pair, index) => {
      const pairLabel = Array.isArray(pair) && pair.length
        ? pair.filter(Boolean).join("/")
        : pointTemps[index]?.runway || `RWY ${index + 1}`;
      const values = [
        ...(Array.isArray(runwayTemps[index]) ? runwayTemps[index] || [] : []),
        pointTemps[index]?.tdz_temp,
        pointTemps[index]?.mid_temp,
        pointTemps[index]?.end_temp,
      ]
        .map(validNumber)
        .filter((value): value is number => value !== null);
      if (!values.length) return;
      const maxTemp = Math.max(...values);
      series.push({
        key: `runway_${index}`,
        label: `${pairLabel} runway`,
        source,
        color: ["#009688", "#f97316", "#0ea5e9", "#ef4444"][index] || "#64748b",
        featured: index === 0,
        dashed: index !== 0,
        values: Array.from({ length }, () => maxTemp),
      });
    });
  return series.slice(0, 4);
}

function buildEvidenceChart(row: ScanOpportunityRow | null) {
  const settlement = normalizeObs(row?.settlement_today_obs || row?.metar_context?.settlement_today_obs);
  const metar = normalizeObs(row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs);
  const baseLabels = settlement.length >= metar.length ? settlement.map((point) => point.label) : metar.map((point) => point.label);
  const length = Math.max(baseLabels.length, settlement.length, metar.length, 24);
  const labels = length === baseLabels.length
    ? baseLabels
    : Array.from({ length }, (_, index) => baseLabels[index] || `${String(index).padStart(2, "0")}:00`);

  const align = (points: Array<{ label: string; value: number }>) => {
    if (!points.length) return Array.from({ length }, () => null);
    const offset = Math.max(0, length - points.length);
    return Array.from({ length }, (_, index) => (index < offset ? null : points[index - offset]?.value ?? null));
  };

  const series: EvidenceSeries[] = [];
  series.push(...extractRunwayPointSeries(row, length));
  if (settlement.length) {
    series.push({
      key: "settlement",
      label: "Settlement runway",
      source: row?.metar_context?.station_label || row?.metar_context?.station || row?.airport || "Settlement",
      color: "#009688",
      featured: true,
      values: align(settlement),
    });
  }
  if (metar.length) {
    series.push({
      key: "metar",
      label: "METAR official",
      source: row?.airport || row?.metar_context?.source || "METAR",
      color: "#0ea5e9",
      dashed: true,
      values: align(metar),
    });
  }
  series.push(...buildModelPoints(row, length));

  const fallbackValue =
    validNumber(row?.current_temp) ??
    validNumber(row?.current_max_so_far) ??
    validNumber(row?.deb_prediction) ??
    validNumber(row?.target_value) ??
    validNumber(row?.target_threshold);
  if (!series.length && fallbackValue !== null) {
    series.push({
      key: "current",
      label: "Current reference",
      source: row?.metar_context?.source || "Live",
      color: "#009688",
      featured: true,
      values: Array.from({ length }, () => fallbackValue),
    });
  }

  const data = labels.map((label, index) => {
    const point: Record<string, string | number | null> = { label: formatChartLabel(label) };
    series.forEach((item) => {
      point[item.key] = item.values[index] ?? null;
    });
    return point;
  });
  return { data, series };
}

function NormalizedPerformancePanel({
  isEn,
  row,
  rows = [],
  onSelect,
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
  rows?: ScanOpportunityRow[];
  onSelect?: (row: ScanOpportunityRow) => void;
}) {
  const { data, series } = useMemo(() => buildEvidenceChart(row), [row]);
  const threshold = validNumber(row?.target_threshold) ?? validNumber(row?.target_value);
  const tableRows = series.slice(0, 5).map((item) => ({ ...item, ...seriesStats(item.values) }));
  return (
    <Panel
      title={isEn ? "Live Temperature Trend & Option Threshold Lines" : "实时气温走势与期权阈值线"}
      actions={
        <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500 hover:bg-slate-50">
          {isEn ? "Export" : "导出"}
        </button>
      }
    >
      <div className="flex h-full min-h-[420px] flex-col">
        <div className="flex shrink-0 overflow-x-auto border-b border-slate-200 bg-[#f5f7f9] text-[10px] font-black text-slate-600 scrollbar-none">
          {rows.slice(0, 18).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item)}
              className={clsx(
                "min-w-[76px] border-r border-slate-200 px-3 py-2 text-center hover:bg-white",
                item.id === row?.id ? "bg-white text-blue-600 shadow-[inset_0_2px_0_#2563eb]" : "text-slate-600",
              )}
            >
              <span className="block truncate">{rowName(item)}</span>
            </button>
          ))}
        </div>
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
          <div className="mb-2 flex items-end justify-between gap-3 text-[10px]">
            <div className="space-y-0.5">
              <div className="font-mono font-black text-teal-700">
                {isEn ? "Settlement live" : "跑道实测"} {temp(validNumber(row?.current_temp))}
              </div>
              <div className="font-mono font-black text-blue-600">
                METAR {temp(validNumber(row?.metar_context?.airport_current_temp ?? row?.metar_context?.last_temp))}
              </div>
            </div>
            <div className="text-right font-mono font-black text-slate-800">
              {isEn ? "Threshold" : "当日阈值"} {temp(threshold)}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-[10px]">
            {tableRows.map((item) => (
              <div key={item.key} className={clsx("rounded border px-2 py-1.5", item.featured ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50")}>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-black text-slate-700">{item.label}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[9px] text-slate-600">
                  <span>now: {temp(item.latest)}</span>
                  <span>max: {temp(item.high)}</span>
                  <span>15m: {item.delta15 === null ? "--" : `${item.delta15 >= 0 ? "+" : ""}${item.delta15.toFixed(1)}°`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 flex-1 p-2">
          <div className="absolute left-3 top-3 z-10 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-800 shadow-sm">
            {rowName(row)} <span className="ml-1 text-teal-600">{row?.target_label || row?.market_direction || ""}</span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={data} margin={{ top: 16, right: 28, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#dbe6ef" strokeDasharray="2 2" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `${Number(v).toFixed(1)}°`} orientation="right" axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
              {threshold !== null && (
                <ReferenceLine
                  y={threshold}
                  stroke="#f97316"
                  strokeDasharray="4 3"
                  label={{ value: `UMA ${threshold.toFixed(1)}°`, fill: "#f97316", fontSize: 10, position: "right" }}
                />
              )}
              <Tooltip
                contentStyle={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  fontSize: 11,
                  boxShadow: "0 8px 24px rgba(15,23,42,.12)",
                }}
                formatter={(value: unknown) => `${Number(value).toFixed(2)}°`}
              />
              {series.map((item) => (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  stroke={item.color}
                  strokeWidth={item.featured ? 2.4 : 1.4}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  isAnimationActive={false}
                  name={item.label}
                  type="stepAfter"
                />
              ))}
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}

function FactorMatrix({
  isEn,
  rows,
}: {
  isEn: boolean;
  rows: ScanOpportunityRow[];
}) {
  const buckets = [
    [isEn ? "Heat" : "高温", rows.filter((r) => r.risk_level === "high")],
    [isEn ? "Live Edge" : "实况优势", rows.filter((r) => Number(r.edge_percent || 0) > 0)],
    [isEn ? "Tradable" : "可交易", rows.filter((r) => r.tradable)],
    [isEn ? "AI Approved" : "AI 通过", rows.filter((r) => String(r.ai_decision || "").includes("approve"))],
    [isEn ? "Watch" : "观察", rows.filter((r) => getSignalState(r) === "watch")],
    [isEn ? "Closed" : "关闭", rows.filter((r) => r.closed)],
  ];
  return (
    <Panel title={isEn ? "Weather Equity Factors" : "天气交易因子"}>
      <div className="grid h-full grid-cols-3 gap-2 p-3">
        {buckets.map(([label, list]) => {
          const count = Array.isArray(list) ? list.length : 0;
          const ratio = rows.length ? count / rows.length : 0;
          const tone =
            ratio >= 0.5 ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
            ratio >= 0.2 ? "bg-amber-100 text-amber-800 border-amber-200" :
            "bg-slate-100 text-slate-600 border-slate-200";
          return (
            <div key={String(label)} className={clsx("grid place-items-center rounded border p-2 text-center", tone)}>
              <div className="font-mono text-sm font-black">{(ratio * 100).toFixed(1)}%</div>
              <div className="mt-1 text-[10px] font-black uppercase">{String(label)}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function YieldLikeTable({
  isEn,
  rows,
}: {
  isEn: boolean;
  rows: ScanOpportunityRow[];
}) {
  const regionStats = TRADING_REGIONS.map((region) => {
    const regionRows = rows.filter((row) => String(row.trading_region).toLowerCase() === region.key);
    const avgEdge = regionRows.reduce((sum, row) => sum + Number(row.edge_percent || 0), 0) / Math.max(regionRows.length, 1);
    const avgProb = regionRows.reduce((sum, row) => sum + Number(row.model_probability ?? row.model_event_probability ?? 0), 0) / Math.max(regionRows.length, 1);
    return {
      label: isEn ? region.labelEn : region.labelZh,
      edge: avgEdge,
      prob: avgProb,
      liq: regionRows.reduce((sum, row) => sum + Number(row.book_liquidity || row.market_liquidity || 0), 0),
      count: regionRows.length,
    };
  }).filter((row) => row.count > 0).slice(0, 7);
  return (
    <Panel title={isEn ? "Regional Weather Yields" : "区域天气收益率"}>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#f3f5f7] text-[9px] uppercase text-slate-500">
            <th className="px-3 py-1 text-left font-black">{isEn ? "Region" : "区域"}</th>
            <th className="px-2 py-1 text-right font-black">1D</th>
            <th className="px-2 py-1 text-right font-black">5D</th>
            <th className="px-2 py-1 text-right font-black">10D</th>
            <th className="px-3 py-1 text-right font-black">{isEn ? "Liq" : "流动性"}</th>
          </tr>
        </thead>
        <tbody>
          {regionStats.map((row) => (
            <tr key={row.label} className="border-b border-slate-100">
              <td className="px-3 py-1.5 font-bold text-slate-800">{row.label}</td>
              <td className={clsx("px-2 py-1.5 text-right font-mono font-bold", edgeClass(row.edge))}>{pct(row.edge)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{pct(row.prob)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{pct(row.edge + row.prob * 0.2)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{money(row.liq)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [selectedRegionKey, setSelectedRegionKey] = useState<string>("all");

  const NAV_ITEMS = [
    { key: "contracts", Icon: Table2, labelEn: "Contracts", labelZh: "天气合约" },
    { key: "signals", Icon: LineChart, labelEn: "Signals", labelZh: "交易信号" },
    { key: "analytics", Icon: BarChart3, labelEn: "Analytics", labelZh: "分析图表" },
    { key: "watchlist", Icon: Gauge, labelEn: "Watchlist", labelZh: "自选监控" },
    { key: "alerts", Icon: Bell, labelEn: "Alerts", labelZh: "实时预警" },
    { key: "markets", Icon: Activity, labelEn: "Markets", labelZh: "市场概览" },
  ];

  const regionTabs = useMemo(() => {
    return [
      { key: "all", labelEn: "ALL", labelZh: "全部" },
      ...TRADING_REGIONS.map((r) => ({
        key: r.key,
        labelEn: r.labelEn.toUpperCase(),
        labelZh: r.labelZh,
      })),
    ];
  }, [isEn]);

  const filteredRegionRows = useMemo(() => {
    if (selectedRegionKey === "all") return rows;
    return rows.filter((row) => String(row.trading_region).toLowerCase() === selectedRegionKey);
  }, [rows, selectedRegionKey]);

  const watchRows = useMemo(() => {
    return filteredRegionRows
      .filter((row) => decisionLabel(row) === "Watch" || !row.tradable)
      .slice(0, 8);
  }, [filteredRegionRows]);
  const topRows = filteredRegionRows.slice(0, 18);
  const activeRows = filteredRegionRows
    .filter((row) => getSignalState(row) === "active" || row.tradable)
    .slice(0, 10);
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
  const firstRegionRows =
    continentGroups.find((group) => group.key !== "active_signals")?.rows.slice(0, 8) ||
    topRows.slice(0, 8);
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
        <header className="flex h-12 shrink-0 items-center justify-between bg-[#11161d] border-b border-[#242f3d] px-4 text-white">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-8 min-w-[320px] items-center gap-2 rounded border border-[#2d3846] bg-[#1e2630] px-2.5 text-slate-300">
              <Search size={14} className="text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder", isEn)}
                className="w-full bg-transparent text-xs font-semibold text-white placeholder-slate-500 outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
              <kbd className="ml-auto rounded border border-slate-600 bg-[#2a3543] px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                /
              </kbd>
            </div>
            <div className="hidden items-center gap-1.5 text-[10px] font-bold uppercase text-slate-500 lg:flex tracking-wider">
              <Activity size={13} />
              {t("dashboard", isEn)}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="hidden font-mono md:inline text-slate-500">{userLocalTime}</span>
            <Link
              href="/account"
              className="grid h-7 w-7 place-items-center rounded-full bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 hover:text-white transition-colors"
              title="User Account"
            >
              <UserRound size={13} />
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden flex flex-col p-2 bg-[#eef2f6]">
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
          <div className="hidden h-full min-h-0 lg:grid lg:grid-cols-[0.96fr_1.72fr_0.96fr] gap-2">
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-[4px] border border-[#cfd6df] bg-white p-1 scrollbar-none">
                {regionTabs.map((tab) => {
                  const isActive = selectedRegionKey === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setSelectedRegionKey(tab.key)}
                      className={clsx(
                        "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-[3px] transition-all whitespace-nowrap",
                        isActive
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      )}
                    >
                      {isEn ? tab.labelEn : tab.labelZh}
                    </button>
                  );
                })}
              </div>

              <KoyfinMarketPanel
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={topRows}
                selectedId={selectedRow?.id}
                title={isEn ? "Weather Contract Markets" : "天气合约市场"}
              />
              <KoyfinMarketPanel
                compact
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={activeRows.length ? activeRows : topRows.slice(0, 8)}
                selectedId={selectedRow?.id}
                title={isEn ? "Active Signal Markets" : "活跃信号市场"}
              />
              <KoyfinMarketPanel
                compact
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={firstRegionRows}
                selectedId={selectedRow?.id}
                title={isEn ? "Regional Weather Markets" : "区域天气市场"}
              />
            </div>

            <div className="grid min-h-0 grid-rows-[auto_1fr_0.38fr] gap-2">
              <WeatherNewsPanel isEn={isEn} rows={topRows} />
              <NormalizedPerformancePanel
                isEn={isEn}
                onSelect={setSelectedRow}
                row={selectedRow}
                rows={topRows}
              />
              <div className="grid min-h-0 grid-cols-[0.48fr_0.52fr] gap-2">
                <FactorMatrix isEn={isEn} rows={filteredRegionRows} />
                <YieldLikeTable isEn={isEn} rows={filteredRegionRows} />
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-2">
              <KoyfinMarketPanel
                compact
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={heatRows.length ? heatRows : topRows.slice(0, 8)}
                selectedId={selectedRow?.id}
                title={isEn ? "High Heat Markets" : "高温市场"}
              />
              <KoyfinMarketPanel
                compact
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={liquidRows}
                selectedId={selectedRow?.id}
                title={isEn ? "Liquid Weather Markets" : "高流动性市场"}
              />
              <KoyfinMarketPanel
                compact
                isEn={isEn}
                onSelect={setSelectedRow}
                rows={watchRows.length ? watchRows : negativeRows.length ? negativeRows : topRows.slice(0, 8)}
                selectedId={selectedRow?.id}
                title={isEn ? "Watchlist & Risk" : "观察与风险"}
              />
              <Panel title={t("terminalStatus", isEn)} className="shrink-0">
                <div className="grid grid-cols-3 gap-1.5 p-2 text-center text-[10px]">
                  {[
                    [t("rows", isEn), filteredRegionRows.length],
                    [t("avgEdge", isEn), pct(avgEdge)],
                    [t("liquidity", isEn), money(totalLiquidity)],
                    [t("tsData", isEn), generatedText || t("tsDataLive", isEn)],
                    [t("tsAccess", isEn), t("tsAccessPaid", isEn)],
                    [t("tsLayout", isEn), "Koyfin"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <div className="truncate text-[9px] font-black uppercase text-slate-400">
                        {label}
                      </div>
                      <div className="truncate font-mono font-black text-slate-800">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
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
