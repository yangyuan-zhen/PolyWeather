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

function getMarketBucketTemp(scan?: MarketScan | null) {
  if (!scan) return null;

  if (scan.temperature_bucket?.value != null) {
    const byBucketValue = Number(scan.temperature_bucket.value);
    if (Number.isFinite(byBucketValue)) return byBucketValue;
  }

  const byBucketLabel = parseTempFromText(
    scan.temperature_bucket?.label ||
      scan.temperature_bucket?.bucket ||
      scan.temperature_bucket?.range,
  );
  if (byBucketLabel != null) return byBucketLabel;

  const slug = String(scan.selected_slug || scan.primary_market?.slug || "");
  const slugMatch = slug.match(/-(-?\d+(?:\.\d+)?)c(?:$|[^a-z0-9])/i);
  if (slugMatch) {
    const numeric = Number(slugMatch[1]);
    if (Number.isFinite(numeric)) return numeric;
  }

  return parseTempFromText(scan.primary_market?.question);
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

function getMarketNoPrice(scan?: MarketScan | null) {
  if (scan?.no_buy != null) {
    const direct = Number(scan.no_buy);
    if (Number.isFinite(direct)) return direct;
  }
  const marketYes = getMarketYesPrice(scan);
  if (marketYes != null) return Math.max(0, Math.min(1, 1 - marketYes));
  return null;
}

function normalizeMarketProbability(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100));
  return Math.max(0, Math.min(1, numeric));
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
            {current.temp != null
              ? `${current.temp}${data.temp_symbol} @${current.obs_time || "--"}`
              : "--"}
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
  const marketBucketTemp = getMarketBucketTemp(marketScan);
  const marketYesPrice = getMarketYesPrice(marketScan);
  const marketNoPrice = getMarketNoPrice(marketScan);
  const marketYesText = toPercent(marketYesPrice);
  const marketNoText = toPercent(marketNoPrice);
  const isToday = !targetDate || targetDate === detail.local_date;
  const marketTopBuckets = isToday ? getMarketTopBuckets(marketScan) : [];
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

  return (
    <section className="prob-section">
      {!hideTitle && <h3>{t("section.probability")}</h3>}
      <div className="prob-bars">
        {view.mu != null && (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              marginBottom: "6px",
            }}
          >
            {t("section.mu", {
              unit: detail.temp_symbol || "",
              value: view.mu.toFixed(1),
            })}
          </div>
        )}
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
                ? `Market top-4 buckets (top): ${topMarketBucketText}`
                : `市场概率（前4温度桶）：最高 ${topMarketBucketText}`
              : locale === "en-US"
                ? `Market probability (this bucket): ${marketYesText}`
                : `市场概率（该温度桶）: ${marketYesText}`}
          </div>
        )}
        {useMarketTopBuckets ? (
          sortedMarketTopBuckets.map((bucket, index) => {
            const probability = Math.round(
              Number(bucket.probability || 0) * 100,
            );
            let bucketLabel =
              bucket.label ||
              (bucket.value != null
                ? `${bucket.value}${detail.temp_symbol}`
                : `${bucket.temp ?? "--"}${detail.temp_symbol}`);

            if (bucketLabel) {
              let str = String(bucketLabel).toUpperCase().replace(/\s+/g, "");
              str = str.replace(/°?C($|\+|-)/g, "℃$1");
              if (!str.includes("℃") && /[0-9]/.test(str)) {
                str += "℃";
              }
              bucketLabel = str;
            }
            const buyYesText = toPriceCents(
              bucket.yes_buy ?? bucket.market_price ?? bucket.probability,
            );
            const buyNoText = toPriceCents(bucket.no_buy);
            const marketTag = buyYesText
              ? locale === "en-US"
                ? `Market ref: ${buyYesText}`
                : `市场参考: ${buyYesText}`
              : buyNoText
                ? locale === "en-US"
                  ? `Market hedge: ${buyNoText}`
                  : `市场反向: ${buyNoText}`
                : null;

            return (
              <div
                key={`${bucket.slug || bucket.label || index}`}
                className="prob-row"
              >
                <div className="prob-label">{bucketLabel}</div>
                <div className="prob-bar-track">
                  <div
                    className={clsx("prob-bar-fill", `rank-${index}`)}
                    style={{ width: `${Math.max(probability, 8)}%` }}
                  >
                    {probability}%
                  </div>
                </div>
                {marketTag && (
                  <div className={clsx("prob-market-inline", "yes")}>
                    {marketTag}
                  </div>
                )}
              </div>
            );
          })
        ) : view.probabilities.length === 0 ? (
          <EmptyState text={t("section.noProb")} />
        ) : (
          view.probabilities.slice(0, 6).map((bucket, index) => {
            const probability = Math.round(
              Number(bucket.probability || 0) * 100,
            );
            const bucketTemp = getBucketTemp(bucket);
            const isMarketBucket =
              marketYesText != null &&
              marketBucketTemp != null &&
              bucketTemp != null &&
              Math.abs(bucketTemp - marketBucketTemp) < 0.26;
            const marketTag = isMarketBucket
              ? locale === "en-US"
                ? `Market ref: ${marketYesText || "--"}`
                : `市场参考: ${marketYesText || "--"}`
              : marketNoText
                ? locale === "en-US"
                  ? `Market hedge: ${marketNoText}`
                  : `市场反向: ${marketNoText}`
                : null;
            const yesPriceText = toPriceCents(marketYesPrice);
            const noPriceText = toPriceCents(marketNoPrice);
            const marketTagFinal = isMarketBucket
              ? locale === "en-US"
                ? `Market ref: ${yesPriceText || "--"}`
                : `市场参考: ${yesPriceText || "--"}`
              : noPriceText
                ? locale === "en-US"
                  ? `Market hedge: ${noPriceText}`
                  : `市场反向: ${noPriceText}`
                : marketTag;
            let bucketLabel =
              bucket.label || `${bucket.value}${detail.temp_symbol}`;
            if (bucketLabel) {
              let str = String(bucketLabel).toUpperCase().replace(/\s+/g, "");
              str = str.replace(/°?C($|\+|-)/g, "℃$1");
              if (!str.includes("℃") && /[0-9]/.test(str)) {
                str += "℃";
              }
              bucketLabel = str;
            }

            return (
              <div
                key={`${bucket.label || bucket.value || index}`}
                className="prob-row"
              >
                <div className="prob-label">{bucketLabel}</div>
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
                      isMarketBucket ? "yes" : "no",
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

  return (
    <section className="models-section">
      {!hideTitle && <h3>{t("section.models")}</h3>}
      <div className="model-bars">
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
        {modelEntries
          .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
          .map(([name, value]) => {
            const numeric = Number(value);
            const width = ((numeric - minValue) / range) * 100;
            const debLine =
              view.deb != null
                ? ((Number(view.deb) - minValue) / range) * 100
                : null;

            return (
              <div key={name} className="model-row">
                <div className="model-name" title={name}>
                  {name}
                </div>
                <div className="model-bar-track">
                  <div
                    className="model-bar-fill"
                    style={{ width: `${width}%` }}
                  >
                    {numeric}
                    {detail.temp_symbol}
                  </div>
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
              >
                {Number(view.deb)}
                {detail.temp_symbol}
              </div>
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
  const { t } = useI18n();
  if (!data) return null;

  const daily = data.forecast?.daily || [];
  const isSparseDaily = daily.length <= 1;
  const resolveForecastTemp = (date: string, fallback: number | null | undefined) => {
    const debPrediction = data.multi_model_daily?.[date]?.deb?.prediction;
    return debPrediction ?? fallback ?? null;
  };
  return (
    <section className="forecast-section">
      <h3>{t("forecast.title")}</h3>
      {isSparseDaily && (
        <div
          className="forecast-inline-note"
          style={{
            color: "var(--text-secondary)",
            fontSize: "12px",
            marginBottom: "10px",
          }}
        >
          {store.loadingState.cityDetail
            ? "多日预报同步中，正在刷新完整日序列。"
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
              store.futureModalDate === day.date ||
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
          })
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
