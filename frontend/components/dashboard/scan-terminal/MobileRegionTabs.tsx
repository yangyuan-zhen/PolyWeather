"use client";

import clsx from "clsx";
import type { ContinentGroup } from "@/components/dashboard/scan-terminal/continent-grouping";

export function MobileRegionTabs({
  activeTab,
  groups,
  isEn,
  onSelectTab,
}: {
  activeTab: string;
  groups: ContinentGroup[];
  isEn: boolean;
  onSelectTab: (key: string) => void;
}) {
  return (
    <div className="mobile-region-tabs flex min-h-11 snap-x gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]">
      {groups.map((g) => {
        const label = isEn ? g.labelEn : g.labelZh;
        const isActive = activeTab === g.key;
        return (
          <button
            key={g.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelectTab(g.key)}
            className={clsx(
              "flex min-h-11 shrink-0 snap-start items-center border-b-2 px-3 text-xs font-bold whitespace-nowrap transition-colors",
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {label}
            <span className="ml-1 text-[10px] text-slate-400">
              {g.activeCount > 0 ? `${g.activeCount}A` : g.rows.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
