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
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
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

type RunwayObsPayload = {
  runway_pairs?: Array<[string, string] | string[] | null> | null;
  temperatures?: Array<[number | null, number | null] | Array<number | null> | null> | null;
  point_temperatures?: Array<{
    runway?: string | null;
    tdz_temp?: number | null;
    mid_temp?: number | null;
    end_temp?: number | null;
  } | null> | null;
};

const DAILY_CHART_HOURS = Array.from(
  { length: 24 },
  (_, index) => `${String(index).padStart(2, "0")}:00`,
);

function validNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeObs(points?: ObsPoint[] | null, limit = 88) {
  return (points || [])
    .filter((point) => validNumber(point.temp) !== null)
    .slice(-limit)
    .map((point, index) => ({
      label: point.time || String(index + 1),
      value: Number(point.temp),
    }));
}

function parseHourOfDay(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getHours();
  }
  const match = raw.match(/(?:^|\D)([01]?\d|2[0-3])[:：][0-5]\d/);
  if (match?.[1] !== undefined) {
    const hour = Number(match[1]);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  }
  return null;
}

function seriesStats(values: Array<number | null>) {
  const nums = values.filter((value): value is number => validNumber(value) !== null);
  const latest = nums.length ? nums[nums.length - 1] : null;
  const high = nums.length ? Math.max(...nums) : null;
  const first15 = nums.length > 1 ? nums[Math.max(0, nums.length - 15)] : null;
  const delta15 = latest !== null && first15 !== null ? latest - first15 : null;
  return { latest, high, delta15 };
}

type HourlyForecast = { times: string[]; temps: Array<number | null> } | null;

function buildModelCurves(row: ScanOpportunityRow | null, length: number, hourly: HourlyForecast) {
  const result: EvidenceSeries[] = [];
  // Use hourly forecast data if available (DEB-blended ensemble curve)
  if (hourly?.times?.length && hourly?.temps?.length) {
    const values = Array.from({ length }, (): number | null => null);
    hourly.times.forEach((t, i) => {
      const hour = /(\d{1,2}):/.exec(String(t || ""))?.[1];
      const h = hour ? parseInt(hour, 10) : null;
      if (h !== null && h >= 0 && h < length && i < hourly.temps.length) {
        values[h] = validNumber(hourly.temps[i]);
      }
    });
    if (values.some((v) => v !== null)) {
      result.push({
        key: "hourly_forecast",
        label: "DEB Forecast",
        source: "DEB Hourly",
        color: "#f97316",
        featured: true,
        smooth: true,
        values,
      });
    }
  }
  // Fallback: show model daily-high points as anchors
  const modelEntries = Object.entries(row?.model_cluster_sources || {})
    .map(([label, value]) => [label, validNumber(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)
    .slice(0, 3);
  modelEntries.forEach(([label, value], index) => {
    // Place anchor points at peak hours (14-17 local)
    const values = Array.from({ length }, (): number | null => null);
    for (let h = 14; h <= 17; h++) values[h] = value;
    result.push({
      key: `model_${index}`,
      label,
      source: "Multi-model",
      color: ["#2563eb", "#14b8a6", "#7c3aed"][index] || "#64748b",
      dashed: true,
      values,
    });
  });
  return result;
}

function extractRunwayPointSeries(row: ScanOpportunityRow | null, length: number): EvidenceSeries[] {
  const payload = row as
    | (ScanOpportunityRow & {
        amos?: { runway_obs?: RunwayObsPayload | null; source_label?: string | null; source?: string | null } | null;
        runway_obs?: RunwayObsPayload | null;
      })
    | null;
  const runwayObs = payload?.amos?.runway_obs || payload?.runway_obs;
  if (!runwayObs) return [];
  const pairs = runwayObs.runway_pairs || [];
  const runwayTemps = runwayObs.temperatures || [];
  const pointTemps = runwayObs.point_temperatures || [];
  const source = payload?.amos?.source_label || payload?.amos?.source || "Runway";
  const series: EvidenceSeries[] = [];

  pairs.forEach((pair, index) => {
    const pairLabel = Array.isArray(pair) && pair.length
      ? pair.filter(Boolean).join("/")
      : pointTemps[index]?.runway || `RWY ${index + 1}`;
    const values = [
      ...(Array.isArray(runwayTemps[index]) ? runwayTemps[index] || [] : []),
      pointTemps[index]?.tdz_temp,
      pointTemps[index]?.mid_temp,
      pointTemps[index]?.end_temp,
    ]
      .map(validNumber)
      .filter((value): value is number => value !== null);
    if (!values.length) return;
    const maxTemp = Math.max(...values);
    series.push({
      key: `runway_${index}`,
      label: `${pairLabel} runway`,
      source,
      color: ["#009688", "#f97316", "#0ea5e9", "#ef4444"][index] || "#64748b",
      featured: index === 0,
      dashed: index !== 0,
      values: Array.from({ length }, () => maxTemp),
    });
  });

  return series.slice(0, 4);
}

function buildEvidenceChart(row: ScanOpportunityRow | null, hourly: HourlyForecast) {
  const settlement = normalizeObs(row?.settlement_today_obs || row?.metar_context?.settlement_today_obs);
  const metar = normalizeObs(row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs);
  const labels = DAILY_CHART_HOURS;
  const length = labels.length;

  const align = (points: Array<{ label: string; value: number }>) => {
    if (!points.length) return Array.from({ length }, (): number | null => null);
    const values = Array.from({ length }, (): number | null => null);
    points.forEach((point, index) => {
      const hour = parseHourOfDay(point.label);
      const bucket = hour ?? Math.min(index, length - 1);
      values[bucket] = point.value;
    });
    return values;
  };

  const series: EvidenceSeries[] = [];
  series.push(...extractRunwayPointSeries(row, length));
  if (settlement.length) {
    series.push({
      key: "settlement",
      label: "Settlement runway",
      source: row?.metar_context?.station_label || row?.metar_context?.station || row?.airport || "Settlement",
      color: "#009688",
      featured: true,
      values: align(settlement),
    });
  }
  if (metar.length) {
    series.push({
      key: "metar",
      label: "METAR official",
      source: row?.airport || row?.metar_context?.source || "METAR",
      color: "#0ea5e9",
      dashed: true,
      values: align(metar),
    });
  }
  series.push(...buildModelCurves(row, length, hourly));

  const fallbackValue =
    validNumber(row?.current_temp) ??
    validNumber(row?.current_max_so_far) ??
    validNumber(row?.deb_prediction) ??
    validNumber(row?.target_value) ??
    validNumber(row?.target_threshold);
  if (!series.length && fallbackValue !== null) {
    series.push({
      key: "current",
      label: "Current reference",
      source: row?.metar_context?.source || "Live",
      color: "#009688",
      featured: true,
      values: Array.from({ length }, () => fallbackValue),
    });
  }

  const data = labels.map((label, index) => {
    const point: Record<string, string | number | null> = { label };
    series.forEach((item) => {
      point[item.key] = item.values[index] ?? null;
    });
    return point;
  });
  return { data, series };
}

export function LiveTemperatureThresholdChart({
  isEn,
  row,
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
}) {
  const [hourly, setHourly] = useState<HourlyForecast>(null);
  const city = String(row?.city || "").toLowerCase().trim();

  useEffect(() => {
    setHourly(null);
    if (!city) return;
    let cancelled = false;
    fetch(`/api/city/${encodeURIComponent(city)}/summary`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ timeseries?: { hourly?: { times?: string[]; temps?: Array<number | null> } } }>;
      })
      .then((json) => {
        if (cancelled || !json?.timeseries?.hourly) return;
        setHourly({
          times: json.timeseries.hourly.times || [],
          temps: json.timeseries.hourly.temps || [],
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [city]);

  const { data, series } = useMemo(() => buildEvidenceChart(row, hourly), [row, hourly]);
  const threshold = validNumber(row?.target_threshold) ?? validNumber(row?.target_value);
  const tableRows = series.slice(0, 5).map((item) => ({ ...item, ...seriesStats(item.values) }));

  return (
    <Panel title={isEn ? "Live Temperature Trend & Option Threshold Lines" : "实时气温走势与期权阈值线"}>
      <div className="flex h-full min-h-[420px] flex-col">
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
                <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px] text-slate-600">
                  <span>now: {temp(item.latest)}</span>
                  <span>max: {temp(item.high)}</span>
                  <span>15m: {item.delta15 === null ? "--" : `${item.delta15 >= 0 ? "+" : ""}${item.delta15.toFixed(1)}°`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 flex-1 p-2">
          <div className="absolute left-3 top-3 z-10 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-800 shadow-sm">
            {rowName(row)} <span className="ml-1 text-teal-600">{row?.target_label || row?.market_direction || ""}</span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={data} margin={{ top: 16, right: 28, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#dbe6ef" strokeDasharray="2 2" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} interval={2} />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `${Number(v).toFixed(1)}°`} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
              {threshold !== null && (
                <ReferenceLine
                  y={threshold}
                  stroke="#f97316"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  label={{ value: `UMA ${threshold.toFixed(1)}°`, fill: "#f97316", fontSize: 10, position: "left" }}
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
                  dataKey={item.key}
                  stroke={item.color}
                  strokeWidth={item.featured ? 2.4 : 1.4}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  isAnimationActive={false}
                  name={item.label}
                  type={item.smooth ? "monotone" : "stepAfter"}
                />
              ))}
            </ReLineChart>
          </ResponsiveContainer>
        </div>
        {row?.market_slug ? (
          <div className="shrink-0 border-t border-slate-200 px-3 py-2">
            <Link
              href={`https://polymarket.com/event/${row.market_slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-800 transition-colors"
            >
              <ExternalLink size={12} />
              {isEn ? "View on Polymarket" : "在 Polymarket 查看"}
            </Link>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
