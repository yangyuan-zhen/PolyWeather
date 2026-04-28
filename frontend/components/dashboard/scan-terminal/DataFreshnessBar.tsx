"use client";

import type { StatusTone } from "@/components/dashboard/scan-terminal/CityStatusTags";

export type DataFreshnessRow = {
  label: string;
  value: string;
  tone: string;
};

export function DataFreshnessBar({
  aiStatusLabel,
  aiStatusTone,
  freshnessSeparator,
  isEn,
  rows,
}: {
  aiStatusLabel: string;
  aiStatusTone: StatusTone;
  freshnessSeparator: string;
  isEn: boolean;
  rows: DataFreshnessRow[];
}) {
  return (
    <div className="scan-ai-city-freshness" aria-label={isEn ? "Data freshness" : "数据新鲜度"}>
      <strong>{isEn ? "Data freshness" : "数据新鲜度"}</strong>
      {rows.map((freshness) => (
        <span key={freshness.label} className={freshness.tone}>
          <b>{freshness.label}{freshnessSeparator}</b>
          <em>{freshness.value}</em>
        </span>
      ))}
      <span className={aiStatusTone}>
        <b>AI{freshnessSeparator}</b>
        <em>{aiStatusLabel}</em>
      </span>
    </div>
  );
}
