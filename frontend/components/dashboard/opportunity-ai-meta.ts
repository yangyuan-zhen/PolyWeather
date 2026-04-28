import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatQuoteCents } from "./opportunity-format";
import { getLocalizedRowText } from "./opportunity-copy";
import { getModelSourceSummary } from "./opportunity-model-summary";

export function getOpportunityStrength(edgePercent?: number | null, locale = "zh-CN") {
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

export function getShortAiConclusion(
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

export function getRiskHints(
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

export function getRecommendationReasons(
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

export function getExclusionReasons(
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

export function getAiMeta(row: ScanOpportunityRow, locale: string) {
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
