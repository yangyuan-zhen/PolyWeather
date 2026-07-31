"use client";

import clsx from "clsx";
import { CircleAlert, RefreshCw, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ArbitrageBucket,
  ArbitrageCity,
  ArbitrageOverview,
  ArbitrageWindow,
} from "@/lib/arbitrage-types";
import { arbitrageClient } from "@/lib/arbitrage-client";
import { useMultiCityArbitrageQuery } from "@/components/dashboard/scan-terminal/use-multi-city-arbitrage";

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
  windowSize: { en: "Window", zh: "窗口" },
  refresh: { en: "Refresh", zh: "刷新" },
  refreshing: { en: "Refreshing…", zh: "刷新中…" },
  marketTotal: { en: "Market ΣYes", zh: "市场 Yes 总和" },
  strictArb: {
    en: "Market ΣYes < 100¢: strict arbitrage space exists (buy every Yes).",
    zh: "全市场 Yes 总和 <100¢，存在严格套利空间（全档买入 Yes）。",
  },
  suggestionTitle: { en: "Suggested", zh: "建议" },
  debSum: { en: "DEB ΣP", zh: "DEB ΣP" },
  marketSum: { en: "Market ΣYes", zh: "市场 ΣYes" },
  edge: { en: "Edge", zh: "差值" },
  noMarketTitle: { en: "No market data", zh: "暂无市场数据" },
  noMarketBody: {
    en: "No active temperature market for this city right now.",
    zh: "该城市当前暂无市场数据。",
  },
  loading: { en: "Loading arbitrage overview…", zh: "正在加载套利对比数据…" },
  loadingCity: { en: "Loading…", zh: "加载中…" },
  partialBanner: {
    en: "Some cities are still loading. The rest will be filled on the next refresh.",
    zh: "部分城市仍在加载，其余将在下一轮刷新中补齐。",
  },
  retry: { en: "Retry", zh: "重试" },
  generated: { en: "Generated", zh: "生成" },
} as const;

function copy(key: keyof typeof ARBITRAGE_TEXT, isEn: boolean) {
  return ARBITRAGE_TEXT[key][isEn ? "en" : "zh"];
}

function cityDisplayLabel(cityName: string, isEn: boolean) {
  const staticLabel = STATIC_CITY_LABELS.get(cityName);
  return staticLabel ? (isEn ? staticLabel.en : staticLabel.zh) : cityName;
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
    <div className="flex min-w-[104px] flex-1 flex-col gap-0.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className={clsx("font-mono text-sm font-black tabular-nums", toneClass)}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单城市卡片
// ---------------------------------------------------------------------------

type CityCardStatus = "ok" | "no-market" | "loading" | "error";

function CityArbitrageCard({
  cityName,
  isEn,
  overview,
  errorMessage,
  status,
  windowSize,
}: {
  cityName: string;
  isEn: boolean;
  overview?: ArbitrageOverview;
  errorMessage?: string;
  status: CityCardStatus;
  windowSize: number;
}) {
  const buckets = useMemo(
    () => (Array.isArray(overview?.buckets) ? overview.buckets : []),
    [overview],
  );

  const activeWindow = useMemo(() => {
    if (status !== "ok") return null;
    const best = pickMaxWindow(
      computeContiguousWindows(buckets, windowSize),
      "debSum",
    );
    return best ? { ...best, isTop3: true } : null;
  }, [buckets, status, windowSize]);

  const suggestionWindow = useMemo(() => {
    if (status !== "ok") return null;
    return pickMaxWindow(computeContiguousWindows(buckets, windowSize), "edge");
  }, [buckets, status, windowSize]);

  const totalMarketYesSum =
    overview?.total_market_yes_sum != null &&
    Number.isFinite(Number(overview.total_market_yes_sum))
      ? Number(overview.total_market_yes_sum)
      : null;
  const strictArbitrage = totalMarketYesSum != null && totalMarketYesSum < 100;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h3 className="truncate text-sm font-black text-slate-900">
          {cityDisplayLabel(cityName, isEn)}
        </h3>
        {strictArbitrage ? (
          <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-black tabular-nums text-emerald-700">
            ΣYes {totalMarketYesSum?.toFixed(1)}¢
          </span>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex h-20 items-center justify-center rounded border border-dashed border-slate-200 text-xs font-bold text-slate-400">
          {copy("loadingCity", isEn)}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="flex h-20 flex-col items-center justify-center gap-1 rounded border border-dashed border-rose-200 text-slate-500">
          <CircleAlert size={14} className="text-rose-500" />
          <span className="max-w-full truncate px-2 text-[11px] font-semibold">
            {errorMessage || "Error"}
          </span>
        </div>
      ) : null}

      {status === "no-market" ? (
        <div className="flex h-20 flex-col items-center justify-center gap-1 rounded border border-dashed border-slate-200 text-slate-400">
          <Scale size={14} />
          <span className="text-[11px] font-black">{copy("noMarketTitle", isEn)}</span>
          <span className="px-2 text-center text-[10px] font-semibold">
            {overview?.error || copy("noMarketBody", isEn)}
          </span>
        </div>
      ) : null}

      {status === "ok" ? (
        <div className="flex min-w-0 flex-col gap-2">
          {suggestionWindow && suggestionWindow.edge > 0 ? (
            <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-blue-800">
              <span className="font-black">{copy("suggestionTitle", isEn)}: </span>
              {isEn
                ? `Window ${windowRangeLabel(suggestionWindow)} — DEB ${formatProb(
                    suggestionWindow.debSum,
                  )} vs market ${formatCents(suggestionWindow.marketSum)} (edge ${formatEdge(
                    suggestionWindow.edge,
                  )})`
                : `窗口 ${windowRangeLabel(suggestionWindow)}：DEB ${formatProb(
                    suggestionWindow.debSum,
                  )}，市场仅 ${formatCents(
                    suggestionWindow.marketSum,
                  )}（差值 ${formatEdge(suggestionWindow.edge)}）`}
            </div>
          ) : null}

          {activeWindow ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {buckets
                  .slice(activeWindow.startIndex, activeWindow.endIndex + 1)
                  .map((bucket) => (
                    <span
                      key={`${bucket.label}-${bucket.value}`}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-slate-600"
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
              <div className="flex flex-wrap gap-1.5">
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
          ) : (
            <div className="flex h-14 items-center justify-center rounded border border-dashed border-slate-200 text-[11px] font-bold text-slate-400">
              {copy("noMarketTitle", isEn)}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件：全城市卡片网格
// ---------------------------------------------------------------------------

export function ArbitrageDashboard({ isEn }: ArbitrageDashboardProps) {
  // 全部城市：初始为静态 8 城，挂载后尝试从后端加载动态列表，失败静默保留静态。
  const [availableCities, setAvailableCities] = useState<ArbitrageCity[]>(() =>
    FALLBACK_ARBITRAGE_CITIES.map((item) => ({
      key: item.value,
      display_name: item.value,
    })),
  );
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [windowSize, setWindowSize] = useState<number>(DEFAULT_WINDOW_SIZE);

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

  const cityNames = useMemo(
    () => availableCities.map((item) => item.display_name),
    [availableCities],
  );

  const { details, error, loading, missing, errors, partial, refreshManually } =
    useMultiCityArbitrageQuery({ cities: cityNames });

  // 用第一个可用城市的 generated_at 作为全局生成时间。
  const generatedText = useMemo(() => {
    for (const name of cityNames) {
      const item = details[name];
      if (item?.generated_at) return formatGeneratedAt(item.generated_at);
    }
    return "";
  }, [cityNames, details]);

  const hasAnyData = useMemo(
    () => cityNames.some((name) => details[name]),
    [cityNames, details],
  );

  const renderBody = () => {
    if (!hasAnyData && loading) {
      return (
        <div className="flex h-40 items-center justify-center text-xs font-bold text-slate-400">
          {copy("loading", isEn)}
        </div>
      );
    }
    if (!hasAnyData && error) {
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

    const missingSet = new Set(missing);
    const errorEntries = Object.entries(errors);

    return (
      <div className="flex flex-col gap-3 p-3">
        {partial ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
            {copy("partialBanner", isEn)}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {availableCities.map((item) => {
            const name = item.display_name;
            const overview = details[name];
            const hasMarket =
              Boolean(overview?.market_available) &&
              Array.isArray(overview?.buckets) &&
              overview.buckets.length > 0;
            let status: CityCardStatus = "loading";
            if (overview && !hasMarket) status = "no-market";
            else if (hasMarket) status = "ok";
            else if (errorEntries.some(([city]) => city === name)) status = "error";
            else if (missingSet.has(name)) status = "loading";
            return (
              <CityArbitrageCard
                key={item.key}
                cityName={name}
                isEn={isEn}
                overview={overview}
                errorMessage={errors[name]}
                status={status}
                windowSize={windowSize}
              />
            );
          })}
        </div>
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
            {loading && hasAnyData ? (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                {copy("refreshing", isEn)}
              </span>
            ) : null}
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              {availableCities.length} {isEn ? "cities" : "城"}
            </span>
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
                  "h-8 w-8 border-r border-slate-200 font-mono text-[11px] font-bold tabular-nums last:border-r-0",
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
            onClick={refreshManually}
            disabled={loading}
            aria-busy={citiesLoading}
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
