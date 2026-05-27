"use client";

import { validNumber, type EvidenceSeries } from "@/components/dashboard/scan-terminal/temperature-chart-logic";

type TooltipSeries = Pick<EvidenceSeries, "key" | "label" | "color">;
type TooltipRow = TooltipSeries & { value: number };

function isRunwayTooltipSeries(seriesKey: string) {
  return seriesKey.startsWith("runway_");
}

function nearestSeriesValue(
  data: Array<Record<string, any>>,
  seriesKey: string,
  activeIndex: number,
) {
  if (!data.length || activeIndex < 0) return null;
  for (let offset = 0; offset < data.length; offset += 1) {
    const left = activeIndex - offset;
    if (left >= 0) {
      const value = validNumber(data[left]?.[seriesKey]);
      if (value !== null) return value;
    }
    const right = activeIndex + offset;
    if (right < data.length) {
      const value = validNumber(data[right]?.[seriesKey]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function TemperatureTooltipContent({
  active,
  label,
  payload,
  data,
  series,
  tempSymbol = "°C",
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload?: Record<string, any> }>;
  data: Array<Record<string, any>>;
  series: TooltipSeries[];
  tempSymbol?: string;
}) {
  if (!active || !payload?.length || !series.length) return null;
  const activePoint = payload[0]?.payload || {};
  const rows = buildTooltipRows(activePoint, data, series);
  if (!rows.length) return null;

  return (
    <div className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-lg">
      <div className="mb-1 font-mono text-slate-500">{label}</div>
      <div className="grid gap-1">
        {rows.slice(0, 8).map((item) => (
          <div key={item.key} className="flex min-w-[140px] items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="font-semibold">{item.label}</span>
            </span>
            <strong className="font-mono text-slate-900">{item.value.toFixed(2)}{tempSymbol}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildTooltipRows(
  activePoint: Record<string, any>,
  data: Array<Record<string, any>>,
  series: TooltipSeries[],
): TooltipRow[] {
  const activeIndex = data.findIndex((point) => point.ts === activePoint.ts);
  return series
    .map((item) => {
      const directValue = validNumber(activePoint[item.key]);
      const value = directValue ?? (
        isRunwayTooltipSeries(item.key) ? null : nearestSeriesValue(data, item.key, activeIndex)
      );
      return value === null ? null : { ...item, value };
    })
    .filter((item): item is TooltipRow => item !== null);
}

export const __buildTemperatureTooltipRowsForTest = buildTooltipRows;
