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
import type { AmosData, AirportCurrentConditions, CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { rowName, temp } from "@/components/dashboard/scan-terminal/utils";

const SETTLEMENT_RUNWAY_PAIRS: Record<string, Array<[string, string]>> = {
  shanghai: [["17L", "35R"]],
  beijing: [["01", "19"]],
  guangzhou: [["02L", "20R"]],
  chengdu: [["02L", "20R"]],
  chongqing: [["02L", "20R"]],
  wuhan: [["04", "22"]],
  seoul: [["15R", "33L"]],
};

function normalizeRunwayLabel(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCityKey(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function pairKey(pair: [string, string]) {
  return pair.map(normalizeRunwayLabel).sort().join("/");
}

function buildRunwayPlates(
  amos: AmosData | null | undefined,
  row: ScanOpportunityRow | null,
  settlementObs?: Array<{ ts: number; value: number }>,
) {
  if (!amos) return [];
  const runwayObs = amos.runway_obs || {};
  const runwayPairs = runwayObs.runway_pairs || [];
  const runwayTemps = runwayObs.temperatures || [];
  const pointTemps = runwayObs.point_temperatures || [];

  const cityKey = normalizeCityKey(row?.city);
  const settlementPairs = SETTLEMENT_RUNWAY_PAIRS[cityKey] || [];
  const settlementKeys = new Set(settlementPairs.map(pairKey));

  const list: Array<{
    rwy: string;
    isSettlement: boolean;
    tdzTemp: number | null;
    midTemp: number | null;
    endTemp: number | null;
    maxTemp: number | null;
    dailyHigh: number | null;
    trend_15m: number | null;
  }> = [];

  runwayPairs.forEach((rawPair: any, index: number) => {
    const pair = rawPair as [string, string];
    if (!Array.isArray(pair) || pair.length < 2) return;
    const isSettlement = settlementKeys.has(pairKey(pair));
    
    const tdz = validNumber(pointTemps[index]?.tdz_temp);
    const mid = validNumber(pointTemps[index]?.mid_temp);
    const end = validNumber(pointTemps[index]?.end_temp);
    
    const historyVals = Array.isArray(runwayTemps[index])
      ? (runwayTemps[index] as Array<number | null>).map(validNumber).filter((v): v is number => v !== null)
      : [];

    const tdzVal = tdz !== null ? [tdz] : [];
    const midVal = mid !== null ? [mid] : [];
    const endVal = end !== null ? [end] : [];
    const allVals = [...historyVals, ...tdzVal, ...midVal, ...endVal];
    
    const maxTemp = allVals.length ? Math.max(...allVals) : null;
    const dailyHigh = historyVals.length ? Math.max(...historyVals) : maxTemp;

    // Calculate 15-minute trend
    const latest = historyVals.length > 0 ? historyVals[historyVals.length - 1] : (tdz ?? mid ?? end ?? null);
    const val15 = historyVals.length > 15 ? historyVals[historyVals.length - 16] : (historyVals.length > 0 ? historyVals[0] : null);
    let trend_15m = (latest !== null && val15 !== null) ? latest - val15 : null;

    if (isSettlement && settlementObs && settlementObs.length >= 2) {
      const latestObs = settlementObs[settlementObs.length - 1];
      const targetTs = latestObs.ts - 15 * 60 * 1000;
      let closestPoint = settlementObs[0];
      let minDiff = Math.abs(closestPoint.ts - targetTs);
      for (let i = 1; i < settlementObs.length; i++) {
        const diff = Math.abs(settlementObs[i].ts - targetTs);
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = settlementObs[i];
        }
      }
      if (Math.abs(closestPoint.ts - targetTs) < 5 * 60 * 1000) {
        trend_15m = latestObs.value - closestPoint.value;
      }
    }

    list.push({
      rwy: `${normalizeRunwayLabel(pair[0])}/${normalizeRunwayLabel(pair[1])}`,
      isSettlement,
      tdzTemp: tdz,
      midTemp: mid,
      endTemp: end,
      maxTemp,
      dailyHigh,
      trend_15m,
    });
  });

  return list;
}

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
const HOURLY_CACHE_TTL_MS = 30 * 60 * 1000;
const _hourlyCache = new Map<string, { ts: number; data: HourlyForecast }>();

function validNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getCityLocalUtcTimestamp(
  value: string | number | null | undefined,
  tzOffsetSeconds: number,
  referenceLocalDate?: string | null
): number | null {
  if (value == null) return null;
  
  if (typeof value === "number") {
    const d = new Date(value + tzOffsetSeconds * 1000);
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes()
    );
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (raw.includes("T") || raw.includes("Z") || raw.includes("-")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const localMs = d.getTime() + tzOffsetSeconds * 1000;
      const localDate = new Date(localMs);
      return Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
        localDate.getUTCHours(),
        localDate.getUTCMinutes()
      );
    }
  }

  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const h = +m[1];
    const min = +m[2];
    
    let year = new Date().getUTCFullYear();
    let month = new Date().getUTCMonth();
    let date = new Date().getUTCDate();
    
    if (referenceLocalDate) {
      const dateParts = referenceLocalDate.split("-");
      if (dateParts.length === 3) {
        year = parseInt(dateParts[0]);
        month = parseInt(dateParts[1]) - 1;
        date = parseInt(dateParts[2]);
      }
    }
    
    return Date.UTC(year, month, date, h, min);
  }

  return null;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function normObs(points: ObsPoint[] | null | undefined, tzOffsetSeconds: number, limit = MAX_OBS_POINTS) {
  return (points || [])
    .filter((p) => validNumber(p.temp) !== null && p.time)
    .map((p) => ({
      ts: getCityLocalUtcTimestamp(p.time, tzOffsetSeconds)!,
      value: Number(p.temp),
    }))
    .filter((p) => p.ts !== null)
    .slice(-limit);
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
  amos?: AmosData | null;
  airportCurrent?: AirportCurrentConditions | null;
  airportPrimary?: AirportCurrentConditions | null;
} | null;

// ── Build aligned data rows for the sliding-window chart ────────────────

function buildSlidingChartData(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
) {
  const tzOffset = row?.tz_offset_seconds ?? 0;
  const localDateStr = row?.local_date || new Date().toISOString().slice(0, 10);

  const settlementObs = normObs(row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset);
  const metarObs = normObs(row?.metar_today_obs || row?.metar_context?.today_obs || row?.metar_recent_obs || row?.metar_context?.recent_obs, tzOffset);

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
      const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
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
    const cityKey = String(row?.city || "").toLowerCase().trim();
    const runwaySensorCities = new Set([
      'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'qingdao',
      'chengdu', 'chongqing', 'wuhan', // AMSC runway sensors
      'seoul', 'busan',                 // AMOS runway sensors
    ]);
    const isHKO = cityKey === 'hong kong' || cityKey === 'lau fau shan' || cityKey.includes('hongkong') || cityKey.includes('laufau');
    const isTokyo = cityKey === 'tokyo';
    const isSingapore = cityKey === 'singapore';
    const isWeatherStation = !runwaySensorCities.has(cityKey)
      && !isHKO && !isTokyo && !isSingapore;

    const runwayHeaderLabel = isHKO ? '参考站点 (1分钟)'
      : isTokyo ? '机场气象站 (10分钟)'
      : isSingapore ? '航站楼温度'
      : isWeatherStation ? '气象站实测'
      : '跑道实测 (1分钟)';

    series.push({
      key: "settlement",
      label: runwayHeaderLabel,
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
      const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
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
          const ts = getCityLocalUtcTimestamp(t, tzOffset, localDateStr);
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
  allRows = [],
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
  allRows?: ScanOpportunityRow[];
}) {
  const [hourly, setHourly] = useState<HourlyForecast>(null);
  const city = String(row?.city || "").toLowerCase().trim();

  useEffect(() => {
    if (!city) return;
    const cached = _hourlyCache.get(city);
    if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
      setHourly(cached.data);
      return;
    }
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
        const hourlySource = (json as any)?.hourly ?? (json as any)?.timeseries?.hourly;
        if (cancelled || !json || !hourlySource) return;
        const data: HourlyForecast = {
          forecastTodayHigh: json.forecast?.today_high ?? null,
          localTime: json.local_time || null,
          times: hourlySource.times || [],
          temps: hourlySource.temps || [],
          modelCurves: (json.models_hourly ?? (json as any)?.timeseries?.models_hourly)?.curves || undefined,
          amos: json.amos || null,
          airportCurrent: json.airport_current || null,
          airportPrimary: json.airport_primary || null,
        };
        _hourlyCache.set(city, { ts: Date.now(), data });
        setHourly(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [city]);

  const { data, series } = useMemo(() => buildSlidingChartData(row, hourly), [row, hourly]);
  const threshold = validNumber(row?.target_threshold) ?? validNumber(row?.target_value);

  const tzOffset = row?.tz_offset_seconds ?? 0;
  const settlementObs = useMemo(() => {
    return normObs(row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset);
  }, [row, tzOffset]);

  const runwayPlates = useMemo(() => buildRunwayPlates(hourly?.amos, row, settlementObs), [hourly?.amos, row, settlementObs]);
  const settlementPlate = useMemo(() => runwayPlates.find((p) => p.isSettlement), [runwayPlates]);

  const cityKey = String(row?.city || "").toLowerCase().trim();
  const runwaySensorCities = new Set([
    'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'qingdao',
    'chengdu', 'chongqing', 'wuhan', // AMSC runway sensors
    'seoul', 'busan',                 // AMOS runway sensors
  ]);
  const isHKO = cityKey === 'hong kong' || cityKey === 'lau fau shan' || cityKey.includes('hongkong') || cityKey.includes('laufau');
  const isTokyo = cityKey === 'tokyo';
  const isSingapore = cityKey === 'singapore';
  const isWeatherStation = !runwaySensorCities.has(cityKey)
    && !isHKO && !isTokyo && !isSingapore;

  const runwayHeaderLabel = isHKO ? '参考站点 (1分钟)'
    : isTokyo ? '机场气象站 (10分钟)'
    : isSingapore ? '航站楼温度'
    : isWeatherStation ? '气象站实测'
    : '跑道实测 (1分钟)';

  const metarHeaderLabel = isHKO ? '天文台实测 (10分钟)'
    : 'METAR 结算 (30分钟)';

  const runwayHighLabel = isHKO ? '参考站点'
    : isTokyo ? '机场气象站'
    : isSingapore ? '航站楼'
    : isWeatherStation ? '气象站'
    : '跑道实测';

  const metarHighLabel = isHKO ? '天文台'
    : 'METAR 官方';

  const currentRunwayTemp = validNumber(hourly?.amos?.temp_c) ?? validNumber(row?.current_temp) ?? settlementPlate?.maxTemp ?? null;
  const observedHighMetar = validNumber(row?.metar_context?.airport_max_so_far ?? row?.metar_context?.max_temp ?? row?.current_max_so_far) ?? null;
  const observedHighRunway = validNumber(row?.current_max_so_far) ?? settlementPlate?.maxTemp ?? currentRunwayTemp ?? null;
  const wundergroundDailyHigh = validNumber(hourly?.airportCurrent?.max_so_far ?? hourly?.airportPrimary?.max_so_far) ?? null;

  const modelValues = Object.values(row?.model_cluster_sources || {})
    .map(validNumber)
    .filter((v): v is number => v !== null);
  const modelMin = modelValues.length ? Math.min(...modelValues) : (row?.cluster_core_low ?? null);
  const modelMax = modelValues.length ? Math.max(...modelValues) : (row?.cluster_core_high ?? null);
  const debVal = validNumber(row?.deb_prediction) ?? null;

  const spread = (modelMax !== null && modelMin !== null) ? modelMax - modelMin : null;
  const spreadLabel = spread === null ? "" : (spread <= 2.0 ? "低分歧" : (spread <= 4.0 ? "中等分歧" : "高分歧"));
  const spreadLabelEn = spread === null ? "" : (spread <= 2.0 ? "Low" : (spread <= 4.0 ? "Medium" : "High"));

  const formattedUpdateTime = useMemo(() => {
    if (row?.local_date && row?.local_time) {
      return `${row.local_date} ${row.local_time.slice(0, 8)}`;
    }
    const d = new Date();
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }, [row]);

  const cityThresholds = useMemo(() => {
    if (!row || !allRows || !allRows.length) return [];
    const cityKey = String(row.city || "").toLowerCase().trim();
    const sameCityRows = allRows.filter(
      (r) => String(r.city || "").toLowerCase().trim() === cityKey
    );

    const seen = new Set<number>();
    const list: { threshold: number; label: string; isBreached: boolean; kind: "gte" | "lte" }[] = [];
    sameCityRows.forEach((r) => {
      const t = Number(r.target_threshold ?? r.target_value ?? r.target_lower ?? r.target_upper);
      if (!Number.isFinite(t) || seen.has(t)) return;
      seen.add(t);

      const maxTemp = Number(r.current_max_so_far ?? r.current_temp ?? 0);
      const q = String(r.market_question || r.target_label || "").toLowerCase();
      const kind: "gte" | "lte" = q.includes("below") || q.includes("under") || q.includes("lte") ? "lte" : "gte";
      const isBreached = kind === "lte" ? maxTemp > t : maxTemp >= t;

      list.push({
        threshold: t,
        label: r.target_label || `${t}°C`,
        isBreached,
        kind,
      });
    });

    return list.sort((a, b) => a.threshold - b.threshold);
  }, [row, allRows]);

  const marketTicks = useMemo(() => buildMarketTemperatureOptions(row), [row]);
  const chartDomain = useMemo(() => buildChartDomain(marketTicks, series), [marketTicks, series]);

  return (
    <Panel title={isEn ? "Live Temperature Trend & Option Threshold Lines" : "实时气温走势与期权阈值线"}>
      <div className="flex h-full min-h-[420px] flex-col">
        {/* Stats bar */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          {/* Top Row: Large temperatures */}
          <div className="flex justify-between items-center gap-6 mb-3">
            <div className="flex items-center gap-12">
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {isEn ? "Runway Live (1m)" : `${runwayHeaderLabel}`}
                </span>
                <span className="text-2xl font-bold font-mono text-[#009688] mt-1">
                  {temp(currentRunwayTemp)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {isEn ? "METAR Settlement (30m) · Daily High" : `${metarHeaderLabel} · 当日最高`}
                </span>
                <span className="text-2xl font-bold font-mono text-blue-600 mt-1">
                  {temp(observedHighMetar)}
                </span>
              </div>
            </div>
            
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isEn ? "Daily Peak" : "当日最高气温"}
              </span>
              <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-600">
                <span>{isEn ? "Runway" : runwayHighLabel}: <strong className="text-[#009688]">{temp(observedHighRunway)}</strong></span>
                <span>|</span>
                <span>{isEn ? "METAR" : metarHighLabel}: <strong className="text-blue-600">{temp(observedHighMetar)}</strong></span>
                {wundergroundDailyHigh !== null && (
                  <>
                    <span>|</span>
                    <span>WU: <strong className="text-purple-600">{temp(wundergroundDailyHigh)}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Model Range Panel */}
          <div className="grid grid-cols-4 gap-4 border-t border-slate-100 pt-3 text-xs font-mono text-slate-700 bg-slate-50/50 -mx-4 px-4 rounded-b-md">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isEn ? "Model Range" : "模型区间"}
              </span>
              <strong className="text-slate-800 font-bold">
                {modelMin !== null && modelMax !== null ? `${temp(modelMin)} - ${temp(modelMax)}` : "--"}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                DEB
              </span>
              <strong className="text-blue-600 font-bold">
                {temp(debVal)}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isEn ? "Spread" : "分歧"}
              </span>
              <strong className={clsx("font-bold", spreadLabel === "高分歧" ? "text-amber-600" : "text-slate-600")}>
                {spread !== null ? `${spread.toFixed(1)}°C` : "--"}
                {spreadLabel && ` · ${isEn ? spreadLabelEn : spreadLabel}`}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isEn ? "Updated" : "更新时间"}
              </span>
              <strong className="text-slate-800 font-bold">
                {formattedUpdateTime}
              </strong>
            </div>
          </div>
        </div>

        {/* Runway observations */}
        {runwayPlates.length > 0 && (
          <div className="shrink-0 border-b border-slate-200 bg-[#f8fafc] px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-black text-slate-700 mb-1.5 uppercase">
              <span>{isEn ? "Runway Observations" : "跑道观测"}</span>
              {runwayPlates.some((p) => p.trend_15m !== null && p.trend_15m > 0 && !p.isSettlement) && (
                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-sans">
                  {isEn ? "Non-settlement Runway Warming Alert" : "非结算跑道升温提醒"}
                </span>
              )}
            </div>
            <div className="grid gap-1">
              {runwayPlates.map((plate) => (
                <div
                  key={plate.rwy}
                  className={clsx(
                    "grid grid-cols-7 gap-2 items-center border rounded px-2.5 py-1 text-[11px] font-mono",
                    plate.isSettlement
                      ? "border-emerald-200 bg-emerald-50/50 text-emerald-950 font-bold"
                      : "border-slate-200 bg-white text-slate-600"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-sans font-bold text-slate-800">
                    {plate.isSettlement && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />}
                    <span>{plate.rwy}</span>
                    {plate.isSettlement && (
                      <span className="text-[9px] bg-teal-200 text-teal-800 px-1 rounded font-normal">
                        {isEn ? "Settlement" : "结算"}
                      </span>
                    )}
                  </div>
                  <div>TDZ: <strong>{plate.tdzTemp !== null ? `${plate.tdzTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>MID: <strong>{plate.midTemp !== null ? `${plate.midTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>END: <strong>{plate.endTemp !== null ? `${plate.endTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>max: <strong>{plate.maxTemp !== null ? `${plate.maxTemp.toFixed(1)}°C` : "--"}</strong></div>
                  <div>high: <strong>{plate.dailyHigh !== null ? `${plate.dailyHigh.toFixed(1)}°C` : "--"}</strong></div>
                  <div className={clsx(plate.trend_15m !== null && plate.trend_15m > 0 ? "text-orange-600 font-bold" : "text-slate-500")}>
                    15m: <strong>{plate.trend_15m !== null ? `${plate.trend_15m >= 0 ? "+" : ""}${plate.trend_15m.toFixed(1)}°C` : "--"}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
              {cityThresholds.map((t, idx) => {
                const isSelected = row && (Number(row.target_threshold ?? row.target_value) === t.threshold);
                const labelText = isEn
                  ? `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}° [${t.isBreached ? "Excluded" : "Active"}]`
                  : `${t.kind === "gte" ? "≥" : "≤"} ${t.threshold.toFixed(1)}° [${t.isBreached ? "已排除" : "活跃"}]`;

                return (
                  <ReferenceLine
                    key={idx}
                    y={t.threshold}
                    stroke={isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316"}
                    strokeDasharray={isSelected ? undefined : "4 4"}
                    strokeWidth={isSelected ? 2 : 1}
                    label={{
                      value: labelText,
                      fill: isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316",
                      fontSize: 9,
                      position: isSelected ? "left" : "insideBottomRight",
                    }}
                  />
                );
              })}
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
