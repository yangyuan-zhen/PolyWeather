"use client";

import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  ScanOpportunityRow,
} from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import {
  formatTemperatureValue,
  getModelView,
  getProbabilityView,
  normalizeTemperatureLabel,
  normalizeTemperatureSymbol,
} from "@/lib/dashboard-utils";

type PhaseMeta = {
  label: string;
  tone: "green" | "amber" | "blue" | "red";
};

function formatPercent(value?: number | null, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  return `${signed && numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function normalizeProbability(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function formatWindowMinutes(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m left`;
    return `${hours}h ${remains}m left`;
  }
  if (hours <= 0) return `剩余 ${remains} 分钟`;
  return `剩余 ${hours}h ${remains}m`;
}

function formatMinuteSpan(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m`;
    return `${hours}h ${remains}m`;
  }
  if (hours <= 0) return `${remains} 分钟`;
  return `${hours}h ${remains}m`;
}

function formatAction(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  return formatTradeSide(row, locale, tempSymbol);
}

export function getWindowPhaseMeta(
  row: Pick<ScanOpportunityRow, "window_phase" | "trend_alignment">,
  locale: string,
): PhaseMeta {
  const mode = String(row.window_phase || "").toLowerCase();
  if (mode === "city_snapshot") {
    return {
      label: locale === "en-US" ? "City Snapshot" : "城市概况",
      tone: "blue",
    };
  }
  if (mode === "active_peak") {
    return {
      label: locale === "en-US" ? "Peak Window" : "峰值窗口",
      tone: "red",
    };
  }
  if (mode === "setup_today") {
    return {
      label: locale === "en-US" ? "Touch Play" : "触达博弈",
      tone: "red",
    };
  }
  if (mode === "early_today") {
    return {
      label: locale === "en-US" ? "Early Today" : "日内早段",
      tone: "blue",
    };
  }
  if (mode === "tomorrow" || mode === "week_ahead") {
    return {
      label: locale === "en-US" ? "Early" : "早期机会",
      tone: "blue",
    };
  }
  if (mode === "post_peak") {
    return {
      label: locale === "en-US" ? "Post Peak" : "峰后确认",
      tone: "amber",
    };
  }
  if (row.trend_alignment) {
    return {
      label: locale === "en-US" ? "Trend" : "趋势确认",
      tone: "amber",
    };
  }
  return {
    label: locale === "en-US" ? "Tradable" : "可交易",
    tone: "green",
  };
}

function formatQuoteCents(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const cents = Number(value) * 100;
  const text =
    cents < 1 || cents >= 99 || Math.abs(cents - Math.round(cents)) >= 0.05
      ? cents.toFixed(1)
      : Math.round(cents).toFixed(0);
  return `${text.replace(/\.0$/, "")}¢`;
}

function formatTradeSide(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const side = String(row.side || "").toLowerCase();
  const isEn = locale === "en-US";
  const { lower, upper } = getTargetRange(row);
  const threshold =
    lower != null && upper == null
      ? formatTemperatureValue(lower, tempSymbol)
      : upper != null && lower == null
        ? formatTemperatureValue(upper, tempSymbol)
        : null;
  if (threshold && lower != null && upper == null) {
    if (side === "yes") return isEn ? `High reaches ${threshold}` : `最高温达到 ${threshold}`;
    if (side === "no") return isEn ? `High stays below ${threshold}` : `最高温低于 ${threshold}`;
  }
  if (threshold && upper != null && lower == null) {
    if (side === "yes") return isEn ? `High stays at/below ${threshold}` : `最高温不高于 ${threshold}`;
    if (side === "no") return isEn ? `High exceeds ${threshold}` : `最高温高于 ${threshold}`;
  }
  if (lower != null && upper != null && Math.abs(lower - upper) > 0.01) {
    const range = `${formatTemperatureValue(lower, tempSymbol)} ~ ${formatTemperatureValue(upper, tempSymbol)}`;
    if (side === "yes") return isEn ? `High lands in ${range}` : `最高温落在 ${range}`;
    if (side === "no") return isEn ? `High avoids ${range}` : `最高温不在 ${range}`;
  }
  const bucket = formatThreshold(row, tempSymbol);
  if (side === "yes") return isEn ? `High lands on ${bucket}` : `最高温落在 ${bucket} 桶`;
  if (side === "no") return isEn ? `High avoids ${bucket}` : `最高温不落在 ${bucket} 桶`;
  if (row.action) {
    return normalizeTemperatureLabel(
      String(row.action).replace(String(row.target_label || ""), ""),
      tempSymbol,
    )
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }
  return locale === "en-US" ? "WATCH" : "观察";
}

function formatThreshold(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const targetLabel = normalizeTemperatureLabel(row.target_label, tempSymbol);
  if (targetLabel) return targetLabel;
  if (row.target_lower != null && row.target_upper != null) {
    return `${formatTemperatureValue(Number(row.target_lower), tempSymbol)} ~ ${formatTemperatureValue(Number(row.target_upper), tempSymbol)}`;
  }
  if (row.target_threshold != null) {
    return formatTemperatureValue(Number(row.target_threshold), tempSymbol);
  }
  if (row.target_value != null) {
    return formatTemperatureValue(Number(row.target_value), tempSymbol);
  }
  return "--";
}

function formatTemperatureDelta(value: number, tempSymbol?: string | null) {
  return formatTemperatureValue(Math.abs(value), tempSymbol, { digits: 1 });
}

function getDebDistanceSummary(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  if (deb == null) return locale === "en-US" ? "DEB pending" : "DEB 待确认";
  const { lower, upper } = getTargetRange(row);
  if (lower != null && upper == null) {
    const delta = deb - lower;
    if (Math.abs(delta) < 0.05) return locale === "en-US" ? "DEB on threshold" : "DEB 贴近阈值";
    return delta >= 0
      ? locale === "en-US"
        ? `DEB above by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB below by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  if (upper != null && lower == null) {
    const delta = deb - upper;
    if (Math.abs(delta) < 0.05) return locale === "en-US" ? "DEB on threshold" : "DEB 贴近阈值";
    return delta <= 0
      ? locale === "en-US"
        ? `DEB below by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB above by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于阈值 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  if (lower != null && upper != null) {
    if (deb >= lower && deb <= upper) return locale === "en-US" ? "DEB inside bucket" : "DEB 位于桶内";
    const nearest = deb < lower ? lower : upper;
    const delta = deb - nearest;
    return deb < lower
      ? locale === "en-US"
        ? `DEB below bucket by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 低于桶 ${formatTemperatureDelta(delta, tempSymbol)}`
      : locale === "en-US"
        ? `DEB above bucket by ${formatTemperatureDelta(delta, tempSymbol)}`
        : `DEB 高于桶 ${formatTemperatureDelta(delta, tempSymbol)}`;
  }
  return locale === "en-US"
    ? `DEB ${formatTemperatureValue(deb, tempSymbol, { digits: 1 })}`
    : `DEB ${formatTemperatureValue(deb, tempSymbol, { digits: 1 })}`;
}

function getModelSupportSummary(
  row: ScanOpportunityRow,
  locale: string,
) {
  const sources = Object.values(row.model_cluster_sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  if (!sources.length || deb == null) return locale === "en-US" ? "Models pending" : "模型待确认";
  const { lower, upper } = getTargetRange(row);
  let supports = 0;
  if (lower != null && upper == null) {
    supports = sources.filter((value) => (deb >= lower ? value >= lower : value < lower)).length;
  } else if (upper != null && lower == null) {
    supports = sources.filter((value) => (deb <= upper ? value <= upper : value > upper)).length;
  } else if (lower != null && upper != null) {
    if (deb >= lower && deb <= upper) {
      supports = sources.filter((value) => value >= lower && value <= upper).length;
    } else if (deb < lower) {
      supports = sources.filter((value) => value < lower).length;
    } else {
      supports = sources.filter((value) => value > upper).length;
    }
  } else {
    const tolerance = 1;
    supports = sources.filter((value) => Math.abs(value - deb) <= tolerance).length;
  }
  return locale === "en-US"
    ? `${supports}/${sources.length} models support DEB`
    : `${supports}/${sources.length} 模型支持 DEB`;
}

function getMetarConflictSummary(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
) {
  const obs = getMetarObservationContext(row, detail);
  if (obs.stale || obs.maxTemp == null) return locale === "en-US" ? "METAR pending" : "METAR 待确认";
  const deb =
    row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : null;
  const { lower, upper } = getTargetRange(row);
  if (deb == null || (lower == null && upper == null)) {
    return locale === "en-US" ? "METAR read only" : "METAR 仅参考";
  }
  const phase = String(row.window_phase || "").toLowerCase();
  const peakPending =
    phase === "early_today" ||
    phase === "setup_today" ||
    (row.minutes_until_peak_start != null && Number(row.minutes_until_peak_start) > 0);
  if (lower != null && upper == null) {
    if (deb < lower && obs.maxTemp >= lower) return locale === "en-US" ? "METAR conflicts" : "METAR 冲突";
    if (deb >= lower && obs.maxTemp < lower && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
    return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
  }
  if (upper != null && lower == null) {
    if (deb <= upper && obs.maxTemp > upper) return locale === "en-US" ? "METAR conflicts" : "METAR 冲突";
    if (deb > upper && obs.maxTemp <= upper && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
    return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
  }
  if (lower != null && upper != null && deb >= lower && deb <= upper) {
    if (obs.maxTemp > upper) return locale === "en-US" ? "METAR above bucket" : "METAR 已越过桶";
    if (obs.maxTemp < lower && peakPending) return locale === "en-US" ? "Await peak" : "等待峰值";
  }
  return locale === "en-US" ? "METAR no conflict" : "METAR 未冲突";
}

function getOpportunityStrength(edgePercent?: number | null, locale = "zh-CN") {
  const edge = Number(edgePercent);
  const normalized = Number.isFinite(edge) ? edge : 0;
  if (normalized >= 20) {
    return {
      label: locale === "en-US" ? "High confidence" : "高胜率",
      tone: "strong",
    };
  }
  if (normalized >= 10) {
    return {
      label: locale === "en-US" ? "Medium confidence" : "中等胜率",
      tone: "medium",
    };
  }
  return {
    label: locale === "en-US" ? "Watch" : "观察",
    tone: "watch",
  };
}

function getLocalizedRowText(
  row: ScanOpportunityRow,
  locale: string,
  zh?: string | null,
  en?: string | null,
) {
  return locale === "en-US" ? en || zh || null : zh || en || null;
}

function formatModelSources(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const sources = row.model_cluster_sources || {};
  return Object.entries(sources)
    .filter(([, value]) => value != null && Number.isFinite(Number(value)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      value: formatTemperatureValue(Number(value), tempSymbol, { digits: 1 }),
    }));
}

function formatModelClusterRange(
  sources?: Record<string, number | null> | null,
  tempSymbol?: string | null,
) {
  const values = Object.values(sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return "--";
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (Math.abs(low - high) < 0.05) {
    return formatTemperatureValue(low, tempSymbol, { digits: 1 });
  }
  return `${formatTemperatureValue(low, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(high, tempSymbol, { digits: 1 })}`;
}

function getModelSourceSummary(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const sources = formatModelSources(row, tempSymbol);
  if (!sources.length) {
    return locale === "en-US"
      ? "model cluster pending"
      : "模型集群暂未回传";
  }
  const shown = sources.map((item) => `${item.name} ${item.value}`).join(" / ");
  return locale === "en-US"
    ? `all models: ${shown}`
    : `全部模型：${shown}`;
}

function getShortAiConclusion(
  row: ScanOpportunityRow,
  locale: string,
  _edgePercent?: number | null,
  strengthLabel?: string,
) {
  const directReason =
    getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
    getLocalizedRowText(
      row,
      locale,
      row.ai_watchlist_reason_zh,
      row.ai_watchlist_reason_en,
    );
  if (directReason) return directReason;
  const cityThesis = getLocalizedRowText(
    row,
    locale,
    row.ai_city_thesis_zh,
    row.ai_city_thesis_en,
  );
  if (cityThesis) return cityThesis;

  const modelBasis = getModelSourceSummary(row, locale, row.target_unit || row.temp_symbol);
  if (locale === "en-US") {
    return `${strengthLabel || "Watch"}: AI should validate against ${modelBasis}.`;
  }
  return `${strengthLabel || "观察"}：AI 需结合${modelBasis}确认。`;
}

function getRiskHints(
  row: ScanOpportunityRow,
  locale: string,
  modelProbability?: number | null,
) {
  const hints: string[] = [];
  const spread = Number(row.spread);
  if (Number.isFinite(spread) && spread > 0.03) {
    hints.push(
      locale === "en-US"
        ? `Wide spread ${formatQuoteCents(spread)} may distort the displayed market price.`
        : `盘口价差 ${formatQuoteCents(spread)} 偏宽，可能扭曲市场价格参考。`,
    );
  }
  const quoteAgeSeconds =
    row.quote_age_ms != null && Number.isFinite(Number(row.quote_age_ms))
      ? Math.round(Number(row.quote_age_ms) / 1000)
      : null;
  if (quoteAgeSeconds != null && quoteAgeSeconds > 60) {
    hints.push(
      locale === "en-US"
        ? `Quote age ${quoteAgeSeconds}s; refresh before acting.`
        : `报价已 ${quoteAgeSeconds}s，执行前需要刷新。`,
    );
  }
  if (row.trend_alignment === false) {
    hints.push(
      locale === "en-US"
        ? "Intraday trend does not fully support this direction."
        : "日内趋势未完全支持该方向。",
    );
  }
  if (row.cluster_adjusted) {
    hints.push(
      locale === "en-US"
        ? "Tail bucket was cluster-adjusted; bucket confidence may be overstated."
        : "尾部桶已做模型集群折扣，温度桶信心可能偏乐观。",
    );
  }
  if (modelProbability != null && modelProbability < 10) {
    hints.push(
      locale === "en-US"
        ? "Low model probability makes the setup sensitive to calibration error."
        : "模型概率偏低，校准误差会显著影响判断。",
    );
  }
  if (!hints.length) {
    hints.push(
      locale === "en-US"
        ? "Main residual risk is late observation updates or a shifted peak window."
        : "主要残余风险是后续实测升温或峰值窗口漂移。",
    );
  }
  return hints;
}

function getRecommendationReasons(
  row: ScanOpportunityRow,
  locale: string,
  _edgePercent?: number | null,
  price?: number | null,
) {
  const reasons: string[] = [];
  const aiReason = getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en);
  if (aiReason && String(row.ai_decision || "").toLowerCase() === "approve") {
    reasons.push(aiReason);
  }
  const modelBasis = getModelSourceSummary(row, locale, row.target_unit || row.temp_symbol);
  reasons.push(
    locale === "en-US"
      ? `AI uses ${modelBasis} with market ask ${formatQuoteCents(price)} only as downstream bucket context.`
      : `AI 以${modelBasis}为主，市场买价 ${formatQuoteCents(price)} 只作下游温度桶参考。`,
  );
  if (row.peak_alignment_score != null) {
    reasons.push(
      locale === "en-US"
        ? `Peak alignment score ${Number(row.peak_alignment_score).toFixed(2)} supports checking this bucket.`
        : `峰值对齐分 ${Number(row.peak_alignment_score).toFixed(2)}，支持把该桶纳入检查。`,
    );
  }
  return reasons.slice(0, 3);
}

function getExclusionReasons(
  row: ScanOpportunityRow,
  locale: string,
  edgePercent?: number | null,
) {
  const decision = String(row.ai_decision || "").toLowerCase();
  const aiReason =
    getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
    getLocalizedRowText(
      row,
      locale,
      row.ai_watchlist_reason_zh,
      row.ai_watchlist_reason_en,
    );
  if (decision === "veto" || decision === "downgrade" || decision === "watchlist") {
    return [
      aiReason ||
        (locale === "en-US"
          ? "AI did not classify this row as the primary forecast bucket."
          : "AI 未把该合约列为主预测桶。"),
    ];
  }
  if (edgePercent != null && Number(edgePercent) < 10) {
    return [
      locale === "en-US"
        ? "This bucket is not the current forecast center."
        : "该桶不是当前预测中枢。",
    ];
  }
  return [
    locale === "en-US"
      ? "No hard veto in the current AI/rule snapshot."
      : "当前 AI/规则快照没有硬性排除项。",
  ];
}

function getAiMeta(row: ScanOpportunityRow, locale: string) {
  const decision = String(row.ai_decision || "").toLowerCase();
  if (decision === "veto") {
    return {
      label: locale === "en-US" ? "AI veto" : "AI 排除",
      tone: "veto",
      reason: locale === "en-US" ? row.ai_reason_en || row.ai_reason_zh : row.ai_reason_zh || row.ai_reason_en,
    };
  }
  if (decision === "downgrade") {
    return {
      label: locale === "en-US" ? "AI downgrade" : "AI 降级",
      tone: "downgrade",
      reason: locale === "en-US" ? row.ai_reason_en || row.ai_reason_zh : row.ai_reason_zh || row.ai_reason_en,
    };
  }
  if (row.ai_rank != null || decision === "approve") {
    return {
      label: locale === "en-US" ? `AI pick ${row.ai_rank || ""}`.trim() : `AI 推荐 ${row.ai_rank || ""}`.trim(),
      tone: "approve",
      reason:
        (locale === "en-US" ? row.ai_reason_en || row.ai_reason_zh : row.ai_reason_zh || row.ai_reason_en) ||
        row.ai_model_cluster_note ||
        null,
    };
  }
  if (decision === "watchlist") {
    return {
      label: locale === "en-US" ? "AI watch" : "AI 观察",
      tone: "downgrade",
      reason:
        locale === "en-US"
          ? row.ai_watchlist_reason_en || row.ai_watchlist_reason_zh
          : row.ai_watchlist_reason_zh || row.ai_watchlist_reason_en,
    };
  }
  return null;
}

type ObservationPoint = { time?: string; temp?: number | null };

type V4TradeDecision = {
  decision: "approve" | "downgrade" | "veto" | "watchlist";
  label: string;
  tone: "approve" | "downgrade" | "veto" | "watchlist";
  reason: string;
  metarSummary?: string | null;
  airportReport?: string | null;
  metarEvidence: string[];
};

type V4CityForecast = {
  predicted: number | null;
  low: number | null;
  high: number | null;
  confidence?: string | null;
  peakWindow?: string | null;
  airportRead?: string | null;
  reason?: string | null;
  modelNote?: string | null;
  source: "ai" | "fallback";
};

function normalizeLookupKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getDetailForRow(
  row: Pick<ScanOpportunityRow, "city" | "city_display_name" | "display_name">,
  cityDetailsByName?: Record<string, CityDetail>,
) {
  if (!cityDetailsByName) return null;
  const rowKeys = [row.city, row.city_display_name, row.display_name]
    .map(normalizeLookupKey)
    .filter(Boolean);
  return (
    Object.entries(cityDetailsByName).find(([name, detail]) => {
      const detailKeys = [name, detail.name, detail.display_name]
        .map(normalizeLookupKey)
        .filter(Boolean);
      return rowKeys.some((key) => detailKeys.includes(key));
    })?.[1] || null
  );
}

function getDetailViewDate(detail: CityDetail, row?: ScanOpportunityRow | null) {
  if (!row) return detail.local_date;
  const rawDate = row.selected_date || row.local_date || "";
  const phase = String(row.window_phase || "").toLowerCase();
  if ((phase === "tomorrow" || phase === "week_ahead") && rawDate) return rawDate;
  if (!rawDate || rawDate === detail.local_date || row.local_date === detail.local_date) {
    return detail.local_date;
  }
  return detail.local_date || rawDate;
}

function normalizeBucketLabel(value?: string | null, tempSymbol?: string | null) {
  return normalizeTemperatureLabel(value, tempSymbol)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/℃/g, "°c");
}

function extractNumbers(value?: string | null) {
  return Array.from(String(value || "").matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );
}

function normalizeObservationPoints(points?: ObservationPoint[] | null) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      time: String(point?.time || "").trim(),
      temp:
        point?.temp != null && Number.isFinite(Number(point.temp))
          ? Number(point.temp)
          : null,
    }))
    .filter((point): point is { time: string; temp: number } =>
      Boolean(point.time && point.temp != null),
    )
    .sort((a, b) => getObservationSortMinutes(a.time) - getObservationSortMinutes(b.time));
}

function getObservationSortMinutes(time: string) {
  const parsed = Date.parse(time);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPeakWindowTiming(row: ScanOpportunityRow, locale: string) {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const label = String(row.peak_window_label || "").trim();
  const untilStart =
    row.minutes_until_peak_start != null && Number.isFinite(Number(row.minutes_until_peak_start))
      ? Number(row.minutes_until_peak_start)
      : null;
  const untilEnd =
    row.minutes_until_peak_end != null && Number.isFinite(Number(row.minutes_until_peak_end))
      ? Number(row.minutes_until_peak_end)
      : null;
  const windowText = label ? `${isEn ? "peak window" : "峰值窗口"} ${label}` : isEn ? "peak window" : "峰值窗口";
  if (phase === "active_peak" || (untilStart != null && untilStart <= 0 && untilEnd != null && untilEnd > 0)) {
    return isEn ? `Currently inside the ${windowText}.` : `当前已进入${windowText}。`;
  }
  if (phase === "post_peak" || (untilEnd != null && untilEnd <= 0)) {
    return isEn ? `The ${windowText} has passed.` : `${windowText}已结束。`;
  }
  if (untilStart != null && untilStart > 0) {
    return isEn
      ? `${windowText} starts in ${formatMinuteSpan(untilStart, locale)}.`
      : `${windowText}尚未开始，约 ${formatMinuteSpan(untilStart, locale)} 后进入。`;
  }
  if (phase === "early_today" || phase === "setup_today") {
    return isEn ? `Before the ${windowText}; latest METAR is not final peak evidence yet.` : `尚处峰值前，最新 METAR 还不能当作最终峰值证据。`;
  }
  return label ? (isEn ? `Reference ${windowText}.` : `参考${windowText}。`) : null;
}

function decodeRawMetarCloud(rawMetar?: string | null, locale = "zh-CN") {
  const raw = String(rawMetar || "").toUpperCase();
  const matches = Array.from(raw.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})?\b/g));
  if (!matches.length) return "";
  const coverText: Record<string, { zh: string; en: string }> = {
    FEW: { zh: "少云", en: "few" },
    SCT: { zh: "散云", en: "scattered" },
    BKN: { zh: "多云", en: "broken" },
    OVC: { zh: "阴天", en: "overcast" },
  };
  return matches
    .slice(0, 3)
    .map((match) => {
      const cover = coverText[match[1]] || { zh: match[1], en: match[1] };
      const base = match[2] ? `${Number(match[2]) * 100}ft` : "";
      return locale === "en-US"
        ? [cover.en, base].filter(Boolean).join(" ")
        : [cover.zh, base].filter(Boolean).join(" ");
    })
    .join(locale === "en-US" ? ", " : "、");
}

function decodeRawMetarVisibility(rawMetar?: string | null) {
  const raw = String(rawMetar || "").toUpperCase();
  if (/\b9999\b/.test(raw)) return "10km+";
  const meterMatch = raw.match(/\b(\d{4})\b/);
  if (meterMatch) return `${Number(meterMatch[1]) / 1000}km`;
  return "";
}

function formatAirportReportRead(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const context = row.metar_context || {};
  const airport: Partial<NonNullable<CityDetail["airport_current"]>> =
    detail?.airport_current || {};
  const station =
    context.station ||
    detail?.risk?.icao ||
    airport.station_code ||
    null;
  const obsTime =
    context.airport_obs_time ||
    context.last_time ||
    airport.obs_time ||
    row.metar_status?.last_observation_time ||
    null;
  const temp =
    context.airport_current_temp != null && Number.isFinite(Number(context.airport_current_temp))
      ? Number(context.airport_current_temp)
      : airport.temp != null && Number.isFinite(Number(airport.temp))
        ? Number(airport.temp)
        : null;
  const windSpeed =
    context.airport_wind_speed_kt != null && Number.isFinite(Number(context.airport_wind_speed_kt))
      ? Number(context.airport_wind_speed_kt)
      : airport.wind_speed_kt != null && Number.isFinite(Number(airport.wind_speed_kt))
        ? Number(airport.wind_speed_kt)
        : null;
  const windDir =
    context.airport_wind_dir != null && Number.isFinite(Number(context.airport_wind_dir))
      ? Number(context.airport_wind_dir)
      : airport.wind_dir != null && Number.isFinite(Number(airport.wind_dir))
        ? Number(airport.wind_dir)
        : null;
  const cloud = String(context.airport_cloud_desc || airport.cloud_desc || "").trim();
  const weather = String(context.airport_wx_desc || airport.wx_desc || "").trim();
  const rawMetar = String(context.airport_raw_metar || airport.raw_metar || "").trim();
  const decodedCloud = cloud || decodeRawMetarCloud(rawMetar, locale);
  const visibility =
    context.airport_visibility_mi != null && Number.isFinite(Number(context.airport_visibility_mi))
      ? Number(context.airport_visibility_mi)
      : airport.visibility_mi != null && Number.isFinite(Number(airport.visibility_mi))
        ? Number(airport.visibility_mi)
        : null;
  const decodedVisibility = visibility != null ? `${visibility.toFixed(1)}mi` : decodeRawMetarVisibility(rawMetar);

  const parts: string[] = [];
  if (temp != null) parts.push(formatTemperatureValue(temp, tempSymbol, { digits: 1 }));
  if (windSpeed != null) {
    parts.push(
      windDir != null
        ? isEn
          ? `wind ${Math.round(windDir)}°/${Math.round(windSpeed)}kt`
          : `风 ${Math.round(windDir)}°/${Math.round(windSpeed)}kt`
        : isEn
          ? `wind ${Math.round(windSpeed)}kt`
          : `风 ${Math.round(windSpeed)}kt`,
    );
  }
  if (decodedCloud) parts.push(isEn ? `cloud ${decodedCloud}` : `云况 ${decodedCloud}`);
  if (weather) parts.push(isEn ? `weather ${weather}` : `天气 ${weather}`);
  if (decodedVisibility) parts.push(isEn ? `visibility ${decodedVisibility}` : `能见度 ${decodedVisibility}`);
  if (!parts.length) return null;
  const prefix = isEn ? "Latest airport METAR read" : "最新机场报文解读";
  const head = [station, obsTime].filter(Boolean).join(" ");
  return `${prefix}${head ? ` ${head}` : ""}：${parts.join("，")}。`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getV4CityForecast(
  row: ScanOpportunityRow,
  group: OpportunityGroup,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
): V4CityForecast {
  const isEn = locale === "en-US";
  const aiPredicted =
    row.ai_predicted_max != null && Number.isFinite(Number(row.ai_predicted_max))
      ? Number(row.ai_predicted_max)
      : null;
  const aiLow =
    row.ai_predicted_low != null && Number.isFinite(Number(row.ai_predicted_low))
      ? Number(row.ai_predicted_low)
      : null;
  const aiHigh =
    row.ai_predicted_high != null && Number.isFinite(Number(row.ai_predicted_high))
      ? Number(row.ai_predicted_high)
      : null;
  const modelValues = Object.values(row.model_cluster_sources || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const fallbackPredicted =
    aiPredicted ??
    (row.deb_prediction != null && Number.isFinite(Number(row.deb_prediction))
      ? Number(row.deb_prediction)
      : median(modelValues));
  const fallbackLow = aiLow ?? (modelValues.length ? Math.min(...modelValues) : fallbackPredicted);
  const fallbackHigh = aiHigh ?? (modelValues.length ? Math.max(...modelValues) : fallbackPredicted);
  const peakWindow =
    getLocalizedRowText(row, locale, row.ai_peak_window_zh, row.ai_peak_window_en) ||
    formatPeakWindowTiming(row, locale);
  const airportRead =
    getLocalizedRowText(
      row,
      locale,
      row.ai_airport_metar_read_zh,
      row.ai_airport_metar_read_en,
    ) || formatAirportReportRead(row, detail, locale, tempSymbol);
  const modelNote =
    row.ai_city_model_cluster_note ||
    row.ai_model_cluster_note ||
    getModelSourceSummary(row, locale, tempSymbol);
  const reason =
    getLocalizedRowText(row, locale, row.ai_forecast_reason_zh, row.ai_forecast_reason_en) ||
    getLocalizedRowText(row, locale, row.ai_city_thesis_zh, row.ai_city_thesis_en) ||
    (fallbackPredicted != null
      ? isEn
        ? `${group.cityName} final high is centered near ${formatTemperatureValue(fallbackPredicted, tempSymbol, { digits: 1 })}; use the contract rows only as bucket mapping.`
        : `${group.cityName} 最终最高温先以 ${formatTemperatureValue(fallbackPredicted, tempSymbol, { digits: 1 })} 附近为中枢，下面合约只作为温度桶映射。`
      : null);
  return {
    predicted: fallbackPredicted,
    low: fallbackLow,
    high: fallbackHigh,
    confidence: row.ai_forecast_confidence || row.ai_city_confidence,
    peakWindow,
    airportRead,
    reason,
    modelNote,
    source: aiPredicted != null ? "ai" : "fallback",
  };
}

function getForecastRangeLabel(forecast: V4CityForecast, tempSymbol?: string | null) {
  if (forecast.low == null && forecast.high == null) return "--";
  if (forecast.low != null && forecast.high != null) {
    if (Math.abs(forecast.low - forecast.high) < 0.05) {
      return formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 });
    }
    return `${formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 })} ~ ${formatTemperatureValue(forecast.high, tempSymbol, { digits: 1 })}`;
  }
  if (forecast.low != null) return `>= ${formatTemperatureValue(forecast.low, tempSymbol, { digits: 1 })}`;
  return `<= ${formatTemperatureValue(Number(forecast.high), tempSymbol, { digits: 1 })}`;
}

function getForecastContractFit(
  row: ScanOpportunityRow,
  forecast: V4CityForecast,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const explicitMatch = String(row.ai_forecast_match || "").toLowerCase();
  const explicitReason = getLocalizedRowText(
    row,
    locale,
    row.ai_forecast_match_reason_zh,
    row.ai_forecast_match_reason_en,
  );
  if (explicitMatch && explicitReason) {
    return {
      label:
        explicitMatch === "core"
          ? isEn ? "Core bucket" : "核心桶"
          : explicitMatch === "outside"
            ? isEn ? "Outside forecast" : "预测区间外"
            : explicitMatch === "edge"
              ? isEn ? "Boundary bucket" : "边界桶"
              : isEn ? "Watch" : "观察",
      tone: explicitMatch === "core" ? "approve" : explicitMatch === "outside" ? "veto" : "watchlist",
      reason: explicitReason,
    };
  }

  const { lower, upper } = getTargetRange(row);
  const predicted = forecast.predicted;
  if (predicted == null || (lower == null && upper == null)) {
    return {
      label: isEn ? "Await forecast" : "等待预测",
      tone: "watchlist",
      reason: isEn ? "AI has no stable max-temperature center yet." : "AI 还没有稳定的最高温中枢。",
    };
  }
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const tolerance = String(unit).toUpperCase().includes("F") ? 1.0 : 0.5;
  const inside =
    (lower == null || predicted >= lower - tolerance) &&
    (upper == null || predicted <= upper + tolerance);
  const rangeOverlaps =
    forecast.low != null &&
    forecast.high != null &&
    (lower == null || forecast.high >= lower - tolerance) &&
    (upper == null || forecast.low <= upper + tolerance);
  if (inside) {
    return {
      label: isEn ? "Core bucket" : "核心桶",
      tone: "approve",
      reason: isEn
        ? `AI max-temperature center ${formatTemperatureValue(predicted, unit, { digits: 1 })} sits inside this bucket.`
        : `AI 最高温中枢 ${formatTemperatureValue(predicted, unit, { digits: 1 })} 落在这个温度桶内。`,
    };
  }
  if (rangeOverlaps) {
    return {
      label: isEn ? "Boundary bucket" : "边界桶",
      tone: "watchlist",
      reason: isEn
        ? `This bucket touches the AI interval ${getForecastRangeLabel(forecast, unit)}, but is not the center.`
        : `该桶触及 AI 区间 ${getForecastRangeLabel(forecast, unit)}，但不是预测中枢。`,
    };
  }
  return {
    label: isEn ? "Outside forecast" : "预测区间外",
    tone: "veto",
    reason: isEn
      ? `This bucket is outside the AI max-temperature interval ${getForecastRangeLabel(forecast, unit)}.`
      : `该桶位于 AI 最高温区间 ${getForecastRangeLabel(forecast, unit)} 之外。`,
  };
}

function firstNonEmptyPoints(...groups: Array<ReturnType<typeof normalizeObservationPoints>>) {
  return groups.find((group) => group.length > 0) || [];
}

function getTargetRange(row: ScanOpportunityRow) {
  const lower =
    row.target_lower != null && Number.isFinite(Number(row.target_lower))
      ? Number(row.target_lower)
      : null;
  const upper =
    row.target_upper != null && Number.isFinite(Number(row.target_upper))
      ? Number(row.target_upper)
      : null;
  if (lower != null || upper != null) return { lower, upper };

  const rawLabel = String(row.target_label || row.action || "");
  const numbers = extractNumbers(rawLabel);
  if (numbers.length >= 2) {
    return { lower: Math.min(numbers[0], numbers[1]), upper: Math.max(numbers[0], numbers[1]) };
  }
  const value =
    row.target_threshold ??
    row.target_value ??
    (numbers.length ? numbers[0] : null);
  if (value == null || !Number.isFinite(Number(value))) {
    return { lower: null, upper: null };
  }
  const numeric = Number(value);
  if (/(\+|above|higher|or\s+higher|>=|≥|以上)/i.test(rawLabel)) {
    return { lower: numeric, upper: null };
  }
  if (/(below|or\s+below|<=|≤|以下)/i.test(rawLabel)) {
    return { lower: null, upper: numeric };
  }
  return { lower: numeric, upper: numeric };
}

function getMetarObservationContext(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
) {
  const context = row.metar_context || {};
  const metarToday = firstNonEmptyPoints(
    normalizeObservationPoints(context.today_obs),
    normalizeObservationPoints(row.metar_today_obs),
  );
  const detailMetarToday = normalizeObservationPoints(detail?.metar_today_obs);
  const metarRecent = firstNonEmptyPoints(
    normalizeObservationPoints(context.recent_obs),
    normalizeObservationPoints(row.metar_recent_obs),
  );
  const detailMetarRecent = normalizeObservationPoints(detail?.metar_recent_obs);
  const settlementToday = firstNonEmptyPoints(
    normalizeObservationPoints(context.settlement_today_obs),
    normalizeObservationPoints(row.settlement_today_obs),
  );
  const detailSettlementToday = normalizeObservationPoints(detail?.settlement_today_obs);

  const primaryPoints =
    metarToday.length
      ? metarToday
      : detailMetarToday.length
        ? detailMetarToday
        : metarRecent.length
          ? metarRecent
          : detailMetarRecent.length
            ? detailMetarRecent
            : settlementToday.length
              ? settlementToday
              : detailSettlementToday;
  const trendPoints =
    (metarRecent.length
      ? metarRecent
      : detailMetarRecent.length
        ? detailMetarRecent
        : primaryPoints.slice(-4));
  const explicitLast = context.last_temp ?? row.metar_status?.last_temp ?? detail?.metar_status?.last_temp;
  const lastPoint = primaryPoints[primaryPoints.length - 1] || null;
  const maxPoint = primaryPoints.reduce<{ time: string; temp: number } | null>(
    (best, point) => (!best || point.temp >= best.temp ? point : best),
    null,
  );
  const trendFirst = trendPoints[0] || null;
  const trendLast = trendPoints[trendPoints.length - 1] || null;
  const trendDelta =
    context.trend_delta != null && Number.isFinite(Number(context.trend_delta))
      ? Number(context.trend_delta)
      : trendFirst && trendLast && trendPoints.length >= 2
        ? trendLast.temp - trendFirst.temp
        : null;
  const lastTemp =
    explicitLast != null && Number.isFinite(Number(explicitLast))
      ? Number(explicitLast)
      : lastPoint?.temp ?? null;
  const maxTemp =
    context.max_temp != null && Number.isFinite(Number(context.max_temp))
      ? Number(context.max_temp)
      : maxPoint?.temp ?? null;
  const stale =
    context.stale_for_today === true ||
    row.metar_status?.stale_for_today === true ||
    detail?.metar_status?.stale_for_today === true;

  return {
    points: primaryPoints,
    lastTime: String(context.last_time || lastPoint?.time || ""),
    lastTemp,
    maxTime: String(context.max_time || maxPoint?.time || ""),
    maxTemp,
    trendDelta,
    stale,
    station: context.station || detail?.risk?.icao || detail?.airport_current?.station_code || null,
  };
}

function getMetarGate(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const side = String(row.side || "").toLowerCase();
  const selectedDate = String(row.selected_date || "");
  const localDate = String(row.local_date || detail?.local_date || "");
  const futureContract = Boolean(selectedDate && localDate && selectedDate > localDate);
  if (futureContract) return null;

  const obs = getMetarObservationContext(row, detail);
  const evidence: string[] = [];
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const peakTiming = formatPeakWindowTiming(row, locale);
  const airportReport = formatAirportReportRead(row, detail, locale, unit);
  if (peakTiming) evidence.push(peakTiming);
  if (airportReport) evidence.push(airportReport);
  if (obs.lastTemp != null) {
    evidence.push(
      `${isEn ? "METAR latest" : "METAR 最新"} ${formatTemperatureValue(obs.lastTemp, unit, { digits: 1 })}${obs.lastTime ? ` @ ${obs.lastTime}` : ""}`,
    );
  }
  if (obs.maxTemp != null) {
    evidence.push(
      `${isEn ? "METAR max" : "METAR 最高"} ${formatTemperatureValue(obs.maxTemp, unit, { digits: 1 })}${obs.maxTime ? ` @ ${obs.maxTime}` : ""}`,
    );
  }
  if (obs.trendDelta != null) {
    evidence.push(
      `${isEn ? "Recent METAR delta" : "近端 METAR 变化"} ${formatTemperatureValue(obs.trendDelta, unit, { digits: 1 })}`,
    );
  }
  if (obs.station) evidence.push(`${isEn ? "Station" : "站点"} ${obs.station}`);

  if (obs.stale || !obs.points.length || obs.maxTemp == null) {
    return {
      decision: "downgrade" as const,
      reason: isEn
        ? "AI has no same-day METAR confirmation yet, so this bucket remains forecast-only."
        : "AI 还没有拿到同日 METAR 确认，该桶暂时只能作为预测映射。",
      evidence,
    };
  }

  const { lower, upper } = getTargetRange(row);
  if (lower == null && upper == null) {
    return {
      decision: "watchlist" as const,
      reason: isEn
        ? "AI has METAR data, but the contract threshold cannot be mapped cleanly to a bucket."
        : "AI 已读取 METAR，但该合约阈值无法稳定映射到温度桶。",
      evidence,
    };
  }

  const epsilon = String(unit).toUpperCase().includes("F") ? 0.7 : 0.4;
  const trendDelta = obs.trendDelta;
  const isNotRising = trendDelta != null && trendDelta <= epsilon;
  const isFalling = trendDelta != null && trendDelta <= -epsilon;
  const phase = String(row.window_phase || "").toLowerCase();
  const remaining =
    row.remaining_window_minutes != null && Number.isFinite(Number(row.remaining_window_minutes))
      ? Number(row.remaining_window_minutes)
      : null;
  const minutesUntilPeakStart =
    row.minutes_until_peak_start != null && Number.isFinite(Number(row.minutes_until_peak_start))
      ? Number(row.minutes_until_peak_start)
      : null;
  const lateWindow =
    phase === "active_peak" ||
    phase === "post_peak" ||
    (remaining != null && remaining <= 180);
  const beforePeak =
    phase === "early_today" ||
    phase === "setup_today" ||
    phase === "tomorrow" ||
    phase === "week_ahead" ||
    (minutesUntilPeakStart != null && minutesUntilPeakStart > 0);
  const aboveUpper = upper != null && obs.maxTemp > upper + epsilon;
  const belowLower = lower != null && obs.maxTemp < lower - epsilon;
  const insideBucket =
    (lower == null || obs.maxTemp >= lower - epsilon) &&
    (upper == null || obs.maxTemp <= upper + epsilon);

  if (side === "no") {
    if (aboveUpper) {
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max has already moved above this bucket, so AI marks the NO bucket as observation-supported."
          : "METAR 实测最高已越过目标桶上沿，AI 判断 NO 桶有实测支撑。",
        evidence,
      };
    }
    if (belowLower && (lateWindow || isFalling || isNotRising)) {
      if (beforePeak && !lateWindow) {
        return {
          decision: "watchlist" as const,
          reason: isEn
            ? "The peak window has not arrived, so a still-low METAR path cannot confirm this NO bucket yet; AI keeps it on watch."
            : "峰值窗口尚未到来，METAR 暂未触达不能直接确认 NO 桶，AI 先列观察。",
          evidence,
        };
      }
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max remains below this bucket and recent observations are not strengthening, so AI favors the NO bucket."
          : "METAR 最高仍低于目标桶且近期走势不强，AI 倾向 NO 桶。",
        evidence,
      };
    }
    if (insideBucket && lateWindow && isNotRising) {
      return {
        decision: "downgrade" as const,
        reason: isEn
          ? "METAR max is still close to this bucket, so AI cannot treat the NO bucket as confirmed."
          : "METAR 最高仍贴近目标桶，AI 不能把 NO 桶视为已确认。",
        evidence,
      };
    }
  }

  if (side === "yes") {
    if (aboveUpper) {
      return {
        decision: "veto" as const,
        reason: isEn
          ? "METAR max has already exceeded the bucket, so AI marks this YES bucket as outside the observed path."
          : "METAR 实测最高已越过目标桶上沿，AI 判断该 YES 桶已偏离实测路径。",
        evidence,
      };
    }
    if (belowLower && (lateWindow || isFalling || isNotRising)) {
      if (beforePeak && !lateWindow) {
        return {
          decision: "watchlist" as const,
          reason: isEn
            ? "The peak window has not arrived, so METAR not reaching the bucket only means this bucket still needs peak-window confirmation."
            : "峰值窗口尚未到来，METAR 未触达目标桶只能说明仍需等待峰值验证，AI 暂列观察。",
          evidence,
        };
      }
      return {
        decision: "downgrade" as const,
        reason: isEn
          ? "METAR max has not reached the bucket and recent observations are weak, so AI downgrades the YES bucket."
          : "METAR 最高仍未触达目标桶且走势不强，AI 将 YES 桶降级观察。",
        evidence,
      };
    }
    if (insideBucket) {
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max is inside the target bucket, so AI sees observation support while monitoring an overshoot."
          : "METAR 实测最高已落入目标桶，AI 认为 YES 桶有实测依据，但仍需防止继续升穿上沿。",
        evidence,
      };
    }
  }

  return {
    decision: "watchlist" as const,
    reason: isEn
      ? "METAR does not give a clean final confirmation yet, so AI keeps this as watchlist."
      : "METAR 还没有给出干净的最终确认，AI 暂列观察。",
    evidence,
  };
}

function getV4DecisionLabel(
  decision: V4TradeDecision["decision"],
  locale: string,
) {
  if (locale === "en-US") {
    if (decision === "approve") return "AI Confirmed";
    if (decision === "veto") return "AI Outside";
    if (decision === "downgrade") return "AI Downgrade";
    return "AI Watch";
  }
  if (decision === "approve") return "AI 确认";
  if (decision === "veto") return "AI 区间外";
  if (decision === "downgrade") return "AI 降级";
  return "AI 观察";
}

function getV4TradeDecision(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  edgePercent?: number | null,
  tempSymbol?: string | null,
): V4TradeDecision {
  const isEn = locale === "en-US";
  const backendMetarDecision = String(row.v4_metar_decision || "").toLowerCase();
  const backendMetarReason =
    getLocalizedRowText(row, locale, row.v4_metar_reason_zh, row.v4_metar_reason_en) ||
    null;
  const metarGate = getMetarGate(row, detail, locale, tempSymbol);
  const aiDecision = String(row.ai_decision || "").toLowerCase();
  const aiReason =
    getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
    getLocalizedRowText(
      row,
      locale,
      row.ai_watchlist_reason_zh,
      row.ai_watchlist_reason_en,
    );

  let decision: V4TradeDecision["decision"] =
    backendMetarDecision === "veto" ||
    backendMetarDecision === "downgrade" ||
    backendMetarDecision === "approve" ||
    backendMetarDecision === "watchlist"
      ? (backendMetarDecision as V4TradeDecision["decision"])
      : metarGate?.decision ||
        (aiDecision === "veto" || aiDecision === "downgrade" || aiDecision === "approve" || aiDecision === "watchlist"
          ? (aiDecision as V4TradeDecision["decision"])
          : Number(edgePercent || 0) >= 20
            ? "watchlist"
            : "watchlist");

  if (metarGate?.decision === "veto") decision = "veto";
  if (metarGate?.decision === "watchlist" && backendMetarDecision === "downgrade") {
    decision = "watchlist";
  }
  if (metarGate?.decision === "downgrade" && decision !== "veto") decision = "downgrade";
  if (metarGate?.decision === "approve" && decision !== "veto" && decision !== "downgrade") {
    decision = "approve";
  }

  const reason =
    (metarGate?.decision === "watchlist" ? metarGate.reason : null) ||
    backendMetarReason ||
    metarGate?.reason ||
    aiReason ||
    (isEn
      ? "AI keeps this on watch until METAR and the full weather-model cluster align."
      : "AI 会等 METAR 与全量天气模型集群对齐后再确认。");
  const airportReport = formatAirportReportRead(
    row,
    detail,
    locale,
    normalizeTemperatureSymbol(tempSymbol),
  );
  const metarSummary =
    metarGate?.evidence?.filter((item) => item !== airportReport).join(" · ") || null;
  return {
    decision,
    label: getV4DecisionLabel(decision, locale),
    tone: decision,
    reason,
    metarSummary,
    airportReport,
    metarEvidence: metarGate?.evidence || [],
  };
}

function getBucketText(bucket: { label?: string | null; bucket?: string | null; range?: string | null }) {
  return [bucket.label, bucket.bucket, bucket.range]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function bucketMatchesRow(
  bucket: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | string | null;
  },
  row: ScanOpportunityRow,
  tempSymbol?: string | null,
) {
  const targetLabel = normalizeBucketLabel(row.target_label, tempSymbol);
  const bucketLabels = getBucketText(bucket).map((label) =>
    normalizeBucketLabel(label, tempSymbol),
  );
  if (targetLabel && bucketLabels.some((label) => label === targetLabel)) {
    return true;
  }

  const rawTargetLabel = String(row.target_label || "");
  const targetNumbers = extractNumbers(rawTargetLabel);
  const targetValue =
    row.target_value ?? row.target_threshold ?? row.target_lower ?? row.target_upper ?? targetNumbers[0] ?? null;
  if (targetValue == null || !Number.isFinite(Number(targetValue))) return false;

  const bucketNumbers = [
    ...(bucket.value != null && Number.isFinite(Number(bucket.value))
      ? [Number(bucket.value)]
      : []),
    ...getBucketText(bucket).flatMap(extractNumbers),
  ];
  const matchesNumber = bucketNumbers.some(
    (value) => Math.abs(Number(value) - Number(targetValue)) < 0.05,
  );
  if (!matchesNumber) return false;

  const targetIsUpper =
    /(\+|以上|or\s*above|above|greater|>=|≥)/i.test(rawTargetLabel) ||
    (row.target_lower != null && row.target_upper == null);
  const targetIsLower =
    /(<=|≤|below|or\s*below|以下)/i.test(rawTargetLabel) ||
    (row.target_upper != null && row.target_lower == null);
  const bucketRaw = getBucketText(bucket).join(" ");
  const bucketIsUpper = /(\+|以上|or\s*above|above|greater|>=|≥|inf|∞)/i.test(bucketRaw);
  const bucketIsLower = /(<=|≤|below|or\s*below|以下|-inf|-∞)/i.test(bucketRaw);

  if (targetIsUpper || bucketIsUpper) return targetIsUpper === bucketIsUpper;
  if (targetIsLower || bucketIsLower) return targetIsLower === bucketIsLower;
  return true;
}

function getDetailBucketEventProbability(
  detail: CityDetail | null,
  row: ScanOpportunityRow,
  tempSymbol?: string | null,
) {
  if (!detail) return null;
  const view = getProbabilityView(detail, getDetailViewDate(detail, row));
  const buckets = Array.isArray(view.probabilitiesAll)
    ? view.probabilitiesAll
    : [];
  if (!buckets.length) return null;
  const matched = buckets.find((bucket) => bucketMatchesRow(bucket, row, tempSymbol));
  return normalizeProbability(matched?.probability);
}

type OpportunityGroup = {
  key: string;
  cityName: string;
  date?: string | null;
  tempSymbol?: string | null;
  debLabel: string;
  peakLabel: string;
  peakProbability?: number | null;
  phaseMeta: PhaseMeta;
  localTime?: string | null;
  remainingMinutes?: number | null;
  rows: ScanOpportunityRow[];
};

function buildOpportunityGroups(
  rows: ScanOpportunityRow[],
  locale: string,
  cityDetailsByName?: Record<string, CityDetail>,
): OpportunityGroup[] {
  const groups = new Map<string, OpportunityGroup>();
  for (const row of rows) {
    const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
    const detail = getDetailForRow(row, cityDetailsByName);
    const cityName = getLocalizedCityName(
      row.city,
      row.city_display_name || row.display_name || row.city,
      locale,
    );
    const date = detail ? getDetailViewDate(detail, row) : row.selected_date || row.local_date || "";
    const key = `${row.city || cityName}|${date}`;
    const modelView = detail ? getModelView(detail, date) : null;
    const debPrediction = modelView?.deb ?? row.deb_prediction ?? null;
    const modelClusterLabel = formatModelClusterRange(
      modelView?.models || row.model_cluster_sources,
      tempSymbol,
    );
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        cityName,
        date,
        tempSymbol,
        debLabel:
          debPrediction != null
            ? formatTemperatureValue(Number(debPrediction), tempSymbol, { digits: 1 })
            : "--",
        peakLabel: modelClusterLabel,
        peakProbability: null,
        phaseMeta: getWindowPhaseMeta(row, locale),
        localTime: row.local_time,
        remainingMinutes: row.remaining_window_minutes,
        rows: [row],
      });
      continue;
    }
    existing.rows.push(row);
    if (existing.peakLabel === "--" && modelClusterLabel !== "--") {
      existing.peakLabel = modelClusterLabel;
    }
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    rows: [...group.rows].sort(
      (a, b) =>
        Number(b.edge_percent ?? -Infinity) - Number(a.edge_percent ?? -Infinity) ||
        Number(b.final_score ?? -Infinity) - Number(a.final_score ?? -Infinity),
    ),
  }));
}

export const OpportunityTable = React.memo(function OpportunityTable({
  rows,
  status,
  stale,
  staleReason,
  loading,
  selectedRowId,
  onSelectRow,
  cityDetailsByName,
}: {
  rows: ScanOpportunityRow[];
  status?: string | null;
  stale?: boolean;
  staleReason?: string | null;
  loading?: boolean;
  selectedRowId?: string | null;
  onSelectRow?: (row: ScanOpportunityRow) => void;
  cityDetailsByName?: Record<string, CityDetail>;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const hasRows = rows.length > 0;
  const scanInProgress =
    loading || status === "partial" || status === "scanning";
  const groups = React.useMemo(
    () => buildOpportunityGroups(rows, locale, cityDetailsByName),
    [rows, locale, cityDetailsByName],
  );
  const [expandedRowIds, setExpandedRowIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const toggleExpandedRow = React.useCallback((rowId: string) => {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const ensureExpandedRow = React.useCallback((rowId: string) => {
    setExpandedRowIds((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
  }, []);

  const selectAndOpenRow = React.useCallback(
    (row: ScanOpportunityRow) => {
      ensureExpandedRow(row.id);
      onSelectRow?.(row);
    },
    [ensureExpandedRow, onSelectRow],
  );

  const toggleRowAnalysis = React.useCallback(
    (row: ScanOpportunityRow) => {
      toggleExpandedRow(row.id);
      onSelectRow?.(row);
    },
    [onSelectRow, toggleExpandedRow],
  );

  if (!hasRows) {
    const title =
      scanInProgress
        ? isEn
          ? "Scanning markets"
          : "正在扫描市场"
        : status === "failed"
          ? isEn
            ? "Scan failed"
            : "扫描失败"
          : isEn
            ? "No tradable market right now"
            : "当前暂无可交易市场";
    const copy =
      scanInProgress
        ? isEn
          ? "Waiting for the latest market snapshot. Existing data will stay on screen when available."
          : "正在等待最新市场快照；如果有旧数据，会继续保留在页面上。"
        : status === "failed"
          ? staleReason || (isEn ? "No valid market snapshot is available." : "当前没有可用的市场快照。")
          : isEn
            ? "The current snapshot does not contain a tradable main signal."
            : "当前快照里还没有可交易的主信号。";
    return (
      <div className="scan-table-shell empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">{title}</div>
          <div className="scan-empty-copy">{copy}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-table-shell">
      {stale ? (
        <div className="scan-table-banner">
          <strong>{isEn ? "Showing delayed snapshot" : "当前显示延迟快照"}</strong>
          <span>{staleReason || (isEn ? "Latest refresh failed, fallback to the last successful scan." : "最新刷新失败，已回退到上次成功扫描结果。")}</span>
        </div>
      ) : null}
      <div className="scan-table-body scan-opportunity-groups">
        {groups.map((group) => {
          const groupSelected = group.rows.some((row) => row.id === selectedRowId);
          return (
          <section
            key={group.key}
            className={`scan-opportunity-group ${groupSelected ? "selected" : ""}`}
          >
            <button
              type="button"
              className="scan-opportunity-group-head"
              onClick={() => {
                const firstRow = group.rows[0];
                if (firstRow) selectAndOpenRow(firstRow);
              }}
            >
              <div className="scan-opportunity-city">
                <strong>{group.cityName}</strong>
                <div className="scan-opportunity-models">
                  <span>
                    <em>{isEn ? "Local time" : "当前时间"}</em>
                    <b>{group.localTime || "--"}</b>
                  </span>
                  <span>
                    <em>{isEn ? "Settlement left" : "剩余结算时间"}</em>
                    <b>{formatWindowMinutes(group.remainingMinutes, locale)}</b>
                  </span>
                  <span>
                    <em>DEB</em>
                    <b>{group.debLabel}</b>
                  </span>
                  <span>
                    <em>{isEn ? "Model range" : "模型区间"}</em>
                    <b>{group.peakLabel}</b>
                  </span>
                </div>
              </div>
              <div className="scan-opportunity-phase">
                <b className={`scan-phase-badge ${group.phaseMeta.tone}`}>
                  {group.phaseMeta.label}
                </b>
              </div>
            </button>

            <div className="scan-opportunity-items">
              {group.rows.map((row) => {
                const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
                const side = String(row.side || "").toLowerCase();
                const detail = getDetailForRow(row, cityDetailsByName);
                const detailEventProbability = getDetailBucketEventProbability(
                  detail,
                  row,
                  tempSymbol,
                );
                const modelProbability =
                  detailEventProbability != null
                    ? (side === "no" ? 1 - detailEventProbability : detailEventProbability) * 100
                    : row.model_probability != null
                      ? Number(row.model_probability) * 100
                    : row.raw_model_event_probability != null
                      ? (side === "no"
                          ? 1 - Number(row.raw_model_event_probability)
                          : Number(row.raw_model_event_probability)) * 100
                    : row.model_event_probability != null
                      ? (side === "no"
                          ? 1 - Number(row.model_event_probability)
                          : Number(row.model_event_probability)) * 100
                      : null;
                const edgePercent =
                  modelProbability != null && row.ask != null
                    ? modelProbability - Number(row.ask) * 100
                    : row.edge_percent;
                const debDistanceLabel = isEn ? "DEB distance" : "DEB 距离";
                const modelSupportLabel = isEn ? "Model support" : "模型支持";
                const metarLabel = "METAR";
                const debDistanceText = getDebDistanceSummary(row, locale, tempSymbol);
                const modelSupportText = getModelSupportSummary(row, locale);
                const metarConflictText = getMetarConflictSummary(row, detail, locale);
                const cityForecast = getV4CityForecast(
                  row,
                  group,
                  detail,
                  locale,
                  tempSymbol,
                );
                const forecastFit = getForecastContractFit(
                  row,
                  cityForecast,
                  locale,
                  tempSymbol,
                );
                const v4Decision = getV4TradeDecision(
                  row,
                  detail,
                  locale,
                  edgePercent,
                  tempSymbol,
                );
                const aiMeta = getAiMeta(row, locale);
                const fallbackStrength = getOpportunityStrength(edgePercent, locale);
                const strength = {
                  label: forecastFit.label || fallbackStrength.label,
                  tone: forecastFit.tone || fallbackStrength.tone,
                };
                const expanded = expandedRowIds.has(row.id);
                const shortConclusion =
                  forecastFit.reason ||
                  cityForecast.reason ||
                  getShortAiConclusion(
                    row,
                    locale,
                    edgePercent,
                    fallbackStrength.label,
                  );
                const riskHints = getRiskHints(row, locale, modelProbability);
                if (
                  v4Decision.decision === "watchlist" &&
                  !riskHints.includes(v4Decision.reason)
                ) {
                  riskHints.unshift(v4Decision.reason);
                }
                const cityAnalysis =
                  getLocalizedRowText(
                    row,
                    locale,
                    row.ai_city_thesis_zh,
                    row.ai_city_thesis_en,
                  ) ||
                  cityForecast.reason ||
                  getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
                  (isEn
                    ? `${group.cityName} is judged first as a max-temperature forecast; contract rows are only bucket mappings.`
                    : `${group.cityName} 当前先判断最终最高温，下面合约只作为温度桶映射。`);
                const cityModelNote =
                  cityForecast.modelNote ||
                  row.ai_city_model_cluster_note ||
                  row.ai_model_cluster_note ||
                  getModelSourceSummary(row, locale, tempSymbol);
                const keyReasons = Array.from(
                  new Set(
                    [
                      forecastFit.reason,
                      cityForecast.reason,
                      cityForecast.peakWindow,
                      cityForecast.airportRead,
                      cityModelNote,
                    ].filter(Boolean),
                  ),
                ).slice(0, 4);
                const riskItems = Array.from(new Set(riskHints.filter(Boolean))).slice(0, 3);
                return (
                  <div
                    key={row.id}
                    className={`scan-opportunity-item ${selectedRowId === row.id ? "selected" : ""} ${expanded ? "expanded" : ""} v4-${strength.tone} ${aiMeta ? `ai-${aiMeta.tone}` : ""}`}
                    onClick={() => selectAndOpenRow(row)}
                  >
                    <div className="scan-opportunity-summary-row">
                      <span className="scan-opportunity-branch" aria-hidden="true">
                        <i />
                      </span>
                      <span className="scan-opportunity-trade">
                        <strong className={`scan-opportunity-action ${side === "no" ? "sell" : "buy"}`}>
                          {formatTradeSide(row, locale, tempSymbol)}
                        </strong>
                      </span>
                      <div className="scan-opportunity-metrics">
                        <span className="scan-opportunity-stat threshold">
                          <small>{debDistanceLabel}</small>
                          <b>{debDistanceText}</b>
                        </span>
                        <span className="scan-opportunity-stat">
                          <small>{modelSupportLabel}</small>
                          <b>{modelSupportText}</b>
                        </span>
                        <span className="scan-opportunity-stat">
                          <small>{metarLabel}</small>
                          <b>{metarConflictText}</b>
                        </span>
                      </div>
                      <span className={`scan-opportunity-strength ${strength.tone}`}>
                        {strength.label}
                      </span>
                      <button
                        type="button"
                        className="scan-opportunity-expand"
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRowAnalysis(row);
                        }}
                      >
                        <BarChart3 size={14} />
                        {expanded
                          ? isEn
                            ? "Hide analysis"
                            : "收起分析"
                          : isEn
                            ? "Full analysis"
                            : "查看完整分析"}
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                    <div className={`scan-opportunity-ai ${aiMeta?.tone || "neutral"}`}>
                      <b>{isEn ? "AI forecast mapping" : "AI 预测映射"}</b>
                      <small>{shortConclusion}</small>
                    </div>
                    {expanded ? (
                      <div className="scan-v4-analysis">
                        <div className="scan-v4-heading">
                          <div>
                            <strong>{isEn ? "AI max-temperature forecast" : "AI 最高温预测"}</strong>
                            <p>{cityAnalysis}</p>
                          </div>
                          <span className={`scan-v4-decision-pill ${strength.tone}`}>
                            {strength.label}
                          </span>
                        </div>
                        <div className="scan-v4-current">
                          <b>{isEn ? "Forecast" : "预测"}</b>
                          <span>
                            {isEn ? "Expected high" : "预计最高温"}{" "}
                            <strong>
                              {cityForecast.predicted != null
                                ? formatTemperatureValue(cityForecast.predicted, tempSymbol, { digits: 1 })
                                : "--"}
                            </strong>
                            {" · "}
                            {isEn ? "interval" : "区间"} {getForecastRangeLabel(cityForecast, tempSymbol)}
                            {cityForecast.confidence ? ` · ${isEn ? "confidence" : "信心"} ${cityForecast.confidence}` : ""}
                          </span>
                          {cityForecast.reason ? (
                            <small>{cityForecast.reason}</small>
                          ) : null}
                          {cityForecast.airportRead ? (
                            <small>{cityForecast.airportRead}</small>
                          ) : null}
                          {cityForecast.peakWindow ? (
                            <small>{cityForecast.peakWindow}</small>
                          ) : null}
                        </div>
                        <div className="scan-v4-brief-grid">
                          <section>
                            <strong>{isEn ? "Key basis" : "关键依据"}</strong>
                            <ul>
                              {keyReasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </section>
                          <section>
                            <strong>{isEn ? "Risk" : "风险"}</strong>
                            <ul>
                              {riskItems.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </section>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
});
