"use client";

import clsx from "clsx";
import { Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  MODEL_SUMMARY_MODEL_COLUMNS,
  buildModelSummaryRows,
  filterModelSummaryRows,
  formatModelSummaryLocalTime,
  formatModelSummaryTemp,
  hasModelSummaryForecastData,
  type ModelSummaryRow,
} from "@/lib/model-summary";

type ModelSummaryDashboardProps = {
  rows: ScanOpportunityRow[];
  isEn: boolean;
  generatedText?: string;
};

const SUMMARY_TEXT = {
  title: { en: "Model Summary", zh: "模型汇总" },
  subtitle: {
    en: "Today high-temperature view across DEB and model cluster sources.",
    zh: "按今日最高温口径汇总 DEB 与多模型预测。",
  },
  search: { en: "Search city or model", zh: "搜索城市或模型" },
  city: { en: "City", zh: "城市" },
  region: { en: "Region", zh: "区域" },
  localTime: { en: "Local Time", zh: "当地时间" },
  median: { en: "Median", zh: "模型中位数" },
  spread: { en: "Spread", zh: "分歧范围" },
  empty: { en: "No model summary rows match the current filters.", zh: "当前筛选下没有模型汇总数据。" },
  generated: { en: "Generated", zh: "生成" },
  total: { en: "rows", zh: "行" },
} as const;

function copy(key: keyof typeof SUMMARY_TEXT, isEn: boolean) {
  return SUMMARY_TEXT[key][isEn ? "en" : "zh"];
}

function TemperatureCell({
  value,
  symbol,
  emphasis,
}: {
  value: number | null;
  symbol: string;
  emphasis?: "deb" | "median";
}) {
  const missing = value == null;
  return (
    <span
      className={clsx(
        "font-mono tabular-nums",
        missing ? "font-semibold text-slate-300" : "font-bold text-slate-800",
        emphasis === "deb" && !missing && "text-orange-600",
        emphasis === "median" && !missing && "text-blue-700",
      )}
    >
      {formatModelSummaryTemp(value, symbol)}
    </span>
  );
}

function FilterToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={clsx(
        "inline-flex h-8 cursor-pointer select-none items-center gap-2 rounded border px-2.5 text-[11px] font-bold transition-colors",
        checked
          ? "border-blue-300 bg-blue-50 text-blue-700"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-blue-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function ModelSummaryRowView({
  row,
  nowMs,
}: {
  row: ModelSummaryRow;
  nowMs: number | null;
}) {
  return (
    <tr className="group border-b border-slate-100 hover:bg-blue-50/40">
      <th
        scope="row"
        className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] border-r border-slate-200 bg-white px-3 py-2 text-left align-middle text-xs font-black text-slate-900 group-hover:bg-blue-50"
      >
        <span className="block truncate">{row.cityName}</span>
      </th>
      <td className="min-w-[150px] px-3 py-2 text-xs font-semibold text-slate-600">
        <span className="block truncate">{row.regionLabel}</span>
      </td>
      <td className="min-w-[96px] px-3 py-2 text-right font-mono text-[11px] font-bold text-slate-700">
        {formatModelSummaryLocalTime(row, nowMs)}
      </td>
      <td className="min-w-[90px] px-3 py-2 text-right">
        <TemperatureCell value={row.debPrediction} symbol={row.tempSymbol} emphasis="deb" />
      </td>
      {MODEL_SUMMARY_MODEL_COLUMNS.map((column) => (
        <td key={column.key} className="min-w-[92px] px-3 py-2 text-right">
          <TemperatureCell value={row.models[column.key]} symbol={row.tempSymbol} />
        </td>
      ))}
      <td className="min-w-[110px] px-3 py-2 text-right">
        <TemperatureCell value={row.modelMedian} symbol={row.tempSymbol} emphasis="median" />
      </td>
      <td className="min-w-[100px] px-3 py-2 text-right">
        <TemperatureCell value={row.modelSpread} symbol={row.tempSymbol} />
      </td>
    </tr>
  );
}

function mergeWithLastGoodSummaryRows(
  incomingRows: ModelSummaryRow[],
  lastGoodRows: ModelSummaryRow[],
) {
  if (!lastGoodRows.length) return incomingRows;
  if (!incomingRows.length) return lastGoodRows;

  const incomingCityKeys = new Set<string>();
  const lastGoodByCity = new Map(lastGoodRows.map((row) => [row.cityKey, row]));
  const mergedRows = incomingRows.map((incomingRow) => {
    incomingCityKeys.add(incomingRow.cityKey);
    const lastGoodRow = lastGoodByCity.get(incomingRow.cityKey);
    if (!lastGoodRow) return incomingRow;

    return {
      ...lastGoodRow,
      cityName: incomingRow.cityName,
      regionLabel: incomingRow.regionLabel,
      regionLabelZh: incomingRow.regionLabelZh,
      regionSort: incomingRow.regionSort,
      tempSymbol: incomingRow.tempSymbol || lastGoodRow.tempSymbol,
      localTime: incomingRow.localTime || lastGoodRow.localTime,
      timezoneOffsetSeconds:
        incomingRow.timezoneOffsetSeconds ?? lastGoodRow.timezoneOffsetSeconds,
      searchText: incomingRow.searchText || lastGoodRow.searchText,
    };
  });

  return [
    ...mergedRows,
    ...lastGoodRows.filter((row) => !incomingCityKeys.has(row.cityKey)),
  ].sort((a, b) => {
    if (a.regionSort !== b.regionSort) return a.regionSort - b.regionSort;
    return a.cityName.localeCompare(b.cityName, "en", { sensitivity: "base" });
  });
}

export function ModelSummaryDashboard({
  rows,
  isEn,
  generatedText,
}: ModelSummaryDashboardProps) {
  const [query, setQuery] = useState("");
  const [debOnly, setDebOnly] = useState(false);
  const [wideSpreadOnly, setWideSpreadOnly] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const lastGoodSummaryRowsRef = useRef<ModelSummaryRow[]>([]);

  useEffect(() => {
    const syncClock = () => setNowMs(Date.now());
    syncClock();
    const timer = window.setInterval(syncClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const incomingSummaryRows = useMemo(() => buildModelSummaryRows(rows, isEn), [rows, isEn]);
  const incomingHasForecastData = hasModelSummaryForecastData(incomingSummaryRows);
  const summaryRows = useMemo(
    () =>
      incomingHasForecastData
        ? incomingSummaryRows
        : mergeWithLastGoodSummaryRows(incomingSummaryRows, lastGoodSummaryRowsRef.current),
    [incomingSummaryRows, incomingHasForecastData],
  );

  useEffect(() => {
    if (incomingHasForecastData) {
      lastGoodSummaryRowsRef.current = incomingSummaryRows;
    }
  }, [incomingSummaryRows, incomingHasForecastData]);

  const visibleRows = useMemo(
    () =>
      filterModelSummaryRows(summaryRows, {
        query,
        debOnly,
        wideSpreadOnly,
      }),
    [summaryRows, query, debOnly, wideSpreadOnly],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#d2d9e2] bg-white shadow-sm">
      <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Table2 size={16} className="text-blue-600" />
            <h2 className="truncate text-sm font-black text-slate-900">{copy("title", isEn)}</h2>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              {visibleRows.length}/{summaryRows.length} {copy("total", isEn)}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {copy("subtitle", isEn)}
            {generatedText ? (
              <span className="ml-2 font-mono text-[11px] text-slate-400">
                {copy("generated", isEn)} {generatedText}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-[240px]">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy("search", isEn)}
              className="h-8 w-full rounded border border-slate-300 bg-white pl-8 pr-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <FilterToggle
            checked={debOnly}
            label={isEn ? "Only DEB" : "仅 DEB"}
            onChange={setDebOnly}
          />
          <FilterToggle
            checked={wideSpreadOnly}
            label={isEn ? "Large spread" : "分歧较大"}
            onChange={setWideSpreadOnly}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1460px] border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              <th className="sticky left-0 z-30 w-[160px] min-w-[160px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">
                {copy("city", isEn)}
              </th>
              <th className="min-w-[150px] px-3 py-2 text-left">{copy("region", isEn)}</th>
              <th className="min-w-[96px] px-3 py-2 text-right">{copy("localTime", isEn)}</th>
              <th className="min-w-[90px] px-3 py-2 text-right text-orange-600">DEB</th>
              {MODEL_SUMMARY_MODEL_COLUMNS.map((column) => (
                <th key={column.key} className="min-w-[92px] px-3 py-2 text-right">
                  {column.label}
                </th>
              ))}
              <th className="min-w-[110px] px-3 py-2 text-right text-blue-700">
                {copy("median", isEn)}
              </th>
              <th className="min-w-[100px] px-3 py-2 text-right">{copy("spread", isEn)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row) => (
              <ModelSummaryRowView key={row.cityKey} row={row} nowMs={nowMs} />
            ))}
          </tbody>
        </table>
        {!visibleRows.length && (
          <div className="flex h-40 items-center justify-center border-t border-slate-100 text-xs font-bold text-slate-400">
            {copy("empty", isEn)}
          </div>
        )}
      </div>
    </section>
  );
}
