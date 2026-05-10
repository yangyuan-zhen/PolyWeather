import type { MarketScan, MarketTopBucket } from "@/lib/dashboard-types";
import { getTodayPaceView } from "@/lib/pace-utils";
import {
  formatTemperatureValue,
  normalizeTemperatureLabel,
} from "@/lib/temperature-utils";
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

function normalizeQuotePrice(value: unknown) {
  const normalized = normalizeMarketProbability(value);
  if (normalized == null || normalized <= 0) return null;
  return normalized;
}

function toFiniteMarketNumber(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasReasonableTemperatureValue(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > -130 && value < 150;
}

function isPlausibleExpectedHigh(
  value: number | null,
  references: Array<number | null>,
) {
  if (!hasReasonableTemperatureValue(value)) return false;
  const usableReferences = references.filter(hasReasonableTemperatureValue);
  if (!usableReferences.length) return true;
  const referenceMin = Math.min(...usableReferences);
  const referenceMax = Math.max(...usableReferences);
  return value >= referenceMin - 6 && value <= referenceMax + 6;
}

export function resolveExpectedHighCandidate({
  aiPredictedMax,
  currentTemp,
  deb,
  modelMax,
  modelMin,
  paceAdjustedHigh,
}: {
  aiPredictedMax?: unknown;
  currentTemp?: number | null;
  deb?: number | null;
  modelMax?: number | null;
  modelMin?: number | null;
  paceAdjustedHigh?: number | null;
}) {
  const ai = toFiniteMarketNumber(aiPredictedMax);
  const modelCenter =
    modelMin != null && modelMax != null
      ? (modelMin + modelMax) / 2
      : null;
  const references = [deb ?? null, modelMin ?? null, modelMax ?? null, currentTemp ?? null];
  const candidates = [ai, deb ?? null, paceAdjustedHigh ?? null, modelCenter, currentTemp ?? null];
  for (const candidate of candidates) {
    if (isPlausibleExpectedHigh(candidate, references)) {
      return candidate;
    }
  }
  return null;
}

export function formatMarketPercent(value: number | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMarketCents(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  if (value > 0 && value < 0.01) return "<1¢";
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
  if (direct && /[°]?[CF]\b|\d+\s*[+-]?$/i.test(direct) && !/[�｡紊]/.test(direct)) {
    const labelSymbol = /°?\s*F\b/i.test(direct)
      ? "°F"
      : /°?\s*C\b/i.test(direct)
        ? "°C"
        : tempSymbol;
    return normalizeTemperatureLabel(direct, labelSymbol).replace(/\s+°([CF])\b/g, "°$1");
  }
  const numeric = toFiniteMarketNumber(bucket?.temp ?? bucket?.value ?? bucket?.lower);
  if (numeric != null) {
    const unit = bucket?.unit
      ? `°${String(bucket.unit).replace(/^°/, "").toUpperCase()}`
      : tempSymbol;
    return `${numeric.toFixed(0)}${unit}`;
  }
  return "--";
}

function getBucketAnchor(bucket: MarketTopBucket) {
  return toFiniteMarketNumber(bucket.temp ?? bucket.value ?? bucket.lower);
}

function marketBucketLabelText(bucket?: MarketTopBucket | null) {
  return String(`${bucket?.label || ""} ${bucket?.slug || ""} ${bucket?.question || ""}`)
    .trim()
    .toLowerCase();
}

function isMarketBucketAbove(bucket?: MarketTopBucket | null) {
  return /\b(or[-\s]?higher|or[-\s]?above|above|higher|at least|greater than)\b/i.test(
    marketBucketLabelText(bucket),
  );
}

function isMarketBucketBelow(bucket?: MarketTopBucket | null) {
  return /\b(or[-\s]?lower|or[-\s]?below|below|lower|at most|less than)\b/i.test(
    marketBucketLabelText(bucket),
  );
}

function getRoundedWeatherBucketValue(
  expectedHigh: number | null,
  tempSymbol: string,
  bucket: MarketTopBucket,
) {
  const comparable = normalizeMarketComparableTemp(expectedHigh, tempSymbol, bucket);
  if (comparable == null || !Number.isFinite(comparable)) return null;
  return Math.round(comparable);
}

function getBucketModelProbability(bucket?: MarketTopBucket | null) {
  const model = normalizeMarketProbability(bucket?.model_probability);
  const probability = normalizeMarketProbability(bucket?.probability);
  const market = normalizeMarketProbability(bucket?.market_price);
  // Some persisted market_scan payloads from older builds overwrote bucket
  // probability with the market price. Treat an exact price clone as missing
  // model probability so the caller can fall back to scan.model_probability.
  if (
    model != null &&
    market != null &&
    Math.abs(model - market) <= 0.000_001
  ) {
    return null;
  }
  if (
    probability != null &&
    market != null &&
    Math.abs(probability - market) <= 0.000_001
  ) {
    return null;
  }
  return model ?? probability;
}

function getBucketDisplayUnit(bucket: MarketTopBucket, tempSymbol: string) {
  return bucket.unit
    ? `°${String(bucket.unit).replace(/^°/, "").toUpperCase()}`
    : tempSymbol;
}

function buildBucketMappingExplanation({
  bucket,
  expectedHigh,
  isEn,
  tempSymbol,
}: {
  bucket: MarketTopBucket;
  expectedHigh: number | null;
  isEn: boolean;
  tempSymbol: string;
}) {
  const comparable = normalizeMarketComparableTemp(expectedHigh, tempSymbol, bucket);
  const rounded = getRoundedWeatherBucketValue(expectedHigh, tempSymbol, bucket);
  if (comparable == null || rounded == null) return "";
  const unit = getBucketDisplayUnit(bucket, tempSymbol);
  const bucketLabel = getMarketBucketLabel(bucket, tempSymbol);
  const expectedText = formatTemperatureValue(comparable, unit, { digits: 1 });
  const hasRounding = Math.abs(comparable - rounded) >= 0.05;
  if (isEn) {
    const mapping = hasRounding
      ? `Expected high ${expectedText} maps to the ${bucketLabel} settlement bucket after rounding.`
      : `Expected high ${expectedText} maps to the ${bucketLabel} bucket.`;
    return `${mapping} Model probability is still the bucket-distribution probability, not 100% just because the center maps there.`;
  }
  const mapping = hasRounding
    ? `预计高点 ${expectedText} 按结算四舍五入映射到 ${bucketLabel} 桶。`
    : `预计高点 ${expectedText} 对应 ${bucketLabel} 桶。`;
  return `${mapping} 模型概率仍按温度分布计算，不等于把该桶视为 100%。`;
}

function getMarketSelectedBucket(scan: MarketScan | null | undefined): MarketTopBucket | null {
  const selected = scan?.temperature_bucket;
  if (!selected) return null;
  const value = Number(selected.value);
  return {
    label: selected.label || selected.bucket || selected.range || null,
    value: Number.isFinite(value) ? value : null,
    temp: Number.isFinite(value) ? value : null,
    unit: selected.unit || null,
    probability: selected.probability ?? scan?.model_probability ?? null,
    model_probability: selected.probability ?? scan?.model_probability ?? null,
    market_price: scan?.market_price ?? null,
    yes_buy: scan?.yes_buy ?? null,
    yes_sell: scan?.yes_sell ?? null,
    slug: scan?.selected_slug ?? scan?.primary_market?.slug ?? null,
  };
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
  const selectedBucket = getMarketSelectedBucket(scan);
  const isReasonableFallback = (bucket: MarketTopBucket | null) => {
    if (!bucket) return false;
    const comparable = normalizeMarketComparableTemp(expectedHigh, tempSymbol, bucket);
    const anchor = getBucketAnchor(bucket);
    if (comparable == null || anchor == null) return false;
    const roundedTarget = Math.round(comparable);
    const roundedAnchor = Math.round(anchor);
    const lower = bucket.lower != null ? Number(bucket.lower) : anchor;
    const upper = bucket.upper != null ? Number(bucket.upper) : null;
    if (upper != null && Number.isFinite(lower) && Number.isFinite(upper)) {
      return roundedTarget >= lower - 0.01 && roundedTarget <= upper + 0.01;
    }
    if (isMarketBucketAbove(bucket)) return roundedTarget >= roundedAnchor;
    if (isMarketBucketBelow(bucket)) return roundedTarget <= roundedAnchor;
    return roundedAnchor === roundedTarget;
  };
  if (!buckets.length || expectedHigh == null || !Number.isFinite(expectedHigh)) {
    return isReasonableFallback(selectedBucket) ? selectedBucket : null;
  }

  let roundedMatch: MarketTopBucket | null = null;
  let nearest: MarketTopBucket | null = null;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    const comparable = normalizeMarketComparableTemp(expectedHigh, tempSymbol, bucket);
    if (comparable == null) continue;
    const roundedTarget = getRoundedWeatherBucketValue(expectedHigh, tempSymbol, bucket);
    const lower = bucket.lower != null ? Number(bucket.lower) : null;
    const upper = bucket.upper != null ? Number(bucket.upper) : null;
    const anchor = getBucketAnchor(bucket);
    if (anchor != null && roundedTarget != null && Math.round(anchor) === roundedTarget) {
      roundedMatch = bucket;
      break;
    }
    if (
      roundedMatch == null &&
      lower != null &&
      upper != null &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      roundedTarget != null &&
      roundedTarget >= lower - 0.01 &&
      roundedTarget <= upper + 0.01
    ) {
      roundedMatch = bucket;
      break;
    }
    if (anchor == null) continue;
    const delta = Math.abs(anchor - comparable);
    if (delta < nearestDelta) {
      nearest = bucket;
      nearestDelta = delta;
    }
  }
  if (roundedMatch) return roundedMatch;
  if (!nearest) return isReasonableFallback(selectedBucket) ? selectedBucket : null;
  if (Number.isFinite(nearestDelta) && isReasonableFallback(nearest)) {
    return nearest;
  }
  return isReasonableFallback(selectedBucket) ? selectedBucket : null;
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
      reason: isEn
        ? "No tradable quote is available yet; weather evidence is still shown."
        : "暂无可交易价格，仅展示天气证据。天气判断仍可参考。",
      status: "unavailable",
      title: isEn ? "Market price temporarily unavailable" : "市场价格暂不可用",
      tone: "watch",
    };
  }

  const bucket = pickMarketBucketForWeatherCenter(marketScan, expectedHigh, tempSymbol);
  if (!bucket) {
    return {
      bucketLabel: "--",
      confidence: marketScan.confidence || "--",
      edgeText: "--",
      impliedText: formatMarketPercent(
        normalizeMarketProbability(marketScan.market_price) ??
          normalizeMarketProbability(marketScan.midpoint) ??
          normalizeMarketProbability(marketScan.yes_midpoint),
      ),
      marketUrl: marketScan.market_url || marketScan.primary_market_url || null,
      modelText: formatMarketPercent(normalizeMarketProbability(marketScan.model_probability)),
      priceText: formatMarketCents(normalizeQuotePrice(marketScan.yes_buy)),
      reason: isEn
        ? "A market was found, but its temperature bucket does not match today’s expected high closely enough, so edge is withheld."
        : "已找到市场，但温度桶与今日预计高点不够匹配，暂不计算概率差。",
      status: "ready",
      title: isEn ? "Market bucket needs rematch" : "市场温度桶需重新匹配",
      tone: "watch",
    };
  }
  const bucketLabel = getMarketBucketLabel(bucket, tempSymbol);
  const bucketMappingExplanation = buildBucketMappingExplanation({
    bucket,
    expectedHigh,
    isEn,
    tempSymbol,
  });
  const bucketProbability = getBucketModelProbability(bucket);
  const scanProbability = normalizeMarketProbability(marketScan.model_probability);
  const modelProbability = bucketProbability ?? scanProbability;
  const yesBuy =
    normalizeQuotePrice(bucket?.yes_buy) ??
    normalizeQuotePrice(marketScan.yes_buy);
  const yesSell =
    normalizeQuotePrice(bucket?.yes_sell) ??
    normalizeQuotePrice(marketScan.yes_sell);
  const marketMid =
    normalizeMarketProbability(bucket?.market_price) ??
    normalizeMarketProbability(marketScan.market_price) ??
    normalizeMarketProbability(marketScan.midpoint) ??
    normalizeMarketProbability(marketScan.yes_midpoint);
  const implied = marketMid ?? yesBuy ?? yesSell ?? null;
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
    bucketLabel,
    confidence: marketScan.confidence || "--",
    edgeText: formatSignedMarketPercent(edge),
    impliedText: formatMarketPercent(implied),
    marketUrl:
      bucket?.market_url ||
      (bucket?.slug
        ? `https://polymarket.com/market/${bucket.slug}`
        : marketScan.market_url || marketScan.primary_market_url || null),
    modelText: formatMarketPercent(modelProbability),
    priceText: formatMarketCents(yesBuy),
    reason:
      edge == null
        ? isEn
          ? "Quote is available, but model probability or YES price is incomplete."
          : "已获取报价，但模型概率或 YES 价格不完整。"
        : isEn
          ? `Model probability is ${formatMarketPercent(modelProbability)} versus market-implied ${formatMarketPercent(implied)}.${bucketMappingExplanation ? ` ${bucketMappingExplanation}` : ""}`
          : `模型概率 ${formatMarketPercent(modelProbability)}，市场隐含约 ${formatMarketPercent(implied)}。${bucketMappingExplanation ? ` ${bucketMappingExplanation}` : ""}`,
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
  const center = resolveExpectedHighCandidate({
    aiPredictedMax: aiCityForecast?.predicted_max,
    currentTemp,
    deb,
    modelMax,
    modelMin,
    paceAdjustedHigh: paceView?.paceAdjustedHigh ?? null,
  });
  const aiLow = toFiniteMarketNumber(aiCityForecast?.range_low);
  const aiHigh = toFiniteMarketNumber(aiCityForecast?.range_high);
  const low = aiLow != null
    ? aiLow
    : modelMin != null
      ? modelMin
      : center != null
        ? center - 1
        : null;
  const high = aiHigh != null
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
          ? "Revise upward"
          : "预计最高温上修"
        : paceTone === "cold"
          ? isEn
            ? "Revise downward"
            : "预计最高温下修"
          : isEn
            ? "Stay with model base"
            : "维持模型基准";
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
      ? "Weather-first read · market price shown separately"
      : "天气优先判断 · 市场价格另列",
    reasons,
    risk,
    targetRange,
    tone,
  };
}

