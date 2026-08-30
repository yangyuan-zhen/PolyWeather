"use client";

import clsx from "clsx";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { rowName } from "@/components/dashboard/scan-terminal/utils";

export function KoyfinRowsTable({
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
          <th className="px-2 py-1 text-left font-bold">
            {isEn ? "City" : "城市"}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            onClick={() => onSelect(row)}
            className={clsx(
              "cursor-pointer border-b border-slate-100 hover:bg-blue-50/70",
              selectedId === row.id && "bg-blue-50",
            )}
          >
            <td className="px-2 py-1">
              <div className="truncate font-bold text-slate-800">
                {rowName(row)}
              </div>
              <div className="truncate text-[10px] font-medium text-slate-400">
                {row.airport || "--"}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
