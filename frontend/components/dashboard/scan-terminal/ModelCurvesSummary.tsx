"use client";

import { seriesStats, type EvidenceSeries } from "@/components/dashboard/scan-terminal/temperature-chart-logic";
import { temp } from "@/components/dashboard/scan-terminal/utils";

export function ModelCurvesSummary({
  isEn,
  activeSeries,
}: {
  isEn: boolean;
  activeSeries: EvidenceSeries[];
}) {
  const modelSeries = activeSeries.filter((s) => s.key.startsWith("model_curve_"));
  if (!modelSeries.length) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
        <span className="font-black text-slate-500 uppercase mr-2">
          {isEn ? "Models:" : "多模型:"}
        </span>
        {modelSeries.map((s) => {
          const stats = seriesStats(s.values);
          return (
            <span key={s.key} className="inline-flex items-center gap-1.5 font-mono">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-slate-700 font-bold">{s.label}</span>
              <span className="text-slate-500">{temp(stats.latest)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
