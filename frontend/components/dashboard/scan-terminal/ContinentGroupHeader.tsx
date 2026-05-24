"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ContinentGroup } from "@/components/dashboard/scan-terminal/continent-grouping";

export function ContinentGroupHeader({
  group,
  isExpanded,
  isEn,
  onToggle,
}: {
  group: ContinentGroup;
  isExpanded: boolean;
  isEn: boolean;
  onToggle: () => void;
}) {
  const label = isEn ? group.labelEn : group.labelZh;
  const parts: string[] = [`${group.rows.length}`];

  if (group.activeCount > 0) {
    parts.push(isEn ? `Active ${group.activeCount}` : `活跃 ${group.activeCount}`);
  }
  if (group.watchCount > 0) {
    parts.push(isEn ? `Watch ${group.watchCount}` : `观察 ${group.watchCount}`);
  }
  if (group.localTimeRange) {
    parts.push(`LT ${group.localTimeRange}`);
  }
  if (group.hotCity) {
    parts.push(isEn ? `Hot: ${group.hotCity}` : `热门: ${group.hotCity}`);
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-2 border-b border-slate-200 bg-[#eef2f6] px-3 py-2 text-left hover:bg-[#e2e8f0] transition-colors"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center text-slate-400 group-hover:text-slate-600">
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <span className="text-xs font-black uppercase tracking-wide text-slate-600">
        {label}
      </span>
      <span className="text-[11px] text-slate-400">
        {parts.join(" · ")}
      </span>
    </button>
  );
}
