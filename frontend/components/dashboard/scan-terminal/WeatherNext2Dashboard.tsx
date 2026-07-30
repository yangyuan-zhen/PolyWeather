"use client";

import clsx from "clsx";
import { ChevronRight, Cloud } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { ScanOpportunityRow, WeatherNext2CityData } from "@/lib/dashboard-types";

type Wn2DashboardProps = {
  rows: ScanOpportunityRow[];
  isEn: boolean;
};

const T = {
  title: { en: "WeatherNext 2 Ensemble", zh: "WeatherNext 2 集合预报" },
  subtitle: {
    en: "Google DeepMind 64-member ensemble high-temperature forecast across cities.",
    zh: "Google DeepMind 64 成员集合预报——各城市最高温概率分布。",
  },
  search: { en: "Search city", zh: "搜索城市" },
  city: { en: "City", zh: "城市" },
  median: { en: "Median", zh: "中位数" },
  spread: { en: "Spread", zh: "离散度" },
  members: { en: "Members", zh: "成员" },
  range: { en: "Range", zh: "范围" },
  probability: { en: "Probability", zh: "概率" },
  noWn2Data: { en: "No WeatherNext 2 data available for any city.", zh: "暂无 WeatherNext 2 数据。" },
  runInfo: { en: "Run", zh: "预测运行" },
  tempRange: { en: "Temp (°C)", zh: "温度 (°C)" },
  timeDist: { en: "High time distribution", zh: "高温时间分布" },
  empty: { en: "No cities match the search.", zh: "没有匹配的城市。" },
  total: { en: "cities", zh: "个城市" },
} as const;

function tt(key: keyof typeof T, isEn: boolean) {
  return T[key][isEn ? "en" : "zh"];
}

function formatTemp(value: number | null | undefined): string {
  if (value == null) return "—";
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0 ? `${rounded}.0` : `${rounded}`;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function timeLabel(hour: string): string {
  const h = parseInt(hour, 10);
  if (h < 6) return `${hour} 凌晨`;
  if (h < 12) return `${hour} 上午`;
  if (h < 18) return `${hour} 下午`;
  return `${hour} 晚间`;
}

function TimeDistChart({ highTimes }: { highTimes: Record<string, string> }) {
  const slots = ["00:00", "06:00", "12:00", "18:00"];
  const counts: Record<string, number> = { "00:00": 0, "06:00": 0, "12:00": 0, "18:00": 0 };
  let total = 0;
  for (const t of Object.values(highTimes)) {
    const slot = slots.find((s) => t.startsWith(s[0])) || "12:00";
    if (t.startsWith("00")) counts["00:00"]++;
    else if (t.startsWith("06")) counts["06:00"]++;
    else if (t.startsWith("12")) counts["12:00"]++;
    else if (t.startsWith("18")) counts["18:00"]++;
    total++;
  }
  const maxCount = Math.max(...Object.values(counts), 1);
  const colors = ["#6366f1", "#3b82f6", "#f59e0b", "#ef4444"];
  return (
    <div className="space-y-1.5">
      {slots.map((slot, i) => {
        const c = counts[slot];
        const pct = total > 0 ? (c / total) * 100 : 0;
        return (
          <div key={slot} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-right font-mono text-[10px] font-bold text-slate-500">{slot}</span>
            <div className="flex h-5 flex-1 items-center rounded bg-slate-100">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${(c / maxCount) * 100}%`,
                  minWidth: c > 0 ? "4px" : "0",
                  backgroundColor: colors[i],
                }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums text-slate-700">
              {Math.round(pct)}%
            </span>
            <span className="w-6 shrink-0 text-right font-mono text-[9px] text-slate-400">
              {c}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Wn2RowExpanded({ data }: { data: WeatherNext2CityData }) {
  const maxProb = Math.max(...data.buckets.map((b) => b.probability), 0.01);
  const hasHighTimes = data.member_high_times && Object.keys(data.member_high_times).length > 0;
  return (
    <div className="space-y-4">
      {/* Temperature probability */}
      <div>
        <div className="mb-1.5 text-[11px] font-bold text-slate-700">
          <span className="inline-block w-3 h-3 rounded bg-blue-400 align-middle mr-1.5" />
          {tt("probability", false)} — {data.buckets.length} buckets
        </div>
        <div className="space-y-1">
          {data.buckets.map((bucket) => {
            const widthPct = (bucket.probability / maxProb) * 100;
            const isTop = bucket.probability === maxProb;
            return (
              <div key={bucket.key} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-right font-mono text-[10px] font-bold text-slate-600">
                  {bucket.label}
                </span>
                <div className="flex h-5 flex-1 items-center rounded bg-slate-100">
                  <div
                    className={clsx(
                      "h-full rounded transition-all",
                      isTop ? "bg-blue-500" : "bg-blue-300",
                    )}
                    style={{ width: `${widthPct}%`, minWidth: bucket.probability > 0 ? "4px" : "0" }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums text-slate-700">
                  {pct(bucket.probability)}
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[9px] text-slate-400">
                  {bucket.member_count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* High time distribution */}
      {hasHighTimes && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-slate-700">
            <span className="inline-block w-3 h-3 rounded bg-indigo-400 align-middle mr-1.5" />
            {tt("timeDist", false)}
          </div>
          <TimeDistChart highTimes={data.member_high_times!} />
        </div>
      )}

      <div className="flex gap-4 text-[10px] font-medium text-slate-400">
        <span>{tt("members", false)}: {data.members}</span>
        <span>
          {tt("tempRange", false)}: {formatTemp(data.summary.min)} – {formatTemp(data.summary.max)}
        </span>
      </div>
    </div>
  );
}

function Wn2TableRow({
  row,
  isEn,
  isExpanded,
  onToggle,
}: {
  row: ScanOpportunityRow;
  isEn: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const wn2 = row.weathernext2!;
  const s = wn2.summary;
  const cityName = row.city_display_name || row.display_name || row.city || "";

  return (
    <Fragment>
      <tr className="group border-b border-slate-100 hover:bg-blue-50/40">
        <th
          scope="row"
          className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] border-r border-slate-200 bg-white px-2 py-2 text-left align-middle text-xs font-black text-slate-900 group-hover:bg-blue-50"
        >
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left outline-none transition hover:bg-blue-100/70 focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <ChevronRight
              size={13}
              className={clsx(
                "shrink-0 text-slate-400 transition-transform",
                isExpanded && "rotate-90 text-blue-600",
              )}
            />
            <span className="block truncate">{cityName}</span>
          </button>
        </th>
        <td className="px-3 py-2 text-right font-mono text-[13px] font-black text-slate-900">
          {formatTemp(s.median)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-slate-400">
          ±{formatTemp(s.spread)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-blue-600">
          {formatTemp(s.p10)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-orange-600">
          {formatTemp(s.p25)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-orange-600">
          {formatTemp(s.p75)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-red-600">
          {formatTemp(s.p90)}
        </td>
        <td className="px-3 py-2">
          {s.p10 != null && s.p90 != null ? (
            <div className="relative h-2 w-full rounded-full bg-slate-100">
              <div
                className="absolute top-0 h-full rounded-full bg-gradient-to-r from-blue-300 via-blue-400 to-red-400"
                style={{
                  left: `${((s.p10 - (s.min ?? s.p10)) / ((s.max ?? s.p90) - (s.min ?? s.p10))) * 100}%`,
                  width: `${((s.p90 - s.p10) / ((s.max ?? s.p90) - (s.min ?? s.p10))) * 100}%`,
                  minWidth: "4px",
                }}
              />
              <div
                className="absolute top-0 h-full w-0.5 -translate-x-1/2 rounded bg-blue-700"
                style={{
                  left: `${((s.median! - (s.min ?? s.p10)) / ((s.max ?? s.p90) - (s.min ?? s.p10))) * 100}%`,
                }}
              />
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono text-[10px] text-slate-500">
          {wn2.members}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-blue-100 bg-blue-50/35">
          <td colSpan={9} className="px-3 py-3">
            <Wn2RowExpanded data={wn2} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function WeatherNext2Dashboard({ rows, isEn }: Wn2DashboardProps) {
  const [query, setQuery] = useState("");
  const [expandedCityKeys, setExpandedCityKeys] = useState<Set<string>>(() => new Set());

  const wn2Rows = useMemo(() => {
    return rows.filter((r) => r.weathernext2?.summary?.median != null);
  }, [rows]);

  const runMeta = useMemo(() => {
    for (const row of wn2Rows) {
      if (row.weathernext2?.source_run) {
        return {
          source_run: row.weathernext2.source_run,
          generated_at: row.weathernext2.generated_at,
        };
      }
    }
    return null;
  }, [wn2Rows]);

  const visibleRows = useMemo(() => {
    if (!query) return wn2Rows;
    const q = query.toLowerCase();
    return wn2Rows.filter((r) => {
      const name = r.city_display_name || r.display_name || r.city || "";
      return name.toLowerCase().includes(q);
    });
  }, [wn2Rows, query]);

  const toggleExpanded = useCallback((cityKey: string) => {
    setExpandedCityKeys((prev) => {
      const next = new Set(prev);
      if (next.has(cityKey)) next.delete(cityKey);
      else next.add(cityKey);
      return next;
    });
  }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#d2d9e2] bg-white shadow-sm">
      <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Cloud size={16} className="text-blue-600" />
            <h2 className="truncate text-sm font-black text-slate-900">{tt("title", isEn)}</h2>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              {visibleRows.length}/{wn2Rows.length} {tt("total", isEn)}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {tt("subtitle", isEn)}
            {runMeta && (
              <span className="ml-2 font-mono text-[11px] text-slate-400">
                {tt("runInfo", isEn)}: {runMeta.source_run}
              </span>
            )}
          </p>
        </div>
        <div className="relative w-full sm:w-[240px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt("search", isEn)}
            className="h-8 w-full rounded border border-slate-300 bg-white pl-8 pr-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: "720px" }}>
          <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              <th className="sticky left-0 z-30 w-[160px] min-w-[160px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">
                {tt("city", isEn)}
              </th>
              <th className="min-w-[72px] px-3 py-2 text-right">{tt("median", isEn)}</th>
              <th className="min-w-[72px] px-3 py-2 text-right text-slate-400">{tt("spread", isEn)}</th>
              <th className="min-w-[80px] px-3 py-2 text-right text-blue-600">p10</th>
              <th className="min-w-[80px] px-3 py-2 text-right text-orange-600">p25</th>
              <th className="min-w-[80px] px-3 py-2 text-right text-orange-600">p75</th>
              <th className="min-w-[80px] px-3 py-2 text-right text-red-600">p90</th>
              <th className="min-w-[140px] px-3 py-2 text-left">{tt("range", isEn)}</th>
              <th className="min-w-[64px] px-3 py-2 text-right">{tt("members", isEn)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row) => {
              const cityKey = String(row.city || "").toLowerCase();
              return (
                <Wn2TableRow
                  key={cityKey}
                  row={row}
                  isEn={isEn}
                  isExpanded={expandedCityKeys.has(cityKey)}
                  onToggle={() => toggleExpanded(cityKey)}
                />
              );
            })}
          </tbody>
        </table>
        {!visibleRows.length && (
          <div className="flex h-40 items-center justify-center border-t border-slate-100 text-xs font-bold text-slate-400">
            {wn2Rows.length ? tt("empty", isEn) : tt("noWn2Data", isEn)}
          </div>
        )}
      </div>
    </section>
  );
}
