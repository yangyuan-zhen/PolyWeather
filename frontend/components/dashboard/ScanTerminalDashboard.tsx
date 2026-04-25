"use client";

import type { ChartConfiguration } from "chart.js";
import clsx from "clsx";
import Link from "next/link";
import {
  BarChart3,
  LogIn,
  X,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Dashboard.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import { DetailPanel as CityDetailPanel } from "@/components/dashboard/DetailPanel";
import { FutureForecastModal } from "@/components/dashboard/FutureForecastModal";
import { MapCanvas } from "@/components/dashboard/MapCanvas";
import { ModelForecast } from "@/components/dashboard/PanelSections";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { useChart } from "@/hooks/useChart";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  ScanOpportunityRow,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import {
  formatTemperatureValue,
  getModelView,
  getTemperatureChartData,
  getTodayPaceView,
  normalizeTemperatureLabel,
} from "@/lib/dashboard-utils";
import {
  getMarketFocus,
  getRowMarketRegion,
  getRowPeakSortValue,
} from "@/lib/scan-market-focus";

type ContentView = "list" | "map" | "calendar";
type ThemeMode = "dark" | "light";
type AiPinnedCity = {
  cityName: string;
  displayName?: string | null;
  addedAt: number;
};

function formatShortDate(value?: string | null, locale = "zh-CN") {
  const text = String(value || "").trim();
  if (!text) return "--";
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return locale === "en-US"
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatCountdownMinutes(value?: number | null, locale = "zh-CN") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const minutes = Math.max(0, Math.round(Math.abs(numeric)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m`;
    if (remains <= 0) return `${hours}h`;
    return `${hours}h ${remains}m`;
  }
  if (hours <= 0) return `${remains} 分钟`;
  if (remains <= 0) return `${hours} 小时`;
  return `${hours} 小时 ${remains} 分钟`;
}

function getPeakWindowLabel(row: ScanOpportunityRow) {
  const direct = String(row.peak_window_label || "").trim();
  if (direct) return direct;
  const start = String(row.peak_window_start || "").trim();
  const end = String(row.peak_window_end || "").trim();
  if (start && end) return `${start}-${end}`;
  return "--";
}

function getPeakCountdownMeta(row: ScanOpportunityRow, locale = "zh-CN") {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const startDelta = Number(row.minutes_until_peak_start);
  const endDelta = Number(row.minutes_until_peak_end);
  const hasStart = Number.isFinite(startDelta);
  const hasEnd = Number.isFinite(endDelta);

  if (phase === "active_peak" || (hasStart && startDelta <= 0 && hasEnd && endDelta >= 0)) {
    return {
      key: "active",
      groupLabel: isEn ? "Peak window now" : "峰值窗口进行中",
      tone: "active",
      sort: 0,
      title: isEn ? "At peak window" : "已进入峰值窗口",
      detail:
        hasEnd && endDelta >= 0
          ? isEn
            ? `${formatCountdownMinutes(endDelta, locale)} left`
            : `剩余 ${formatCountdownMinutes(endDelta, locale)}`
          : getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 180) {
    return {
      key: "next",
      groupLabel: isEn ? "Next 3 hours" : "未来 3 小时到峰值",
      tone: "next",
      sort: 1000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 1440) {
    return {
      key: "today",
      groupLabel: isEn ? "Later today" : "今日稍后",
      tone: "upcoming",
      sort: 2000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 1440) {
    return {
      key: "later",
      groupLabel: isEn ? "Later sessions" : "后续交易时段",
      tone: "later",
      sort: 3000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  return {
    key: "past",
    groupLabel: isEn ? "Past peak" : "峰值已过",
    tone: "past",
    sort: 9000 + Math.abs(startDelta || 0),
    title:
      hasEnd && endDelta < 0
        ? isEn
          ? `Peak passed ${formatCountdownMinutes(endDelta, locale)} ago`
          : `峰值已过 ${formatCountdownMinutes(endDelta, locale)}`
        : isEn
          ? "Peak window passed"
          : "峰值窗口已过",
    detail: getPeakWindowLabel(row),
  };
}

function formatUserLocalTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

function getLocalDateIndex(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function getPhaseUrgency(row: ScanOpportunityRow) {
  const phase = String(row.window_phase || "").toLowerCase();
  if (phase === "active_peak") return 0;
  if (phase === "setup_today") return 1;
  if (phase === "post_peak") return 2;
  if (phase === "early_today") return 3;
  if (phase === "tomorrow") return 4;
  if (phase === "week_ahead") return 5;
  return 6;
}

function sortRowsByUserTime(rows: ScanOpportunityRow[]) {
  const focus = getMarketFocus(rows);
  return [...rows].sort((left, right) => {
    if (focus) {
      const leftFocusRank = getRowMarketRegion(left) === focus.key ? 0 : 1;
      const rightFocusRank = getRowMarketRegion(right) === focus.key ? 0 : 1;
      if (leftFocusRank !== rightFocusRank) return leftFocusRank - rightFocusRank;
    }

    const leftPeakSort = getRowPeakSortValue(left);
    const rightPeakSort = getRowPeakSortValue(right);
    if (leftPeakSort.stage.rank !== rightPeakSort.stage.rank) {
      return leftPeakSort.stage.rank - rightPeakSort.stage.rank;
    }
    if (leftPeakSort.countdown !== rightPeakSort.countdown) {
      return leftPeakSort.countdown - rightPeakSort.countdown;
    }

    const leftDateIndex = getLocalDateIndex(left.selected_date || left.local_date);
    const rightDateIndex = getLocalDateIndex(right.selected_date || right.local_date);
    if (leftDateIndex !== rightDateIndex) return leftDateIndex - rightDateIndex;

    const leftRemaining = Number.isFinite(Number(left.remaining_window_minutes))
      ? Number(left.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    const rightRemaining = Number.isFinite(Number(right.remaining_window_minutes))
      ? Number(right.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

    const leftPhase = getPhaseUrgency(left);
    const rightPhase = getPhaseUrgency(right);
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;

    const scoreDelta = Number(right.final_score || 0) - Number(left.final_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(right.edge_percent || 0) - Number(left.edge_percent || 0);
  });
}

function normalizeCityKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function prettifyCityName(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function rowMatchesCity(row: ScanOpportunityRow, cityName: string) {
  const cityKey = normalizeCityKey(cityName);
  if (!cityKey) return false;
  return [row.city, row.city_display_name, row.display_name].some(
    (value) => normalizeCityKey(value) === cityKey,
  );
}

function findRowForCity(rows: ScanOpportunityRow[], cityName?: string | null) {
  const normalized = normalizeCityKey(cityName);
  if (!normalized) return null;
  return rows.find((row) => rowMatchesCity(row, cityName || "")) || null;
}

function CalendarView({
  rows,
  locale,
  selectedRowId,
  onSelectRow,
}: {
  rows: ScanOpportunityRow[];
  locale: string;
  selectedRowId: string | null;
  onSelectRow: (row: ScanOpportunityRow) => void;
}) {
  const groups = useMemo(() => {
    const order = ["active", "next", "today", "later", "past"];
    const byPhase = new Map<
      string,
      {
        label: string;
        sort: number;
        items: Array<{ row: ScanOpportunityRow; meta: ReturnType<typeof getPeakCountdownMeta> }>;
      }
    >();
    rows.forEach((row) => {
      const meta = getPeakCountdownMeta(row, locale);
      const current = byPhase.get(meta.key) || {
        label: meta.groupLabel,
        sort: order.indexOf(meta.key) >= 0 ? order.indexOf(meta.key) : order.length,
        items: [],
      };
      current.items.push({ row, meta });
      byPhase.set(meta.key, current);
    });
    return Array.from(byPhase.entries())
      .sort(([, left], [, right]) => left.sort - right.sort)
      .map(([key, group]) => ({
        key,
        label: group.label,
        items: group.items.sort((left, right) => {
          if (left.meta.sort !== right.meta.sort) return left.meta.sort - right.meta.sort;
          return Number(right.row.edge_percent || 0) - Number(left.row.edge_percent || 0);
        }),
      }));
  }, [locale, rows]);

  if (!groups.length) {
    return (
      <div className="scan-empty-state compact">
        <div className="scan-empty-title">
          {locale === "en-US" ? "No dated opportunities" : "当前没有日期机会"}
        </div>
      </div>
    );
  }

  return (
    <div className="scan-calendar-view">
      {groups.map((group) => (
        <section key={group.key} className="scan-calendar-group">
          <div className="scan-calendar-group-head">
            <div>
              <div className="scan-calendar-date">{group.label}</div>
              <div className="scan-calendar-subtitle">
                {locale === "en-US"
                  ? "Ordered by DEB peak-window countdown"
                  : "按 DEB 峰值窗口倒计时排序"}
              </div>
            </div>
            <div className="scan-calendar-count">
              {locale === "en-US" ? `${group.items.length} rows` : `${group.items.length} 条`}
            </div>
          </div>
          <div className="scan-calendar-grid">
            {group.items.map(({ row, meta }) => (
              <button
                key={row.id}
                type="button"
                className={`scan-calendar-card peak-${meta.tone} ${selectedRowId === row.id ? "selected" : ""}`}
                onClick={() => onSelectRow(row)}
              >
                {(() => {
                  const tempSymbol = row.temp_symbol || "°C";
                  const phaseMeta = getWindowPhaseMeta(row, locale);
                  return (
                    <>
                <div className="scan-calendar-city">
                  {getLocalizedCityName(
                    row.city,
                    row.city_display_name || row.display_name || row.city,
                    locale,
                  )}
                </div>
                <div className="scan-calendar-countdown">
                  {meta.title}
                  <small>{meta.detail}</small>
                </div>
                <div className="scan-calendar-action">
                  <span>{locale === "en-US" ? "DEB high" : "DEB 预测高点"}</span>
                  <b>
                    {row.deb_prediction != null
                      ? formatTemperatureValue(row.deb_prediction, tempSymbol)
                      : "--"}
                  </b>
                </div>
                <div className="scan-calendar-meta">
                  <span>
                    {formatShortDate(row.selected_date || row.local_date, locale)} · {row.local_time || "--"}
                  </span>
                  <span>{phaseMeta.label}</span>
                </div>
                    </>
                  );
                })()}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function findDetailForCity(
  detailsByName: Record<string, CityDetail>,
  cityName?: string | null,
) {
  const target = normalizeCityKey(cityName);
  if (!target) return null;
  return (
    Object.values(detailsByName).find((detail) =>
      [detail?.name, detail?.display_name].some(
        (value) => normalizeCityKey(value) === target,
      ),
    ) || null
  );
}

function AiCityTemperatureChart({ detail }: { detail: CityDetail }) {
  const { locale } = useI18n();
  const chartData = useMemo(
    () => getTemperatureChartData(detail, locale),
    [detail, locale],
  );
  const forecastLabel = chartData?.datasets.hasMgmHourly
    ? locale === "en-US"
      ? "MGM forecast"
      : "MGM 预测"
    : locale === "en-US"
      ? "DEB forecast"
      : "DEB 预测";
  const observationLabel =
    chartData?.observationLabel ||
    (locale === "en-US" ? "METAR obs" : "METAR 实况");
  const canvasRef = useChart(() => {
    if (!chartData) {
      return {
        data: { datasets: [], labels: [] },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    }
    const forecastPoints = chartData.datasets.hasMgmHourly
      ? chartData.datasets.mgmHourlyPoints
      : chartData.datasets.debPast.map(
          (value, index) => value ?? chartData.datasets.debFuture[index],
        );
    return {
      data: {
        datasets: [
          {
            borderColor: "#4DA3FF",
            borderWidth: 2,
            data: forecastPoints,
            fill: false,
            label: forecastLabel,
            pointRadius: 0,
            spanGaps: true,
            tension: 0.32,
          },
          {
            backgroundColor: "#22C55E",
            borderColor: "#22C55E",
            borderWidth: 0,
            data: chartData.datasets.metarPoints,
            fill: false,
            label: observationLabel,
            pointHoverRadius: 5,
            pointRadius: 3.5,
            showLine: false,
          },
        ],
        labels: chartData.times,
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        layout: { padding: { bottom: 2, left: 0, right: 8, top: 8 } },
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(11, 18, 32, 0.96)",
            borderColor: "rgba(77, 163, 255, 0.38)",
            borderWidth: 1,
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { color: "rgba(159, 178, 199, 0.08)" },
            ticks: {
              callback: (_value, index) =>
                typeof index === "number" && index % 4 === 0
                  ? chartData.times[index]
                  : "",
              color: "#6B7A90",
              font: { size: 10 },
              maxTicksLimit: 6,
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(159, 178, 199, 0.08)" },
            max: chartData.max,
            min: chartData.min,
            ticks: {
              callback: (value) =>
                `${Number(value).toFixed(chartData.yTickStep < 1 ? 1 : 0)}${detail.temp_symbol || "°C"}`,
              color: "#6B7A90",
              font: { size: 10 },
              maxTicksLimit: 5,
              stepSize: chartData.yTickStep,
            },
          },
        },
      },
      type: "line",
    } satisfies ChartConfiguration<"line">;
  }, [chartData, detail.temp_symbol, forecastLabel, observationLabel]);

  return (
    <section className="scan-ai-city-section chart">
      <div className="scan-ai-city-section-title">
        <BarChart3 size={15} />
        <span>{locale === "en-US" ? "Intraday path" : "今日日内分析"}</span>
      </div>
      <div className="scan-ai-city-chart">
        <canvas ref={canvasRef} />
      </div>
      {chartData ? (
        <div className="scan-ai-city-chart-legend">
          <span><i className="forecast" />{forecastLabel}</span>
          <span><i className="observation" />{observationLabel}</span>
        </div>
      ) : null}
    </section>
  );
}

function AiPinnedCityCard({
  item,
  detail,
  row,
  locale,
  onRemove,
}: {
  item: AiPinnedCity;
  detail: CityDetail | null;
  row: ScanOpportunityRow | null;
  locale: string;
  onRemove: () => void;
}) {
  const isEn = locale === "en-US";
  const displayName =
    detail?.display_name ||
    row?.city_display_name ||
    row?.display_name ||
    item.displayName ||
    item.cityName;
  const tempSymbol = detail?.temp_symbol || row?.temp_symbol || "°C";
  const modelView = detail ? getModelView(detail, detail.local_date) : null;
  const modelValues = modelView
    ? Object.values(modelView.models || {})
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    : [];
  const modelMin = modelValues.length ? Math.min(...modelValues) : null;
  const modelMax = modelValues.length ? Math.max(...modelValues) : null;
  const paceView = detail ? getTodayPaceView(detail, locale as "zh-CN" | "en-US") : null;
  const peakWindow =
    paceView?.peakWindowText ||
    (row ? getPeakWindowLabel(row) : null) ||
    "--";
  const deb = detail?.deb?.prediction ?? row?.deb_prediction ?? null;
  const currentTemp =
    detail?.airport_primary?.temp ??
    detail?.airport_current?.temp ??
    detail?.current?.temp ??
    row?.current_temp ??
    null;
  const modelRange =
    modelMin != null && modelMax != null
      ? `${formatTemperatureValue(modelMin, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(modelMax, tempSymbol, { digits: 1 })}`
      : "--";
  const paceTone = paceView?.biasTone || "neutral";
  const paceText =
    paceView?.summary ||
    (isEn
      ? "Waiting for intraday observations to compare against the DEB path."
      : "等待更多日内实测，用来对照 DEB 预测路径。");
  const report = detail?.current?.raw_metar || detail?.airport_current?.raw_metar || "";
  const weatherLine =
    detail?.current?.wx_desc ||
    detail?.airport_current?.wx_desc ||
    detail?.airport_primary?.wx_desc ||
    "";

  return (
    <article className="scan-ai-city-card">
      <header className="scan-ai-city-hero">
        <div>
          <span className="scan-ai-city-kicker">
            {isEn ? "AI city forecast" : "AI 城市预测"}
          </span>
          <h3>{displayName}</h3>
          <div className="scan-ai-city-pills">
            <span>{detail?.local_time || row?.local_time || "--"}</span>
            <span>
              DEB{" "}
              {deb != null
                ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
                : "--"}
            </span>
            <span>{isEn ? "Model" : "模型"} {modelRange}</span>
            <span>{isEn ? "Peak" : "峰值"} {peakWindow}</span>
          </div>
        </div>
        <div className="scan-ai-city-hero-side">
          <span>{isEn ? "Expected high" : "预计最高温"}</span>
          <strong>
            {paceView?.paceAdjustedHigh != null
              ? formatTemperatureValue(paceView.paceAdjustedHigh, tempSymbol, { digits: 1 })
              : deb != null
                ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
                : "--"}
          </strong>
          <button type="button" className="scan-ai-city-remove" onClick={onRemove}>
            <X size={14} />
            {isEn ? "Unpin" : "取消固定"}
          </button>
        </div>
      </header>

      {detail ? (
        <div className="scan-ai-city-body">
          <section className={clsx("scan-ai-decision-band", paceTone)}>
            <div>
              <span>{isEn ? "Final read" : "最终判断"}</span>
              <strong>
                {paceTone === "warm"
                  ? isEn
                    ? "Running above DEB path"
                    : "实测高于 DEB 路径"
                  : paceTone === "cold"
                    ? isEn
                      ? "Running below DEB path"
                      : "实测低于 DEB 路径"
                    : isEn
                      ? "Tracking DEB path"
                      : "基本贴合 DEB 路径"}
              </strong>
              <p>{paceText}</p>
            </div>
            <div className="scan-ai-decision-metrics">
              <span>
                {isEn ? "Observed" : "实测"}{" "}
                <b>
                  {currentTemp != null
                    ? formatTemperatureValue(currentTemp, tempSymbol, { digits: 1 })
                    : "--"}
                </b>
              </span>
              <span>
                {isEn ? "Path delta" : "路径偏差"} <b>{paceView?.deltaText || "--"}</b>
              </span>
              <span>
                {isEn ? "Model support" : "模型支持"} <b>{modelValues.length}</b>
              </span>
            </div>
          </section>

          <div className="scan-ai-city-analysis-grid">
            <AiCityTemperatureChart detail={detail} />
            <section className="scan-ai-city-section">
              <div className="scan-ai-city-section-title">
                {isEn ? "Airport / climate read" : "机场报文与天气解读"}
              </div>
              <p>{weatherLine || (isEn ? "No weather text decoded yet." : "暂无天气文本解读。")}</p>
              <p>
                {report
                  ? `${detail.risk?.icao || detail.current?.station_code || ""} ${report}`.trim()
                  : isEn
                    ? "No raw METAR available."
                    : "暂无原始 METAR 报文。"}
              </p>
              <p>{paceView?.kicker || ""}</p>
            </section>
          </div>

          <section className="scan-ai-city-section models">
            <div className="scan-ai-city-section-title">
              {isEn ? "Multi-model support" : "多模型支撑"}
            </div>
            <ModelForecast detail={detail} targetDate={detail.local_date} hideTitle />
          </section>

        </div>
      ) : (
        <div className="scan-ai-city-loading">
          {isEn ? "Loading today analysis for this city..." : "正在加载该城市的今日日内分析..."}
        </div>
      )}
    </article>
  );
}

function AiPinnedForecastView({
  items,
  rows,
  detailsByName,
  locale,
  onRemoveCity,
}: {
  items: AiPinnedCity[];
  rows: ScanOpportunityRow[];
  detailsByName: Record<string, CityDetail>;
  locale: string;
  onRemoveCity: (cityName: string) => void;
}) {
  const isEn = locale === "en-US";
  if (!items.length) {
    return (
      <div className="scan-ai-workspace empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "Click a city on the map" : "从分布视图点击城市"}
          </div>
          <div className="scan-empty-copy">
            {isEn
              ? "Selected cities will appear here as pinned AI forecast blocks."
              : "被点击的城市会加入 AI 预测页，并保留为可固定的城市分析区块。"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-ai-workspace">
      <div className="scan-ai-workspace-head">
        <div>
          <span>{isEn ? "Pinned city workspace" : "固定城市工作区"}</span>
          <strong>
            {isEn
              ? `${items.length} cities under AI forecast`
              : `${items.length} 个城市正在 AI 预测`}
          </strong>
        </div>
        <p>
          {isEn
            ? "Map clicks add cities here. Pinned city analysis stays here until you remove it."
            : "地图点击会把城市加入这里；已固定的城市分析会保留，直到你手动移除。"}
        </p>
      </div>
      <div className="scan-ai-city-stack">
        {items.map((item) => {
          const detail = findDetailForCity(detailsByName, item.cityName);
          const row = findRowForCity(rows, item.cityName);
          const key = normalizeCityKey(item.cityName);
          return (
            <AiPinnedCityCard
              key={key || item.cityName}
              item={item}
              detail={detail}
              row={row}
              locale={locale}
              onRemove={() => onRemoveCity(item.cityName)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AiForecastKPIBar({
  pinnedCount,
  activeCityName,
  activeDetail,
  activeRow,
  locale,
}: {
  pinnedCount: number;
  activeCityName?: string | null;
  activeDetail?: CityDetail | null;
  activeRow?: ScanOpportunityRow | null;
  locale: string;
}) {
  const isEn = locale === "en-US";
  const tempSymbol = activeDetail?.temp_symbol || activeRow?.temp_symbol || "°C";
  const displayName =
    activeDetail?.display_name ||
    activeRow?.city_display_name ||
    activeRow?.display_name ||
    activeCityName ||
    "--";
  const deb = activeDetail?.deb?.prediction ?? activeRow?.deb_prediction ?? null;
  const paceView = activeDetail
    ? getTodayPaceView(activeDetail, locale as "zh-CN" | "en-US")
    : null;
  const peakWindow =
    paceView?.peakWindowText ||
    (activeRow ? getPeakWindowLabel(activeRow) : null) ||
    "--";
  const cards = [
    {
      label: isEn ? "AI Workspace" : "AI 工作区",
      value: String(pinnedCount),
      note: isEn ? "Pinned cities from map clicks" : "地图点选后固定到 AI 预测",
      tone: "green",
    },
    {
      label: isEn ? "Current City" : "当前城市",
      value: displayName,
      note: isEn ? "City briefing stays in the right rail" : "右侧城市简报同步显示，不自动切页",
      tone: "blue",
    },
    {
      label: isEn ? "Forecast Center" : "预测中枢",
      value:
        deb != null
          ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
          : "--",
      note: isEn ? "DEB final blended forecast" : "DEB 最终融合预测，不含市场价格",
      tone: "cyan",
    },
    {
      label: isEn ? "Peak Window" : "峰值窗口",
      value: peakWindow,
      note: isEn ? "Key window for daily high judgment" : "用于判断是否接近今日最高温",
      tone: "amber",
    },
  ];

  return (
    <section className="scan-kpi-bar">
      {cards.map((card) => (
        <article key={card.label} className={`scan-kpi-card ${card.tone}`}>
          <div className="scan-kpi-label">{card.label}</div>
          <div className="scan-kpi-value">{card.value}</div>
          <div className="scan-kpi-note">{card.note}</div>
        </article>
      ))}
    </section>
  );
}

function ScanTerminalScreen() {
  const store = useDashboardStore();
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const isPro = store.proAccess.subscriptionActive;
  const accountHref = store.proAccess.authenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const [terminalData] = useState<ScanTerminalResponse | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ContentView>("map");
  const [mapSelectedCityName, setMapSelectedCityName] = useState<string | null>(null);
  const [aiPinnedCities, setAiPinnedCities] = useState<AiPinnedCity[]>([]);
  const [showScanPaywall, setShowScanPaywall] = useState(false);
  const [userLocalTime, setUserLocalTime] = useState("--");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const lastMapSelectedCityRef = useRef<string>("");

  const timeSortedRows = useMemo(
    () => sortRowsByUserTime(terminalData?.rows || []),
    [terminalData?.rows],
  );
  const selectedRow = useMemo(() => {
    if (!timeSortedRows.length) return null;
    return timeSortedRows.find((row) => row.id === selectedRowId) || timeSortedRows[0] || null;
  }, [timeSortedRows, selectedRowId]);

  const mapFocusedRow = useMemo(() => {
    return findRowForCity(
      timeSortedRows,
      mapSelectedCityName || store.selectedCity,
    );
  }, [mapSelectedCityName, store.selectedCity, timeSortedRows]);
  const kpiCityName =
    mapSelectedCityName ||
    store.selectedCity ||
    aiPinnedCities[0]?.cityName ||
    null;
  const kpiDetail =
    findDetailForCity(store.cityDetailsByName, kpiCityName) ||
    (store.selectedDetail &&
    normalizeCityKey(store.selectedDetail.name) === normalizeCityKey(kpiCityName)
      ? store.selectedDetail
      : null);
  const kpiRow = findRowForCity(timeSortedRows, kpiCityName);

  const mapFallbackRow = useMemo(() => {
    const rawCityName = mapSelectedCityName || store.selectedCity;
    const cityKey = normalizeCityKey(rawCityName);
    if (!cityKey || mapFocusedRow) return null;
    const selectedDetail =
      store.selectedDetail && normalizeCityKey(store.selectedDetail.name) === cityKey
        ? store.selectedDetail
        : Object.values(store.cityDetailsByName).find(
            (detail) => normalizeCityKey(detail?.name) === cityKey,
          ) || null;
    const selectedSummary =
      Object.values(store.citySummariesByName).find(
        (summary) => normalizeCityKey(summary?.name) === cityKey,
      ) || null;
    const selectedCityItem =
      store.cities.find(
        (city) =>
          normalizeCityKey(city.name) === cityKey ||
          normalizeCityKey(city.display_name) === cityKey,
      ) || null;
    const canonicalCity =
      selectedDetail?.name ||
      selectedSummary?.name ||
      selectedCityItem?.name ||
      String(rawCityName || "").trim();
    if (!canonicalCity) return null;

    const tempSymbol =
      selectedDetail?.temp_symbol ||
      selectedSummary?.temp_symbol ||
      (selectedCityItem?.temp_unit === "fahrenheit" ? "°F" : "°C");
    const displayName =
      selectedDetail?.display_name ||
      selectedSummary?.display_name ||
      selectedCityItem?.display_name ||
      canonicalCity;
    const currentTemp =
      selectedDetail?.current?.temp ?? selectedSummary?.current?.temp ?? null;

    return {
      id: `map-city:${canonicalCity}`,
      city: canonicalCity,
      city_display_name: displayName,
      display_name: displayName,
      selected_date: selectedDetail?.local_date || null,
      local_date: selectedDetail?.local_date || null,
      local_time: selectedDetail?.local_time || selectedSummary?.local_time || null,
      temp_symbol: tempSymbol,
      current_temp: currentTemp,
      current_max_so_far:
        selectedDetail?.current?.max_so_far ?? currentTemp ?? null,
      deb_prediction:
        selectedDetail?.deb?.prediction ??
        selectedSummary?.deb?.prediction ??
        null,
      airport:
        selectedDetail?.risk?.airport ||
        selectedCityItem?.airport ||
        selectedCityItem?.settlement_station_label ||
        null,
      risk_level:
        selectedDetail?.risk?.level ||
        selectedSummary?.risk?.level ||
        selectedCityItem?.risk_level ||
        "low",
      market_slug: null,
      market_question: isEn ? "City briefing" : "城市简报",
      target_label: isEn ? "City snapshot" : "城市概况",
      side: null,
      edge_percent: null,
      final_score: null,
      window_phase: "city_snapshot",
      tradable: false,
      active: false,
      closed: false,
      accepting_orders: false,
    } satisfies ScanOpportunityRow;
  }, [
    isEn,
    mapFocusedRow,
    mapSelectedCityName,
    store.cityDetailsByName,
    store.citySummariesByName,
    store.cities,
    store.selectedCity,
    store.selectedDetail,
  ]);

  useEffect(() => {
    if (!store.proAccess.loading && !isPro && activeView === "calendar") {
      setActiveView("map");
    }
  }, [activeView, isPro, store.proAccess.loading]);

  useEffect(() => {
    setUserLocalTime(formatUserLocalTime());
    const intervalId = window.setInterval(() => {
      setUserLocalTime(formatUserLocalTime());
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("polyweather_scan_theme");
    if (stored === "light") {
      setThemeMode("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("polyweather_scan_theme", themeMode);
  }, [themeMode]);

  const resolvedView: ContentView = activeView;
  const mapFocusedCity = mapSelectedCityName || store.selectedCity;
  const activeDetailRow =
    resolvedView === "map" && mapFocusedCity
      ? mapFocusedRow || mapFallbackRow
      : selectedRow;
  const scanStatus = terminalData?.status || "ready";
  const staleReason = terminalData?.stale_reason || null;

  useEffect(() => {
    if (!activeDetailRow) return;
    if (!store.cityDetailsByName[activeDetailRow.city]) {
      void store.ensureCityDetail(activeDetailRow.city, false, "panel").catch(() => {});
    }
  }, [activeDetailRow, store.cityDetailsByName, store.ensureCityDetail]);

  const addAiPinnedCity = useCallback((cityName: string) => {
    const cleanName = String(cityName || "").trim();
    const key = normalizeCityKey(cleanName);
    if (!key) return;
    const matchedRow = findRowForCity(timeSortedRows, cleanName);
    const prettyName = prettifyCityName(cleanName);
    const displayName =
      matchedRow?.city_display_name ||
      matchedRow?.display_name ||
      getLocalizedCityName(cleanName, prettyName || cleanName, locale) ||
      prettyName ||
      cleanName;
    setAiPinnedCities((current) => {
      const existing = current.findIndex(
        (item) => normalizeCityKey(item.cityName) === key,
      );
      const nextItem = {
        cityName: matchedRow?.city || cleanName,
        displayName,
        addedAt: Date.now(),
      };
      if (existing >= 0) {
        const next = [...current];
        next[existing] = { ...next[existing], ...nextItem };
        return [
          next[existing],
          ...next.filter((_, index) => index !== existing),
        ];
      }
      return [nextItem, ...current].slice(0, 8);
    });
    void store.ensureCityDetail(cleanName, false, "full").catch(() => {});
  }, [locale, store.ensureCityDetail, timeSortedRows]);

  const removeAiPinnedCity = useCallback((cityName: string) => {
    const key = normalizeCityKey(cityName);
    setAiPinnedCities((current) =>
      current.filter((item) => normalizeCityKey(item.cityName) !== key),
    );
  }, []);

  useEffect(() => {
    aiPinnedCities.forEach((item) => {
      if (!findDetailForCity(store.cityDetailsByName, item.cityName)) {
        void store.ensureCityDetail(item.cityName, false, "full").catch(() => {});
      }
    });
  }, [aiPinnedCities, store.cityDetailsByName, store.ensureCityDetail]);

  const handleMapCitySelect = useCallback((cityName: string) => {
    setMapSelectedCityName(cityName);
    lastMapSelectedCityRef.current = normalizeCityKey(cityName);
    const matchedRow = findRowForCity(timeSortedRows, cityName);
    setSelectedRowId(matchedRow?.id || null);
    addAiPinnedCity(cityName);
  }, [addAiPinnedCity, timeSortedRows]);

  useEffect(() => {
    if (activeView !== "map") return;
    const selectedCity = String(store.selectedCity || "").trim();
    const selectedKey = normalizeCityKey(selectedCity);
    if (!selectedKey || selectedKey === lastMapSelectedCityRef.current) return;
    lastMapSelectedCityRef.current = selectedKey;
    setMapSelectedCityName(selectedCity);
    const matchedRow = findRowForCity(timeSortedRows, selectedCity);
    setSelectedRowId(matchedRow?.id || null);
    addAiPinnedCity(selectedCity);
  }, [activeView, addAiPinnedCity, store.selectedCity, timeSortedRows]);

  const handleSelectRow = useCallback((row: ScanOpportunityRow) => {
    const cityName = row.city || row.city_display_name || row.display_name || "";
    if (!cityName) return;
    setSelectedRowId(row.id);
    const selectedCityKey = normalizeCityKey(store.selectedCity);
    const rowCityKey = normalizeCityKey(cityName);
    const hasCachedDetail =
      Boolean(store.cityDetailsByName[cityName]) ||
      Object.values(store.cityDetailsByName).some((detail) =>
        rowMatchesCity(row, detail?.name || detail?.display_name || ""),
      );
    if (store.isPanelOpen && selectedCityKey === rowCityKey) {
      if (!hasCachedDetail) {
        void store.ensureCityDetail(cityName, false, "panel").catch(() => {});
      }
      return;
    }
    void store.selectCity(cityName);
  }, [store]);

  const openScanPaywall = useCallback(() => {
    setShowScanPaywall(true);
  }, []);

  const renderMainView = () => {
    if (resolvedView === "map") {
      return (
        <div className="scan-map-view">
          <div className="scan-map-shell">
            <MapCanvas
              onCitySelect={handleMapCitySelect}
              selectionMode="select"
            />
          </div>
        </div>
      );
    }
    if (resolvedView === "list") {
      return (
        <AiPinnedForecastView
          items={aiPinnedCities}
          rows={timeSortedRows}
          detailsByName={store.cityDetailsByName}
          locale={locale}
          onRemoveCity={removeAiPinnedCity}
        />
      );
    }
    if (!isPro) {
      return (
        <div className="scan-table-shell empty">
          <div className="scan-empty-state">
            <div className="scan-empty-title">
              {isEn ? "Scan is available on Pro" : "扫描功能需 Pro 权限"}
            </div>
            <div className="scan-empty-copy">
              {isEn
                ? "Distribution view and city briefing remain available."
                : "分布视图和右侧城市简报仍可查看。"}
            </div>
          </div>
        </div>
      );
    }
    if (resolvedView === "calendar") {
      return (
        <CalendarView
          rows={timeSortedRows}
          locale={locale}
          selectedRowId={selectedRowId}
          onSelectRow={handleSelectRow}
        />
      );
    }
    return null;
  };

  if (store.proAccess.loading) {
    return (
      <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
        <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
          <main className="scan-data-grid">
            <div className="scan-empty-state">
              <div className="scan-empty-title">{isEn ? "Checking access" : "正在检查权限"}</div>
              <div className="scan-empty-copy">
                {isEn ? "Preparing your AI forecast workspace." : "正在准备 AI 预测台。"}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.root, detailChromeStyles.root, modalChromeStyles.root)}>
      <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
        <main className="scan-data-grid">
          <div className="scan-topbar">
            <div className="scan-topbar-title">
              <strong>{isEn ? "AI Forecast Terminal" : "AI 预测台"}</strong>
              <span>
                {isEn
                  ? "Click cities on the map to build an AI forecast workspace"
                  : "点击地图城市加入 AI 预测工作区，按城市查看 DEB / 模型 / METAR"}
              </span>
            </div>
            <div className="scan-topbar-actions">
              <button
                type="button"
                className="scan-locale-switch"
                aria-label={isEn ? "Switch to Chinese" : "切换到英文"}
                title={isEn ? "Switch to Chinese" : "切换到英文"}
                onClick={toggleLocale}
              >
                <span className={clsx(locale === "zh-CN" && "active")}>中文</span>
                <span className={clsx(locale === "en-US" && "active")}>EN</span>
              </button>
              <span className="scan-topbar-time">
                {userLocalTime}
              </span>
              {isPro ? null : store.proAccess.authenticated ? (
                <button
                  type="button"
                  className="scan-primary-button"
                  onClick={openScanPaywall}
                >
                  <UserRound size={14} />
                  {isEn ? "Upgrade Pro" : "升级 Pro"}
                </button>
              ) : (
                <Link href={accountHref} className="scan-primary-button">
                  <LogIn size={14} />
                  {isEn ? "Sign in" : "登录"}
                </Link>
              )}
              <button
                type="button"
                className="scan-theme-button"
                aria-label={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                title={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
                onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
              >
                {themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}
              </button>
              {store.proAccess.authenticated ? (
                <Link
                  href={accountHref}
                  className="scan-account-button"
                  aria-label={isEn ? "Account" : "账户"}
                  title={isEn ? "Account" : "账户"}
                >
                  <UserRound size={15} />
                </Link>
              ) : null}
            </div>
          </div>

          <AiForecastKPIBar
            pinnedCount={aiPinnedCities.length}
            activeCityName={kpiCityName}
            activeDetail={kpiDetail}
            activeRow={kpiRow}
            locale={locale}
          />

          <section className="scan-list-section">
            <div className="scan-list-header">
              <div className="scan-list-tabs">
                <button
                  type="button"
                  className={resolvedView === "map" ? "active" : ""}
                  onClick={() => {
                    lastMapSelectedCityRef.current = normalizeCityKey(store.selectedCity);
                    setActiveView("map");
                  }}
                >
                  {isEn ? "Distribution View" : "分布视图"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "list" ? "active" : ""}
                  onClick={() => {
                    setActiveView("list");
                  }}
                >
                  {isEn ? "AI Forecast" : "AI 预测"}
                </button>
                <button
                  type="button"
                  className={resolvedView === "calendar" ? "active" : ""}
                  title={!isPro ? (isEn ? "Pro forecast calendar required" : "日历预测需 Pro") : undefined}
                  onClick={() => {
                    if (!isPro) {
                      openScanPaywall();
                      return;
                    }
                    setActiveView("calendar");
                  }}
                >
                  {isEn ? "Calendar View" : "日历视图"}
                </button>
              </div>
              <div className="scan-list-status">
                {terminalData?.stale ? (
                  <span className="scan-status-chip stale">
                    {isEn ? "Delayed snapshot" : "延迟快照"}
                  </span>
                ) : null}
              </div>
            </div>

            {scanStatus === "failed" && !terminalData ? (
              <div className="scan-empty-state">
                <div className="scan-empty-title">
                  {isEn ? "Scan failed" : "扫描失败"}
                </div>
                <div className="scan-empty-copy">{staleReason}</div>
              </div>
            ) : (
              renderMainView()
            )}
          </section>
        </main>

        <CityDetailPanel variant="rail" />
      </div>
      <FutureForecastModal />
      {showScanPaywall ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? "Unlock market scan" : "解锁市场扫描"}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowScanPaywall(false);
            }
          }}
        >
          <ProFeaturePaywall
            feature="scan"
            onClose={() => setShowScanPaywall(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ScanTerminalDashboard() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <ScanTerminalScreen />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
