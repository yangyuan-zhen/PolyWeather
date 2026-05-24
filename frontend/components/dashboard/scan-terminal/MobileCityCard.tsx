"use client";

import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatPrice,
  GAP_COLOR_MAP,
  getGapColor,
  getSignalLabel,
  getSignalState,
} from "@/components/dashboard/scan-terminal/continent-grouping";

function rowName(row: ScanOpportunityRow) {
  return row.city_display_name || row.display_name || row.city || "--";
}

function tempVal(value?: number | null, symbol?: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}${symbol || "°"}`;
}

export function MobileCityCard({
  isEn,
  onClick,
  row,
}: {
  isEn: boolean;
  onClick: (row: ScanOpportunityRow) => void;
  row: ScanOpportunityRow;
}) {
  const signal = getSignalState(row);
  const gapColor = GAP_COLOR_MAP[getGapColor(row)];

  return (
    <button
      type="button"
      onClick={() => onClick(row)}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:bg-blue-50/70 transition-colors"
    >
      {/* Row 1: City + Signal */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold text-slate-900">
          {rowName(row)}
        </span>
        <span className="shrink-0 text-xs font-black">
          <span className={signal === "active" ? "text-emerald-600" : signal === "watch" ? "text-amber-600" : signal === "closed" ? "text-slate-400" : "text-red-500"}>
            {getSignalLabel(signal, isEn)}
          </span>
        </span>
      </div>

      {/* Row 2: Obs · Gap · Market */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono font-bold">
          Obs {tempVal(row.current_temp, row.temp_symbol)}
        </span>
        <span className={gapColor}>
          Gap {tempVal(row.signed_gap ?? row.gap_to_target, row.temp_symbol)}
        </span>
        <span className="text-slate-600">
          {formatPrice(row.midpoint, row.ask, row.bid)}
        </span>
      </div>

      {/* Row 3: High · DEB */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          High {tempVal(row.current_max_so_far, row.temp_symbol)}
        </span>
        <span>
          DEB {tempVal(row.deb_prediction, row.temp_symbol)}
        </span>
      </div>
    </button>
  );
}
