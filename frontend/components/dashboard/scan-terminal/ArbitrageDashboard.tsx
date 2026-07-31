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

// 结论视图固定使用 3 档连续温度区间。
const WINDOW_SIZE = 3;

const ARBITRAGE_TEXT = {
  title: { en: "Arbitrage Compare", zh: "套利对比" },
  subtitle: {
    en: "Model probability vs market price for temperature ranges.",
    zh: "模型概率 vs 市场价格的温度区间对比。",
  },
  refresh: { en: "Refresh", zh: "刷新" },
  refreshing: { en: "Refreshing…", zh: "刷新中…" },
  strictArb: {
    en: "strict: buy every Yes at only ",
    zh: "严格套利：全档买入 Yes 仅需 ",
  },
  model: { en: "model", zh: "模型" },
  market: { en: "market", zh: "市场" },
  edge: { en: "edge", zh: "价差" },
  pricedIn: { en: "market fully priced", zh: "市场已充分定价" },
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
  legend: {
    en: "Model = our DEB forecast. Market = Polymarket Yes price. Positive edge means the market is underpricing that range.",
    zh: "模型 = 我们的 DEB 预测概率；市场 = Polymarket Yes 价格；价差为正说明市场低估了这个区间。",
  },
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
  return `${(n * 100).toFixed(0)}%`;
}

function formatCents(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(0)}¢`;
}

function formatEdge(edge: number) {
  if (!Number.isFinite(edge)) return "--";
  const points = edge * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(0)}`;
}

function windowRangeLabel(windowItem: ArbitrageWindow) {
  const first = windowItem.labels[0] || "";
  const last = windowItem.labels[windowItem.labels.length - 1] || "";
  return windowItem.labels.length > 1 ? `${first} – ${last}` : first;
}

// 纯前端滑窗计算：buckets 已是温度升序，连续 WINDOW_SIZE 档求和。
function computeWindows(buckets: ArbitrageBucket[]): ArbitrageWindow[] {
  if (buckets.length < WINDOW_SIZE) return [];
  const windows: ArbitrageWindow[] = [];
  for (let startIndex = 0; startIndex + WINDOW_SIZE <= buckets.length; startIndex += 1) {
    const slice = buckets.slice(startIndex, startIndex + WINDOW_SIZE);
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
      endIndex: startIndex + WINDOW_SIZE - 1,
      labels: slice.map((bucket) => bucket.label),
      debSum,
      marketSum,
      edge: debSum - marketSum / 100,
      isTop3: false,
    });
  }
  return windows;
}

function pickBestWindow(windows: ArbitrageWindow[]): ArbitrageWindow | null {
  let best: ArbitrageWindow | null = null;
  for (const windowItem of windows) {
    if (!best || windowItem.edge > best.edge) best = windowItem;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 单城市卡片：一句话结论
// ---------------------------------------------------------------------------

type CityCardStatus = "ok" | "no-market" | "loading" | "error";

function CityArbitrageCard({
  cityName,
  isEn,
  overview,
  errorMessage,
  status,
}: {
  cityName: string;
  isEn: boolean;
  overview?: ArbitrageOverview;
  errorMessage?: string;
  status: CityCardStatus;
}) {
  const bestWindow = useMemo(() => {
    if (status !== "ok") return null;
    const buckets = Array.isArray(overview?.buckets) ? overview.buckets : [];
    return pickBestWindow(computeWindows(buckets));
  }, [overview, status]);

  const hasEdge = bestWindow != null && bestWindow.edge > 0;

  const totalMarketYesSum =
    overview?.total_market_yes_sum != null &&
    Number.isFinite(Number(overview.total_market_yes_sum))
      ? Number(overview.total_market_yes_sum)
      : null;
  const strictArbitrage = totalMarketYesSum != null && totalMarketYesSum < 100;

  return (
    <div
      className={clsx(
        "flex min-w-0 flex-col gap-1.5 rounded border p-3 transition-colors",
        hasEdge
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h3 className="truncate text-sm font-black text-slate-900">
          {cityDisplayLabel(cityName, isEn)}
        </h3>
        {strictArbitrage && status === "ok" ? (
          <span className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-black text-emerald-700">
            {copy("strictArb", isEn)}
            {totalMarketYesSum?.toFixed(0)}¢
          </span>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex h-12 items-center justify-center rounded border border-dashed border-slate-200 text-xs font-bold text-slate-400">
          {copy("loadingCity", isEn)}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="flex h-12 flex-col items-center justify-center gap-1 rounded border border-dashed border-rose-200 text-slate-500">
          <CircleAlert size={13} className="text-rose-500" />
          <span className="max-w-full truncate px-2 text-[11px] font-semibold">
            {errorMessage || "Error"}
          </span>
        </div>
      ) : null}

      {status === "no-market" ? (
        <div className="flex h-12 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-slate-200 text-slate-400">
          <span className="text-[11px] font-black">{copy("noMarketTitle", isEn)}</span>
          <span className="px-2 text-center text-[10px] font-semibold">
            {overview?.error || copy("noMarketBody", isEn)}
          </span>
        </div>
      ) : null}

      {status === "ok" && bestWindow ? (
        <p className="text-[13px] font-medium leading-relaxed text-slate-700">
          <span className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[11px] font-black text-white">
            {windowRangeLabel(bestWindow)}
          </span>
          <span className="mx-1.5 text-slate-400">·</span>
          {isEn ? (
            <>
              {copy("model", isEn)}{" "}
              <span className="font-mono font-black tabular-nums text-violet-700">
                {formatProb(bestWindow.debSum)}
              </span>
              {" vs "}
              {copy("market", isEn)}{" "}
              <span className="font-mono font-black tabular-nums text-blue-700">
                {formatCents(bestWindow.marketSum)}
              </span>
              {" ("}
              {copy("edge", isEn)}{" "}
              <span
                className={clsx(
                  "font-mono font-black tabular-nums",
                  hasEdge ? "text-emerald-700" : "text-slate-500",
                )}
              >
                {formatEdge(bestWindow.edge)}
              </span>
              {")"}
            </>
          ) : (
            <>
              {copy("model", isEn)}{" "}
              <span className="font-mono font-black tabular-nums text-violet-700">
                {formatProb(bestWindow.debSum)}
              </span>
              {"，"}
              {copy("market", isEn)}{" "}
              <span className="font-mono font-black tabular-nums text-blue-700">
                {formatCents(bestWindow.marketSum)}
              </span>
              {"，"}
              {copy("edge", isEn)}{" "}
              <span
                className={clsx(
                  "font-mono font-black tabular-nums",
                  hasEdge ? "text-emerald-700" : "text-slate-500",
                )}
              >
                {formatEdge(bestWindow.edge)}
              </span>
            </>
          )}
        </p>
      ) : null}

      {status === "ok" && !bestWindow ? (
        <div className="flex h-12 items-center justify-center rounded border border-dashed border-slate-200 text-[11px] font-bold text-slate-400">
          {copy("noMarketTitle", isEn)}
        </div>
      ) : null}

      {status === "ok" && bestWindow && !hasEdge ? (
        <p className="text-[10px] font-bold text-slate-400">
          {copy("pricedIn", isEn)}
        </p>
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
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-slate-500">
          {copy("legend", isEn)}
        </p>
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

function formatGeneratedAt(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
