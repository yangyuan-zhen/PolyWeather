"use client";

import React from "react";
import { TrendingUp, BarChart3, Radio, DollarSign, Target } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

interface KPIData {
  recommendedCount: number;
  recommendedDelta?: number;
  avgEdge: number | null;
  avgEdgeDelta?: number | null;
  totalWinRate: number | null;
  tradableMarkets: number;
  filteredTotal: number;
  totalVolume: number;
}

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
      value: String(data.recommendedCount),
      delta:
        data.recommendedDelta != null
          ? `${isEn ? "vs last" : "较上次"} ${data.recommendedDelta > 0 ? "+" : ""}${data.recommendedDelta}`
          : null,
      accent: "green" as const,
    },
    {
      icon: TrendingUp,
      label: isEn ? "Avg Edge" : "平均边际优势",
      value: data.avgEdge != null ? `+${data.avgEdge.toFixed(1)}%` : "--",
      delta:
        data.avgEdgeDelta != null
          ? `${isEn ? "vs last" : "较上次"} ${data.avgEdgeDelta > 0 ? "+" : ""}${data.avgEdgeDelta.toFixed(1)}%`
          : null,
      accent: "green" as const,
    },
    {
      icon: BarChart3,
      label: isEn ? "Total Win Rate" : "总胜率预测",
      value:
        data.totalWinRate != null ? `+${data.totalWinRate.toFixed(1)}%` : "--",
      delta: isEn ? "Model confidence" : "模型全分配",
      accent: "green" as const,
    },
    {
      icon: Radio,
      label: isEn ? "Tradable Markets" : "可交易市场",
      value: String(data.tradableMarkets),
      delta: `${isEn ? "Filtered" : "过滤后"} / ${data.filteredTotal}`,
      accent: "purple" as const,
    },
    {
      icon: DollarSign,
      label: isEn ? "Total Volume" : "总成交量",
      value: formatVolume(data.totalVolume),
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
