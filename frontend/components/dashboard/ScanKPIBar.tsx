"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanOpportunityRow, ScanTerminalResponse } from "@/lib/dashboard-types";

function formatPercent(value?: number | null, signed = false): string {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const numeric = Number(value);
  return `${signed && numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function countByRisk(rows: ScanOpportunityRow[]) {
  return rows.reduce(
    (acc, row) => {
      const risk = String(row.risk_level || "").toLowerCase();
      if (risk.includes("high")) acc.high += 1;
      else if (risk.includes("medium")) acc.medium += 1;
      else acc.low += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

export function ScanKPIBar({
  response,
  rows,
  totalCities,
  loading,
}: {
  response: ScanTerminalResponse | null;
  rows: ScanOpportunityRow[];
  totalCities: number;
  loading: boolean;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const summary = response?.summary;
  const riskCounts = countByRisk(rows);
  const tradableRows = rows.filter((row) => row.tradable && !row.closed);
  const liveRows = rows.filter((row) => row.active || row.accepting_orders);
  const bestRow = rows[0] || null;
  const statusLabel =
    loading && !response
      ? isEn
        ? "Scanning"
        : "扫描中"
      : response?.status === "stale"
        ? isEn
          ? "Stale"
          : "旧数据"
        : response?.status === "failed"
          ? isEn
            ? "Failed"
            : "失败"
          : isEn
            ? "Live"
            : "最新";

  const cards = [
    {
      label: isEn ? "Scan Status" : "扫描状态",
      value: `${rows.length}/${totalCities || 0}`,
      note:
        loading && response
          ? isEn
            ? "Refreshing latest snapshot"
            : "正在刷新最新快照"
          : response?.status === "stale"
            ? response.stale_reason || (isEn ? "Using last good snapshot" : "正在使用上次成功快照")
            : response?.status === "failed"
              ? response.stale_reason || (isEn ? "No valid snapshot" : "当前没有可用快照")
              : `${isEn ? "Snapshot" : "快照"} · ${statusLabel}`,
      tone: response?.status === "failed" ? "red" : response?.status === "stale" ? "amber" : "cyan",
    },
    {
      label: isEn ? "Book Status" : "盘口状态",
      value: `${liveRows.length}`,
      note: `${isEn ? "Tradable" : "可交易"} ${tradableRows.length} · ${isEn ? "No edge" : "无机会"} ${Math.max(0, rows.length - tradableRows.length)}`,
      tone: "blue",
    },
    {
      label: isEn ? "Opportunity Quality" : "机会质量",
      value: formatPercent(summary?.avg_edge_percent, true),
      note: bestRow
        ? `${isEn ? "Best" : "最佳"} ${bestRow.city_display_name || bestRow.display_name || bestRow.city} · ${formatPercent(bestRow.edge_percent, true)}`
        : isEn
          ? "No active market now"
          : "当前没有活跃市场",
      tone: "green",
    },
    {
      label: isEn ? "Risk Layers" : "风险层",
      value: `${riskCounts.high} / ${riskCounts.medium} / ${riskCounts.low}`,
      note: `${isEn ? "High / Med / Low" : "高 / 中 / 低"}`,
      tone: "purple",
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
