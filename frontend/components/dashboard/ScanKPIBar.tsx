"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanOpportunityRow, ScanTerminalResponse } from "@/lib/dashboard-types";

function formatTemperature(value?: number | null, unit?: string | null): string {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(1)}${unit || "°C"}`;
}

export function ScanKPIBar({
  response,
  rows,
  totalCities,
  loading: _loading,
}: {
  response: ScanTerminalResponse | null;
  rows: ScanOpportunityRow[];
  totalCities: number;
  loading: boolean;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const bestRow = rows[0] || null;

  const cards = [
    {
      label: isEn ? "AI Workspace" : "AI 工作区",
      value: `${rows.length}/${totalCities || 0}`,
      note: isEn
        ? "No automatic scan. Cities are added from map clicks."
        : "不主动扫描；地图点选后加入城市分析。",
      tone: response?.status === "failed" ? "red" : response?.status === "stale" ? "amber" : "cyan",
    },
    {
      label: isEn ? "City Pool" : "城市池",
      value: `${totalCities || 0}`,
      note: isEn ? "Available cities for forecast review" : "可点击进入 AI 预测的城市范围",
      tone: "blue",
    },
    {
      label: isEn ? "Forecast Center" : "预测中枢",
      value: bestRow ? formatTemperature(bestRow.deb_prediction, bestRow.temp_symbol || bestRow.target_unit) : "--",
      note: bestRow
        ? `${isEn ? "Focus" : "焦点"} ${bestRow.city_display_name || bestRow.display_name || bestRow.city} · DEB / ${isEn ? "models" : "模型"} / METAR`
        : isEn
          ? "Select a city to load DEB and observations"
          : "选择城市后展示 DEB 与实测路径",
      tone: "green",
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
