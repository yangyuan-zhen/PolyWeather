"use client";

import React from "react";
import { TrendingUp, BarChart3, Radio, DollarSign, Target } from "lucide-react";
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

  const kpis = [
    {
      icon: Target,
      label: isEn ? "Recommended" : "推荐机会",
      value: String(data.recommended_count),
      delta: `${isEn ? "Showing" : "当前展示"} ${data.visible_count}`,
      accent: "green" as const,
    },
    {
      icon: TrendingUp,
      label: isEn ? "Avg Edge" : "平均边际优势",
      value:
        data.avg_edge_percent != null
          ? `+${data.avg_edge_percent.toFixed(1)}%`
          : "--",
      delta: `${isEn ? "Candidates" : "候选总数"} ${data.candidate_total}`,
      accent: "green" as const,
    },
    {
      icon: BarChart3,
      label: isEn ? "Avg Confidence" : "平均主信号置信度",
      value:
        data.avg_primary_confidence != null
          ? `${data.avg_primary_confidence.toFixed(0)}`
          : "--",
      delta: isEn ? "Main signal score" : "主信号评分",
      accent: "green" as const,
    },
    {
      icon: Radio,
      label: isEn ? "Tradable Markets" : "可交易市场",
      value: String(data.tradable_market_count),
      delta: data.resolved_market_type || "maxtemp",
      accent: "purple" as const,
    },
    {
      icon: DollarSign,
      label: isEn ? "Total Volume" : "总成交量",
      value: formatVolume(data.total_volume),
      delta: isEn ? "Past 24h" : "过去 24 小时",
      accent: "purple" as const,
    },
  ];

  return (
    <div className="scan-kpi-bar">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div
            key={kpi.label}
            className={`scan-kpi-card scan-kpi-${kpi.accent}`}
          >
            <div className="scan-kpi-header">
              <Icon size={14} className="scan-kpi-icon" />
              <span className="scan-kpi-label">{kpi.label}</span>
            </div>
            <div className="scan-kpi-value">{kpi.value}</div>
            {kpi.delta && <div className="scan-kpi-delta">{kpi.delta}</div>}
          </div>
        );
      })}
    </div>
  );
}
