"use client";

import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart as ReComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { TemperatureTooltipContent } from "@/components/dashboard/scan-terminal/TemperatureTooltipContent";
import {
  getTemperatureSeriesForRunwayDetailsMode,
  type EvidenceSeries,
  type ProbabilityOverlay,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";

type CityThreshold = {
  threshold: number;
  label: string;
  isBreached: boolean;
  kind: "gte" | "lte";
};

function isFiniteChartValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasDrawableTemperatureChartContent({
  activeSeries,
  probabilityOverlay,
  zoomedData,
}: {
  activeSeries: EvidenceSeries[];
  probabilityOverlay: ProbabilityOverlay | null;
  zoomedData: Array<Record<string, any>>;
}) {
  if (probabilityOverlay?.muLine || probabilityOverlay?.bands.length) return true;
  return activeSeries.some((series) =>
    zoomedData.some((point, index) => {
      const value = point?.[series.key] ?? series.values[index];
      return isFiniteChartValue(value);
    }),
  );
}

function shouldKeepTemperatureChartLoading({
  row,
  isHourlyLoading,
  activeSeries,
  probabilityOverlay,
  zoomedData,
}: {
  row: ScanOpportunityRow | null;
  isHourlyLoading: boolean;
  activeSeries: EvidenceSeries[];
  probabilityOverlay: ProbabilityOverlay | null;
  zoomedData: Array<Record<string, any>>;
}) {
  if (!row?.city) return false;
  if (!isHourlyLoading) return false;
  return !hasDrawableTemperatureChartContent({ activeSeries, probabilityOverlay, zoomedData });
}

function TemperatureChartSkeleton({ compact }: { compact: boolean }) {
  const horizontalLines = compact ? 5 : 7;
  const verticalLines = compact ? 5 : 8;

  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <div className="absolute inset-x-3 bottom-7 top-4 rounded-sm border border-slate-100">
        {Array.from({ length: horizontalLines }).map((_, index) => (
          <span
            key={`h-${index}`}
            className="absolute left-0 right-0 border-t border-dashed border-sky-100"
            style={{ top: `${(index / Math.max(1, horizontalLines - 1)) * 100}%` }}
          />
        ))}
        {Array.from({ length: verticalLines }).map((_, index) => (
          <span
            key={`v-${index}`}
            className="absolute bottom-0 top-0 border-l border-dashed border-sky-100"
            style={{ left: `${(index / Math.max(1, verticalLines - 1)) * 100}%` }}
          />
        ))}
        <div className="absolute inset-x-10 top-1/3 h-10 rounded bg-slate-100/60" />
      </div>
    </div>
  );
}

function TemperatureChartCanvasComponent({
  isEn,
  compact,
  timeframe,
  row,
  cityThresholds,
  chartSeries,
  activeSeries,
  probabilityOverlay,
  zoomedData,
  chartDomain,
  intDegreeTicks,
  hasRunwayData,
  showRunwayDetails,
  isHourlyLoading,
  refAreaLeft,
  refAreaRight,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onZoomReset,
  isSeriesVisible,
  onSeriesToggle,
  onShowRunwayDetailsChange,
}: {
  isEn: boolean;
  compact: boolean;
  timeframe: string;
  row: ScanOpportunityRow | null;
  cityThresholds: CityThreshold[];
  chartSeries: EvidenceSeries[];
  activeSeries: EvidenceSeries[];
  probabilityOverlay: ProbabilityOverlay | null;
  zoomedData: Array<Record<string, any>>;
  chartDomain: [number, number] | ["auto", "auto"];
  intDegreeTicks: number[] | null;
  hasRunwayData: boolean;
  showRunwayDetails: boolean;
  isHourlyLoading: boolean;
  refAreaLeft: number | null;
  refAreaRight: number | null;
  onMouseDown: (event: any) => void;
  onMouseMove: (event: any) => void;
  onMouseUp: () => void;
  onZoomReset: () => void;
  isSeriesVisible: (seriesKey: string) => boolean;
  onSeriesToggle: (seriesKey: string) => void;
  onShowRunwayDetailsChange: (value: boolean) => void;
}) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const tempSymbol = row?.temp_symbol || "°C";

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        setChartSize((prev) => {
          if (prev.width === width && prev.height === height) return prev;
          return { width, height };
        });
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(host);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const canRenderChart = chartSize.width > 0 && chartSize.height > 0;
  const chartWidth = Math.max(1, chartSize.width);
  const minChartHeight = compact ? 120 : 220;
  const chartHeight = Math.max(minChartHeight, chartSize.height);
  const individualRunwaySeriesCount = chartSeries.filter(
    (series) => series.key.startsWith("runway_") && series.key !== "runway_max",
  ).length;
  const collapsedRunwaySeries = getTemperatureSeriesForRunwayDetailsMode(
    row?.city || "",
    chartSeries,
    false,
  );
  const canToggleRunwayDetails =
    hasRunwayData &&
    individualRunwaySeriesCount > 1 &&
    collapsedRunwaySeries.length < chartSeries.length;
  const hasDrawableChartContent = hasDrawableTemperatureChartContent({
    activeSeries,
    probabilityOverlay,
    zoomedData,
  });
  const shouldShowChartLoading = shouldKeepTemperatureChartLoading({
    row,
    isHourlyLoading,
    activeSeries,
    probabilityOverlay,
    zoomedData,
  });
  const shouldRenderChart = canRenderChart && hasDrawableChartContent;
  const shouldShowEmptyState = Boolean(row?.city) && !isHourlyLoading && !hasDrawableChartContent;
  const shouldShowBackgroundRefresh = isHourlyLoading && hasDrawableChartContent;

  return (
    <div className={clsx("relative flex flex-1 flex-col p-2", compact ? "min-h-[120px]" : "min-h-[240px]")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 text-[11px] border-b border-[#e2e8f0] bg-white">
        {chartSeries.length > 1 &&
          getTemperatureSeriesForRunwayDetailsMode(
            row?.city || "",
            chartSeries,
            showRunwayDetails,
          )
            .map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onSeriesToggle(s.key)}
                className={clsx(
                  "inline-flex items-center gap-1.5 font-mono cursor-pointer transition-opacity hover:opacity-80",
                  !isSeriesVisible(s.key) && "opacity-40 line-through"
                )}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-slate-700 font-bold">{s.label}</span>
              </button>
            ))}

        {canToggleRunwayDetails && (
          <label className="inline-flex items-center gap-1.5 ml-auto cursor-pointer text-slate-600 hover:text-slate-800 font-semibold select-none">
            <input
              type="checkbox"
              checked={showRunwayDetails}
              onChange={(e) => onShowRunwayDetailsChange(e.target.checked)}
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
            />
            <span>{isEn ? "Show Runway Details" : "显示跑道明细"}</span>
          </label>
        )}

        {probabilityOverlay && (
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700",
              canToggleRunwayDetails ? "" : "ml-auto",
            )}
            title={
              probabilityOverlay.muLine
                ? probabilityOverlay.muLine.label
                : isEn
                  ? "Legacy Gaussian probability bands"
                  : "Legacy 高斯概率温度带"
            }
          >
            <span className="h-2 w-2 rounded-full bg-violet-500/70" />
            <span>{isEn ? "Gaussian" : "高斯概率"}</span>
            {probabilityOverlay.muLine && (
              <span className="font-mono text-violet-600">
                μ {probabilityOverlay.muLine.value.toFixed(1)}{tempSymbol}
              </span>
            )}
          </span>
        )}
      </div>
      <div ref={chartHostRef} className={clsx("relative flex-1", compact ? "min-h-[120px]" : "min-h-[220px]")}>
        {!shouldRenderChart && <TemperatureChartSkeleton compact={compact} />}
        {shouldRenderChart && (
          <ReComposedChart
            width={chartWidth}
            height={chartHeight}
            data={zoomedData}
            margin={{ top: 16, right: compact ? 20 : 44, left: 4, bottom: 8 }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDoubleClick={onZoomReset}
          >
            <CartesianGrid stroke="#dbe6ef" strokeDasharray="2 2" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              interval={Math.max(0, Math.floor(zoomedData.length / (compact ? 6 : 10)))}
              minTickGap={compact ? 24 : 32}
            />
            <YAxis
              orientation="right"
              tick={{ fontSize: 9, fill: "#64748b" }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}${tempSymbol}`}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={false}
              domain={chartDomain}
              ticks={intDegreeTicks ?? undefined}
            />
            {timeframe === "1D" && probabilityOverlay?.bands.map((band) => (
              <ReferenceArea
                key={band.key}
                y1={band.lower}
                y2={band.upper}
                strokeOpacity={0}
                fill="#8b5cf6"
                fillOpacity={band.opacity}
              />
            ))}
            {timeframe === "1D" && cityThresholds.map((t, idx) => {
              const isSelected = row && (Number(row.target_threshold ?? row.target_value) === t.threshold);
              const labelText = isEn
                ? `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}${tempSymbol} [${t.isBreached ? "Excluded" : "Active"}]`
                : `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}${tempSymbol} [${t.isBreached ? "已排除" : "活跃"}]`;

              return (
                <ReferenceLine
                  key={idx}
                  y={t.threshold}
                  stroke={isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316"}
                  strokeDasharray={isSelected ? undefined : "4 4"}
                  strokeWidth={isSelected ? 2 : 1}
                  label={{
                    value: compact ? undefined : labelText,
                    fill: isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316",
                    fontSize: 9,
                    position: isSelected ? "left" : "insideBottomRight",
                  }}
                />
              );
            })}
            {timeframe === "1D" && probabilityOverlay?.muLine && (
              <ReferenceLine
                y={probabilityOverlay.muLine.value}
                stroke="#7c3aed"
                strokeDasharray="2 3"
                strokeWidth={1.4}
                label={{
                  value: compact ? undefined : probabilityOverlay.muLine.label,
                  fill: "#7c3aed",
                  fontSize: 9,
                  position: "insideTopLeft",
                }}
              />
            )}
            <Tooltip
              filterNull={false}
              cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
              contentStyle={{
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 11,
                boxShadow: "0 8px 24px rgba(15,23,42,.12)",
              }}
              content={(props) => (
                <TemperatureTooltipContent
                  active={props.active}
                  label={props.label}
                  payload={props.payload as ReadonlyArray<{ payload?: Record<string, any> }> | undefined}
                  data={zoomedData}
                  series={activeSeries}
                  tempSymbol={tempSymbol}
                />
              )}
              formatter={(value: unknown) => {
                if (Array.isArray(value)) {
                  const [low, high] = value;
                  if (typeof low === "number" && typeof high === "number") {
                    return `${low.toFixed(1)}${tempSymbol} - ${high.toFixed(1)}${tempSymbol}`;
                  }
                }
                const num = Number(value);
                return Number.isFinite(num) ? `${num.toFixed(2)}${tempSymbol}` : String(value);
              }}
            />
            {hasRunwayData && (
              <Area
                dataKey="runway_band"
                name={isEn ? "Runway Range" : "跑道区间"}
                stroke="none"
                fill="#009688"
                fillOpacity={showRunwayDetails ? 0.08 : 0.18}
                connectNulls={true}
                isAnimationActive={false}
              />
            )}
            {refAreaLeft !== null && refAreaRight !== null && zoomedData[refAreaLeft] && zoomedData[refAreaRight] && (
              <ReferenceArea
                x1={zoomedData[refAreaLeft].label}
                x2={zoomedData[refAreaRight].label}
                strokeOpacity={0.3}
                fill="#3b82f6"
                fillOpacity={0.15}
              />
            )}
            {activeSeries.map((item) => (
              <Line
                key={item.key}
                type={item.curve ?? (item.smooth ? "monotone" : "linear")}
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={item.featured ? 2.8 : 1.2}
                strokeDasharray={item.dashed ? "4 3" : undefined}
                dot={item.showDot ? { r: item.featured ? 3 : 2, fill: item.color, strokeWidth: 0 } : false}
                activeDot={{ r: item.featured ? 6 : 4 }}
                connectNulls={true}
                isAnimationActive={false}
              />
            ))}
          </ReComposedChart>
        )}
        {shouldShowEmptyState && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center">
            <div className="rounded border border-slate-200 bg-white/90 px-3 py-2 text-[11px] font-semibold text-slate-500 shadow-sm">
              {isEn ? "No drawable chart data yet" : "暂无可绘制图表数据"}
            </div>
          </div>
        )}
      </div>
      {shouldShowBackgroundRefresh && (
        <div className="pointer-events-none absolute right-3 top-12 z-10 inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-500 shadow-sm backdrop-blur-[1px]">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
          <span>{isEn ? "Updating" : "更新中"}</span>
        </div>
      )}
      {shouldShowChartLoading && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center bg-white/65 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
            <span>{isEn ? "Loading chart" : "加载图表"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const TemperatureChartCanvas = memo(TemperatureChartCanvasComponent);
export const __shouldKeepTemperatureChartLoadingForTest = shouldKeepTemperatureChartLoading;
