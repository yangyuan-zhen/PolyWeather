"use client";

import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  DistributionPreviewPoint,
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

function formatAction(
  row: ScanOpportunityRow,
  locale: string,
  tempSymbol?: string | null,
) {
  const formattedTarget = normalizeTemperatureLabel(row.target_label, tempSymbol);
  if (row.action) {
    return row.target_label
      ? row.action.replace(String(row.target_label), formattedTarget || String(row.target_label))
      : row.action;
  }
  if (row.side === "yes") {
    return `${locale === "en-US" ? "Buy Yes" : "买入 Yes"} ${formattedTarget || ""}`.trim();
  }
  if (row.side === "no") {
    return `${locale === "en-US" ? "Buy No" : "买入 No"} ${formattedTarget || ""}`.trim();
  }
  return "--";
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

function formatTradeSide(row: ScanOpportunityRow, locale: string) {
  const side = String(row.side || "").toLowerCase();
  if (side === "yes") return "BUY YES";
  if (side === "no") return "BUY NO";
  if (row.action) {
    return String(row.action)
      .replace(String(row.target_label || ""), "")
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

function getOpportunityStrength(edgePercent?: number | null, locale = "zh-CN") {
  const edge = Number(edgePercent);
  const normalized = Number.isFinite(edge) ? edge : 0;
  if (normalized >= 20) {
    return {
      label: locale === "en-US" ? "Strong" : "强机会",
      tone: "strong",
    };
  }
  if (normalized >= 10) {
    return {
      label: locale === "en-US" ? "Medium" : "中机会",
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
  edgePercent?: number | null,
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

  const edgeText = formatPercent(edgePercent, true);
  const modelBasis = getModelSourceSummary(row, locale, row.target_unit || row.temp_symbol);
  if (locale === "en-US") {
    return `${strengthLabel || "Watch"} setup: edge ${edgeText}; V4 should validate against ${modelBasis}.`;
  }
  return `${strengthLabel || "观察"}：edge ${edgeText}，V4 需结合${modelBasis}确认。`;
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
        ? `Wide spread ${formatQuoteCents(spread)} may distort executable edge.`
        : `盘口价差 ${formatQuoteCents(spread)} 偏宽，可能扭曲可执行 edge。`,
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
        ? "Tail bucket was cluster-adjusted; raw edge may be overstated."
        : "尾部桶已做模型集群折扣，原始 edge 可能偏乐观。",
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
  modelProbability?: number | null,
  edgePercent?: number | null,
  price?: number | null,
) {
  const reasons: string[] = [];
  const aiReason = getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en);
  if (aiReason && String(row.ai_decision || "").toLowerCase() === "approve") {
    reasons.push(aiReason);
  }
  reasons.push(
    locale === "en-US"
      ? `EMOS probability ${formatPercent(modelProbability)} vs market price ${formatQuoteCents(price)} gives edge ${formatPercent(edgePercent, true)}.`
      : `EMOS 概率 ${formatPercent(modelProbability)} 对比市场价格 ${formatQuoteCents(price)}，edge ${formatPercent(edgePercent, true)}。`,
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
          ? "V4 did not classify this row as a primary recommendation."
          : "V4 未把该合约列为主推荐。"),
    ];
  }
  if (edgePercent != null && Number(edgePercent) < 10) {
    return [
      locale === "en-US"
        ? "Edge is below the medium-opportunity threshold."
        : "edge 低于中机会阈值。",
    ];
  }
  return [
    locale === "en-US"
      ? "No hard veto in the current V4/rule snapshot."
      : "当前 V4/规则快照没有硬性排除项。",
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

function getDistributionPreview(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const preview = Array.isArray(row.distribution_preview)
    ? row.distribution_preview.filter(
        (item): item is DistributionPreviewPoint =>
          Boolean(item && (item.label || item.value != null)),
      )
    : [];

  if (!preview.length) {
    const targetBase =
      row.target_value ??
      row.target_threshold ??
      row.target_lower ??
      row.target_upper ??
      null;
    const targetLabel =
      targetBase != null
        ? formatTemperatureValue(Number(targetBase), tempSymbol)
        : normalizeTemperatureLabel(row.target_label, tempSymbol) || "--";
    preview.push({
      label: targetLabel,
      model_probability:
        row.raw_model_event_probability ?? row.model_event_probability,
      market_probability: row.market_event_probability,
      highlighted: true,
    });
  }
  return preview;
}

function getEmosPeak(row: ScanOpportunityRow, tempSymbol?: string | null) {
  const preview = getDistributionPreview(row, tempSymbol);
  const peak =
    preview.reduce<DistributionPreviewPoint | null>((best, item) => {
      const probability = Number(item.model_probability ?? -1);
      const bestProbability = Number(best?.model_probability ?? -1);
      return probability > bestProbability ? item : best;
    }, null) || preview.find((item) => item.highlighted) || preview[0];
  const peakValue = peak?.value ?? row.peak_value ?? null;
  const peakLabel = normalizeTemperatureLabel(peak?.label, tempSymbol) ||
    (peakValue != null ? formatTemperatureValue(Number(peakValue), tempSymbol) : "--");
  const peakProbability =
    peak?.model_probability != null
      ? Number(peak.model_probability) * 100
      : row.peak_probability != null
        ? Number(row.peak_probability) * 100
        : null;
  return { label: peakLabel, probability: peakProbability };
}

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

function getDetailPeak(
  detail: CityDetail | null,
  row?: ScanOpportunityRow | null,
  tempSymbol?: string | null,
) {
  if (!detail) return null;
  const view = getProbabilityView(detail, getDetailViewDate(detail, row));
  const buckets = Array.isArray(view.probabilitiesAll)
    ? view.probabilitiesAll
    : [];
  const peak = [...buckets]
    .filter((bucket) => normalizeProbability(bucket?.probability) != null)
    .sort(
      (a, b) =>
        Number(normalizeProbability(b?.probability)) -
        Number(normalizeProbability(a?.probability)),
    )[0];
  if (!peak) return null;
  const peakValue = peak.value ?? null;
  return {
    label:
      normalizeTemperatureLabel(peak.label || peak.bucket || peak.range, tempSymbol) ||
      (peakValue != null ? formatTemperatureValue(Number(peakValue), tempSymbol) : "--"),
    probability: Number(normalizeProbability(peak.probability)) * 100,
  };
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
    const peak = getDetailPeak(detail, row, tempSymbol) || getEmosPeak(row, tempSymbol);
    const modelView = detail ? getModelView(detail, date) : null;
    const debPrediction = modelView?.deb ?? row.deb_prediction ?? null;
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
        peakLabel: peak.label,
        peakProbability: peak.probability,
        phaseMeta: getWindowPhaseMeta(row, locale),
        localTime: row.local_time,
        remainingMinutes: row.remaining_window_minutes,
        rows: [row],
      });
      continue;
    }
    existing.rows.push(row);
    if ((peak.probability ?? -1) > (existing.peakProbability ?? -1)) {
      existing.peakLabel = peak.label;
      existing.peakProbability = peak.probability;
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
                if (firstRow) onSelectRow?.(firstRow);
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
                    <em>EMOS peak</em>
                    <b>{group.peakLabel}</b>
                  </span>
                  {group.peakProbability != null ? (
                    <span>
                      <em>{isEn ? "Peak prob" : "峰值概率"}</em>
                      <b>{formatPercent(group.peakProbability)}</b>
                    </span>
                  ) : null}
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
                const modelLabel = isEn ? "EMOS prob" : "EMOS 概率";
                const priceLabel = isEn ? "Market price" : "市场价格";
                const edgePositive = Number(edgePercent || 0) >= 0;
                const aiMeta = getAiMeta(row, locale);
                const strength = getOpportunityStrength(edgePercent, locale);
                const expanded = expandedRowIds.has(row.id);
                const shortConclusion = getShortAiConclusion(
                  row,
                  locale,
                  edgePercent,
                  strength.label,
                );
                const recommendationReasons = getRecommendationReasons(
                  row,
                  locale,
                  modelProbability,
                  edgePercent,
                  row.ask,
                );
                const exclusionReasons = getExclusionReasons(row, locale, edgePercent);
                const riskHints = getRiskHints(row, locale, modelProbability);
                const thesis =
                  getLocalizedRowText(
                    row,
                    locale,
                    row.ai_city_thesis_zh,
                    row.ai_city_thesis_en,
                  ) ||
                  getLocalizedRowText(row, locale, row.ai_reason_zh, row.ai_reason_en) ||
                  (isEn
                    ? `${group.cityName} thesis: validate this ${formatTradeSide(row, locale)} against the full model cluster before sizing.`
                    : `${group.cityName} thesis：该 ${formatTradeSide(row, locale)} 需要先结合全部模型集群确认，再考虑仓位。`);
                const modelSources = formatModelSources(row, tempSymbol);
                return (
                  <div
                    key={row.id}
                    className={`scan-opportunity-item ${selectedRowId === row.id ? "selected" : ""} ${aiMeta ? `ai-${aiMeta.tone}` : ""}`}
                    onClick={() => onSelectRow?.(row)}
                  >
                    <span className="scan-opportunity-branch" aria-hidden="true">
                      <i />
                    </span>
                    <span className="scan-opportunity-trade">
                      <strong className={`scan-opportunity-action ${side === "no" ? "sell" : "buy"}`}>
                        {formatTradeSide(row, locale)}
                      </strong>
                    </span>
                    <span className="scan-opportunity-stat threshold">
                      <small>{isEn ? "Threshold" : "阈值"}</small>
                      <b>{formatThreshold(row, tempSymbol)}</b>
                    </span>
                    <span className="scan-opportunity-stat">
                      <small>{modelLabel}</small>
                      <b>{formatPercent(modelProbability)}</b>
                    </span>
                    <span className="scan-opportunity-stat">
                      <small>{priceLabel}</small>
                      <b>{formatQuoteCents(row.ask)}</b>
                    </span>
                    <span className="scan-opportunity-stat edge">
                      <small>edge</small>
                      <b className={edgePositive ? "positive" : "negative"}>
                        {formatPercent(edgePercent, true)}
                      </b>
                    </span>
                    <span className={`scan-opportunity-strength ${strength.tone}`}>
                      {strength.label}
                    </span>
                    <button
                      type="button"
                      className="scan-opportunity-expand"
                      aria-expanded={expanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpandedRow(row.id);
                        onSelectRow?.(row);
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
                    <span className={`scan-opportunity-ai ${aiMeta?.tone || "neutral"}`}>
                      <b>{isEn ? "AI take" : "AI 结论"}</b>
                      <small>{shortConclusion}</small>
                    </span>
                    {expanded ? (
                      <div className="scan-v4-analysis">
                        <section>
                          <strong>thesis</strong>
                          <p>{thesis}</p>
                        </section>
                        <section>
                          <strong>{isEn ? "Recommendation reasons" : "推荐理由"}</strong>
                          <ul>
                            {recommendationReasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </section>
                        <section>
                          <strong>{isEn ? "Exclusion reasons" : "排除理由"}</strong>
                          <ul>
                            {exclusionReasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </section>
                        <section>
                          <strong>{isEn ? "Risk notes" : "风险提示"}</strong>
                          <ul>
                            {riskHints.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </section>
                        <section className="scan-v4-evidence">
                          <strong>{isEn ? "Data basis" : "数据依据"}</strong>
                          <div>
                            <span>DEB {group.debLabel}</span>
                            <span>EMOS peak {group.peakLabel}</span>
                            <span>
                              {isEn ? "Peak prob" : "峰值概率"}{" "}
                              {formatPercent(group.peakProbability)}
                            </span>
                            <span>
                              {isEn ? "Ask" : "买价"} {formatQuoteCents(row.ask)}
                            </span>
                            <span>edge {formatPercent(edgePercent, true)}</span>
                            {row.kelly_fraction != null ? (
                              <span>
                                Kelly {formatPercent(Number(row.kelly_fraction) * 100)}
                              </span>
                            ) : null}
                          </div>
                          <div className="scan-v4-model-sources">
                            {modelSources.length ? (
                              modelSources.map((source) => (
                                <span key={source.name}>
                                  <em>{source.name}</em>
                                  <b>{source.value}</b>
                                </span>
                              ))
                            ) : (
                              <span>
                                <em>{isEn ? "Models" : "模型"}</em>
                                <b>
                                  {isEn
                                    ? "waiting for cluster"
                                    : "等待模型集群"}
                                </b>
                              </span>
                            )}
                          </div>
                        </section>
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
