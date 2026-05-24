"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  type ContinentGroup,
  formatPrice,
  formatSpreadLiquidity,
  GAP_COLOR_MAP,
  getGapColor,
  getSignalLabel,
  getSignalState,
  getDefaultExpanded,
} from "@/components/dashboard/scan-terminal/continent-grouping";
import { rowName, temp, pct, edgeClass } from "./utils";

export function GroupedMarketTable({
  groups,
  isEn,
  onSelect,
  selectedId,
}: {
  groups: ContinentGroup[];
  isEn: boolean;
  onSelect: (row: ScanOpportunityRow) => void;
  selectedId?: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const c = new Set<string>();
    const defaultExpanded = getDefaultExpanded(groups);
    for (const g of groups) {
      if (!defaultExpanded.has(g.key)) c.add(g.key);
    }
    return c;
  });

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const labelActive = isEn ? "Active" : "活跃";
  const labelWatch = isEn ? "Watch" : "观察";
  const showHeaders = groups.length > 1;

  return (
    <div className="overflow-auto h-full">
      <table className="w-full min-w-[800px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#f8f9fa] text-left text-[10px] uppercase font-bold tracking-wider text-slate-500">
            <th className="px-3 py-1.5 font-bold">City</th>
            <th className="px-2 py-1.5 text-right font-bold">Obs</th>
            <th className="px-2 py-1.5 text-right font-bold">High</th>
            <th className="px-2 py-1.5 text-right font-bold">DEB</th>
            <th className="px-2 py-1.5 text-right font-bold">Gap</th>
            <th className="px-2 py-1.5 text-right font-bold">Market</th>
            <th className="px-2 py-1.5 text-right font-bold">Edge</th>
            <th className="px-2 py-1.5 text-right font-bold">Spr/Liq</th>
            <th className="px-3 py-1.5 font-bold">Signal</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group) => {
            const isExpanded = !collapsed.has(group.key);
            const rows = showHeaders && !isExpanded ? [] : group.rows;
            return (
              <Fragment key={group.key}>
                {showHeaders && (
                  <tr className="border-b border-slate-200 bg-[#eef2f6]">
                    <td colSpan={9} className="p-0">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-[#e2e8f0] transition-colors"
                      >
                        <span className="grid h-4 w-4 place-items-center text-slate-400">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">
                          {isEn ? group.labelEn : group.labelZh}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {group.rows.length} · {labelActive} {group.activeCount} · {labelWatch} {group.watchCount}
                          {group.localTimeRange ? ` · LT ${group.localTimeRange}` : ""}
                          {group.hotCity ? ` · Hot: ${group.hotCity}` : ""}
                        </span>
                      </button>
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                    const signal = getSignalState(row);
                    const gapColor = GAP_COLOR_MAP[getGapColor(row)];
                    return (
                      <tr
                        key={row.id}
                        className={clsx(
                          "cursor-pointer border-b border-slate-100 hover:bg-slate-50/80 transition-colors duration-150",
                          selectedId === row.id && "bg-blue-50/50"
                        )}
                        onClick={() => onSelect(row)}
                      >
                        <td className="px-3 py-1.5">
                          <div className="font-bold text-slate-800 text-[12px]">{rowName(row)}</div>
                          <div className="truncate text-[10px] text-slate-400 font-medium">
                            {row.airport || ""}{row.local_time ? ` · ${row.local_time}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold">
                          {temp(row.current_temp, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {temp(row.current_max_so_far, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {temp(row.deb_prediction, row.temp_symbol)}
                        </td>
                        <td className={clsx("px-2 py-1.5 text-right font-mono font-bold", gapColor)}>
                          {temp(row.signed_gap ?? row.gap_to_target, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {formatPrice(row.midpoint, row.ask, row.bid)}
                        </td>
                        <td className={clsx("px-2 py-1.5 text-right font-mono font-bold", edgeClass(row.edge_percent))}>
                          {pct(row.edge_percent)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-[11px]">
                          {formatSpreadLiquidity(row.spread, row.book_liquidity ?? row.market_liquidity)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={clsx(
                            "text-[11px] font-black",
                            signal === "active" ? "text-emerald-600" :
                            signal === "watch" ? "text-amber-600" :
                            signal === "closed" ? "text-slate-400" : "text-red-500"
                          )}>
                            {getSignalLabel(signal, isEn)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
