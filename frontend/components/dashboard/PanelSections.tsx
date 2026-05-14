"use client";

function getTempExtremeClass(temp: number | null | undefined, symbol?: string | null) {
  if (temp == null || !Number.isFinite(temp)) return "";
  const isF = String(symbol || "").toUpperCase().includes("F");
  if (isF ? temp >= 104 : temp >= 40) return "temp-extreme-hot";
  if (isF ? temp <= 23 : temp <= -5) return "temp-extreme-cold";
  return "";
}

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import { startTransition, useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import {
  useCityData,
  useCityDetails,
  useDashboardModal,
} from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { CityDetail } from "@/lib/dashboard-types";
import { getTemperatureChartData } from "@/lib/chart-utils";
import {
  normalizeObservationSourceCode,
  normalizeObservationSourceLabel,
} from "@/lib/source-labels";
import {
  getHeroMetaItems,
  getRiskBadgeLabel,
  getWeatherSummary,
} from "@/lib/weather-summary-utils";

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{text}</div>
  );
}

export function HeroSummary() {
  const { data } = useCityData();
  const { locale } = useI18n();
  if (!data) return null;

  const { weatherIcon, weatherText } = getWeatherSummary(data, locale);
  const metaItems = getHeroMetaItems(data, locale);
  const current = data.current || {};
  const settlementSourceCode = normalizeObservationSourceCode(
    current.settlement_source || "metar",
  );
  const settlementIcao = String(current.station_code || data.risk?.icao || "")
    .trim()
    .toUpperCase();
  const settlementSource =
    settlementSourceCode === "metar" && settlementIcao
      ? `${settlementIcao} METAR`
      : normalizeObservationSourceLabel(
          current.settlement_source_label || current.settlement_source,
          "METAR",
        ).toUpperCase();
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
      <div className={`hero-temp ${getTempExtremeClass(current.temp, data.temp_symbol)}`}>
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
          <span className="value">{currentObsText}</span>
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
        backgroundColor: "rgba(77, 163, 255, 0.06)",
        borderColor: "rgba(77, 163, 255, 0.66)",
        borderWidth: 1.5,
        data: chartData.datasets.debPast,
        fill: true,
        label: locale === "en-US" ? "DEB Forecast" : "DEB 预报",
        pointHoverRadius: 3,
        pointRadius: 0,
        tension: 0.3,
      });
      datasets.push({
        borderColor: "rgba(77, 163, 255, 0.36)",
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
      backgroundColor: "#4DA3FF",
      borderColor: "#4DA3FF",
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
        borderColor: "rgba(77, 163, 255, 0.22)",
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
            borderColor: "rgba(77, 163, 255, 0.28)",
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
              color: "#6B7A90",
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.04)" },
            max: chartData.max,
            min: chartData.min,
            ticks: {
              callback: (value) =>
                `${Number(value).toFixed(chartData.yTickStep < 1 ? 1 : 0)}${data.temp_symbol || "°C"}`,
              color: "#6B7A90",
              stepSize: chartData.yTickStep,
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

export { ProbabilityDistribution } from "./ProbabilityDistribution";

export { ModelForecast } from "./ModelForecast";

export function ForecastTable() {
  const modal = useDashboardModal();
  const { loadingState } = useCityDetails();
  const { data } = useCityData();
  const { locale, t } = useI18n();
  const daily = useMemo(() => {
    if (!data) return [];
    const rawDaily = Array.isArray(data.forecast?.daily)
      ? data.forecast?.daily || []
      : [];
    const seen = new Set<string>();
    return rawDaily.filter((day) => {
      const date = String(day?.date || "").trim();
      if (!date || seen.has(date)) return false;
      seen.add(date);
      return true;
    });
  }, [data]);
  if (!data) return null;
  const isSparseDaily = daily.length <= 1;
  const isForecastCompleting =
    loadingState.cityDetail &&
    (data.detail_depth !== "full" || isSparseDaily);
  const resolveForecastTemp = (
    date: string,
    fallback: number | null | undefined,
  ) => {
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
          daily
            .map((day, index) => {
              const isToday = data.local_date
                ? day.date === data.local_date
                : index === 0;
              const isSelected =
                (isToday &&
                  modal.forecastModalMode === "today" &&
                  Boolean(modal.futureModalDate)) ||
                (modal.forecastModalMode !== "today" &&
                  modal.futureModalDate === day.date) ||
                modal.selectedForecastDate === day.date;
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
                        modal.openTodayModal();
                        return;
                      }
                      modal.openFutureModal(day.date);
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
            .concat(
              isForecastCompleting
                ? Array.from({ length: Math.max(0, 5 - daily.length) }).map(
                    (_, index) => (
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
                    ),
                  )
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
