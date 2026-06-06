"use client";

import {
  validNumber,
  type EvidenceSeries,
  type ProbabilityOverlay,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";

type TooltipSeries = Pick<EvidenceSeries, "key" | "label" | "color">;
type TooltipRow = TooltipSeries & { value: number };
type TooltipProbabilityRow = { key: string; label: string; value: string; color: string };

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
  probabilityOverlay,
  tempSymbol = "°C",
  isEn = false,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload?: Record<string, any> }>;
  data: Array<Record<string, any>>;
  series: TooltipSeries[];
  probabilityOverlay?: ProbabilityOverlay | null;
  tempSymbol?: string;
  isEn?: boolean;
}) {
  if (!active) return null;
  const activePoint = payload?.[0]?.payload || findTooltipPointByLabel(data, label) || {};
  const rows = series.length ? buildTooltipRows(activePoint, data, series) : [];
  const probabilityRows = buildTooltipProbabilityRows(probabilityOverlay, tempSymbol, isEn);
  if (!rows.length && !probabilityRows.length) return null;

  return (
    <div className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-lg">
      <div className="mb-1 font-mono text-slate-500">{label}</div>
      {rows.length > 0 && (
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
      )}
      {probabilityRows.length > 0 && (
        <div className={rows.length > 0 ? "mt-1.5 grid gap-1 border-t border-slate-100 pt-1.5" : "grid gap-1"}>
          {probabilityRows.slice(0, 8).map((item) => (
            <div key={item.key} className="flex min-w-[160px] items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-violet-700">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="font-semibold">{item.label}</span>
              </span>
              <strong className="font-mono text-violet-900">{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function findTooltipPointByLabel(
  data: Array<Record<string, any>>,
  label?: string | number,
) {
  if (label === undefined || label === null) return null;
  return data.find((point) => String(point.label) === String(label)) || null;
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

function buildTooltipProbabilityRows(
  probabilityOverlay: ProbabilityOverlay | null | undefined,
  tempSymbol: string,
  isEn: boolean,
): TooltipProbabilityRow[] {
  if (!probabilityOverlay) return [];
  const rows: TooltipProbabilityRow[] = [];
  const mu = validNumber(probabilityOverlay.muLine?.value);
  if (mu !== null) {
    rows.push({
      key: "legacy_probability_mu",
      label: isEn ? "Gaussian μ" : "高斯 μ",
      value: `${mu.toFixed(1)}${tempSymbol}`,
      color: "#8b5cf6",
    });
  }

  const topBand = [...probabilityOverlay.bands]
    .filter((band) => validNumber(band.probability) !== null)
    .sort((a, b) => b.probability - a.probability)[0];
  if (topBand) {
    const probabilityPct = Math.round(topBand.probability * 100);
    rows.push({
      key: topBand.key,
      label: topBand.label,
      value: `${probabilityPct}%`,
      color: "#a78bfa",
    });
  }
  return rows;
}

export const __buildTemperatureTooltipRowsForTest = buildTooltipRows;
export const __buildTemperatureTooltipProbabilityRowsForTest = buildTooltipProbabilityRows;
