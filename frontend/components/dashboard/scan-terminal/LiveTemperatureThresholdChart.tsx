"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  Area,
  ComposedChart as ReComposedChart,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { useLatestPatch, useSseResyncVersion } from "@/hooks/use-sse-patches";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { rowName, temp } from "@/components/dashboard/scan-terminal/utils";

import {
  HOURLY_CACHE_TTL_MS,
  _hourlyCache,
  buildChartDomain,
  buildFullDayChartData,
  buildIntDegreeTicks,
  buildModelSummaryCards,
  buildRunwayPlates,
  fetchHourlyForecastForCity,
  getActiveTemperatureSeries,
  getDebPeakWindowRange,
  getLiveObservationLabels,
  getObservationDisplayMetrics,
  getVisibleTemperatureSeries,
  isTemperatureSeriesVisibleByDefault,
  mergePatchIntoHourly,
  normObs,
  normalizeCityKey,
  readSessionCache,
  seedHourlyForecastFromRow,
  seriesStats,
  shouldPollLiveChart,
  validNumber,
  type HourlyForecast,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";
export { clearCityDetailCache } from "@/components/dashboard/scan-terminal/temperature-chart-logic";

type TooltipSeries = {
  key: string;
  label: string;
  color: string;
};

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

function TemperatureTooltipContent({
  active,
  label,
  payload,
  data,
  series,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload?: Record<string, any> }>;
  data: Array<Record<string, any>>;
  series: TooltipSeries[];
}) {
  if (!active || !payload?.length || !series.length) return null;
  const activePoint = payload[0]?.payload || {};
  const activeIndex = data.findIndex((point) => point.ts === activePoint.ts);
  const rows = series
    .map((item) => {
      const directValue = validNumber(activePoint[item.key]);
      const value = directValue ?? nearestSeriesValue(data, item.key, activeIndex);
      return value === null ? null : { ...item, value };
    })
    .filter((item): item is TooltipSeries & { value: number } => item !== null);
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
            <strong className="font-mono text-slate-900">{item.value.toFixed(2)}°</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
// ── Main component ─────────────────────────────────────────────────────

export function LiveTemperatureThresholdChart({
  isEn,
  row,
  allRows = [],
  compact = false,
  onSearchClick,
  onMaximize,
  onClose,
  isMaximized = false,
  disableClose = false,
  isActive = !compact,
  slotIndex = 0,
}: {
  isEn: boolean;
  row: ScanOpportunityRow | null;
  allRows?: ScanOpportunityRow[];
  compact?: boolean;
  onSearchClick?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  disableClose?: boolean;
  isActive?: boolean;
  slotIndex?: number;
}) {
  const [hourly, setHourly] = useState<HourlyForecast>(null);
  const city = String(row?.city || "").toLowerCase().trim();
  const latestPatch = useLatestPatch(city);
  const resyncVersion = useSseResyncVersion();
  const timeframe = "1D";
  const [viewMode, setViewMode] = useState<"auto" | "full">("auto");
  const [userToggledKeys, setUserToggledKeys] = useState<Record<string, boolean>>({});
  const [liveTemp, setLiveTemp] = useState<number | null>(null);
  const [isHourlyLoading, setIsHourlyLoading] = useState(false);
  const hasLoadedHourlyDetailRef = useRef(false);
  const lastPatchAtRef = useRef<number>(Date.now());
  const lastAppliedPatchRevisionRef = useRef<number>(0);

  const [showRunwayDetails, setShowRunwayDetails] = useState<boolean>(true);
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [targetResolution, setTargetResolution] = useState<string>("10m");

  useEffect(() => {
    setUserToggledKeys({});
    setZoomRange(null);
    setViewMode("auto");
    setShowRunwayDetails(true);
    setHourly(seedHourlyForecastFromRow(row));
    setIsHourlyLoading(Boolean(city));
    hasLoadedHourlyDetailRef.current = false;
    lastPatchAtRef.current = Date.now();
    lastAppliedPatchRevisionRef.current = 0;
  }, [city]);

  useEffect(() => {
    if (!city) {
      setIsHourlyLoading(false);
      return;
    }
    
    const cacheKey = `${city}:${targetResolution}`;
    // Check in-memory cache first
    let cached = _hourlyCache.get(cacheKey);
    if (!cached) {
      // Fallback to session cache
      const sessionEntry = readSessionCache(cacheKey);
      if (sessionEntry) {
        cached = sessionEntry;
        _hourlyCache.set(cacheKey, sessionEntry);
      }
    }

    if (cached && Date.now() - cached.ts < HOURLY_CACHE_TTL_MS) {
      hasLoadedHourlyDetailRef.current = true;
      setHourly(cached.data);
      setIsHourlyLoading(false);
      return;
    }

    if (!hasLoadedHourlyDetailRef.current) {
      setHourly(seedHourlyForecastFromRow(row));
    }
    setIsHourlyLoading(!hasLoadedHourlyDetailRef.current);
    let cancelled = false;

    // Prioritize active slots, stagger/delay background slots to optimize load performance
    const delay = isActive ? 0 : (slotIndex ? 300 + slotIndex * 250 : 350);

    const timer = setTimeout(() => {
      fetchHourlyForecastForCity(city, { resolution: targetResolution })
        .then((data) => {
          if (cancelled || !data) return;
          hasLoadedHourlyDetailRef.current = true;
          setHourly(data);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsHourlyLoading(false);
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [city, row, isActive, slotIndex, targetResolution]);

  useEffect(() => {
    if (!latestPatch || latestPatch.revision <= lastAppliedPatchRevisionRef.current) return;
    lastAppliedPatchRevisionRef.current = latestPatch.revision;
    lastPatchAtRef.current = Date.now();
    const tempValue = validNumber(latestPatch.changes.temp);
    if (tempValue !== null) setLiveTemp(tempValue);
    setHourly((prev) => mergePatchIntoHourly(prev ?? seedHourlyForecastFromRow(row), latestPatch));
  }, [latestPatch, row]);

  useEffect(() => {
    if (!resyncVersion || !city) return;
    let cancelled = false;
    fetchHourlyForecastForCity(city, { ignoreCache: true, resolution: targetResolution })
      .then((data) => {
        if (cancelled || !data) return;
        hasLoadedHourlyDetailRef.current = true;
        setHourly(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsHourlyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resyncVersion, city, targetResolution]);

  // ── SSE fallback: only full-fetch if a visible chart has seen no patch for 2 minutes ──
  useEffect(() => {
    if (!shouldPollLiveChart({ city, compact, isActive, isMaximized })) return;
    let cancelled = false;

    const refreshFullDetail = () => {
      lastPatchAtRef.current = Date.now();

      fetchHourlyForecastForCity(city, { ignoreCache: true })
        .then((data) => {
          if (cancelled || !data) return;
          hasLoadedHourlyDetailRef.current = true;
          setHourly(data);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsHourlyLoading(false);
        });
    };

    const checkFallback = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (Date.now() - lastPatchAtRef.current < 2 * 60_000) return;

      fetch(`/api/city/${encodeURIComponent(city)}/summary`)
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
          if (cancelled || !payload) return;
          const temp = validNumber(payload?.current?.temp);
          if (temp !== null) setLiveTemp(temp);
        })
        .catch(() => {});

      refreshFullDetail();
    };

    const id = setInterval(checkFallback, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [city, compact, isActive, isMaximized]);

  const { data, series } = useMemo(() => buildFullDayChartData(row, hourly, isEn), [row, hourly, isEn]);

  const autoWindowRange = useMemo(
    () => (viewMode === "auto" ? getDebPeakWindowRange(data, series) : null),
    [data, series, viewMode],
  );
  const visibleRange = zoomRange ?? autoWindowRange;
  const visibleRangeKey = visibleRange ? `${visibleRange[0]}:${visibleRange[1]}` : "full";

  const zoomedData = useMemo(() => {
    if (!visibleRange || data.length === 0) return data;
    const [start, end] = visibleRange;
    return data.slice(start, end + 1);
  }, [data, visibleRangeKey]);

  const nextTargetResolution = useMemo(() => {
    if (visibleRange && data.length > 0) {
      const zoomedData = data.slice(visibleRange[0], visibleRange[1] + 1);
      if (zoomedData.length > 0) {
        const startTs = zoomedData[0].ts;
        const endTs = zoomedData[zoomedData.length - 1].ts;
        if (endTs - startTs <= 2 * 60 * 60 * 1000) {
          return "1m";
        }
      }
    }
    return "10m";
  }, [data, visibleRangeKey]);

  useEffect(() => {
    if (targetResolution !== nextTargetResolution) {
      setTargetResolution(nextTargetResolution);
    }
  }, [targetResolution, nextTargetResolution]);

  const tzOffset = row?.tz_offset_seconds ?? 0;
  const settlementObs = useMemo(() => {
    let obs = normObs(hourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset, undefined, row?.local_date || null);
    if (!obs.length && !hourly?.runwayPlateHistory) {
      const mObs = normObs(hourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs, tzOffset, undefined, row?.local_date || null);
      if (mObs.length > 0) {
        obs = mObs;
      }
    }
    return obs;
  }, [row, hourly, tzOffset]);

  const runwayPlates = useMemo(() => buildRunwayPlates(hourly?.amos, row, settlementObs), [hourly?.amos, row, settlementObs]);
  const hasRunwayData = runwayPlates.length > 0;
  const settlementPlate = useMemo(() => runwayPlates.find((p) => p.isSettlement), [runwayPlates]);

  const chartSeries = useMemo(() => {
    return series;
  }, [series]);

  const isSeriesVisible = (sKey: string) => {
    if (userToggledKeys[sKey] !== undefined) {
      return userToggledKeys[sKey];
    }
    return isTemperatureSeriesVisibleByDefault(city, sKey);
  };

  const activeSeries = useMemo(() => {
    return getActiveTemperatureSeries(
      city,
      chartSeries,
      userToggledKeys,
      showRunwayDetails,
    );
  }, [chartSeries, userToggledKeys, city, showRunwayDetails]);

  const {
    isHKO,
    isParis,
    isShenzhen,
    metarHeaderLabel,
    metarHighLabel,
    runwayHeaderLabel,
    runwayHighLabel,
  } = useMemo(() => getLiveObservationLabels(row, hourly), [row, hourly]);

  const { currentRunwayTemp, observedHighMetar, observedHighRunway } = useMemo(
    () => getObservationDisplayMetrics(row, hourly, settlementPlate),
    [row, hourly, settlementPlate],
  );
  const displayRunwayTemp = liveTemp ?? currentRunwayTemp;
  const wundergroundDailyHigh = validNumber(hourly?.airportCurrent?.max_so_far ?? hourly?.airportPrimary?.max_so_far) ?? null;

  const localDateStr = row?.local_date || new Date().toISOString().slice(0, 10);
  const modelSources = (row?.model_cluster_sources && Object.keys(row.model_cluster_sources).length > 0)
    ? row.model_cluster_sources
    : (hourly?.multiModelDaily?.[localDateStr]?.models || null);

  const modelValues = Object.values(modelSources || {})
    .map(validNumber)
    .filter((v): v is number => v !== null);
  const modelMin = modelValues.length ? Math.min(...modelValues) : (row?.cluster_core_low ?? null);
  const modelMax = modelValues.length ? Math.max(...modelValues) : (row?.cluster_core_high ?? null);
  const debVal = validNumber(hourly?.debPrediction) ?? validNumber(row?.deb_prediction) ?? null;

  const spread = (modelMax !== null && modelMin !== null) ? modelMax - modelMin : null;
  const spreadLabel = spread === null ? "" : (spread <= 2.0 ? "低分歧" : (spread <= 4.0 ? "中等分歧" : "高分歧"));
  const spreadLabelEn = spread === null ? "" : (spread <= 2.0 ? "Low" : (spread <= 4.0 ? "Medium" : "High"));

  const formattedUpdateTime = useMemo(() => {
    const nowUtc = Date.now();
    const cityOffsetMs = (row?.tz_offset_seconds ?? 0) * 1000;
    const cityNow = new Date(nowUtc + cityOffsetMs + new Date().getTimezoneOffset() * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = cityNow.getFullYear();
    const mo = pad(cityNow.getMonth() + 1);
    const d = pad(cityNow.getDate());
    const hh = pad(cityNow.getHours());
    const mm = pad(cityNow.getMinutes());
    const ss = pad(cityNow.getSeconds());
    return `${y}-${mo}-${d} ${hh}:${mm}:${ss}`;
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

  const intDegreeTicks = useMemo(() => buildIntDegreeTicks(activeSeries, zoomedData), [activeSeries, zoomedData]);
  const chartDomain = useMemo(
    () => buildChartDomain(activeSeries, zoomedData),
    [activeSeries, zoomedData],
  );

  const subtitle = row ? (isEn ? "Live & Forecast" : "实测与预测") : "";

  const panelTitle = row ? (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onSearchClick}
        className={clsx(
          "flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left transition-colors font-bold text-slate-800 outline-none select-none",
          onSearchClick ? "hover:bg-slate-200/80 cursor-pointer" : ""
        )}
      >
        <span>{rowName(row)}</span>
        {onSearchClick && <span className="text-[8px] text-slate-400">▼</span>}
      </button>
      <span className="text-slate-400 font-normal">·</span>
      <span className="text-slate-500 font-normal">{subtitle}</span>
    </div>
  ) : isEn ? (
    "Temperature Chart"
  ) : (
    "气温图表"
  );

  const timeframeActions = (
    <div className="flex items-center gap-1.5">
      {zoomRange && (
        <button
          type="button"
          onClick={() => setZoomRange(null)}
          className="px-2 py-0.5 text-[9px] font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 shadow-sm transition-all cursor-pointer"
        >
          {isEn ? "Reset Zoom" : "重置缩放"}
        </button>
      )}
      <div className="flex items-center gap-1 rounded bg-[#eef2f6] p-0.5 border border-slate-200">
        {(["auto", "full"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setViewMode(mode);
              setZoomRange(null);
            }}
            className={clsx(
              "px-2 py-0.5 text-[9px] font-bold rounded transition-all cursor-pointer",
              viewMode === mode
                ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            {mode === "auto" ? (isEn ? "Auto" : "高温") : (isEn ? "Full" : "全天")}
          </button>
        ))}
      </div>

      {(onMaximize || onClose) && (
        <div className="flex items-center gap-1">
          {onMaximize && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              className="grid h-6 w-6 place-items-center rounded bg-white hover:bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800 transition-colors shadow-sm"
              title={isMaximized ? (isEn ? "Restore Grid" : "还原网格") : (isEn ? "Maximize" : "最大化")}
            >
              {isMaximized ? "❐" : "⛶"}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              disabled={disableClose}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className={clsx(
                "grid h-6 w-6 place-items-center rounded border transition-colors shadow-sm",
                disableClose
                  ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed"
                  : "bg-white hover:bg-slate-50 border-slate-200 text-slate-500 hover:text-red-600"
              )}
              title={isEn ? "Clear Slot" : "清除槽位"}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );  const handleMouseDown = (e: any) => {
    if (compact || !e) return;
    if (typeof e.activeTooltipIndex === "number") {
      setRefAreaLeft(e.activeTooltipIndex);
      setRefAreaRight(e.activeTooltipIndex);
    }
  };

  const handleMouseMove = (e: any) => {
    if (compact || !e || refAreaLeft === null) return;
    if (typeof e.activeTooltipIndex === "number") {
      setRefAreaRight(e.activeTooltipIndex);
    }
  };

  const handleMouseUp = () => {
    if (refAreaLeft === null || refAreaRight === null) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }

    let leftIdx = refAreaLeft;
    let rightIdx = refAreaRight;

    if (leftIdx > rightIdx) {
      [leftIdx, rightIdx] = [rightIdx, leftIdx];
    }

    if (rightIdx - leftIdx >= 1) {
      const originalStartIndex = visibleRange ? visibleRange[0] : 0;
      const newStart = originalStartIndex + leftIdx;
      const newEnd = originalStartIndex + rightIdx;
      setZoomRange([newStart, newEnd]);
    }

    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  return (
    <Panel title={panelTitle} actions={timeframeActions}>
      <div className="flex h-full min-h-[300px] flex-col">
        {/* Compact stats bar */}
        {compact ? (
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between">
            {timeframe === "1D" ? (
              <div className="flex items-center gap-4 text-[11px]">
                <span className="font-semibold text-slate-500">
                  {isEn ? "Runway" : runwayHeaderLabel}:{" "}
                  <strong className="text-[#009688] font-mono">{temp(displayRunwayTemp)}</strong>
                </span>
                <span className="text-slate-300">|</span>
                <span className="font-semibold text-slate-500">
                  {isEn ? "METAR" : (isShenzhen ? "当日最高" : metarHeaderLabel)}:{" "}
                  <strong className="text-blue-600 font-mono">{temp(observedHighMetar)}</strong>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-4 text-[11px]">
                <span className="font-semibold text-slate-500">
                  DEB: <strong className="text-orange-600 font-mono">{temp(debVal)}</strong>
                </span>
                {modelMin !== null && modelMax !== null && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="font-semibold text-slate-500">
                      {isEn ? "Models" : "多模型"}:{" "}
                      <strong className="text-slate-700 font-mono">
                        {temp(modelMin)} - {temp(modelMax)}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="text-[10px] text-slate-400 font-mono">
              {timeframe === "1D" && formattedUpdateTime.includes(" ") ? formattedUpdateTime.split(" ")[1].slice(0, 5) : ""}
            </div>
          </div>
        ) : (
          /* Normal detailed stats bar */
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
            {/* Top Row: Large temperatures */}
            <div className="flex justify-between items-center gap-6 mb-3">
              {timeframe === "1D" ? (
                <div className="flex items-center gap-12">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "Runway Live (1m)" : `${runwayHeaderLabel}`}
                    </span>
                    <span className="text-2xl font-bold font-mono text-[#009688] mt-1">
                      {temp(displayRunwayTemp)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "METAR Settlement · Daily High" : `${metarHeaderLabel} · 当日最高`}
                    </span>
                    <span className="text-2xl font-bold font-mono text-blue-600 mt-1">
                      {temp(observedHighMetar)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-12">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      DEB Max
                    </span>
                    <span className="text-2xl font-bold font-mono text-orange-600 mt-1">
                      {temp(debVal)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isEn ? "Model Range" : "多模型区间"}
                    </span>
                    <span className="text-2xl font-bold font-mono text-slate-700 mt-1">
                      {modelMin !== null && modelMax !== null ? `${temp(modelMin)} - ${temp(modelMax)}` : "--"}
                    </span>
                  </div>
                </div>
              )}
              
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

            {/* Bottom Row: Model Range Panel (Only for 1D mode) */}
            {timeframe === "1D" && (
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
            )}
          </div>
        )}

        {/* Runway observations (Only for 1D mode and when not compact) */}
        {timeframe === "1D" && !compact && runwayPlates.length > 0 && (
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

        {/* Multi-model list (Only in 1D mode and when not compact) */}
        {timeframe === "1D" && !compact && activeSeries.some((s) => s.key.startsWith("model_curve_")) && (
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
              <span className="font-black text-slate-500 uppercase mr-2">
                {isEn ? "Models:" : "多模型:"}
              </span>
              {activeSeries
                .filter((s) => s.key.startsWith("model_curve_"))
                .map((s) => {
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
        )}

        {/* Chart */}
        <div className="relative min-h-[240px] flex-1 p-2">
          {/* Interactive legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 text-[11px] border-b border-[#e2e8f0] bg-white">
            {chartSeries.length > 1 &&
              chartSeries
                .filter((s) => {
                  const isIndividualRunway = s.key.startsWith("runway_") && s.key !== "runway_max";
                  if (showRunwayDetails) {
                    return s.key !== "runway_max";
                  } else {
                    return !isIndividualRunway;
                  }
                })
                .map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setUserToggledKeys((prev) => ({
                        ...prev,
                        [s.key]: !isSeriesVisible(s.key),
                      }));
                    }}
                    className={clsx(
                      "inline-flex items-center gap-1.5 font-mono cursor-pointer transition-opacity hover:opacity-80",
                      !isSeriesVisible(s.key) && "opacity-40 line-through"
                    )}
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-slate-700 font-bold">{s.label}</span>
                  </button>
                ))}

            {/* "Show Runway Details" toggle switch */}
            {hasRunwayData && (
              <label className="inline-flex items-center gap-1.5 ml-auto cursor-pointer text-slate-600 hover:text-slate-800 font-semibold select-none">
                <input
                  type="checkbox"
                  checked={showRunwayDetails}
                  onChange={(e) => setShowRunwayDetails(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                />
                <span>{isEn ? "Show Runway Details" : "显示跑道明细"}</span>
              </label>
            )}
          </div>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={1}
            minHeight={220}
            initialDimension={{ width: 1, height: 220 }}
          >
            <ReComposedChart
              data={zoomedData}
              margin={{ top: 16, right: compact ? 20 : 44, left: 4, bottom: 8 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={() => setZoomRange(null)}
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
                tickFormatter={(v) => `${Number(v).toFixed(0)}°`}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                domain={chartDomain}
                ticks={intDegreeTicks ?? undefined}
              />
              {timeframe === "1D" && cityThresholds.map((t, idx) => {
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
                      value: compact ? undefined : labelText,
                      fill: isSelected ? "#3b82f6" : t.isBreached ? "#ef4444" : "#f97316",
                      fontSize: 9,
                      position: isSelected ? "left" : "insideBottomRight",
                    }}
                  />
                );
              })}
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
                  />
                )}
                formatter={(value: unknown) => {
                  if (Array.isArray(value)) {
                    const [low, high] = value;
                    if (typeof low === "number" && typeof high === "number") {
                      return `${low.toFixed(1)}° - ${high.toFixed(1)}°`;
                    }
                  }
                  const num = Number(value);
                  return Number.isFinite(num) ? `${num.toFixed(2)}°` : String(value);
                }}
              />
              {/* Runway Temperature Band (low-high range area) */}
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
          </ResponsiveContainer>
          {isHourlyLoading && (
            <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center bg-white/65 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                <span>{isEn ? "Loading chart" : "加载图表"}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function __buildTemperatureChartDataForTest(
  row: ScanOpportunityRow | null,
  hourly: HourlyForecast,
  _timeframe = "1D",
  isEn = false,
) {
  return buildFullDayChartData(row, hourly, isEn);
}

export const __isTemperatureSeriesVisibleByDefaultForTest = isTemperatureSeriesVisibleByDefault;
export const __getVisibleTemperatureSeriesForTest = getVisibleTemperatureSeries;
export const __getActiveTemperatureSeriesForTest = getActiveTemperatureSeries;
export const __getDebPeakWindowRangeForTest = getDebPeakWindowRange;
export const __getLiveObservationLabelsForTest = getLiveObservationLabels;
export const __getObservationDisplayMetricsForTest = getObservationDisplayMetrics;
export const __shouldPollLiveChartForTest = shouldPollLiveChart;
export const __mergePatchIntoHourlyForTest = mergePatchIntoHourly;
