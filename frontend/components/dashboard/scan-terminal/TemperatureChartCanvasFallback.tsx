export function TemperatureChartCanvasFallback({ compact }: { compact?: boolean }) {
  const horizontalLines = compact ? 5 : 7;
  const verticalLines = compact ? 5 : 8;
  const minChartHeight = compact === false ? 220 : 120;

  return (
    <div
      className="relative flex-1 overflow-hidden rounded-sm border border-slate-100 bg-white"
      style={{ minHeight: minChartHeight }}
    >
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
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 shadow-sm">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />
          加载图表
        </div>
      </div>
    </div>
  );
}
