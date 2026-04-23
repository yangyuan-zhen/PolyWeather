"use client";

import React from "react";
import { Star } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type {
  DistributionPreviewPoint,
  ScanOpportunityRow,
} from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";

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

function formatAction(row: ScanOpportunityRow, locale: string) {
  if (row.action) return row.action;
  if (row.side === "yes") {
    return `${locale === "en-US" ? "Buy Yes" : "买入 Yes"} ${row.target_label || ""}`.trim();
  }
  if (row.side === "no") {
    return `${locale === "en-US" ? "Buy No" : "买入 No"} ${row.target_label || ""}`.trim();
  }
  return "--";
}

export function getWindowPhaseMeta(
  row: Pick<ScanOpportunityRow, "window_phase" | "trend_alignment">,
  locale: string,
): PhaseMeta {
  const mode = String(row.window_phase || "").toLowerCase();
  if (mode === "active_peak") {
    return {
      label: locale === "en-US" ? "Peak Window" : "峰值窗口",
      tone: "red",
    };
  }
  if (mode === "setup_today" || mode === "early_today") {
    return {
      label: locale === "en-US" ? "Touch Play" : "触达博弈",
      tone: "red",
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

  if (!preview.length) {
    const targetBase =
      row.target_value ??
      row.target_threshold ??
      row.target_lower ??
      row.target_upper ??
      null;
    const unit = row.target_unit || row.temp_symbol || "";
    const targetLabel =
      targetBase != null
        ? `${Math.round(Number(targetBase))}${unit}`
        : row.target_label || "--";
    preview.push({
      label: targetLabel,
      model_probability: row.model_event_probability,
      market_probability: row.market_event_probability,
      highlighted: true,
    });
  }

  return (
    <div className="scan-distribution-preview">
      {preview.slice(0, 6).map((item) => (
        <div
          key={`${item.label}-${item.value ?? ""}`}
          className={`scan-distribution-card ${item.highlighted ? "featured" : ""}`}
        >
          <strong>{item.label || "--"}</strong>
          <span>
            {locale === "en-US" ? "Model" : "模型"}
            <br />
            {formatPercent(
              item.model_probability != null ? item.model_probability * 100 : null,
            )}
          </span>
          <br />
          <span>
            {locale === "en-US" ? "Market" : "市场"}
            <br />
            {formatPercent(
              item.market_probability != null ? item.market_probability * 100 : null,
            )}
          </span>
        </div>
      ))}
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

export function OpportunityTable({
  rows,
  selectedRowId,
  onSelectRow,
}: {
  rows: ScanOpportunityRow[];
  selectedRowId?: string | null;
  onSelectRow?: (row: ScanOpportunityRow) => void;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";

  if (!rows.length) {
    return (
      <div className="scan-table-shell empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "No main signal right now" : "当前无主信号"}
          </div>
          <div className="scan-empty-copy">
            {isEn
              ? "No row passed the price, spread, liquidity, and edge thresholds."
              : "当前没有机会同时满足价格、点差、流动性和 edge 过滤。"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-table-shell">
      <div className="scan-table-header">
        <span />
        <span>{isEn ? "City / Market" : "城市 / 市场"}</span>
        <span>{isEn ? "Local Time / Phase" : "当前时间 / 阶段"}</span>
        <span>{isEn ? "Model vs Market" : "模型分布 vs 市场分布"}</span>
        <span>{isEn ? "Best Opportunity" : "最佳机会"}</span>
        <span>{isEn ? "Edge" : "边际优势"}</span>
        <span>{isEn ? "Score" : "综合得分"}</span>
      </div>

      <div className="scan-table-body">
        {rows.map((row, index) => {
          const phaseMeta = getWindowPhaseMeta(row, locale);
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
                  {row.rank || index + 1}
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
                  {formatAction(row, locale)}
                </div>
                <div className="scan-trade-sub">
                  {formatPercent(row.ask != null ? row.ask * 100 : null)} →{" "}
                  {formatPercent(row.model_probability != null ? row.model_probability * 100 : null)}
                </div>
                <div className="scan-trade-note">
                  {row.target_label || row.market_direction || "--"}
                </div>
              </div>

              <div className={`scan-edge-cell ${Number(row.edge_percent || 0) >= 0 ? "positive" : "negative"}`}>
                {formatPercent(row.edge_percent, true)}
              </div>

              <div className="scan-score-cell">
                <ScoreRing score={row.final_score} />
              </div>

              <div className="scan-row-fav">
                <Star size={16} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
