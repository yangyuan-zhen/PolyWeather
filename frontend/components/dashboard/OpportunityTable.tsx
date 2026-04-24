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

function formatVolume(value?: number | null) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "--";
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(0)}K`;
  return `$${numeric.toFixed(0)}`;
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

function scoreTone(score?: number | null) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return "green";
  if (numeric >= 70) return "yellow";
  return "gray";
}

function ProbabilityPreview({
  row,
  locale,
}: {
  row: ScanOpportunityRow;
  locale: string;
}) {
  const preview = Array.isArray(row.distribution_preview)
    ? row.distribution_preview.filter(
        (item): item is DistributionPreviewPoint =>
          Boolean(item && (item.label || item.value != null)),
      )
    : [];
  const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);

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

  const modelLabel = "EMOS";
  const marketLabel = locale === "en-US" ? "Market" : "市场";

  return (
    <div className="scan-distribution-preview">
      {preview.slice(0, 6).map((item) => {
        const modelPercent =
          item.model_probability != null ? item.model_probability * 100 : null;
        const marketPercent =
          item.market_probability != null ? item.market_probability * 100 : null;
        const modelWidth = Math.max(3, Math.min(100, Number(modelPercent || 0)));
        const marketWidth = Math.max(3, Math.min(100, Number(marketPercent || 0)));

        return (
          <div
            key={`${item.label}-${item.value ?? ""}`}
            className={`scan-distribution-card ${item.highlighted ? "featured" : ""}`}
          >
            <strong>
              {normalizeTemperatureLabel(item.label, tempSymbol) || item.label || "--"}
            </strong>
            <span className="scan-distribution-line model">
              <b>{modelLabel}</b>
              <i style={{ width: `${modelWidth}%` }} />
              <em>{formatPercent(modelPercent)}</em>
            </span>
            <span className="scan-distribution-line market">
              <b>{marketLabel}</b>
              <i style={{ width: `${marketWidth}%` }} />
              <em>{formatPercent(marketPercent)}</em>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ScoreRing({ score }: { score?: number | null }) {
  const displayScore = Math.max(0, Math.min(100, Number(score || 0)));
  return (
    <div className={`scan-score-ring tone-${scoreTone(displayScore)}`}>
      <span>{displayScore.toFixed(0)}</span>
    </div>
  );
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
      <div className="scan-table-header">
        <span />
        <span>{isEn ? "City / Market" : "城市 / 市场"}</span>
        <span>{isEn ? "Local Time / Phase" : "当前时间 / 阶段"}</span>
        <span>{isEn ? "EMOS / Market" : "EMOS / 市场"}</span>
        <span>{isEn ? "Quote / Model" : "买价 / 模型"}</span>
        <span>{isEn ? "Edge" : "边际优势"}</span>
        <span>{isEn ? "Score" : "综合得分"}</span>
      </div>

      <div className="scan-table-body">
        {rows.map((row, index) => {
          const phaseMeta = getWindowPhaseMeta(row, locale);
          const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
          const localizedCityName = getLocalizedCityName(
            row.city,
            row.city_display_name || row.display_name || row.city,
            locale,
          );
          const selected = selectedRowId === row.id;
          const scoreClass = scoreTone(row.final_score);
          return (
            <button
              key={row.id}
              type="button"
              className={`scan-table-row ${selected ? "selected" : ""}`}
              onClick={() => onSelectRow?.(row)}
            >
              <div className="scan-rank-cell">
                <div className={`scan-rank-circle ${scoreClass}`}>
                  {index + 1}
                </div>
              </div>

              <div className="scan-city-cell">
                <div className="scan-city-copy">
                  <div className="scan-city-name">{localizedCityName}</div>
                  <div className="scan-city-sub">
                    {row.market_question || row.target_label || "--"}
                  </div>
                  <div className="scan-city-volume">{formatVolume(row.volume)}</div>
                </div>
              </div>

              <div className="scan-time-cell">
                <div className="scan-time-main">{row.local_time || "--"}</div>
                <div className={`scan-phase-badge ${phaseMeta.tone}`}>
                  {phaseMeta.label}
                </div>
                <div className="scan-time-remaining">
                  {formatWindowMinutes(row.remaining_window_minutes, locale)}
                </div>
              </div>

              <ProbabilityPreview row={row} locale={locale} />

                <div className="scan-trade-cell">
                  <div className={`scan-trade-main ${row.side === "no" ? "sell" : "buy"}`}>
                  {formatAction(row, locale, tempSymbol)}
                  </div>
                <div className="scan-trade-sub">
                  {isEn ? "Buy" : "买价"} {row.ask != null ? `${Math.round(row.ask * 100)}¢` : "--"} ·{" "}
                  EMOS {formatPercent(row.model_probability != null ? row.model_probability * 100 : null)}
                </div>
                <div className="scan-trade-note">
                  {normalizeTemperatureLabel(row.target_label, tempSymbol) ||
                    row.market_direction ||
                    "--"}
                </div>
              </div>

              <div className={`scan-edge-cell ${Number(row.edge_percent || 0) >= 0 ? "positive" : "negative"}`}>
                {formatPercent(row.edge_percent, true)}
              </div>

              <div className="scan-score-cell">
                <ScoreRing score={row.final_score} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
