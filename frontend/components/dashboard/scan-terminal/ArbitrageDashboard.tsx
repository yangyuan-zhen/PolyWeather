"use client";

import clsx from "clsx";
import { CircleAlert, RefreshCw, Scale, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ArbitrageBucket,
  ArbitrageCity,
  ArbitrageWindow,
} from "@/lib/arbitrage-types";
import { arbitrageClient } from "@/lib/arbitrage-client";
import { useArbitrageQuery } from "@/components/dashboard/scan-terminal/use-arbitrage-query";

type ArbitrageDashboardProps = {
  isEn: boolean;
};

// 静态回退城市列表（value 为传给后端的 display name）；
// 后端 /api/arbitrage/cities 加载成功后被动态列表替换，失败时保持此列表。
const FALLBACK_ARBITRAGE_CITIES = [
  { value: "Shanghai", labelEn: "Shanghai", labelZh: "上海" },
  { value: "Tokyo", labelEn: "Tokyo", labelZh: "东京" },
  { value: "Seoul", labelEn: "Seoul", labelZh: "首尔" },
  { value: "London", labelEn: "London", labelZh: "伦敦" },
  { value: "Paris", labelEn: "Paris", labelZh: "巴黎" },
  { value: "New York", labelEn: "New York", labelZh: "纽约" },
  { value: "Miami", labelEn: "Miami", labelZh: "迈阿密" },
  { value: "Chicago", labelEn: "Chicago", labelZh: "芝加哥" },
] as const;

// 静态城市 display_name → 双语 label；动态新增城市无中文名，回退显示 display_name。
const STATIC_CITY_LABELS: ReadonlyMap<string, { en: string; zh: string }> = new Map(
  FALLBACK_ARBITRAGE_CITIES.map(
    (item) => [item.value, { en: item.labelEn, zh: item.labelZh }] as const,
  ),
);

const WINDOW_SIZES = [2, 3, 4, 5] as const;
const DEFAULT_WINDOW_SIZE = 3;

const ARBITRAGE_TEXT = {
  title: { en: "Arbitrage Compare", zh: "套利对比" },
  subtitle: {
    en: "DEB bucket probabilities vs Polymarket Yes prices.",
    zh: "DEB 温度档位概率 vs Polymarket 市场 Yes 价格。",
  },
  city: { en: "City", zh: "城市" },
  refresh: { en: "Refresh", zh: "刷新" },
  refreshing: { en: "Refreshing…", zh: "刷新中…" },
  windowSize: { en: "Window", zh: "窗口" },
  scanAll: { en: "Scan all windows", zh: "扫描全部连续窗口" },
  hideScan: { en: "Hide scan", zh: "收起扫描" },
  marketTotal: { en: "Market ΣYes", zh: "市场 Yes 总和" },
  strictArb: {
    en: "Market ΣYes < 100¢: strict arbitrage space exists (buy every Yes).",
    zh: "全市场 Yes 总和 <100¢，存在严格套利空间（全档买入 Yes）。",
  },
  suggestionTitle: { en: "Suggested", zh: "建议" },
  debSum: { en: "DEB ΣP", zh: "DEB ΣP" },
  marketSum: { en: "Market ΣYes", zh: "市场 ΣYes" },
  edge: { en: "Edge", zh: "差值" },
  windowCol: { en: "Window", zh: "窗口" },
  sizeCol: { en: "Size", zh: "档数" },
  noMarketTitle: { en: "No market data", zh: "暂无市场数据" },
  noMarketBody: {
    en: "This city has no active temperature market right now. Try another city.",
    zh: "该城市暂无市场数据，请切换其他城市。",
  },
  loading: { en: "Loading arbitrage overview…", zh: "正在加载套利对比数据…" },
  retry: { en: "Retry", zh: "重试" },
  generated: { en: "Generated", zh: "生成" },
  emptyScan: { en: "No contiguous windows available.", zh: "暂无可计算的连续窗口。" },
} as const;

function copy(key: keyof typeof ARBITRAGE_TEXT, isEn: boolean) {
  return ARBITRAGE_TEXT[key][isEn ? "en" : "zh"];
}

function formatProb(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${(n * 100).toFixed(1)}%`;
}

function formatCents(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}¢`;
}

function formatEdge(edge: number) {
  if (!Number.isFinite(edge)) return "--";
  const points = edge * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}`;
}

function edgeToneClass(edge: number) {
  if (!Number.isFinite(edge) || Math.abs(edge) < 0.0005) return "text-slate-500";
  return edge > 0 ? "text-emerald-600" : "text-rose-600";
}

function formatGeneratedAt(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// 纯前端滑窗计算：buckets 已是温度升序，连续 size 档求和。
function computeContiguousWindows(
  buckets: ArbitrageBucket[],
  size: number,
): ArbitrageWindow[] {
  if (size <= 0 || buckets.length < size) return [];
  const windows: ArbitrageWindow[] = [];
  for (let startIndex = 0; startIndex + size <= buckets.length; startIndex += 1) {
    const slice = buckets.slice(startIndex, startIndex + size);
    const debSum = slice.reduce(
      (total, bucket) => total + (Number(bucket.deb_probability) || 0),
      0,
    );
    const marketSum = slice.reduce(
      (total, bucket) => total + (Number(bucket.market_yes_cents) || 0),
      0,
    );
    windows.push({
      startIndex,
      endIndex: startIndex + size - 1,
      labels: slice.map((bucket) => bucket.label),
      debSum,
      marketSum,
      edge: debSum - marketSum / 100,
      isTop3: false,
    });
  }
  return windows;
}

function pickMaxWindow(
  windows: ArbitrageWindow[],
  key: "debSum" | "edge",
): ArbitrageWindow | null {
  let best: ArbitrageWindow | null = null;
  for (const windowItem of windows) {
    if (!best || windowItem[key] > best[key]) best = windowItem;
  }
  return best;
}

function windowRangeLabel(windowItem: ArbitrageWindow) {
  const first = windowItem.labels[0] || "";
  const last = windowItem.labels[windowItem.labels.length - 1] || "";
  return windowItem.labels.length > 1 ? `${first} – ${last}` : first;
}

function WindowSummaryStat({
  label,
  value,
  toneClass,
}: {
  label: string;
  value: string;
  toneClass: string;
}) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col gap-0.5 rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className={clsx("font-mono text-base font-black tabular-nums", toneClass)}>
        {value}
      </span>
    </div>
  );
}

export function ArbitrageDashboard({ isEn }: ArbitrageDashboardProps) {
  const [city, setCity] = useState<string>(FALLBACK_ARBITRAGE_CITIES[0].value);
  // 可选城市：初始为静态 8 城，挂载后尝试从后端加载动态列表，失败静默保留静态。
  const [availableCities, setAvailableCities] = useState<ArbitrageCity[]>(() =>
    FALLBACK_ARBITRAGE_CITIES.map((item) => ({
      key: item.value,
      display_name: item.value,
    })),
  );
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [windowSize, setWindowSize] = useState<number>(DEFAULT_WINDOW_SIZE);
  const [scanVisible, setScanVisible] = useState(false);
  const { data, error, loading, refreshManually } = useArbitrageQuery({ city });

  // 挂载时加载一次动态城市列表；空列表或失败都保持静态回退。
  useEffect(() => {
    const controller = new AbortController();
    arbitrageClient
      .fetchCities({ signal: controller.signal })
      .then((payload) => {
        if (Array.isArray(payload.cities) && payload.cities.length > 0) {
          setAvailableCities(payload.cities);
        }
      })
      .catch(() => {
        // 静默回退：availableCities 已是静态 8 城。
      })
      .finally(() => setCitiesLoading(false));
    return () => controller.abort();
  }, []);

  // 动态列表不含当前选中城市时（如该城市已无市场），自动切到列表第一项。
  useEffect(() => {
    if (availableCities.length === 0) return;
    setCity((current) =>
      availableCities.some((item) => item.display_name === current)
        ? current
        : availableCities[0].display_name,
    );
  }, [availableCities]);

  const buckets = useMemo(
    () => (Array.isArray(data?.buckets) ? data.buckets : []),
    [data],
  );
  const marketAvailable = Boolean(data?.market_available) && buckets.length > 0;

  // 当前窗口大小下 debSum 最大的相邻窗口（默认高亮视图）。
  const activeWindow = useMemo(() => {
    const best = pickMaxWindow(computeContiguousWindows(buckets, windowSize), "debSum");
    return best ? { ...best, isTop3: true } : null;
  }, [buckets, windowSize]);

  // 当前窗口大小下 edge 最大的窗口（建议动作提示）。
  const suggestionWindow = useMemo(
    () => pickMaxWindow(computeContiguousWindows(buckets, windowSize), "edge"),
    [buckets, windowSize],
  );

  // 全部连续窗口（size 2-5），按 edge 降序。
  const scanWindows = useMemo(() => {
    if (!scanVisible) return [] as ArbitrageWindow[];
    const all: ArbitrageWindow[] = [];
    for (const size of WINDOW_SIZES) {
      all.push(...computeContiguousWindows(buckets, size));
    }
    all.sort((a, b) => b.edge - a.edge);
    return all.map((windowItem, index) => ({
      ...windowItem,
      isTop3: index === 0,
    }));
  }, [buckets, scanVisible]);

  const totalMarketYesSum =
    data?.total_market_yes_sum != null && Number.isFinite(Number(data.total_market_yes_sum))
      ? Number(data.total_market_yes_sum)
      : null;
  const strictArbitrage = totalMarketYesSum != null && totalMarketYesSum < 100;
  const generatedText = formatGeneratedAt(data?.generated_at);

  const renderBody = () => {
    if (!data && loading) {
      return (
        <div className="flex h-40 items-center justify-center text-xs font-bold text-slate-400">
          {copy("loading", isEn)}
        </div>
      );
    }
    if (!data && error) {
      return (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs font-bold text-rose-600">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button
            type="button"
            onClick={refreshManually}
            className="mt-1 inline-flex h-7 items-center rounded border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            {copy("retry", isEn)}
          </button>
        </div>
      );
    }
    if (!marketAvailable) {
      return (
        <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-slate-400">
          <Scale size={16} />
          <span className="text-xs font-black">{copy("noMarketTitle", isEn)}</span>
          <span className="text-[11px] font-semibold">
            {data?.error || copy("noMarketBody", isEn)}
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 p-3">
        {/* 工具行：窗口大小 + 扫描 + 市场 Yes 总和 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
            {copy("windowSize", isEn)}
          </span>
          <div className="inline-flex overflow-hidden rounded border border-slate-300">
            {WINDOW_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={windowSize === size}
                onClick={() => setWindowSize(size)}
                className={clsx(
                  "h-7 w-8 border-r border-slate-200 font-mono text-[11px] font-bold tabular-nums last:border-r-0",
                  windowSize === size
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {size}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={scanVisible}
            onClick={() => setScanVisible((current) => !current)}
            className={clsx(
              "inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[11px] font-bold transition-colors",
              scanVisible
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <ScanSearch size={13} />
            {scanVisible ? copy("hideScan", isEn) : copy("scanAll", isEn)}
          </button>
          {totalMarketYesSum != null ? (
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] font-bold tabular-nums",
                strictArbitrage
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              {copy("marketTotal", isEn)} {totalMarketYesSum.toFixed(1)}¢
            </span>
          ) : null}
        </div>

        {/* 严格套利提示 */}
        {strictArbitrage ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">
            {copy("strictArb", isEn)}
          </div>
        ) : null}

        {/* 建议动作提示：当前窗口大小下 edge 最大且为正 */}
        {suggestionWindow && suggestionWindow.edge > 0 ? (
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800">
            <span className="font-black">{copy("suggestionTitle", isEn)}: </span>
            {isEn
              ? `Window ${windowRangeLabel(suggestionWindow)} — DEB ${formatProb(suggestionWindow.debSum)} vs market ${formatCents(suggestionWindow.marketSum)} (edge ${formatEdge(suggestionWindow.edge)}), worth a look.`
              : `窗口 ${windowRangeLabel(suggestionWindow)}：DEB ${formatProb(suggestionWindow.debSum)}，市场仅 ${formatCents(suggestionWindow.marketSum)}（差值 ${formatEdge(suggestionWindow.edge)}），可关注。`}
          </div>
        ) : null}

        {/* 默认视图：当前窗口大小下 debSum 最大的相邻档位 */}
        {activeWindow ? (
          <div className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {buckets
                .slice(activeWindow.startIndex, activeWindow.endIndex + 1)
                .map((bucket) => (
                  <span
                    key={`${bucket.label}-${bucket.value}`}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] font-bold tabular-nums text-slate-600"
                    title={bucket.market_url || bucket.label}
                  >
                    <span className="text-slate-800">{bucket.label}</span>
                    <span className="text-violet-700">
                      {formatProb(bucket.deb_probability)}
                    </span>
                    <span className="text-blue-700">
                      {formatCents(bucket.market_yes_cents)}
                    </span>
                  </span>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <WindowSummaryStat
                label={copy("debSum", isEn)}
                value={formatProb(activeWindow.debSum)}
                toneClass="text-violet-700"
              />
              <WindowSummaryStat
                label={copy("marketSum", isEn)}
                value={formatCents(activeWindow.marketSum)}
                toneClass="text-blue-700"
              />
              <WindowSummaryStat
                label={copy("edge", isEn)}
                value={formatEdge(activeWindow.edge)}
                toneClass={edgeToneClass(activeWindow.edge)}
              />
            </div>
          </div>
        ) : null}

        {/* 全连续窗口扫描结果 */}
        {scanVisible ? (
          <div className="overflow-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
                <tr>
                  <th className="px-3 py-2 text-left">{copy("windowCol", isEn)}</th>
                  <th className="min-w-[56px] px-3 py-2 text-right">
                    {copy("sizeCol", isEn)}
                  </th>
                  <th className="min-w-[88px] px-3 py-2 text-right text-violet-700">
                    {copy("debSum", isEn)}
                  </th>
                  <th className="min-w-[88px] px-3 py-2 text-right text-blue-700">
                    {copy("marketSum", isEn)}
                  </th>
                  <th className="min-w-[80px] px-3 py-2 text-right">
                    {copy("edge", isEn)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {scanWindows.map((windowItem) => (
                  <tr
                    key={`${windowItem.labels.length}-${windowItem.startIndex}`}
                    className={clsx(
                      "hover:bg-blue-50/40",
                      windowItem.edge > 0 && "bg-emerald-50/40",
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className={clsx(
                          "font-mono text-[11px] font-bold tabular-nums",
                          windowItem.isTop3 ? "text-emerald-700" : "text-slate-700",
                        )}
                      >
                        {windowRangeLabel(windowItem)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums text-slate-600">
                      {windowItem.labels.length}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums text-violet-700">
                      {formatProb(windowItem.debSum)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums text-blue-700">
                      {formatCents(windowItem.marketSum)}
                    </td>
                    <td
                      className={clsx(
                        "px-3 py-1.5 text-right font-mono text-[11px] font-black tabular-nums",
                        edgeToneClass(windowItem.edge),
                      )}
                    >
                      {formatEdge(windowItem.edge)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!scanWindows.length ? (
              <div className="flex h-24 items-center justify-center border-t border-slate-100 text-xs font-bold text-slate-400">
                {copy("emptyScan", isEn)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#d2d9e2] bg-white shadow-sm">
      <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Scale size={16} className="text-blue-600" />
            <h2 className="truncate text-sm font-black text-slate-900">
              {copy("title", isEn)}
            </h2>
            {loading && data ? (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                {copy("refreshing", isEn)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {copy("subtitle", isEn)}
            {generatedText ? (
              <span className="ml-2 font-mono text-[11px] text-slate-400">
                {copy("generated", isEn)} {generatedText}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
            <span>{copy("city", isEn)}</span>
            <select
              value={city}
              onChange={(event) => setCity(event.target.value)}
              aria-busy={citiesLoading}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              {availableCities.map((item) => {
                const staticLabel = STATIC_CITY_LABELS.get(item.display_name);
                return (
                  <option key={item.key} value={item.display_name}>
                    {staticLabel
                      ? isEn
                        ? staticLabel.en
                        : staticLabel.zh
                      : item.display_name}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="button"
            onClick={refreshManually}
            disabled={loading}
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-600 transition-colors",
              loading ? "opacity-60" : "hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <RefreshCw size={13} className={clsx(loading && "animate-spin")} />
            {copy("refresh", isEn)}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">{renderBody()}</div>
    </section>
  );
}
