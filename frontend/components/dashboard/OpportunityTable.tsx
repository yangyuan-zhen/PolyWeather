"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  DistributionPreviewPoint,
  ScanOpportunityRow,
} from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import {
  formatTemperatureValue,
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
      model_probability: row.model_event_probability,
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

function buildOpportunityGroups(rows: ScanOpportunityRow[], locale: string): OpportunityGroup[] {
  const groups = new Map<string, OpportunityGroup>();
  for (const row of rows) {
    const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
    const cityName = getLocalizedCityName(
      row.city,
      row.city_display_name || row.display_name || row.city,
      locale,
    );
    const date = row.selected_date || row.local_date || "";
    const key = `${row.city || cityName}|${date}`;
    const peak = getEmosPeak(row, tempSymbol);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        cityName,
        date,
        tempSymbol,
        debLabel:
          row.deb_prediction != null
            ? formatTemperatureValue(Number(row.deb_prediction), tempSymbol, { digits: 1 })
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
}: {
  rows: ScanOpportunityRow[];
  status?: string | null;
  stale?: boolean;
  staleReason?: string | null;
  loading?: boolean;
  selectedRowId?: string | null;
  onSelectRow?: (row: ScanOpportunityRow) => void;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const hasRows = rows.length > 0;
  const scanInProgress =
    loading || status === "partial" || status === "scanning";
  const groups = React.useMemo(
    () => buildOpportunityGroups(rows, locale),
    [rows, locale],
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
        {groups.map((group) => (
          <section key={group.key} className="scan-opportunity-group">
            <div className="scan-opportunity-group-head">
              <div className="scan-opportunity-city">
                <strong>{group.cityName}</strong>
                <div className="scan-opportunity-models">
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
                <span>{group.localTime || "--"}</span>
                <b className={`scan-phase-badge ${group.phaseMeta.tone}`}>
                  {group.phaseMeta.label}
                </b>
                <em>{formatWindowMinutes(group.remainingMinutes, locale)}</em>
              </div>
            </div>

            <div className="scan-opportunity-items">
              {group.rows.map((row, rowIndex) => {
                const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
                const selected = selectedRowId === row.id;
                const side = String(row.side || "").toLowerCase();
                const modelProbability =
                  row.model_probability != null
                    ? row.model_probability * 100
                    : row.model_event_probability != null
                      ? row.model_event_probability * 100
                      : null;
                const modelLabel = row.cluster_adjusted
                  ? isEn
                    ? "Model"
                    : "模型"
                  : "EMOS";
                const priceLabel = side === "no" ? "NO" : isEn ? "Market" : "市场";
                const edgePositive = Number(row.edge_percent || 0) >= 0;
                const aiMeta = getAiMeta(row, locale);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`scan-opportunity-item ${selected ? "selected" : ""} ${aiMeta ? `ai-${aiMeta.tone}` : ""}`}
                    onClick={() => onSelectRow?.(row)}
                  >
                    <span className="scan-opportunity-branch" aria-hidden="true">
                      <i />
                    </span>
                    <span className="scan-opportunity-trade">
                      <strong className={`scan-opportunity-action ${side === "no" ? "sell" : "buy"}`}>
                        {formatAction(row, locale, tempSymbol)}
                      </strong>
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
                        {formatPercent(row.edge_percent, true)}
                      </b>
                    </span>
                    {aiMeta ? (
                      <span className={`scan-opportunity-ai ${aiMeta.tone}`}>
                        <b>{aiMeta.label}</b>
                        {aiMeta.reason ? <small>{aiMeta.reason}</small> : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
});
