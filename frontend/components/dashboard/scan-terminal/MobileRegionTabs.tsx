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
    <div className="mobile-region-tabs flex overflow-x-auto border-b border-slate-200 bg-white px-2">
      {groups.map((g) => {
        const label = isEn ? g.labelEn : g.labelZh;
        const isActive = activeTab === g.key;
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => onSelectTab(g.key)}
            className={clsx(
              "shrink-0 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors",
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
