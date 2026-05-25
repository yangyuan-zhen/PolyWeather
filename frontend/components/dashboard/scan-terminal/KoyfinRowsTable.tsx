"use client";

import clsx from "clsx";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatPrice } from "@/components/dashboard/scan-terminal/continent-grouping";
import { rowName, pct } from "@/components/dashboard/scan-terminal/utils";

function tablePrice(row: ScanOpportunityRow) {
  return formatPrice(row.midpoint, row.ask, row.bid);
}

export function KoyfinRowsTable({
  compact = false,
  isEn,
  onSelect,
  rows,
  selectedId,
}: {
  compact?: boolean;
  isEn: boolean;
  onSelect: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  selectedId?: string | null;
}) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-b border-slate-200 bg-[#f3f5f7] text-[11px] uppercase tracking-wide text-slate-500">
          <th className="w-5 px-2 py-1 text-left font-black">
            <span className="block h-3 w-3 rounded-[2px] border border-slate-300 bg-white" />
          </th>
          <th className="px-1.5 py-1 text-left font-black">
            {isEn ? "City" : "城市"}
          </th>
          <th className="px-1.5 py-1 text-right font-black">
            {isEn ? "Price" : "价格"}
          </th>
          <th className="px-1.5 py-1 text-right font-black">
            {isEn ? "Chg" : "变化"}
          </th>
          <th className="px-2 py-1 text-right font-black">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const edge = Number(row.edge_percent ?? row.signed_gap ?? row.gap ?? 0);
          const positive = edge >= 0;
          return (
            <tr
              key={row.id}
              onClick={() => onSelect(row)}
              className={clsx(
                "cursor-pointer border-b border-slate-100 hover:bg-blue-50/70",
                selectedId === row.id && "bg-blue-50",
              )}
            >
              <td className="px-2 py-1">
                <span className="block h-3 w-3 rounded-[2px] border border-slate-300 bg-white" />
              </td>
              <td className="px-1.5 py-1">
                <div className="truncate font-bold text-slate-800">
                  {rowName(row)}
                </div>
                <div className="truncate text-[10px] font-medium text-slate-400">
                  {row.target_label || row.market_question || row.airport || "--"}
                </div>
              </td>
              <td className="px-1.5 py-1 text-right font-mono font-bold text-slate-800">
                {tablePrice(row)}
              </td>
              <td
                className={clsx(
                  "px-1.5 py-1 text-right font-mono font-bold",
                  positive ? "text-emerald-700" : "text-red-600",
                )}
              >
                {Number.isFinite(edge) ? `${positive ? "+" : ""}${edge.toFixed(1)}` : "--"}
              </td>
              <td
                className={clsx(
                  "px-2 py-1 text-right font-mono font-bold",
                  positive ? "text-emerald-700" : "text-red-600",
                )}
              >
                {pct(row.market_probability ?? row.market_event_probability ?? row.model_probability)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
