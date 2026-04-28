"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  CityDetail,
  MarketScan,
  MarketTopBucket,
  ProbabilityBucket,
} from "@/lib/dashboard-types";
import { getModelView, getProbabilityView } from "@/lib/model-utils";

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{text}</div>
  );
}

function toPercent(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${(numeric * 100).toFixed(1)}%`;
}

function toPriceCents(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  const cents = normalized * 100;
  const rounded = Math.round(cents * 10) / 10;
  const text = Number.isInteger(rounded)
    ? String(rounded.toFixed(0))
    : String(rounded);
  return `${text}c`;
}

function parseTempFromText(value: unknown) {
  const text = String(value || "");
  const match = text.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function getBucketTemp(bucket: ProbabilityBucket) {
  if (bucket.value != null) {
    const byValue = Number(bucket.value);
    if (Number.isFinite(byValue)) return byValue;
  }
  return parseTempFromText(bucket.label || bucket.bucket || bucket.range);
}

function getMarketYesPrice(scan?: MarketScan | null) {
  if (scan?.market_price != null) {
    const preferred = Number(scan.market_price);
    if (Number.isFinite(preferred)) return preferred;
  }
  if (scan?.yes_token?.implied_probability != null) {
    const implied = Number(scan.yes_token.implied_probability);
    if (Number.isFinite(implied)) return implied;
  }
  return null;
}

function isFahrenheitSymbol(symbol?: string | null) {
  return String(symbol || "")
    .toUpperCase()
    .includes("F");
}

function displayTempToMarketCelsius(
  value: number | null,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  if (value == null || !Number.isFinite(value)) return null;
  if (isFahrenheitSymbol(detail.temp_symbol)) {
    return ((value - 32) * 5) / 9;
  }
  return value;
}

function formatBucketDisplayLabel(
  bucket: ProbabilityBucket,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  let bucketLabel = bucket.label || `${bucket.value}${detail.temp_symbol}`;
  if (!bucketLabel) return "";
  let str = String(bucketLabel).toUpperCase().replace(/\s+/g, "");
  const symbol = detail.temp_symbol || "°C";
  if (isFahrenheitSymbol(symbol)) {
    str = str.replace(/℃/g, "°F").replace(/°C/g, "°F");
  } else {
    str = str.replace(/℃/g, "°C").replace(/°F/g, "°C");
  }
  str = str.replace(/°?C($|\+|-)/g, "°C$1");
  str = str.replace(/°?F($|\+|-)/g, "°F$1");
  if (!/[°℃][CF]/.test(str) && /[0-9]/.test(str)) {
    str += symbol;
  }
  return str;
}

function getMarketBucketUnit(bucket?: MarketTopBucket | null) {
  return String(bucket?.unit || "").toUpperCase();
}

function isMarketBucketAbove(bucket?: MarketTopBucket | null) {
  const text =
    `${bucket?.label || ""} ${bucket?.slug || ""} ${bucket?.question || ""}`
      .toLowerCase()
      .replace(/\s+/g, "");
  return (
    text.includes("+") ||
    text.includes("orhigher") ||
    text.includes("or-higher")
  );
}

function isMarketBucketBelow(bucket?: MarketTopBucket | null) {
  const text =
    `${bucket?.label || ""} ${bucket?.slug || ""} ${bucket?.question || ""}`
      .toLowerCase()
      .replace(/\s+/g, "");
  return (
    text.includes("<=") || text.includes("orlower") || text.includes("or-lower")
  );
}

function findMarketBucketForDisplayTemp(
  buckets: MarketTopBucket[],
  displayTemp: number | null,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  if (displayTemp == null || !Number.isFinite(displayTemp)) return null;

  let best: MarketTopBucket | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    const bucketUnit = String(bucket.unit || "").toUpperCase();
    const compareTemp =
      bucketUnit === "F"
        ? displayTemp
        : displayTempToMarketCelsius(displayTemp, detail);
    if (compareTemp == null) continue;

    const lower = bucket.lower != null ? Number(bucket.lower) : null;
    const upper = bucket.upper != null ? Number(bucket.upper) : null;
    if (
      lower != null &&
      upper != null &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      compareTemp >= lower - 0.01 &&
      compareTemp <= upper + 0.01
    ) {
      return bucket;
    }

    const rawTemp = bucket.temp ?? bucket.value ?? null;
    if (rawTemp == null) continue;
    const candidateTemp = Number(rawTemp);
    if (!Number.isFinite(candidateTemp)) continue;
    const delta = Math.abs(candidateTemp - compareTemp);
    if (delta < bestDelta) {
      best = bucket;
      bestDelta = delta;
    }
  }
  const tolerance = isFahrenheitSymbol(detail.temp_symbol) ? 0.56 : 0.26;
  return best && bestDelta <= tolerance ? best : null;
}

function marketBucketContainsDisplayTemp(
  bucket: MarketTopBucket | null,
  displayTemp: number | null,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  if (!bucket || displayTemp == null || !Number.isFinite(displayTemp))
    return false;

  const bucketUnit = getMarketBucketUnit(bucket);
  const compareTemp =
    bucketUnit === "F"
      ? displayTemp
      : displayTempToMarketCelsius(displayTemp, detail);
  if (compareTemp == null) return false;

  const lower = bucket.lower != null ? Number(bucket.lower) : null;
  const upper = bucket.upper != null ? Number(bucket.upper) : null;
  if (lower != null && !Number.isFinite(lower)) return false;
  if (upper != null && !Number.isFinite(upper)) return false;

  if (lower != null && upper != null) {
    return compareTemp >= lower - 0.01 && compareTemp <= upper + 0.01;
  }
  if (lower != null && isMarketBucketAbove(bucket)) {
    return compareTemp >= lower - 0.01;
  }
  if (lower != null && isMarketBucketBelow(bucket)) {
    return compareTemp <= lower + 0.01;
  }
  const reference = bucket.temp ?? bucket.value ?? lower;
  const numeric = reference != null ? Number(reference) : null;
  if (numeric == null || !Number.isFinite(numeric)) return false;
  const tolerance = bucketUnit === "F" ? 0.56 : 0.26;
  return Math.abs(compareTemp - numeric) <= tolerance;
}

function getAggregatedModelProbabilityForMarketBucket(
  probabilities: ProbabilityBucket[],
  bucket: MarketTopBucket | null,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  if (!bucket) return null;

  let total = 0;
  let matched = 0;
  for (const probabilityBucket of probabilities) {
    const temp = getBucketTemp(probabilityBucket);
    if (!marketBucketContainsDisplayTemp(bucket, temp, detail)) continue;
    const probability = Number(probabilityBucket.probability);
    if (!Number.isFinite(probability)) continue;
    total += probability;
    matched += 1;
  }

  return matched > 0 ? Math.max(0, Math.min(1, total)) : null;
}

type ProbabilityDisplayRow = {
  key: string;
  label: string;
  probability: number;
  marketBucket?: MarketTopBucket | null;
};

function formatMarketBucketDisplayLabel(
  bucket: MarketTopBucket,
  detail: Pick<CityDetail, "temp_symbol">,
) {
  const label = String(bucket.label || "").trim();
  if (label) {
    const unit = getMarketBucketUnit(bucket);
    let normalized = label.toUpperCase().replace(/\s+/g, "");
    if (unit === "F" || isFahrenheitSymbol(detail.temp_symbol)) {
      normalized = normalized
        .replace(/ORHIGHER/g, "+")
        .replace(/ORLOWER/g, "-")
        .replace(/℃/g, "°F")
        .replace(/°C/g, "°F")
        .replace(/(?<=\d)F/g, "°F");
    } else {
      normalized = normalized
        .replace(/ORHIGHER/g, "+")
        .replace(/ORLOWER/g, "-")
        .replace(/℃/g, "°C")
        .replace(/°F/g, "°C")
        .replace(/(?<=\d)C/g, "°C");
    }
    return normalized.replace(/\+/g, "+");
  }

  const unit =
    getMarketBucketUnit(bucket) === "F" ||
    isFahrenheitSymbol(detail.temp_symbol)
      ? "°F"
      : "°C";
  const lower = bucket.lower != null ? Number(bucket.lower) : null;
  const upper = bucket.upper != null ? Number(bucket.upper) : null;
  if (
    lower != null &&
    upper != null &&
    Number.isFinite(lower) &&
    Number.isFinite(upper)
  ) {
    return `${lower}-${upper}${unit}`;
  }
  const value = bucket.value ?? bucket.temp ?? lower;
  const numeric = value != null ? Number(value) : null;
  if (numeric != null && Number.isFinite(numeric)) {
    return isMarketBucketAbove(bucket)
      ? `${numeric}${unit}+`
      : `${numeric}${unit}`;
  }
  return "--";
}

type ModelMetadata = NonNullable<
  NonNullable<CityDetail["source_forecasts"]>["open_meteo_multi_model"]
>["model_metadata"];


function normalizeModelNameForVote(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]/g, "");
}

function getModelVoteFamily(name: string) {
  const normalized = normalizeModelNameForVote(name);
  if (["icon", "iconeu", "icond2"].includes(normalized)) return "dwd_icon";
  if (["gem", "gdps", "rdps", "hrdps"].includes(normalized)) return "eccc_gem";
  if (["ecmwfaifs", "aifs"].includes(normalized)) return "ecmwf_aifs";
  if (normalized === "ecmwf") return "ecmwf_ifs";
  return normalized || name;
}

function getModelVotePriority(name: string) {
  const normalized = normalizeModelNameForVote(name);
  return (
    {
      icond2: 40,
      iconeu: 30,
      icon: 20,
      hrdps: 40,
      rdps: 35,
      gdps: 30,
      gem: 20,
      ecmwfaifs: 30,
      ecmwf: 30,
      gfs: 30,
      jma: 30,
      mgm: 45,
      nws: 45,
      openmeteo: 15,
    }[normalized] || 10
  );
}

function getRoundedModelVoteDistribution(
  detail: CityDetail,
  targetDate?: string | null,
) {
  const view = getModelView(detail, targetDate);
  const representatives = new Map<
    string,
    { name: string; priority: number; value: number }
  >();

  Object.entries(view.models || {}).forEach(([name, rawValue]) => {
    const normalized = normalizeModelNameForVote(name);
    if (normalized === "lgbm" || normalized.includes("meteoblue")) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const family = getModelVoteFamily(name);
    const priority = getModelVotePriority(name);
    const current = representatives.get(family);
    if (!current || priority > current.priority) {
      representatives.set(family, { name, priority, value });
    }
  });

  const bucketMap = new Map<number, { count: number; models: string[] }>();
  representatives.forEach(({ name, value }) => {
    const rounded = Math.round(value);
    const row = bucketMap.get(rounded) || { count: 0, models: [] };
    row.count += 1;
    row.models.push(name);
    bucketMap.set(rounded, row);
  });

  const total = representatives.size;
  const rows = Array.from(bucketMap.entries())
    .map(([value, row]) => ({
      count: row.count,
      models: row.models,
      percent: total > 0 ? row.count / total : 0,
      value,
    }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  return {
    rows,
    total,
  };
}

function normalizeMarketProbability(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100));
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSignedProbability(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) > 1) return numeric / 100;
  return numeric;
}

function formatSignedPercent(value?: number | null, digits = 1) {
  const normalized = normalizeSignedProbability(value);
  if (normalized == null) return "--";
  const percent = normalized * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(digits)}%`;
}

function getMarketTopBuckets(scan?: MarketScan | null) {
  const buckets = Array.isArray(scan?.top_buckets) ? scan.top_buckets : [];
  if (!buckets.length) return [];

  return buckets
    .map((item) => ({
      ...item,
      probability: normalizeMarketProbability(item.probability),
    }))
    .filter(
      (item): item is MarketTopBucket & { probability: number } =>
        item.probability != null,
    );
}

function getMarketAllBuckets(scan?: MarketScan | null) {
  const buckets = Array.isArray(scan?.all_buckets)
    ? scan.all_buckets
    : Array.isArray(scan?.top_buckets)
      ? scan.top_buckets
      : [];
  if (!buckets.length) return [];

  return buckets
    .map((item) => ({
      ...item,
      probability: normalizeMarketProbability(item.probability),
    }))
    .filter(
      (item): item is MarketTopBucket & { probability: number } =>
        item.probability != null,
    );
}

function getMarketTopBucketKey(bucket: MarketTopBucket) {
  if (bucket?.value != null) {
    const valueNum = Number(bucket.value);
    if (Number.isFinite(valueNum)) return `v:${valueNum.toFixed(2)}`;
  }

  if (bucket?.temp != null) {
    const tempNum = Number(bucket.temp);
    if (Number.isFinite(tempNum)) return `t:${tempNum.toFixed(2)}`;
  }

  const parsed = parseTempFromText(bucket?.label);
  if (parsed != null) return `l:${parsed.toFixed(2)}`;

  return `s:${String(bucket?.slug || bucket?.question || bucket?.label || "")}`;
}

function hasLgbmModel(detail: CityDetail, targetDate?: string | null) {
  const view = getModelView(detail, targetDate);
  return Object.keys(view.models || {}).some((name) =>
    normalizeModelNameForVote(name).includes("lgbm"),
  );
}

function formatProbabilityEngineLabel(
  detail: CityDetail,
  targetDate: string | null | undefined,
  locale: string,
) {
  const view = getProbabilityView(detail, targetDate);
  if (hasLgbmModel(detail, targetDate)) {
    return locale === "en-US" ? "LGBM-calibrated probability" : "LGBM 校准概率";
  }
  const engine = String(view.engine || "")
    .trim()
    .toLowerCase();
  const calibrationMode = String(view.calibrationMode || "")
    .trim()
    .toLowerCase();
  if (engine === "emos" || calibrationMode.includes("emos")) {
    return locale === "en-US" ? "EMOS-calibrated probability" : "EMOS 校准概率";
  }
  return locale === "en-US" ? "Model probability" : "模型概率";
}


export function ProbabilityDistribution({
  detail,
  hideTitle = false,
  targetDate,
  marketScan,
}: {
  detail: CityDetail;
  hideTitle?: boolean;
  targetDate?: string | null;
  marketScan?: MarketScan | null;
}) {
  const { locale, t } = useI18n();
  const view = getProbabilityView(detail, targetDate);
  const modelView = getModelView(detail, targetDate);
  const marketYesPrice = getMarketYesPrice(marketScan);
  const marketYesText = toPercent(marketYesPrice);
  const isToday = !targetDate || targetDate === detail.local_date;
  const probabilityEngineLabel = formatProbabilityEngineLabel(
    detail,
    targetDate,
    locale,
  );
  const hasLgbmProbability = hasLgbmModel(detail, targetDate);
  const modelVoteView = useMemo(
    () => getRoundedModelVoteDistribution(detail, targetDate),
    [detail, targetDate],
  );
  const modelVoteHint = modelVoteView.rows
    .slice(0, 2)
    .map(
      (row) =>
        `${row.value}${detail.temp_symbol} ${row.count}/${modelVoteView.total}`,
    )
    .join(" · ");
  const marketTopBuckets = isToday ? getMarketTopBuckets(marketScan) : [];
  const marketAllBuckets = isToday ? getMarketAllBuckets(marketScan) : [];
  const sortedMarketTopBuckets = useMemo(() => {
    const sorted = [...marketTopBuckets].sort(
      (a, b) => Number(b.probability || 0) - Number(a.probability || 0),
    );
    const deduped: Array<MarketTopBucket & { probability: number }> = [];
    const seenKeys = new Set<string>();
    for (const row of sorted) {
      const key = getMarketTopBucketKey(row);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduped.push(row);
      if (deduped.length >= 4) break;
    }
    return deduped;
  }, [marketTopBuckets]);
  const useMarketTopBuckets =
    marketScan?.available && sortedMarketTopBuckets.length >= 2;
  const topMarketBucketText = toPercent(sortedMarketTopBuckets[0]?.probability);
  const topProbability = [...(view.probabilities || [])].sort(
    (a, b) => Number(b.probability || 0) - Number(a.probability || 0),
  )[0];
  const topProbabilityText = toPercent(topProbability?.probability);
  const topProbabilityLabel = topProbability
    ? formatBucketDisplayLabel(topProbability, detail)
    : null;
  const topProbabilityTemp = topProbability
    ? getBucketTemp(topProbability)
    : null;
  const probabilitiesForMarketContracts =
    view.probabilitiesAll?.length > 0
      ? view.probabilitiesAll
      : view.probabilities || [];
  const marketContractRows = useMemo<ProbabilityDisplayRow[]>(() => {
    if (!isToday || !marketScan?.available || marketAllBuckets.length === 0) {
      return [];
    }

    const rows: ProbabilityDisplayRow[] = [];
    const seenKeys = new Set<string>();
    for (const marketBucket of marketAllBuckets) {
      const probability = getAggregatedModelProbabilityForMarketBucket(
        probabilitiesForMarketContracts,
        marketBucket,
        detail,
      );

      const key =
        marketBucket.slug ||
        marketBucket.label ||
        `${marketBucket.lower ?? marketBucket.value ?? marketBucket.temp}-${marketBucket.upper ?? ""}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      rows.push({
        key,
        label: formatMarketBucketDisplayLabel(marketBucket, detail),
        probability: probability ?? 0,
        marketBucket,
      });
    }
    return rows;
  }, [
    detail,
    isToday,
    marketAllBuckets,
    marketScan?.available,
    probabilitiesForMarketContracts,
  ]);
  const modelProbabilityRows = useMemo<ProbabilityDisplayRow[]>(
    () =>
      (view.probabilities || []).slice(0, 6).map((bucket, index) => {
        const bucketTemp = getBucketTemp(bucket);
        return {
          key: `${bucket.label || bucket.value || index}`,
          label: formatBucketDisplayLabel(bucket, detail),
          probability: Number(bucket.probability || 0),
          marketBucket: findMarketBucketForDisplayTemp(
            marketAllBuckets,
            bucketTemp,
            detail,
          ),
        };
      }),
    [detail, marketAllBuckets, view.probabilities],
  );
  const probabilityRows =
    marketContractRows.length > 0
      ? marketContractRows.slice(0, 8)
      : modelProbabilityRows;
  const topContractRow =
    marketContractRows.length > 0
      ? marketContractRows.reduce((best, row) =>
          row.probability > best.probability ? row : best,
        )
      : null;
  const displayTopLabel = topContractRow?.label || topProbabilityLabel || null;
  const displayTopProbability =
    topContractRow?.probability ??
    (topProbability?.probability != null
      ? Number(topProbability.probability)
      : null);
  const displayTopProbabilityText = toPercent(displayTopProbability);
  const displayUsesMarketBuckets = marketContractRows.length > 0;
  const linkedMarketBucket = useMemo(() => {
    if (topContractRow?.marketBucket) return topContractRow.marketBucket;
    if (topProbabilityTemp == null) return null;
    return findMarketBucketForDisplayTemp(
      marketAllBuckets,
      topProbabilityTemp,
      detail,
    );
  }, [detail, marketAllBuckets, topContractRow, topProbabilityTemp]);
  const priceAnalysis = marketScan?.price_analysis;
  const yesPriceView = priceAnalysis?.yes;
  const noPriceView = priceAnalysis?.no;
  const linkedMarketAsk =
    linkedMarketBucket?.yes_buy ??
    linkedMarketBucket?.market_price ??
    yesPriceView?.ask ??
    null;
  const linkedNoAsk = linkedMarketBucket?.no_buy ?? noPriceView?.ask ?? null;
  const linkedContractLabel =
    topContractRow?.label ||
    (linkedMarketBucket
      ? formatMarketBucketDisplayLabel(linkedMarketBucket, detail)
      : null) ||
    topProbabilityLabel ||
    null;
  const aggregatedMarketProbability =
    getAggregatedModelProbabilityForMarketBucket(
      probabilitiesForMarketContracts,
      linkedMarketBucket,
      detail,
    );
  const linkedMarketProbability =
    topContractRow?.probability ??
    aggregatedMarketProbability ??
    (topProbability?.probability != null
      ? Number(topProbability.probability)
      : null);
  const linkedMarketProbabilityText = toPercent(linkedMarketProbability);
  const linkedMarketEdge =
    linkedMarketProbability != null && linkedMarketAsk != null
      ? linkedMarketProbability - Number(linkedMarketAsk)
      : null;
  const linkedNoEdge =
    linkedMarketProbability != null && linkedNoAsk != null
      ? 1 - linkedMarketProbability - Number(linkedNoAsk)
      : null;
  const linkedBestSide =
    linkedMarketBucket && linkedNoEdge != null && linkedMarketEdge != null
      ? linkedNoEdge > linkedMarketEdge
        ? "no"
        : "yes"
      : null;
  const linkedBestAsk = linkedBestSide === "no" ? linkedNoAsk : linkedMarketAsk;
  const linkedBestEdge =
    linkedBestSide === "no" ? linkedNoEdge : linkedMarketEdge;
  const preferredPriceView = linkedMarketBucket
    ? {
        ask: linkedBestAsk,
        edge: linkedBestEdge,
      }
    : priceAnalysis?.best_side === "no"
      ? noPriceView
      : yesPriceView;
  const preferredSideLabel = linkedMarketBucket
    ? linkedBestSide === "no"
      ? "NO"
      : "YES"
    : priceAnalysis?.best_side === "no"
      ? locale === "en-US"
        ? "NO"
        : "NO"
      : locale === "en-US"
        ? "YES"
        : "YES";
  const yesDisplayPrice = linkedMarketBucket
    ? linkedMarketAsk
    : yesPriceView?.ask;
  const noDisplayPrice = linkedMarketBucket ? linkedNoAsk : noPriceView?.ask;
  const yesDisplayEdge = linkedMarketBucket
    ? linkedMarketEdge
    : yesPriceView?.edge;
  const noDisplayEdge = linkedMarketBucket ? linkedNoEdge : noPriceView?.edge;
  const hasPriceAnalysis =
    isToday &&
    (Boolean(priceAnalysis?.available) ||
      Boolean(marketScan) ||
      Boolean(topProbability));
  const lockEdge = normalizeSignedProbability(priceAnalysis?.lock?.edge);
  const lockAvailable = Boolean(
    priceAnalysis?.lock?.available && lockEdge != null,
  );
  const quoteSource =
    linkedMarketBucket?.quote_source ||
    marketScan?.yes_token?.quote_source ||
    marketScan?.no_token?.quote_source ||
    null;
  const quoteAgeMs =
    linkedMarketBucket?.quote_age_ms ??
    marketScan?.yes_token?.quote_age_ms ??
    marketScan?.no_token?.quote_age_ms;
  const quoteSourceLabel =
    quoteSource === "polymarket_ws"
      ? locale === "en-US"
        ? `WS live${quoteAgeMs != null ? ` · ${Math.max(0, Math.round(Number(quoteAgeMs) / 1000))}s` : ""}`
        : `WS 实时${quoteAgeMs != null ? ` · ${Math.max(0, Math.round(Number(quoteAgeMs) / 1000))}秒` : ""}`
      : locale === "en-US"
        ? "CLOB fallback"
        : "CLOB 兜底";
  const actionableEdge = normalizeSignedProbability(preferredPriceView?.edge);
  const linkedContractOverpriced =
    Boolean(linkedMarketBucket) &&
    linkedBestSide === "no" &&
    linkedMarketProbability != null &&
    linkedMarketAsk != null &&
    linkedMarketEdge != null &&
    linkedMarketEdge < 0 &&
    linkedNoEdge != null &&
    linkedNoEdge > 0;
  const linkedContractOverpay =
    linkedContractOverpriced &&
    linkedMarketProbability != null &&
    linkedMarketAsk != null
      ? Number(linkedMarketAsk) - linkedMarketProbability
      : null;
  const actionText = !marketScan
    ? locale === "en-US"
      ? "Waiting"
      : "等待"
    : !marketScan.available
      ? locale === "en-US"
        ? "No market"
        : "无盘口"
      : actionableEdge == null
        ? locale === "en-US"
          ? "No quote"
          : "无报价"
        : actionableEdge >= 0.02
          ? linkedContractOverpriced
            ? locale === "en-US"
              ? "Overpriced"
              : "市场偏贵"
            : locale === "en-US"
              ? `Watch ${preferredSideLabel}`
              : `可关注 ${preferredSideLabel}`
          : actionableEdge > 0
            ? linkedContractOverpriced
              ? locale === "en-US"
                ? "Slightly overpriced"
                : "略偏贵"
              : locale === "en-US"
                ? `Small ${preferredSideLabel}`
                : `${preferredSideLabel} 优势较小`
            : locale === "en-US"
              ? "No clear edge"
              : "暂无优势";
  const actionNote =
    linkedContractOverpriced && linkedContractOverpay != null
      ? locale === "en-US"
        ? `YES above model by ${formatSignedPercent(linkedContractOverpay)}`
        : `YES 高于模型 ${formatSignedPercent(linkedContractOverpay)}`
      : actionableEdge != null && actionableEdge >= 0.02
        ? locale === "en-US"
          ? `${formatSignedPercent(actionableEdge)} vs ask`
          : `相对买价 ${formatSignedPercent(actionableEdge)}`
        : locale === "en-US"
          ? `${preferredSideLabel} ${formatSignedPercent(actionableEdge)}`
          : `${preferredSideLabel} ${formatSignedPercent(actionableEdge)}`;

  return (
    <section className="prob-section">
      {!hideTitle && <h3>{t("section.probability")}</h3>}
      <div className="prob-bars">
        <div className="prob-calibration-head">
          <div>
            <span className="prob-source-chip">{probabilityEngineLabel}</span>
            <strong>
              {displayTopLabel && displayTopProbabilityText
                ? locale === "en-US"
                  ? displayUsesMarketBuckets
                    ? `${displayTopLabel} is the top displayed contract bucket at ${displayTopProbabilityText}`
                    : `${displayTopLabel} is the top single bucket at ${displayTopProbabilityText}`
                  : displayUsesMarketBuckets
                    ? `${displayTopLabel} 为当前显示分布最高，${displayTopProbabilityText}`
                    : `${displayTopLabel} 单点最高，${displayTopProbabilityText}`
                : locale === "en-US"
                  ? "Awaiting calibrated buckets"
                  : "等待校准概率桶"}
            </strong>
          </div>
          <p>
            {hasLgbmProbability
              ? locale === "en-US"
                ? "LGBM is the learned intraday adjustment; raw model points below are only diagnostic."
                : "LGBM 作为日内学习校准项；下方原始模型落点仅用于诊断。"
              : locale === "en-US"
                ? "Using the calibrated probability distribution; raw model points below are not probabilities."
                : "使用校准后的概率分布；下方原始模型落点不是概率。"}
          </p>
        </div>
        {marketScan?.available && (topMarketBucketText || marketYesText) && (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "11px",
              marginBottom: "6px",
            }}
          >
            {useMarketTopBuckets
              ? locale === "en-US"
                ? `Market reference only: top traded bucket ${topMarketBucketText}`
                : `市场仅作参考：最高交易温度桶 ${topMarketBucketText}`
              : locale === "en-US"
                ? `Market reference only: this bucket ${marketYesText}`
                : `市场仅作参考：该温度桶 ${marketYesText}`}
          </div>
        )}
        <div className="prob-distribution-panel">
          <div className="prob-distribution-head">
            <span>
              {locale === "en-US"
                ? "EMOS probability distribution"
                : "EMOS 概率分布"}
            </span>
            <em>
              {marketContractRows.length > 0
                ? locale === "en-US"
                  ? "market buckets are aggregated from single-degree EMOS buckets"
                  : "市场合约桶由单点 EMOS 概率聚合"
                : locale === "en-US"
                  ? "calibrated temperature buckets"
                  : "校准后的温度桶"}
            </em>
          </div>
          {probabilityRows.length === 0 ? (
            <EmptyState text={t("section.noProb")} />
          ) : (
            probabilityRows.map((row, index) => {
              const probability = Math.round(
                Number(row.probability || 0) * 100,
              );

              return (
                <div key={`${row.key || index}`} className="prob-row">
                  <div className="prob-label">{row.label}</div>
                  <div className="prob-bar-track">
                    <div
                      className={clsx("prob-bar-fill", `rank-${index}`)}
                      style={{ width: `${Math.max(probability, 8)}%` }}
                    >
                      {probability}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {hasPriceAnalysis && (
          <div className="prob-price-card">
            <div className="prob-price-head">
              <span>
                {locale === "en-US" ? "Win-rate reference" : "胜率参考"}
              </span>
              <strong>
                {!marketScan
                  ? locale === "en-US"
                    ? "Waiting for market context"
                    : "等待市场参照"
                  : !marketScan.available
                    ? locale === "en-US"
                      ? "No matched active market"
                      : "未匹配到活跃盘口"
                    : locale === "en-US"
                      ? `${linkedContractLabel || topProbabilityLabel || "Temperature bucket"} · model ${linkedMarketProbabilityText || topProbabilityText || "--"}`
                      : `${linkedContractLabel || topProbabilityLabel || "温度桶"} · 模型 ${linkedMarketProbabilityText || topProbabilityText || "--"}`}
              </strong>
            </div>
            <div className="prob-price-grid">
              <div>
                <span>
                  {locale === "en-US" ? "Bucket" : "温度桶"}
                </span>
                <strong>
                  {linkedContractLabel || topProbabilityLabel || "--"}
                </strong>
                <em>
                  {linkedMarketProbabilityText || topProbabilityText || "--"}
                </em>
              </div>
              <div>
                <span>{locale === "en-US" ? "DEB" : "DEB"}</span>
                <strong>
                  {modelView.deb != null && Number.isFinite(Number(modelView.deb))
                    ? `${Number(modelView.deb).toFixed(1)}${detail.temp_symbol}`
                    : "--"}
                </strong>
                <em>{locale === "en-US" ? "final fused forecast" : "最终融合预测"}</em>
              </div>
              <div>
                <span>{locale === "en-US" ? "Model support" : "模型支持"}</span>
                <strong>{modelVoteHint || "--"}</strong>
                <em>{locale === "en-US" ? "raw model agreement" : "原始模型一致性"}</em>
              </div>
              <div>
                <span>{locale === "en-US" ? "Market role" : "盘口角色"}</span>
                <strong>{locale === "en-US" ? "Reference only" : "仅作参考"}</strong>
                <em>{quoteSourceLabel}</em>
              </div>
            </div>
            <p>
              {locale === "en-US"
                ? "This card follows the same rule as AI forecast: DEB first, model agreement second, METAR conflict check before settlement."
                : "该卡片与 AI 预测口径一致：先看 DEB，再看模型支持，最后检查 METAR 是否冲突。"}
            </p>
          </div>
        )}
        {modelVoteHint && (
          <div className="prob-model-hint">
            <span>
              {locale === "en-US" ? "Raw model points" : "原始模型落点"}
            </span>
            <strong>{modelVoteHint}</strong>
            <em>
              {locale === "en-US"
                ? "diagnostic only; EMOS and contract rows use calibrated probabilities"
                : "仅作诊断；EMOS 与合约行使用校准概率"}
            </em>
          </div>
        )}
      </div>
    </section>
  );
}
