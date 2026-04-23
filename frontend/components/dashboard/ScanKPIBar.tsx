"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanTerminalResponse } from "@/lib/dashboard-types";

type KPIData = ScanTerminalResponse["summary"];

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function ScanKPIBar({ data }: { data: KPIData }) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";

  const cards = [
    {
      label: isEn ? "Recommended" : "推荐机会",
      value: String(data.recommended_count),
      note: `${isEn ? "Visible" : "当前展示"} ${data.visible_count}`,
      tone: "green",
    },
    {
      label: isEn ? "Avg Edge" : "平均边际优势",
      value:
        data.avg_edge_percent != null
          ? `+${data.avg_edge_percent.toFixed(1)}%`
          : "--",
      note: `${isEn ? "Candidates" : "候选总数"} ${data.candidate_total}`,
      tone: "purple",
    },
    {
      label: isEn ? "Avg Confidence" : "平均主信号置信度",
      value:
        data.avg_primary_confidence != null
          ? `+${data.avg_primary_confidence.toFixed(1)}%`
          : "--",
      note: isEn ? "Main signal score" : "主信号评分",
      tone: "blue",
    },
    {
      label: isEn ? "Tradable Markets" : "可交易市场",
      value: String(data.tradable_market_count),
      note: `${isEn ? "Filtered" : "过滤后"} / ${data.candidate_total || 0}`,
      tone: "orange",
    },
    {
      label: isEn ? "Total Volume" : "总成交量",
      value: formatVolume(data.total_volume),
      note: isEn ? "Past 24 hours" : "过去 24 小时",
      tone: "neutral",
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
