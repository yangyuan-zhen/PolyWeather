import type { MarketScan, MarketTopBucket } from "@/lib/dashboard-types";
import { formatTemperatureValue, getTodayPaceView } from "@/lib/dashboard-utils";
import type { AiCityForecastPayload } from "@/components/dashboard/scan-terminal/types";

export type WeatherDecisionView = {
  action: string;
  confidence: string;
  expectedHigh: string;
  kicker: string;
  reasons: string[];
  risk: string;
  targetRange: string;
  tone: "cold" | "neutral" | "warm" | "watch";
};

export type MarketDecisionView = {
  bucketLabel: string;
  confidence: string;
  edgeText: string;
  impliedText: string;
  marketUrl?: string | null;
  modelText: string;
  priceText: string;
  reason: string;
  status: "loading" | "ready" | "unavailable";
  title: string;
  tone: "cold" | "neutral" | "warm" | "watch";
};

export function normalizeMarketProbability(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) return numeric / 100;
  if (numeric < 0) return null;
  return numeric;
}

export function formatMarketPercent(value: number | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMarketCents(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}¢`;
}

export function formatSignedMarketPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function normalizeMarketComparableTemp(
  displayTemp: number | null,
  tempSymbol: string,
  bucket?: MarketTopBucket | null,
) {
  if (displayTemp == null || !Number.isFinite(displayTemp)) return null;
  const bucketUnit = String(bucket?.unit || "").trim().toUpperCase();
  const isDisplayF = String(tempSymbol || "").toUpperCase().includes("F");
  if (bucketUnit === "F" && !isDisplayF) return displayTemp * 1.8 + 32;
  if (bucketUnit === "C" && isDisplayF) return (displayTemp - 32) / 1.8;
  return displayTemp;
}

export function getMarketBucketLabel(bucket?: MarketTopBucket | null, tempSymbol = "°C") {
  const direct = String(bucket?.label || "").trim();
  if (direct) return direct;
  const value = bucket?.temp ?? bucket?.value ?? bucket?.lower ?? null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const unit = bucket?.unit
      ? `°${String(bucket.unit).replace(/^°/, "").toUpperCase()}`
      : tempSymbol;
    return `${numeric.toFixed(0)}${unit}`;
  }
  return "--";
}

export function pickMarketBucketForWeatherCenter(
  scan: MarketScan | null | undefined,
  expectedHigh: number | null,
  tempSymbol: string,
) {
  const buckets = (
    Array.isArray(scan?.all_buckets)
      ? scan?.all_buckets
      : Array.isArray(scan?.top_buckets)
        ? scan?.top_buckets
        : []
  ) as MarketTopBucket[];
  if (!buckets.length || expectedHigh == null || !Number.isFinite(expectedHigh)) {
    return null;
  }

  let nearest: MarketTopBucket | null = null;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    const comparable = normalizeMarketComparableTemp(expectedHigh, tempSymbol, bucket);
    if (comparable == null) continue;
    const lower = bucket.lower != null ? Number(bucket.lower) : null;
    const upper = bucket.upper != null ? Number(bucket.upper) : null;
    if (
      lower != null &&
      upper != null &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      comparable >= lower - 0.01 &&
      comparable <= upper + 0.01
    ) {
      return bucket;
    }
    const anchor = Number(bucket.temp ?? bucket.value ?? bucket.lower);
    if (!Number.isFinite(anchor)) continue;
    const delta = Math.abs(anchor - comparable);
    if (delta < nearestDelta) {
      nearest = bucket;
      nearestDelta = delta;
    }
  }
  return nearest;
}

export function buildMarketDecisionView({
  expectedHigh,
  isEn,
  marketScan,
  marketStatus,
  tempSymbol,
}: {
  expectedHigh: number | null;
  isEn: boolean;
  marketScan: MarketScan | null;
  marketStatus: "idle" | "loading" | "ready" | "failed";
  tempSymbol: string;
}): MarketDecisionView {
  if (marketStatus === "loading") {
    return {
      bucketLabel: "--",
      confidence: "--",
      edgeText: "--",
      impliedText: "--",
      modelText: "--",
      priceText: "--",
      reason: isEn
        ? "Fetching the existing Polymarket quote layer for this city."
        : "正在读取项目内已有的 Polymarket 价格层。",
      status: "loading",
      title: isEn ? "Syncing market price" : "正在同步市场价格",
      tone: "watch",
    };
  }
  if (!marketScan?.available) {
    return {
      bucketLabel: "--",
      confidence: "--",
      edgeText: "--",
      impliedText: "--",
      modelText: "--",
      priceText: "--",
      reason:
        marketScan?.reason ||
        (isEn
          ? "No active matched Polymarket temperature market is available for this city yet."
          : "该城市暂未匹配到可用的 Polymarket 温度市场。"),
      status: "unavailable",
      title: isEn ? "No market quote" : "暂无市场报价",
      tone: "watch",
    };
  }

  const bucket = pickMarketBucketForWeatherCenter(marketScan, expectedHigh, tempSymbol);
  const bucketProbability = normalizeMarketProbability(bucket?.probability);
  const scanProbability = normalizeMarketProbability(marketScan.model_probability);
  const modelProbability = bucketProbability ?? scanProbability;
  const yesBuy =
    normalizeMarketProbability(bucket?.yes_buy) ??
    normalizeMarketProbability(bucket?.market_price) ??
    normalizeMarketProbability(marketScan.yes_buy) ??
    normalizeMarketProbability(marketScan.market_price);
  const yesSell =
    normalizeMarketProbability(bucket?.yes_sell) ??
    normalizeMarketProbability(marketScan.yes_sell);
  const implied = yesBuy ?? yesSell ?? null;
  const edge =
    modelProbability != null && implied != null ? modelProbability - implied : null;
  const tone =
    edge == null
      ? "neutral"
      : edge >= 0.08
        ? "warm"
        : edge <= -0.08
          ? "cold"
          : "neutral";
  const title =
    edge == null
      ? isEn
        ? "Market quote matched"
        : "已匹配市场报价"
      : edge >= 0.08
        ? isEn
          ? "Weather probability above market"
          : "天气概率高于市场报价"
        : edge <= -0.08
          ? isEn
            ? "Market already prices this in"
            : "市场价格已偏充分"
          : isEn
            ? "Price near weather probability"
            : "价格接近天气概率";

  return {
    bucketLabel: getMarketBucketLabel(bucket, tempSymbol),
    confidence: marketScan.confidence || "--",
    edgeText: formatSignedMarketPercent(edge),
    impliedText: formatMarketPercent(implied),
    marketUrl:
      bucket?.slug
        ? `https://polymarket.com/market/${bucket.slug}`
        : marketScan.market_url || marketScan.primary_market_url || null,
    modelText: formatMarketPercent(modelProbability),
    priceText: formatMarketCents(yesBuy),
    reason:
      edge == null
        ? isEn
          ? "Quote is available, but model probability or YES price is incomplete."
          : "已获取报价，但模型概率或 YES 价格不完整。"
        : isEn
          ? `Model probability is ${formatMarketPercent(modelProbability)} versus market-implied ${formatMarketPercent(implied)}.`
          : `模型概率 ${formatMarketPercent(modelProbability)}，市场隐含约 ${formatMarketPercent(implied)}。`,
    status: "ready",
    title,
    tone,
  };
}

export function buildWeatherDecisionView({
  aiCityForecast,
  currentTemp,
  deb,
  isEn,
  localModelSupportNote,
  modelEntries,
  modelMax,
  modelMin,
  paceTone,
  paceView,
  peakWindow,
  tempSymbol,
}: {
  aiCityForecast: AiCityForecastPayload["city_forecast"] | null;
  currentTemp: number | null;
  deb: number | null;
  isEn: boolean;
  localModelSupportNote: string;
  modelEntries: Array<readonly [string, number]>;
  modelMax: number | null;
  modelMin: number | null;
  paceTone: string;
  paceView: ReturnType<typeof getTodayPaceView> | null;
  peakWindow: string;
  tempSymbol: string;
}): WeatherDecisionView {
  const aiPredicted = Number(aiCityForecast?.predicted_max);
  const center = Number.isFinite(aiPredicted)
    ? aiPredicted
    : paceView?.paceAdjustedHigh != null
      ? paceView.paceAdjustedHigh
      : deb;
  const aiLow = Number(aiCityForecast?.range_low);
  const aiHigh = Number(aiCityForecast?.range_high);
  const low = Number.isFinite(aiLow)
    ? aiLow
    : modelMin != null
      ? modelMin
      : center != null
        ? center - 1
        : null;
  const high = Number.isFinite(aiHigh)
    ? aiHigh
    : modelMax != null
      ? modelMax
      : center != null
        ? center + 1
        : null;
  const spread = modelMax != null && modelMin != null ? modelMax - modelMin : null;
  const modelCount = modelEntries.length;
  const aiConfidence = String(aiCityForecast?.confidence || "").trim();
  const confidence =
    aiConfidence ||
    (modelCount >= 4 && spread != null && spread <= 2
      ? isEn
        ? "High"
        : "高"
      : modelCount >= 2
        ? isEn
          ? "Medium"
          : "中"
        : isEn
          ? "Low"
          : "低");
  const tone =
    modelCount <= 1
      ? "watch"
      : paceTone === "warm" || paceTone === "cold" || paceTone === "neutral"
        ? paceTone
        : "neutral";
  const action =
    modelCount <= 1
      ? isEn
        ? "Wait for model cluster"
        : "等待模型补齐"
      : paceTone === "warm"
        ? isEn
          ? "Watch hotter range"
          : "关注偏高温区间"
        : paceTone === "cold"
          ? isEn
            ? "Avoid chasing high"
            : "暂不追高温"
          : isEn
            ? "Wait for peak-window confirmation"
            : "等待峰值窗口确认";
  const expectedHigh =
    center != null && Number.isFinite(Number(center))
      ? formatTemperatureValue(Number(center), tempSymbol, { digits: 1 })
      : "--";
  const targetRange =
    low != null && high != null && Number.isFinite(Number(low)) && Number.isFinite(Number(high))
      ? `${formatTemperatureValue(Number(low), tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(Number(high), tempSymbol, { digits: 1 })}`
      : expectedHigh;
  const reasons = [
    localModelSupportNote,
    paceView?.summary || "",
    currentTemp != null
      ? isEn
        ? `Latest observed anchor is ${formatTemperatureValue(currentTemp, tempSymbol, { digits: 1 })}.`
        : `最新实测锚点为 ${formatTemperatureValue(currentTemp, tempSymbol, { digits: 1 })}。`
      : "",
  ]
    .filter(Boolean)
    .slice(0, 3);
  const risk =
    paceTone === "warm"
      ? isEn
        ? "Risk trigger: if later METAR cools back toward the curve before the peak window, downgrade the hotter read."
        : "风险触发：如果后续 METAR 在峰值窗口前回落到曲线附近，需要下调偏高温判断。"
      : paceTone === "cold"
        ? isEn
          ? "Risk trigger: only restore higher buckets if observations recover before the peak window."
          : "风险触发：只有实测在峰值窗口前修复，才重新考虑更高温区间。"
        : isEn
          ? "Risk trigger: a clear METAR/path break before the peak window should decide direction."
          : "风险触发：峰值窗口前若 METAR 或路径明显偏离，再决定方向。";

  return {
    action,
    confidence,
    expectedHigh,
    kicker: isEn
      ? "Weather decision layer · no market price input"
      : "天气决策层 · 未接入市场价格",
    reasons,
    risk,
    targetRange,
    tone,
  };
}

