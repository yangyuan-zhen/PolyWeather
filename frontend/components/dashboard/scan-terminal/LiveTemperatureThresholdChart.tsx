"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { rowName, temp } from "@/components/dashboard/scan-terminal/utils";

type ObsPoint = { time?: string | null; temp?: number | null };

type EvidenceSeries = {
  key: string;
  label: string;
  source: string;
  color: string;
  dashed?: boolean;
  featured?: boolean;
  smooth?: boolean;
  values: Array<number | null>;
};

// Sliding window: keep at most this many observation points (24h at 1-min ≈ 1440)
const MAX_OBS_POINTS = 1440;

function validNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toTimestamp(value?: string | null): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  // HH:MM or HH:MM:SS — treat as today, but handle cross-midnight:
  // if parsed time is >2h ahead of now, assume yesterday
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const now = new Date();
    const h = +m[1], min = +m[2];
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
    if (candidate.getTime() - now.getTime() > 2 * 60 * 60 * 1000) {
      candidate.setDate(candidate.getDate() - 1);
    }
    return candidate.getTime();
  }
  return null;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function normObs(points?: ObsPoint[] | null, limit = MAX_OBS_POINTS) {
  return (points || [])
    .filter((p) => validNumber(p.temp) !== null)
    .slice(-limit)
    .map((p, i) => ({
      ts: toTimestamp(p.time) ?? (Date.now() - (limit - i) * 60_000),
      value: Number(p.temp),
    }));
}

function seriesStats(values: Array<number | null>) {
  const nums = values.filter((v): v is number => validNumber(v) !== null);
  const latest = nums.length ? nums[nums.length - 1] : null;
  const high = nums.length ? Math.max(...nums) : null;
  const first15 = nums.length > 1 ? nums[Math.max(0, nums.length - 15)] : null;
  const delta15 = latest !== null && first15 !== null ? latest - first15 : null;
  return { latest, high, delta15 };
}

type HourlyForecast = {
  forecastTodayHigh?: number | null;
  localTime?: string | null;
  times: string[];
  temps: Array<number | null>;
  modelCurves?: Record<string, Array<number | null>>;
} | null;

// ── Build aligned data rows for the sliding-window chart ────────────────

function buildSlidingChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
) {
  const settlementObs = normObs(row?.settlement_today_obs || row?.metar_context?.settlement_today_obs);
  const metarObs = normObs(row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs);

  // Collect all timestamps from observations + forecasts
  const allTimes = new Set<number>();

  const pushObs = (obs: ReturnType<typeof normObs>) => {
    obs.forEach((o) => allTimes.add(o.ts));
  };
  pushObs(settlementObs);
  pushObs(metarObs);

  // Forecast timestamps
  const forecastTimes: number[] = [];
  if (hourly?.times?.length && hourly?.temps?.length) {
    hourly.times.forEach((t, i) => {
      const ts = toTimestamp(t);
      if (ts !== null && i < hourly.temps.length) {
        allTimes.add(ts);
        forecastTimes.push(ts);
      }
    });
  }

  // Sort timestamps
  const sorted = [...allTimes].sort((a, b) => a - b);
  if (!sorted.length) return { data: [], series: [] };

  // Build a lookup: timestamp → index in the sorted array
  const tsToIdx = new Map<number, number>();
  sorted.forEach((ts, i) => tsToIdx.set(ts, i));

  const n = sorted.length;
  const na = (): Array<number | null> => Array.from({ length: n }, () => null);

  const series: EvidenceSeries[] = [];

  // Settlement
  const sVals = na();
  settlementObs.forEach((o) => {
    const idx = tsToIdx.get(o.ts);
    if (idx !== undefined) sVals[idx] = o.value;
  });
  if (sVals.some((v) => v !== null)) {
    series.push({
      key: "settlement",
      label: row?.metar_context?.station_label || row?.metar_context?.station || "Settlement",
      source: row?.metar_context?.station || row?.airport || "Settlement",
      color: "#009688",
      featured: true,
      values: sVals,
    });
  }

  // METAR
  const mVals = na();
  metarObs.forEach((o) => {
    const idx = tsToIdx.get(o.ts);
    if (idx !== undefined) mVals[idx] = o.value;
  });
  if (mVals.some((v) => v !== null)) {
    series.push({
      key: "metar",
      label: "METAR",
      source: row?.airport || "METAR",
      color: "#0ea5e9",
      dashed: true,
      values: mVals,
    });
  }

  // DEB forecast curve
  if (hourly?.times?.length && hourly?.temps?.length) {
    const debPath = buildDebBaselinePath(
      hourly.times,
      hourly.temps,
      row?.deb_prediction,
      hourly.localTime || row?.local_time,
      hourly.forecastTodayHigh,
    );
    const debVals = na();
    hourly.times.forEach((t, i) => {
      const ts = toTimestamp(t);
      const idx = ts !== null ? tsToIdx.get(ts) : undefined;
      if (idx !== undefined && i < debPath.debTemps.length) {
        debVals[idx] = validNumber(debPath.debTemps[i]);
      }
    });
    if (debVals.some((v) => v !== null)) {
      series.push({
        key: "hourly_forecast",
        label: "DEB Forecast",
        source: "DEB Hourly",
        color: "#f97316",
        featured: true,
        smooth: true,
        values: debVals,
      });
    }

    // Per-model hourly curves
    if (hourly.modelCurves) {
      const modelColors = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];
      Object.keys(hourly.modelCurves).forEach((model, idx) => {
        const modelTemps = hourly.modelCurves![model];
        if (!modelTemps?.length) return;
        const vals = na();
        hourly.times.forEach((t, i) => {
          const ts = toTimestamp(t);
          const x = ts !== null ? tsToIdx.get(ts) : undefined;
          if (x !== undefined && i < modelTemps.length) vals[x] = validNumber(modelTemps[i]);
        });
        if (vals.some((v) => v !== null)) {
          series.push({
            key: `model_curve_${model}`,
            label: model,
            source: "Multi-model hourly",
            color: modelColors[idx % modelColors.length],
            dashed: true,
            smooth: true,
            values: vals,
          });
        }
      });
    }
  }

  // Fallback: if no series, use current temp as a flat line
  if (!series.length) {
    const fallback = validNumber(row?.current_temp) ?? validNumber(row?.deb_prediction) ?? validNumber(row?.target_threshold);
    if (fallback !== null) {
      const vals = na().map(() => fallback);
      series.push({
        key: "current",
        label: "Current",
        source: "Live",
        color: "#009688",
        featured: true,
        values: vals,
      });
    }
  }

  // Build data rows: one per timestamp
  const data = sorted.map((ts, i) => {
    const point: Record<string, string | number | null> = {
      label: formatTimestamp(ts),
      ts,
    };
    series.forEach((s) => { point[s.key] = s.values[i]; });
    return point;
  });

  return { data, series };
}

// ── Model summary cards (daily high point predictions) ─────────────────

function buildModelSummaryCards(row: ScanOpportunityRow | null): EvidenceSeries[] {
  return Object.entries(row?.model_cluster_sources || {})
    .map(([label, value]) => [label, validNumber(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)
    .slice(0, 4)
    .map(([label, value], index) => ({
      key: `model_summary_${index}`,
      label,
      source: "Multi-model daily high",
      color: ["#2563eb", "#14b8a6", "#7c3aed", "#64748b"][index] || "#64748b",
      dashed: true,
      values: [value],
    }));
}

// ── Market temperature ticks for Y-axis ─────────────────────────────────

function parseTemperatureOptionsFromText(value?: string | null) {
  const raw = String(value || "");
  const matches = raw.match(/-?\d+(?:\.\d+)?/g) || [];
  return matches.map(Number).filter((v) => Number.isFinite(v) && v > -80 && v < 80);
}

function buildMarketTemperatureOptions(row: ScanOpportunityRow | null) {
  const buckets = row?.distribution_full?.length
    ? row.distribution_full
    : row?.distribution_preview;
  const values = new Set<number>();
  (buckets || []).forEach((b) => {
    const v = validNumber(b.value);
    if (v !== null) values.add(v);
    parseTemperatureOptionsFromText(b.label).forEach((x) => values.add(x));
  });
  [row?.target_lower, row?.target_upper, row?.target_value, row?.target_threshold]
    .forEach((v) => { if (validNumber(v) !== null) values.add(validNumber(v)!); });
  parseTemperatureOptionsFromText(row?.target_label).forEach((x) => values.add(x));
  parseTemperatureOptionsFromText(row?.market_question).forEach((x) => values.add(x));

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length) return sorted;
  const t = validNumber(row?.target_threshold) ?? validNumber(row?.target_value);
  if (t === null) return null;
  return [t - 2, t - 1, t, t + 1, t + 2];
}

function buildChartDomain(
  ticks: number[] | null,
  series: EvidenceSeries[],
): [number, number] | ["auto", "auto"] {
  const vals = series.flatMap((s) => s.values).filter((v): v is number => validNumber(v) !== null);
  const all = [...(ticks || []), ...vals];
  if (!all.length) return ["auto", "auto"];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1, max - min);
  const pad = Math.max(0.5, span * 0.08);
  return [Number((min - pad).toFixed(1)), Number((max + pad).toFixed(1))];
}

// ── Main component ─────────────────────────────────────────────────────

export function LiveTemperatureThresholdChart({
  isEn,
  row,
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
}) {
const hourlyCache = new Map<string, { ts: number; data: HourlyForecast }>();
const HOURLY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

  const [hourly, setHourly] = useState<HourlyForecast>(null);
  const city = String(row?.city || "").toLowerCase().trim();

  useEffect(() => {
    if (!city) return;
    const cached = hourlyCache.get(city);
    if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
      setHourly(cached.data);
      return;
    }
    setHourly(null);
    let cancelled = false;
    fetch(`/api/city/${encodeURIComponent(city)}/detail?depth=panel&force_refresh=false`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<CityDetail>;
      })
      .then((json) => {
        if (cancelled || !json?.hourly) return;
        const data: HourlyForecast = {
          forecastTodayHigh: json.forecast?.today_high ?? null,
          localTime: json.local_time || null,
          times: json.hourly.times || [],
          temps: json.hourly.temps || [],
          modelCurves: json.models_hourly?.curves || undefined,
        };
        hourlyCache.set(city, { ts: Date.now(), data });
        setHourly(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [city]);

  const { data, series } = useMemo(() => buildSlidingChartData(row, hourly), [row, hourly]);
  const threshold = validNumber(row?.target_threshold) ?? validNumber(row?.target_value);
  const modelSummaryCards = useMemo(() => {
    const cards = buildModelSummaryCards(row);
    if (!hourly?.modelCurves) return cards;
    const curveKeys = new Set(Object.keys(hourly.modelCurves));
    return cards.filter((c) => !curveKeys.has(c.label));
  }, [row, hourly]);
  const tableRows = [...series, ...modelSummaryCards]
    .slice(0, 5)
    .map((item) => ({ ...item, ...seriesStats(item.values) }));
  const marketTicks = useMemo(() => buildMarketTemperatureOptions(row), [row]);
  const chartDomain = useMemo(() => buildChartDomain(marketTicks, series), [marketTicks, series]);

  return (
    <Panel title={isEn ? "Live Temperature Trend & Option Threshold Lines" : "实时气温走势与期权阈值线"}>
      <div className="flex h-full min-h-[420px] flex-col">
        {/* Stats bar */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
          <div className="mb-2 flex items-end justify-between gap-3 text-[10px]">
            <div className="space-y-0.5">
              <div className="font-mono font-black text-teal-700">
                {isEn ? "Settlement live" : "跑道实测"} {temp(validNumber(row?.current_temp))}
              </div>
              <div className="font-mono font-black text-blue-600">
                METAR {temp(validNumber(row?.metar_context?.airport_current_temp ?? row?.metar_context?.last_temp))}
              </div>
            </div>
            <div className="text-right font-mono font-black text-slate-800">
              {isEn ? "Threshold" : "当日阈值"} {temp(threshold)}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-[10px]">
            {tableRows.map((item) => (
              <div
                key={item.key}
                className={clsx(
                  "rounded border px-2 py-1.5",
                  item.featured ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-black text-slate-700">{item.label}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-600">
                  {item.key.startsWith("model_summary_") ? (
                    <span>{temp(item.latest)}</span>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <span>now: {temp(item.latest)}</span>
                      <span>max: {temp(item.high)}</span>
                      <span>15m: {item.delta15 === null ? "--" : `${item.delta15 >= 0 ? "+" : ""}${item.delta15.toFixed(1)}°`}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="relative min-h-0 flex-1 p-2">
          <div className="absolute left-3 top-3 z-10 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-800 shadow-sm">
            {rowName(row)}
            {row?.market_url ? (
              <Link href={row.market_url} target="_blank" className="ml-1 text-blue-600 hover:underline">
                <ExternalLink size={10} className="inline" />
              </Link>
            ) : null}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={data} margin={{ top: 16, right: 28, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#dbe6ef" strokeDasharray="2 2" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickLine={false}
                axisLine={{ stroke: "#cbd5e1" }}
                interval={Math.max(1, Math.floor(data.length / 8))}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${Number(v).toFixed(1)}°`}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                domain={chartDomain}
                ticks={marketTicks ?? undefined}
              />
              {threshold !== null && (
                <ReferenceLine
                  y={threshold}
                  stroke="#f97316"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  label={{ value: `${threshold.toFixed(1)}°`, fill: "#f97316", fontSize: 10, position: "left" }}
                />
              )}
              <Tooltip
                contentStyle={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  fontSize: 11,
                  boxShadow: "0 8px 24px rgba(15,23,42,.12)",
                }}
                formatter={(value: unknown) => `${Number(value).toFixed(2)}°`}
              />
              {series.map((item) => (
                <Line
                  key={item.key}
                  type={item.smooth ? "monotone" : "linear"}
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={item.featured ? 2 : 1}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}
