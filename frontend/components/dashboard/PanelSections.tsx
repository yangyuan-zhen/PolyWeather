"use client";

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import { startTransition, useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useCityData, useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import {
  CityDetail,
  MarketScan,
  MarketTopBucket,
  ProbabilityBucket,
} from "@/lib/dashboard-types";
import {
  getHeroMetaItems,
  getModelView,
  getProbabilityView,
  getRiskBadgeLabel,
  getTemperatureChartData,
  getWeatherSummary,
} from "@/lib/dashboard-utils";

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
  return String(symbol || "").toUpperCase().includes("F");
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
  const text = `${bucket?.label || ""} ${bucket?.slug || ""} ${bucket?.question || ""}`
    .toLowerCase()
    .replace(/\s+/g, "");
  return text.includes("+") || text.includes("orhigher") || text.includes("or-higher");
}

function isMarketBucketBelow(bucket?: MarketTopBucket | null) {
  const text = `${bucket?.label || ""} ${bucket?.slug || ""} ${bucket?.question || ""}`
    .toLowerCase()
    .replace(/\s+/g, "");
  return text.includes("<=") || text.includes("orlower") || text.includes("or-lower");
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
  if (!bucket || displayTemp == null || !Number.isFinite(displayTemp)) return false;

  const bucketUnit = getMarketBucketUnit(bucket);
  const compareTemp =
    bucketUnit === "F" ? displayTemp : displayTempToMarketCelsius(displayTemp, detail);
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
    getMarketBucketUnit(bucket) === "F" || isFahrenheitSymbol(detail.temp_symbol)
      ? "°F"
      : "°C";
  const lower = bucket.lower != null ? Number(bucket.lower) : null;
  const upper = bucket.upper != null ? Number(bucket.upper) : null;
  if (lower != null && upper != null && Number.isFinite(lower) && Number.isFinite(upper)) {
    return `${lower}-${upper}${unit}`;
  }
  const value = bucket.value ?? bucket.temp ?? lower;
  const numeric = value != null ? Number(value) : null;
  if (numeric != null && Number.isFinite(numeric)) {
    return isMarketBucketAbove(bucket) ? `${numeric}${unit}+` : `${numeric}${unit}`;
  }
  return "--";
}

type ModelMetadata = NonNullable<
  NonNullable<CityDetail["source_forecasts"]>["open_meteo_multi_model"]
>["model_metadata"];

function getModelGroupMeta(
  name: string,
  metadata: ModelMetadata,
  locale: string,
) {
  const meta = metadata?.[name] || {};
  const tier = String(meta.tier || "").toLowerCase();
  const upperName = String(name || "").toUpperCase();

  if (tier.includes("aifs") || upperName.includes("AIFS")) {
    return {
      key: "aifs",
      label: locale === "en-US" ? "AIFS model" : "AIFS 模型",
      order: 1,
      tone: "blue",
    };
  }
  if (
    tier.includes("europe") ||
    upperName.includes("ICON-EU") ||
    upperName.includes("ICON-D2")
  ) {
    return {
      key: "europe",
      label: locale === "en-US" ? "Europe high-resolution" : "欧洲高分辨率",
      order: 2,
      tone: "cyan",
    };
  }
  if (
    tier.includes("north_america") ||
    upperName === "RDPS" ||
    upperName === "HRDPS"
  ) {
    return {
      key: "north-america",
      label: locale === "en-US" ? "North America high-resolution" : "北美高分辨率",
      order: 3,
      tone: "amber",
    };
  }
  return {
    key: "global",
    label: locale === "en-US" ? "Global baseline" : "全球基准",
    order: 0,
    tone: "neutral",
  };
}

function formatModelMetaLine(
  name: string,
  metadata: ModelMetadata,
  locale: string,
) {
  const meta = metadata?.[name] || {};
  const provider = String(meta.provider || "").trim();
  const model = String(meta.model || "").trim();
  const horizon = String(meta.horizon || "").trim();
  const resolution = Number(meta.resolution_km);
  const parts = [
    provider,
    model && model !== name ? model : "",
    Number.isFinite(resolution)
      ? `${resolution}${locale === "en-US" ? " km" : " 公里"}`
      : "",
    horizon,
  ].filter(Boolean);
  return parts.join(" · ");
}

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
    return locale === "en-US"
      ? "LGBM-calibrated probability"
      : "LGBM 校准概率";
  }
  const engine = String(view.engine || "").trim().toLowerCase();
  const calibrationMode = String(view.calibrationMode || "")
    .trim()
    .toLowerCase();
  if (engine === "emos" || calibrationMode.includes("emos")) {
    return locale === "en-US" ? "EMOS-calibrated probability" : "EMOS 校准概率";
  }
  return locale === "en-US" ? "Model probability" : "模型概率";
}

export function HeroSummary() {
  const { data } = useCityData();
  const { locale } = useI18n();
  if (!data) return null;

  const { weatherIcon, weatherText } = getWeatherSummary(data, locale);
  const metaItems = getHeroMetaItems(data, locale);
  const current = data.current || {};
  const settlementSourceCode = String(current.settlement_source || "metar")
    .trim()
    .toLowerCase();
  const settlementIcao = String(
    current.station_code || data.risk?.icao || "",
  )
    .trim()
    .toUpperCase();
  const settlementSource =
    settlementSourceCode === "wunderground"
      ? settlementIcao
        ? `${settlementIcao} METAR`
        : "METAR"
      : String(current.settlement_source_label || current.settlement_source || "METAR")
          .trim()
          .toUpperCase();
  const isMax =
    current.max_so_far != null &&
    current.temp != null &&
    current.max_so_far <= current.temp;
  const currentObsText =
    current.temp != null
      ? `${current.temp}${data.temp_symbol} @${current.obs_time || "--"}`
      : data.metar_status?.stale_for_today
        ? locale === "en-US"
          ? "No same-day METAR"
          : "今日暂无 METAR"
        : "--";

  return (
    <section className="hero-section">
      <div className="hero-weather">
        <span>
          {weatherIcon} {weatherText}
        </span>
      </div>
      <div className="hero-temp">
        <span className="hero-value">
          {current.temp != null ? current.temp.toFixed(1) : "--"}
        </span>
        <span className="hero-unit">{data.temp_symbol || "°C"}</span>
      </div>
      <div className="hero-max-time">
        {isMax && current.max_temp_time
          ? locale === "en-US"
            ? `Today's peak temperature appeared at local time ${current.max_temp_time}`
            : `该城市今日最高温出现在当地时间 ${current.max_temp_time}`
          : ""}
      </div>
      <div className="hero-details">
        <div className="hero-item">
          <span className="label">
            {locale === "en-US" ? "Current Obs" : "当前实测"}
          </span>
          <span className="value">
            {currentObsText}
          </span>
        </div>
        <div className="hero-item">
          <span className="label">
            {locale === "en-US"
              ? `${settlementSource} Anchor`
              : `${settlementSource} 锚点`}
          </span>
          <span className="value highlight">
            {current.wu_settlement != null
              ? `${current.wu_settlement}${data.temp_symbol}`
              : "--"}
          </span>
        </div>
        <div className="hero-item">
          <span className="label">
            {locale === "en-US" ? "DEB Forecast" : "DEB 预测"}
          </span>
          <span className="value">
            {data.deb?.prediction != null
              ? `${data.deb.prediction}${data.temp_symbol}`
              : "--"}
          </span>
        </div>
      </div>
      <div className="hero-sub">
        {metaItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

export function TemperatureChart() {
  const { data } = useCityData();
  const { locale, t } = useI18n();
  const chartData = useMemo(
    () => (data ? getTemperatureChartData(data, locale) : null),
    [data, locale],
  );

  const canvasRef = useChart(() => {
    if (!data || !chartData) {
      return {
        data: { datasets: [], labels: [] },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    }

    const datasets: NonNullable<
      ChartConfiguration<"line">["data"]
    >["datasets"] = [];

    if (chartData.datasets.hasMgmHourly) {
      datasets.push({
        backgroundColor: "rgba(234, 179, 8, 0.05)",
        borderColor: "rgba(234, 179, 8, 0.8)",
        borderWidth: 2,
        data: chartData.datasets.mgmHourlyPoints,
        fill: false,
        label: locale === "en-US" ? "MGM Forecast" : "MGM 预报",
        pointHoverRadius: 6,
        pointRadius: 3,
        spanGaps: true,
        tension: 0.3,
      });
    } else {
      datasets.push({
        backgroundColor: "rgba(52, 211, 153, 0.05)",
        borderColor: "rgba(52, 211, 153, 0.6)",
        borderWidth: 1.5,
        data: chartData.datasets.debPast,
        fill: true,
        label: locale === "en-US" ? "DEB Forecast" : "DEB 预报",
        pointHoverRadius: 3,
        pointRadius: 0,
        tension: 0.3,
      });
      datasets.push({
        borderColor: "rgba(52, 211, 153, 0.35)",
        borderDash: [5, 3],
        borderWidth: 1.5,
        data: chartData.datasets.debFuture,
        fill: false,
        label: locale === "en-US" ? "DEB Forecast" : "DEB 预报",
        pointRadius: 0,
        tension: 0.3,
      });
    }

    datasets.push({
      backgroundColor: "#22d3ee",
      borderColor: "#22d3ee",
      borderWidth: 0,
      data: chartData.datasets.metarPoints,
      fill: false,
      label:
        chartData.observationLabel ||
        (locale === "en-US" ? "METAR Observation" : "METAR 实况"),
      order: 0,
      pointHoverRadius: 7,
      pointRadius: 5,
    });

    if (chartData.datasets.mgmPoints.some((value) => value != null)) {
      datasets.push({
        backgroundColor: "#facc15",
        borderColor: "#facc15",
        borderWidth: 0,
        data: chartData.datasets.mgmPoints,
        fill: false,
        label: locale === "en-US" ? "MGM Observation" : "MGM 实测",
        order: -1,
        pointHoverRadius: 9,
        pointRadius: 7,
        showLine: false,
      });
    }

    if (
      !chartData.datasets.hasMgmHourly &&
      Math.abs(chartData.datasets.offset) > 0.3
    ) {
      datasets.push({
        borderColor: "rgba(99, 102, 241, 0.2)",
        borderDash: [2, 4],
        borderWidth: 1,
        data: chartData.datasets.temps,
        fill: false,
        label: locale === "en-US" ? "OM Raw" : "OM 原始",
        pointRadius: 0,
        tension: 0.3,
      });
    }

    return {
      data: {
        datasets,
        labels: chartData.times,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            borderColor: "rgba(52, 211, 153, 0.3)",
            borderWidth: 1,
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              callback: (_value, index) =>
                typeof index === "number" && index % 3 === 0
                  ? chartData.times[index]
                  : "",
              color: "#64748b",
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.04)" },
            max: chartData.max,
            min: chartData.min,
            ticks: {
              callback: (value) => `${value}${data.temp_symbol || "°C"}`,
              color: "#64748b",
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [data, chartData, locale]);

  return (
    <section className="chart-section">
      <h3>{t("section.todayTempTrend")}</h3>
      <div className="chart-wrapper">
        <canvas ref={canvasRef} />
      </div>
      <div className="chart-legend">
        {chartData?.legendText || t("section.chartEmpty")}
      </div>
    </section>
  );
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
  const topProbabilityTemp = topProbability ? getBucketTemp(topProbability) : null;
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
    (linkedMarketBucket ? formatMarketBucketDisplayLabel(linkedMarketBucket, detail) : null) ||
    topProbabilityLabel ||
    null;
  const aggregatedMarketProbability = getAggregatedModelProbabilityForMarketBucket(
    probabilitiesForMarketContracts,
    linkedMarketBucket,
    detail,
  );
  const linkedMarketProbability =
    topContractRow?.probability ??
    aggregatedMarketProbability ??
    (topProbability?.probability != null ? Number(topProbability.probability) : null);
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
  const preferredPriceView =
    linkedMarketBucket
      ? {
          ask: linkedBestAsk,
          edge: linkedBestEdge,
        }
      : priceAnalysis?.best_side === "no"
        ? noPriceView
        : yesPriceView;
  const preferredSideLabel =
    linkedMarketBucket
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
  const yesDisplayPrice = linkedMarketBucket ? linkedMarketAsk : yesPriceView?.ask;
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
  const lockAvailable = Boolean(priceAnalysis?.lock?.available && lockEdge != null);
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
    linkedContractOverpriced && linkedMarketProbability != null && linkedMarketAsk != null
      ? Number(linkedMarketAsk) - linkedMarketProbability
      : null;
  const actionText =
    !marketScan
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
              const probability = Math.round(Number(row.probability || 0) * 100);
              const rowMarketBucket = row.marketBucket;
              const rowMarketPrice =
                rowMarketBucket?.market_price ?? rowMarketBucket?.yes_buy ?? null;
              const yesPriceText = toPriceCents(rowMarketPrice);
              const marketTagFinal = rowMarketBucket
                ? locale === "en-US"
                  ? `Market ref: ${yesPriceText || "--"}`
                  : `市场参考: ${yesPriceText || "--"}`
                : null;

              return (
                <div
                  key={`${row.key || index}`}
                  className="prob-row"
                >
                  <div className="prob-label">{row.label}</div>
                  <div className="prob-bar-track">
                    <div
                      className={clsx("prob-bar-fill", `rank-${index}`)}
                      style={{ width: `${Math.max(probability, 8)}%` }}
                    >
                      {probability}%
                    </div>
                  </div>
                  {marketTagFinal && (
                    <div
                      className={clsx(
                        "prob-market-inline",
                        rowMarketBucket ? "yes" : "no",
                      )}
                    >
                      {marketTagFinal}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {hasPriceAnalysis && (
          <div className="prob-price-card">
            <div className="prob-price-head">
              <span>
                {locale === "en-US" ? "Probability x Price" : "概率 x 价格联动"}
              </span>
              <strong>
                {!marketScan
                  ? locale === "en-US"
                    ? "Waiting for market layer"
                    : "等待市场层"
                  : !marketScan.available
                    ? locale === "en-US"
                      ? "No matched active market"
                      : "未匹配到活跃盘口"
                    : linkedMarketBucket
                      ? locale === "en-US"
                        ? `${actionText}: ${linkedContractLabel || "contract bucket"}`
                        : `${actionText}：${linkedContractLabel || "合约桶"}`
                      : preferredPriceView?.edge != null
                  ? locale === "en-US"
                    ? `${actionText} · edge ${formatSignedPercent(preferredPriceView.edge)}`
                    : `${actionText} · 优势 ${formatSignedPercent(preferredPriceView.edge)}`
                  : locale === "en-US"
                    ? "Waiting for executable quote"
                    : "等待可执行报价"}
              </strong>
            </div>
            <div className="prob-price-grid">
              <div>
                <span>{locale === "en-US" ? "Contract bucket" : "合约桶口径"}</span>
                <strong>{linkedContractLabel || topProbabilityLabel || "--"}</strong>
                <em>{linkedMarketProbabilityText || topProbabilityText || "--"}</em>
              </div>
              <div>
                <span>{locale === "en-US" ? "Candidate" : "可关注"}</span>
                <strong>{actionText}</strong>
                <em>{actionNote}</em>
              </div>
              <div>
                <span>{locale === "en-US" ? "YES price" : "YES 价格"}</span>
                <strong>{toPriceCents(yesDisplayPrice) || "--"}</strong>
                <em>
                  {locale === "en-US"
                    ? `edge ${formatSignedPercent(yesDisplayEdge)}`
                    : `优势 ${formatSignedPercent(yesDisplayEdge)}`}
                </em>
              </div>
              <div>
                <span>{locale === "en-US" ? "NO price" : "NO 价格"}</span>
                <strong>{toPriceCents(noDisplayPrice) || "--"}</strong>
                <em>
                  {locale === "en-US"
                    ? `edge ${formatSignedPercent(noDisplayEdge)}`
                    : `优势 ${formatSignedPercent(noDisplayEdge)}`}
                </em>
              </div>
            </div>
            <p>
              {locale === "en-US"
                ? `Read-only comparison between model probability and executable ask; it does not place orders. Source: ${quoteSourceLabel}${lockAvailable ? ` · lock ${formatSignedPercent(lockEdge)}` : ""}.`
                : `只比较模型概率与可执行买价；系统不会下单。来源：${quoteSourceLabel}${lockAvailable ? ` · 锁价 ${formatSignedPercent(lockEdge)}` : ""}。`}
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

export function ModelForecast({
  detail,
  hideTitle = false,
  targetDate,
}: {
  detail: CityDetail;
  hideTitle?: boolean;
  targetDate?: string | null;
}) {
  const { locale, t } = useI18n();
  const view = getModelView(detail, targetDate);
  const modelsMap = { ...view.models };
  const modelMetadata =
    detail.source_forecasts?.open_meteo_multi_model?.model_metadata || {};

  const modelEntries = Object.entries(modelsMap).filter(
    ([, value]) =>
      value !== null && value !== undefined && Number.isFinite(Number(value)),
  );
  const hasSingleModelOnly = modelEntries.length === 1;

  // 如果没有任何数值，给出提示
  if (modelEntries.length === 0) {
    return (
      <section className="models-section">
        {!hideTitle && <h3>{t("section.models")}</h3>}
        <div className="model-bars">
          <EmptyState text={t("section.noModels")} />
        </div>
      </section>
    );
  }

  const numericValues = modelEntries.map(([, value]) => Number(value));
  const comparisonValues =
    view.deb != null ? [...numericValues, Number(view.deb)] : numericValues;
  const minValue = comparisonValues.length
    ? Math.min(...comparisonValues) - 1
    : 0;
  const maxValue = comparisonValues.length
    ? Math.max(...comparisonValues) + 1
    : 1;
  const range = Math.max(maxValue - minValue, 1);
  const sortedEntries = modelEntries.sort(
    (a, b) => Number(b[1] || 0) - Number(a[1] || 0),
  );
  const groupedEntries = sortedEntries.reduce(
    (acc, [name, value]) => {
      const group = getModelGroupMeta(name, modelMetadata, locale);
      const existing = acc.find((item) => item.key === group.key);
      const entry = {
        metaLine: formatModelMetaLine(name, modelMetadata, locale),
        name,
        value: Number(value),
      };
      if (existing) {
        existing.entries.push(entry);
      } else {
        acc.push({ ...group, entries: [entry] });
      }
      return acc;
    },
    [] as Array<{
      entries: Array<{ metaLine: string; name: string; value: number }>;
      key: string;
      label: string;
      order: number;
      tone: string;
    }>,
  ).sort((a, b) => a.order - b.order);
  const spread =
    numericValues.length >= 2
      ? Math.max(...numericValues) - Math.min(...numericValues)
      : null;
  const metadataSource =
    detail.source_forecasts?.open_meteo_multi_model?.provider === "open-meteo"
      ? "Open-Meteo"
      : null;

  return (
    <section className="models-section">
      {!hideTitle && <h3>{t("section.models")}</h3>}
      <div className="model-bars">
        <div className="model-stack-summary">
          <span>
            {locale === "en-US" ? "Available models" : "可用模型"} ·{" "}
            <strong>{modelEntries.length}</strong>
          </span>
          <span>
            {locale === "en-US" ? "Spread" : "分歧"} ·{" "}
            <strong>
              {spread != null
                ? `${spread.toFixed(1)}${detail.temp_symbol}`
                : "--"}
            </strong>
          </span>
          {metadataSource && (
            <span>
              {locale === "en-US" ? "API" : "接口"} ·{" "}
              <strong>{metadataSource}</strong>
            </span>
          )}
        </div>
        {hasSingleModelOnly && (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "11px",
              marginBottom: "8px",
            }}
          >
            {locale === "en-US"
              ? "Single-model fallback: waiting for the rest of the model cluster."
              : "当前处于单模型回退，其他模型结果还没回传。"}
          </div>
        )}
        {groupedEntries.map((group) => (
          <div
            key={group.key}
            className={clsx("model-group", `model-group-${group.tone}`)}
          >
            <div className="model-group-heading">
              <span>{group.label}</span>
              <em>{group.entries.length}</em>
            </div>
            {group.entries.map(({ metaLine, name, value }) => {
              const width = ((value - minValue) / range) * 100;
              const debLine =
                view.deb != null
                  ? ((Number(view.deb) - minValue) / range) * 100
                  : null;

              return (
                <div key={name} className="model-row model-row-rich">
                  <div className="model-name" title={metaLine || name}>
                    <strong>{name}</strong>
                    {metaLine && <span>{metaLine}</span>}
                  </div>
                  <div className="model-bar-track">
                    <div
                      className="model-bar-fill"
                      style={{ width: `${width}%` }}
                    />
                    <span className="model-bar-value">
                      {value}
                      {detail.temp_symbol}
                    </span>
                    {debLine != null && (
                      <div
                        className="model-deb-line"
                        style={{ left: `${debLine}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {view.deb != null && (
          <div
            className="model-row"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              marginTop: "6px",
              paddingTop: "6px",
            }}
          >
            <div
              className="model-name"
              style={{ color: "var(--accent-cyan)", fontWeight: 700 }}
            >
              DEB
            </div>
            <div className="model-bar-track">
              <div
                className="model-bar-fill deb"
                style={{
                  width: `${((Number(view.deb) - minValue) / range) * 100}%`,
                }}
              />
              <span className="model-bar-value deb">
                {Number(view.deb)}
                {detail.temp_symbol}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function ForecastTable() {
  const store = useDashboardStore();
  const { data } = useCityData();
  const { locale, t } = useI18n();
  if (!data) return null;

  const daily = data.forecast?.daily || [];
  const isSparseDaily = daily.length <= 1;
  const isForecastCompleting =
    store.loadingState.cityDetail &&
    (data.detail_depth !== "full" || isSparseDaily);
  const resolveForecastTemp = (date: string, fallback: number | null | undefined) => {
    const debPrediction = data.multi_model_daily?.[date]?.deb?.prediction;
    return debPrediction ?? fallback ?? null;
  };
  return (
    <section className="forecast-section">
      <h3>{t("forecast.title")}</h3>
      {isSparseDaily && (
        <div className="forecast-inline-note">
          {isForecastCompleting
            ? locale === "en-US"
              ? "Multi-day forecast is syncing. Only the current-day card has arrived."
              : "多日预报同步中，当前只到达当日卡片。"
            : locale === "en-US"
              ? "Only the current-day forecast is available right now."
              : "当前只收到当日预报，其他日期结果暂未回传。"}
        </div>
      )}
      <div className="forecast-table">
        {daily.length === 0 ? (
          <EmptyState text={t("forecast.empty")} />
        ) : (
          daily.map((day, index) => {
            const isToday = day.date === data.local_date || index === 0;
            const isSelected =
              (isToday &&
                store.forecastModalMode === "today" &&
                Boolean(store.futureModalDate)) ||
              (store.forecastModalMode !== "today" &&
                store.futureModalDate === day.date) ||
              store.selectedForecastDate === day.date;
            return (
              <button
                key={day.date}
                type="button"
                className={clsx(
                  "forecast-day",
                  isToday && "today",
                  isSelected && "selected",
                )}
                onClick={() => {
                  startTransition(() => {
                    if (isToday) {
                      store.openTodayModal();
                      return;
                    }
                    store.openFutureModal(day.date);
                  });
                }}
              >
                <div className="f-date">
                  {isToday
                    ? t("forecast.today")
                    : day.date.substring(5).replace("-", "/")}
                </div>
                <div className="f-temp">
                  {resolveForecastTemp(day.date, day.max_temp)}
                  {data.temp_symbol}
                </div>
              </button>
            );
          }).concat(
            isForecastCompleting
              ? Array.from({ length: Math.max(0, 5 - daily.length) }).map((_, index) => (
                  <button
                    key={`forecast-sync-${index}`}
                    type="button"
                    className="forecast-day forecast-day-sync"
                    disabled
                  >
                    <div className="f-date">
                      {locale === "en-US" ? "Syncing" : "同步中"}
                    </div>
                    <div className="f-temp">--</div>
                  </button>
                ))
              : [],
          )
        )}
      </div>
    </section>
  );
}

export function RiskInfo() {
  const { data } = useCityData();
  const { t } = useI18n();
  if (!data) return null;
  const risk = data.risk || {};

  return (
    <section className="risk-section">
      <h3>{t("section.risk")}</h3>
      <div className="risk-info">
        {!risk.airport ? (
          <span style={{ color: "var(--text-muted)" }}>
            {t("section.noRiskProfile")}
          </span>
        ) : (
          <>
            <div className="risk-row">
              <span className="risk-label">{t("section.airport")}</span>
              <span>
                {risk.airport} ({risk.icao})
              </span>
            </div>
            <div className="risk-row">
              <span className="risk-label">{t("section.distance")}</span>
              <span>{risk.distance_km}km</span>
            </div>
            {risk.warning && (
              <div className="risk-row">
                <span className="risk-label">{t("section.note")}</span>
                <span>{risk.warning}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
