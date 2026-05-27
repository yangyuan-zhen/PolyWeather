"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { useLatestPatch, useSseResyncVersion } from "@/hooks/use-sse-patches";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { ModelCurvesSummary } from "@/components/dashboard/scan-terminal/ModelCurvesSummary";
import { TemperatureChartCanvas } from "@/components/dashboard/scan-terminal/TemperatureChartCanvas";
import { TemperatureRunwayDetails } from "@/components/dashboard/scan-terminal/TemperatureRunwayDetails";
import { TemperatureStatsBars } from "@/components/dashboard/scan-terminal/TemperatureStatsBars";
import { rowName } from "@/components/dashboard/scan-terminal/utils";

import {
  HOURLY_CACHE_TTL_MS,
  _hourlyCache,
  buildChartDomain,
  buildFullDayChartData,
  buildIntDegreeTicks,
  buildRunwayPlates,
  fetchHourlyForecastForCity,
  getActiveTemperatureSeries,
  getDebPeakWindowRange,
  getPeakGlowState,
  getLiveObservationLabels,
  getObservationDisplayMetrics,
  getVisibleTemperatureSeries,
  isTemperatureSeriesVisibleByDefault,
  mergePatchIntoHourly,
  normObs,
  prefersHighFrequencyRunwayResolution,
  readSessionCache,
  seedHourlyForecastFromRow,
  shouldPollLiveChart,
  validNumber,
  type HourlyForecast,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";
export { clearCityDetailCache } from "@/components/dashboard/scan-terminal/temperature-chart-logic";

const PEAK_GLOW_PANEL_CLASS = {
  none: "",
  watch: "peak-glow-card peak-glow-watch",
  near_peak: "peak-glow-card peak-glow-near",
  breakout: "peak-glow-card peak-glow-breakout",
  cooling: "peak-glow-card peak-glow-cooling",
} as const;

const PEAK_GLOW_BADGE_CLASS = {
  none: "",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  near_peak: "border-orange-200 bg-orange-50 text-orange-700",
  breakout: "border-rose-200 bg-rose-50 text-rose-700",
  cooling: "border-slate-200 bg-slate-100 text-slate-500",
} as const;

function peakGlowLabel(state: keyof typeof PEAK_GLOW_PANEL_CLASS, isEn: boolean) {
  if (state === "watch") return isEn ? "Watch" : "关注";
  if (state === "near_peak") return isEn ? "Near peak" : "接近峰值";
  if (state === "breakout") return isEn ? "Breakout" : "突破";
  if (state === "cooling") return isEn ? "Cooling" : "降温";
  return "";
}

function peakGlowTitle(
  state: keyof typeof PEAK_GLOW_PANEL_CLASS,
  distanceToHigh: number | null,
  isEn: boolean,
) {
  const label = peakGlowLabel(state, isEn);
  if (!label) return "";
  if (distanceToHigh === null) return label;
  const absDistance = Math.abs(distanceToHigh).toFixed(1);
  if (state === "breakout") {
    return isEn ? `${label}: new observed high` : `${label}：刷新实测高点`;
  }
  if (state === "cooling") return isEn ? `${label}: peak likely passed` : `${label}：峰值可能已过`;
  return isEn ? `${label}: ${absDistance}° below observed high` : `${label}：距实测高点 ${absDistance}°`;
}

function formatCityLocalDate(tzOffsetSeconds: number | null | undefined) {
  const cityOffsetMs = (tzOffsetSeconds ?? 0) * 1000;
  const cityNow = new Date(Date.now() + cityOffsetMs + new Date().getTimezoneOffset() * 60_000);
  const y = cityNow.getFullYear();
  const m = String(cityNow.getMonth() + 1).padStart(2, "0");
  const d = String(cityNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  const [viewMode, setViewMode] = useState<"auto" | "full">("full");
  const [userToggledKeys, setUserToggledKeys] = useState<Record<string, boolean>>({});
  const [liveTemp, setLiveTemp] = useState<number | null>(null);
  const [isHourlyLoading, setIsHourlyLoading] = useState(false);
  const hasLoadedHourlyDetailRef = useRef(false);
  const lastPatchAtRef = useRef<number>(Date.now());
  const lastAppliedPatchRevisionRef = useRef<number>(0);
  const localDayRolloverFetchDateRef = useRef<string>("");

  const [showRunwayDetails, setShowRunwayDetails] = useState<boolean>(true);
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [targetResolution, setTargetResolution] = useState<string>(() =>
    prefersHighFrequencyRunwayResolution(row, null) ? "1m" : "10m",
  );
  const [currentCityLocalDate, setCurrentCityLocalDate] = useState(() =>
    formatCityLocalDate(row?.tz_offset_seconds),
  );

  useEffect(() => {
    setUserToggledKeys({});
    setZoomRange(null);
    setViewMode("full");
    setShowRunwayDetails(true);
    setTargetResolution(prefersHighFrequencyRunwayResolution(row, null) ? "1m" : "10m");
    setHourly(seedHourlyForecastFromRow(row));
    setLiveTemp(null);
    setIsHourlyLoading(Boolean(city));
    hasLoadedHourlyDetailRef.current = false;
    lastPatchAtRef.current = Date.now();
    lastAppliedPatchRevisionRef.current = 0;
    localDayRolloverFetchDateRef.current = "";
    setCurrentCityLocalDate(formatCityLocalDate(row?.tz_offset_seconds));
  }, [city]);

  useEffect(() => {
    setCurrentCityLocalDate(formatCityLocalDate(row?.tz_offset_seconds));
    const id = setInterval(() => {
      setCurrentCityLocalDate(formatCityLocalDate(row?.tz_offset_seconds));
    }, 60_000);
    return () => clearInterval(id);
  }, [row?.tz_offset_seconds]);

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
  }, [city, compact, isActive, isMaximized, targetResolution]);

  useEffect(() => {
    if (!city || !currentCityLocalDate) return;
    const loadedLocalDate = hourly?.localDate || row?.local_date || "";
    if (currentCityLocalDate === loadedLocalDate) return;
    if (localDayRolloverFetchDateRef.current === currentCityLocalDate) return;

    localDayRolloverFetchDateRef.current = currentCityLocalDate;
    let cancelled = false;
    fetchHourlyForecastForCity(city, { ignoreCache: true, resolution: targetResolution })
      .then((data) => {
        if (cancelled || !data) return;
        hasLoadedHourlyDetailRef.current = true;
        setHourly(data);
      })
      .catch(() => {
        if (!cancelled) localDayRolloverFetchDateRef.current = "";
      });

    return () => {
      cancelled = true;
    };
  }, [city, currentCityLocalDate, hourly?.localDate, row?.local_date, targetResolution]);

  const chartHourly = useMemo<HourlyForecast>(() => {
    if (!hourly) return hourly;
    const loadedLocalDate = hourly.localDate || row?.local_date || "";
    if (currentCityLocalDate && currentCityLocalDate !== loadedLocalDate) {
      return { ...hourly, localDate: currentCityLocalDate };
    }
    return hourly;
  }, [hourly, currentCityLocalDate, row?.local_date]);
  const chartLocalDate = chartHourly?.localDate || row?.local_date || currentCityLocalDate;

  const { data, series } = useMemo(() => buildFullDayChartData(row, chartHourly, isEn), [row, chartHourly, isEn]);
  const peakGlow = useMemo(() => getPeakGlowState(row, data, series), [row, data, series]);

  const autoWindowRange = useMemo(
    () => (viewMode === "auto" ? getDebPeakWindowRange(data, series) : null),
    [data, series, viewMode],
  );
  const visibleRange = zoomRange ?? autoWindowRange;
  const visibleRangeKey = visibleRange ? `${visibleRange[0]}:${visibleRange[1]}` : "full";
  const shouldUseRunwayResolution = useMemo(
    () => prefersHighFrequencyRunwayResolution(row, chartHourly),
    [row, chartHourly],
  );

  const zoomedData = useMemo(() => {
    if (!visibleRange || data.length === 0) return data;
    const [start, end] = visibleRange;
    return data.slice(start, end + 1);
  }, [data, visibleRangeKey]);

  const nextTargetResolution = useMemo(() => {
    if (shouldUseRunwayResolution) {
      return "1m";
    }
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
  }, [data, visibleRangeKey, shouldUseRunwayResolution]);

  useEffect(() => {
    if (targetResolution !== nextTargetResolution) {
      setTargetResolution(nextTargetResolution);
    }
  }, [targetResolution, nextTargetResolution]);

  const tzOffset = row?.tz_offset_seconds ?? 0;
  const settlementObs = useMemo(() => {
    let obs = normObs(chartHourly?.settlementTodayObs || row?.settlement_today_obs || row?.metar_context?.settlement_today_obs, tzOffset, undefined, chartLocalDate || null);
    if (!obs.length && !chartHourly?.runwayPlateHistory) {
      const mObs = normObs(chartHourly?.metarTodayObs || row?.metar_today_obs || row?.metar_context?.today_obs, tzOffset, undefined, chartLocalDate || null);
      if (mObs.length > 0) {
        obs = mObs;
      }
    }
    return obs;
  }, [row, chartHourly, tzOffset, chartLocalDate]);

  const runwayPlates = useMemo(() => buildRunwayPlates(chartHourly?.amos, row, settlementObs), [chartHourly?.amos, row, settlementObs]);
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
    isShenzhen,
    metarHeaderLabel,
    metarHighLabel,
    runwayHeaderLabel,
    runwayHighLabel,
  } = useMemo(() => getLiveObservationLabels(row, chartHourly), [row, chartHourly]);

  const { currentRunwayTemp, observedHighMetar, observedHighRunway } = useMemo(
    () => getObservationDisplayMetrics(row, chartHourly, settlementPlate),
    [row, chartHourly, settlementPlate],
  );
  const displayRunwayTemp = liveTemp ?? currentRunwayTemp;
  const wundergroundDailyHigh = validNumber(chartHourly?.airportCurrent?.max_so_far ?? chartHourly?.airportPrimary?.max_so_far) ?? null;

  const localDateStr = chartLocalDate || new Date().toISOString().slice(0, 10);
  const modelSources = (row?.model_cluster_sources && Object.keys(row.model_cluster_sources).length > 0)
    ? row.model_cluster_sources
    : (chartHourly?.multiModelDaily?.[localDateStr]?.models || null);

  const modelValues = Object.values(modelSources || {})
    .map(validNumber)
    .filter((v): v is number => v !== null);
  const modelMin = modelValues.length ? Math.min(...modelValues) : (row?.cluster_core_low ?? null);
  const modelMax = modelValues.length ? Math.max(...modelValues) : (row?.cluster_core_high ?? null);
  const debVal = validNumber(chartHourly?.debPrediction) ?? validNumber(row?.deb_prediction) ?? null;

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
    const tempSymbol = row.temp_symbol || "°C";
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
        label: r.target_label || `${t}${tempSymbol}`,
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
      {peakGlow.state !== "none" && (
        <span
          className={clsx(
            "ml-1 rounded border px-1.5 py-0.5 text-[9px] font-black normal-case tracking-normal",
            PEAK_GLOW_BADGE_CLASS[peakGlow.state],
          )}
          title={peakGlowTitle(peakGlow.state, peakGlow.distanceToHigh, isEn)}
        >
          {peakGlowLabel(peakGlow.state, isEn)}
        </span>
      )}
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
            {mode === "auto" ? (isEn ? "Peak" : "高温") : (isEn ? "All Day" : "全天")}
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
    <Panel
      title={panelTitle}
      actions={timeframeActions}
      className={PEAK_GLOW_PANEL_CLASS[peakGlow.state]}
    >
      <div className="flex h-full min-h-[300px] flex-col">
        <TemperatureStatsBars
          isEn={isEn}
          compact={compact}
          timeframe={timeframe}
          tempSymbol={row?.temp_symbol || "°C"}
          runwayHeaderLabel={runwayHeaderLabel}
          metarHeaderLabel={metarHeaderLabel}
          runwayHighLabel={runwayHighLabel}
          metarHighLabel={metarHighLabel}
          isShenzhen={isShenzhen}
          displayRunwayTemp={displayRunwayTemp}
          observedHighMetar={observedHighMetar}
          observedHighRunway={observedHighRunway}
          wundergroundDailyHigh={wundergroundDailyHigh}
          debVal={debVal}
          modelMin={modelMin}
          modelMax={modelMax}
          spread={spread}
          spreadLabel={spreadLabel}
          spreadLabelEn={spreadLabelEn}
          formattedUpdateTime={formattedUpdateTime}
        />

        {timeframe === "1D" && !compact && (
          <TemperatureRunwayDetails isEn={isEn} plates={runwayPlates} tempSymbol={row?.temp_symbol || "°C"} />
        )}

        {timeframe === "1D" && !compact && (
          <ModelCurvesSummary isEn={isEn} activeSeries={activeSeries} tempSymbol={row?.temp_symbol || "°C"} />
        )}

        <TemperatureChartCanvas
          isEn={isEn}
          compact={compact}
          timeframe={timeframe}
          row={row}
          cityThresholds={cityThresholds}
          chartSeries={chartSeries}
          activeSeries={activeSeries}
          zoomedData={zoomedData}
          chartDomain={chartDomain}
          intDegreeTicks={intDegreeTicks}
          hasRunwayData={hasRunwayData}
          showRunwayDetails={showRunwayDetails}
          isHourlyLoading={isHourlyLoading}
          refAreaLeft={refAreaLeft}
          refAreaRight={refAreaRight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onZoomReset={() => setZoomRange(null)}
          isSeriesVisible={isSeriesVisible}
          onSeriesToggle={(seriesKey) => {
            setUserToggledKeys((prev) => ({
              ...prev,
              [seriesKey]: !isSeriesVisible(seriesKey),
            }));
          }}
          onShowRunwayDetailsChange={setShowRunwayDetails}
        />
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
export const __getPeakGlowStateForTest = getPeakGlowState;
export const __shouldPollLiveChartForTest = shouldPollLiveChart;
export const __mergePatchIntoHourlyForTest = mergePatchIntoHourly;
