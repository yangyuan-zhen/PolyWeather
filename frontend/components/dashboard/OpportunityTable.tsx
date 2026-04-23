"use client";

import React from "react";
import { Star } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";

function getStatusMeta(
  row: ScanOpportunityRow,
  locale: string,
): { label: string; tone: "green" | "amber" | "purple" | "neutral" } {
  const phase = String(row.window_phase || "").toLowerCase();
  if (phase === "active_peak" || phase === "setup_today") {
    return { label: locale === "en-US" ? "Tradable" : "可交易", tone: "green" };
  }
  if (phase === "tomorrow" || phase === "week_ahead") {
    return { label: locale === "en-US" ? "Early" : "早期机会", tone: "purple" };
  }
  if (phase === "post_peak") {
    return { label: locale === "en-US" ? "Post Peak" : "峰后确认", tone: "amber" };
  }
  return { label: locale === "en-US" ? "Watching" : "观察中", tone: "neutral" };
}

function formatPercent(value?: number | null, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  if (!signed) return `${numeric.toFixed(1)}%`;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function formatTimeBlock(row: ScanOpportunityRow, locale: string) {
  const parts: string[] = [];
  if (row.local_time) {
    parts.push(row.local_time);
  }
  if (row.selected_date) {
    parts.push(row.selected_date);
  }
  return parts.join(" · ") || (locale === "en-US" ? "No time" : "暂无时间");
}

function formatAction(row: ScanOpportunityRow, locale: string) {
  if (row.side === "yes") {
    return `${locale === "en-US" ? "Buy" : "买入"} Yes ${row.target_label || ""}`.trim();
  }
  if (row.side === "no") {
    return `${locale === "en-US" ? "Buy" : "买入"} No ${row.target_label || ""}`.trim();
  }
  return row.action || "--";
}

function formatProbability(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function ScoreRing({ score }: { score?: number | null }) {
  const displayScore = Math.max(0, Math.min(100, Number(score || 0)));
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const progress = (displayScore / 100) * circumference;
  const color =
    displayScore >= 85 ? "#00E0A4" : displayScore >= 70 ? "#FFB020" : "#FF4D6A";

  return (
    <div className="scan-score-ring">
      <svg viewBox="0 0 48 48" width={48} height={48}>
        <circle
          cx={24}
          cy={24}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={3}
        />
        <circle
          cx={24}
          cy={24}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${progress} ${circumference - progress}`}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="scan-score-value" style={{ color }}>
        {displayScore.toFixed(0)}
      </span>
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

  return (
    <div className="scan-table-container">
      <div className="scan-table-header">
        <span className="scan-th scan-th-rank">#</span>
        <span className="scan-th scan-th-city">
          {isEn ? "City / Market" : "城市 / 市场"}
        </span>
        <span className="scan-th scan-th-time">
          {isEn ? "Time / Phase" : "时间 / 阶段"}
        </span>
        <span className="scan-th scan-th-prob">
          {isEn ? "EMOS vs Market" : "EMOS vs 市场"}
        </span>
        <span className="scan-th scan-th-action">
          {isEn ? "Best Action" : "最佳动作"}
        </span>
        <span className="scan-th scan-th-edge">
          {isEn ? "Edge" : "边际优势"}
        </span>
        <span className="scan-th scan-th-score">
          {isEn ? "Score" : "综合得分"}
        </span>
        <span className="scan-th scan-th-fav" />
      </div>

      {rows.map((row, index) => {
        const status = getStatusMeta(row, locale);
        const localizedCityName = getLocalizedCityName(
          row.city,
          row.city_display_name || row.display_name || row.city,
          locale,
        );
        const selected = selectedRowId === row.id;
        const finalScore = Number(row.final_score || 0);

        return (
          <button
            key={row.id}
            type="button"
            className={`scan-table-row ${selected ? "selected" : ""} ${row.tradable ? "tradable" : ""}`}
            onClick={() => onSelectRow?.(row)}
          >
            <span className={`scan-td scan-td-rank rank-${status.tone}`}>
              <span className="scan-rank-circle">{row.rank || index + 1}</span>
            </span>

            <span className="scan-td scan-td-city">
              <span className="scan-city-thumb">
                <span className="scan-city-img-placeholder" />
              </span>
              <span className="scan-city-info">
                <span className="scan-city-name">{localizedCityName}</span>
                <span className="scan-city-sub">
                  {row.target_label || row.market_question || "--"}
                </span>
              </span>
            </span>

            <span className="scan-td scan-td-time">
              <span className="scan-time-text">{formatTimeBlock(row, locale)}</span>
              <span className={`scan-status-badge tone-${status.tone}`}>
                {status.label}
              </span>
            </span>

            <span className="scan-td scan-td-prob">
              <div className="scan-city-info">
                <span className="scan-city-name">
                  {formatProbability(row.model_event_probability)} /{" "}
                  {formatProbability(row.market_event_probability)}
                </span>
                <span className="scan-city-sub">
                  {isEn ? "Bias" : "偏移"}{" "}
                  {row.distribution_bias_direction || "--"} ·{" "}
                  {formatPercent(row.distribution_bias_score)}
                </span>
              </div>
            </span>

            <span className="scan-td scan-td-action">
              <span className="scan-action-text">
                {formatAction(row, locale)}
              </span>
            </span>

            <span className="scan-td scan-td-edge">
              <span
                className={`scan-edge-value ${finalScore > 0 ? "positive" : "neutral"}`}
              >
                {formatPercent(row.edge_percent, true)}
              </span>
            </span>

            <span className="scan-td scan-td-score">
              <ScoreRing score={row.final_score} />
            </span>

            <span className="scan-td scan-td-fav">
              <Star size={16} className="scan-fav-icon" />
            </span>
          </button>
        );
      })}

      {!rows.length ? (
        <div className="scan-detail-empty">
          <div>
            <div className="scan-detail-section-title">
              {isEn ? "No primary signal" : "当前无主信号"}
            </div>
            <p className="scan-city-sub">
              {isEn
                ? "No opportunity passed the price, spread, liquidity, and edge filters."
                : "当前没有机会同时满足价格、点差、流动性和 edge 过滤。"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
