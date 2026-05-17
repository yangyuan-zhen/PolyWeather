import type { CityDetail } from "@/lib/dashboard-types";
import { getDisplayAirportPrimary } from "@/lib/airport-observation-display";
import type { Locale } from "@/lib/i18n";
import {
  getNoaaStationCode,
  getObservationSourceCode,
  getObservationSourceTag,
  getRealtimeObservationTag,
  isTurkishMgmCity,
} from "@/lib/observation-source-utils";
import { formatTafMarkerType } from "@/lib/taf-utils";
import {
  hmToMinutes,
  interpolateSeriesAtMinutes,
  normalizeHm,
} from "@/lib/time-utils";
import {
  buildCalibratedPath,
  buildChartTimeAxis,
  buildDebBaselinePath,
  buildObservationGrid,
  buildObservationPointSeries,
  buildSeriesPoints,
  buildTemperatureTickLabels,
  findNearestTimeIndex,
  getNiceTemperatureScale,
  type ChartTimeAxis,
  type DebBaselinePath,
} from "@/lib/temperature-chart-paths";

function isEnglish(locale: Locale) {
  return locale === "en-US";
}

function sortObservationItemsByTime<T extends { time?: string | null }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftMinutes = hmToMinutes(left.time);
    const rightMinutes = hmToMinutes(right.time);
    if (leftMinutes == null && rightMinutes == null) return 0;
    if (leftMinutes == null) return 1;
    if (rightMinutes == null) return -1;
    return leftMinutes - rightMinutes;
  });
}

function dedupeObservationItems<T extends { temp?: number | null; time?: string | null }>(
  items: T[],
) {
  const byTime = new Map<string, T>();
  items.forEach((item) => {
    const time = normalizeHm(item.time);
    const value = Number(item.temp);
    if (!time || !Number.isFinite(value)) return;
    const existing = byTime.get(time);
    if (!existing || Number(item.temp) >= Number(existing.temp)) {
      byTime.set(time, { ...item, time });
    }
  });
  return sortObservationItemsByTime([...byTime.values()]);
}

function looksLikeForecastMirror(
  observations: Array<{ temp?: number | null; time?: string | null }>,
  forecastTimes: string[],
  forecastValues: Array<number | null | undefined>,
) {
  const unique = dedupeObservationItems(observations);
  if (unique.length < 6 || forecastTimes.length < 6) return false;
  if (unique.length < Math.max(6, Math.floor(forecastTimes.length * 0.4))) {
    return false;
  }

  let compared = 0;
  let exactMatches = 0;
  unique.forEach((item) => {
    const minute = hmToMinutes(item.time);
    const observed = Number(item.temp);
    if (minute == null || !Number.isFinite(observed)) return;
    const expected = interpolateSeriesAtMinutes(
      forecastTimes,
      forecastValues,
      minute,
    );
    if (expected == null || !Number.isFinite(expected)) return;
    compared += 1;
    if (Math.abs(observed - expected) <= 0.05) {
      exactMatches += 1;
    }
  });

  return compared >= 6 && exactMatches / compared >= 0.65;
}

function normalizeObservationTimeForChart(
  value: unknown,
  detail: CityDetail,
) {
  const raw = String(value || "").trim();
  if (raw && !raw.includes("T")) {
    return normalizeHm(raw) || raw;
  }
  return normalizeHm(detail.local_time) || normalizeHm(raw) || raw;
}

function buildCurrentObservationFallback(
  detail: CityDetail,
): Array<{ time?: string; temp?: number | null; sourceLabel?: string | null }> {
  const displayAirportPrimary = getDisplayAirportPrimary(detail);
  const candidates: Array<{
    sourceLabel?: string | null;
    temp?: number | null;
    time?: string | null;
  }> = [
    {
      sourceLabel: detail.current?.settlement_source_label,
      temp: detail.current?.temp,
      time: detail.current?.obs_time || detail.current?.report_time,
    },
    {
      sourceLabel: displayAirportPrimary?.source_label || "METAR",
      temp: displayAirportPrimary?.temp,
      time: displayAirportPrimary?.obs_time || displayAirportPrimary?.report_time,
    },
    {
      sourceLabel: detail.airport_current?.source_label || "METAR",
      temp: detail.airport_current?.temp,
      time: detail.airport_current?.obs_time || detail.airport_current?.report_time,
    },
  ];

  const first = candidates.find((item) => {
    const numeric = Number(item.temp);
    return Number.isFinite(numeric);
  });
  if (!first) return [];

  return [
    {
      sourceLabel: first.sourceLabel,
      temp: Number(first.temp),
      time: normalizeObservationTimeForChart(first.time, detail),
    },
  ];
}

export function getTemperatureChartData(
  detail: CityDetail,
  locale: Locale = "zh-CN",
) {
  const hourly = detail.hourly || {};
  const mgmHourlyRows = Array.isArray(detail.mgm?.hourly)
    ? detail.mgm?.hourly || []
    : [];
  const axis = buildChartTimeAxis(
    hourly.times,
    hourly.temps,
    mgmHourlyRows,
    isTurkishMgmCity(detail),
  );
  const { times, temps } = axis;
  if (!times.length) return null;

  const mgmHourlyMax = mgmHourlyRows
    .map((row) => Number(row?.temp))
    .filter((value) => Number.isFinite(value))
    .reduce<number | null>(
      (maxValue, value) => (maxValue == null ? value : Math.max(maxValue, value)),
      null,
    );
  const baseline = buildDebBaselinePath(
    times,
    temps,
    detail.deb?.prediction,
    detail.local_time,
    detail.forecast?.today_high,
    mgmHourlyMax,
  );
  const {
    debTemps,
    debPast,
    debFuture,
    currentIndex,
    offset,
  } = baseline;
  const suppressAnkaraMgmObservation = isTurkishMgmCity(detail);

  const observationTag = getRealtimeObservationTag(detail);
  const observationCode = getObservationSourceCode(detail);
  const settlementSource =
    observationCode === "hko" ||
    observationCode === "cwa" ||
    observationCode === "noaa" ||
    observationCode === "wunderground";
  const useSettlementObservationSource = settlementSource;
  const officialObservationSource =
    useSettlementObservationSource
      ? detail.settlement_today_obs?.length
        ? detail.settlement_today_obs
        : detail.current?.obs_time && detail.current?.temp != null
          ? [{ time: detail.current.obs_time, temp: detail.current.temp }]
          : []
      : [];
  const currentObservationFallback = buildCurrentObservationFallback(detail);
  const minPlausibleObservationTemp = (() => {
    const name = String(detail.name || "").trim().toLowerCase();
    const icao = String(detail.risk?.icao || "").trim().toUpperCase();
    if (name === "karachi" || icao === "OPKC") {
      return detail.temp_symbol === "°F" ? 41 : 5;
    }
    return null;
  })();
  const filterPlausibleObservations = <T extends { temp?: number | null }>(
    rows?: T[] | null,
  ) =>
    (Array.isArray(rows) ? rows : []).filter((row) => {
      const value = Number(row?.temp);
      if (!Number.isFinite(value)) return false;
      return minPlausibleObservationTemp == null || value >= minPlausibleObservationTemp;
    });
  const plausibleMetarTodayObs = filterPlausibleObservations(detail.metar_today_obs);
  const plausibleTrendRecent = filterPlausibleObservations(detail.trend?.recent);
  const plausibleCurrentFallback = filterPlausibleObservations(currentObservationFallback);
  const metarObservationSource = plausibleMetarTodayObs.length
    ? plausibleMetarTodayObs
    : plausibleTrendRecent.length
      ? plausibleTrendRecent
      : plausibleCurrentFallback;
  const usingCurrentObservationFallback =
    !plausibleMetarTodayObs.length &&
    !plausibleTrendRecent.length &&
    plausibleCurrentFallback.length > 0;
  const currentFallbackTag =
    currentObservationFallback[0]?.sourceLabel ||
    getObservationSourceTag(detail);
  const allowMetarFallback = settlementSource && observationCode !== "hko";
  const shouldUseMetarFallback =
    allowMetarFallback &&
    officialObservationSource.length > 0 &&
    officialObservationSource.length < 3 &&
    metarObservationSource.length >= 3;
  let usingMetarObservationSource =
    !useSettlementObservationSource || shouldUseMetarFallback;
  let observationSource = useSettlementObservationSource
    ? shouldUseMetarFallback
      ? metarObservationSource
      : officialObservationSource
    : metarObservationSource;
  let usingMirrorFallback = false;
  if (looksLikeForecastMirror(observationSource, times, debTemps)) {
    const fallbackCandidates = [
      plausibleTrendRecent,
      plausibleCurrentFallback,
      metarObservationSource,
    ];
    const fallback = fallbackCandidates.find(
      (candidate) =>
        candidate.length > 0 &&
        candidate !== observationSource &&
        !looksLikeForecastMirror(candidate, times, debTemps),
    );
    if (fallback) {
      observationSource = fallback;
      usingMetarObservationSource = fallback === metarObservationSource;
      usingMirrorFallback = true;
    }
  }
  observationSource = dedupeObservationItems(observationSource);
  const airportMetarSource: Array<{ time?: string; temp?: number | null }> = [];
  const metarFallbackTag = (() => {
    const icao = String(detail.risk?.icao || "").trim().toUpperCase();
    if (!icao) return "METAR";
    return `${icao} METAR`;
  })();
  const observationDisplayTag =
    usingCurrentObservationFallback
      ? String(currentFallbackTag).toUpperCase()
      : observationCode === "wunderground" && usingMetarObservationSource
      ? metarFallbackTag
      : observationCode === "wunderground"
        ? metarFallbackTag
      : useSettlementObservationSource && shouldUseMetarFallback
      ? metarFallbackTag
      : observationCode === "noaa"
        ? `NOAA ${getNoaaStationCode(detail)}`
        : observationTag;

  const metarPoints = buildObservationGrid(observationSource, times);
  const airportMetarPoints = new Array(times.length).fill(null);
  const calibrationObservationSource = dedupeObservationItems(
    metarObservationSource.length ? metarObservationSource : observationSource,
  );
  const calibratedPath = buildCalibratedPath(
    calibrationObservationSource,
    times,
    debTemps,
    detail.local_time,
    detail.forecast?.sunset,
  );
  const calibratedFuture = calibratedPath.future;

  const mgmPoints = new Array(times.length).fill(null);
  if (
    !suppressAnkaraMgmObservation &&
    detail.mgm?.temp != null &&
    detail.mgm?.time
  ) {
    const index = findNearestTimeIndex(times, detail.mgm.time);
    const temp = Number(detail.mgm.temp);
    if (index >= 0 && Number.isFinite(temp)) {
      mgmPoints[index] = temp;
    }
  }

  const mgmHourlyPoints = new Array(times.length).fill(null);
  let hasMgmHourly = false;
  mgmHourlyRows.forEach((item) => {
    const index = findNearestTimeIndex(times, String(item.time || ""));
    const temp = Number(item.temp);
    if (index >= 0 && Number.isFinite(temp)) {
      mgmHourlyPoints[index] = temp;
      hasMgmHourly = true;
    }
  });

  const allValues = [
    ...debTemps.filter((value) => value != null),
    ...calibratedFuture.filter((value) => value != null),
    ...metarPoints.filter((value) => value != null),
    ...airportMetarPoints.filter((value) => value != null),
    ...mgmPoints.filter((value) => value != null),
    ...mgmHourlyPoints.filter((value) => value != null),
  ] as number[];

  if (!allValues.length) return null;

  const yScale = getNiceTemperatureScale(allValues, detail.temp_symbol);
  const min = yScale.min;
  const max = yScale.max;
  const yTickStep = yScale.step;
  const tafMarkersRaw = Array.isArray(detail.taf?.signal?.markers)
    ? detail.taf?.signal?.markers || []
    : [];
  const currentMinutes = hmToMinutes(normalizeHm(detail.local_time));
  const peakFirstHour = Number(detail.peak?.first_h);
  const peakLastHour = Number(detail.peak?.last_h);
  const peakWindowStartMinutes =
    Number.isFinite(peakFirstHour) && peakFirstHour >= 0
      ? Math.max(0, (peakFirstHour - 2) * 60)
      : null;
  const peakWindowEndMinutes =
    Number.isFinite(peakLastHour) && peakLastHour >= peakFirstHour
      ? Math.min(23 * 60 + 59, (peakLastHour + 1) * 60)
      : null;
  const tafMarkerValue = max - 0.4;
  const tafMarkerPoints = new Array(times.length).fill(null);
  const tafCurrentMarkerPoints = new Array(times.length).fill(null);
  const tafPeakWindowMarkerPoints = new Array(times.length).fill(null);
  const sameMarker = (
    left:
      | { markerType?: string | null; startLocal?: string | null; endLocal?: string | null }
      | null
      | undefined,
    right:
      | { markerType?: string | null; startLocal?: string | null; endLocal?: string | null }
      | null
      | undefined,
  ) =>
    !!left &&
    !!right &&
    String(left.markerType || "") === String(right.markerType || "") &&
    String(left.startLocal || "") === String(right.startLocal || "") &&
    String(left.endLocal || "") === String(right.endLocal || "");
  const tafMarkers = tafMarkersRaw
    .map((marker) => {
      const labelTime = String(marker?.label_time || "").trim();
      const index = findNearestTimeIndex(times, labelTime);
      if (index >= 0) {
        tafMarkerPoints[index] = tafMarkerValue;
      }
      return {
        displayType: formatTafMarkerType(
          String(marker?.marker_type || "").trim(),
          locale,
        ),
        endLocal: String(marker?.end_local || "").trim(),
        index,
        labelTime,
        markerType: String(marker?.marker_type || "").trim(),
        startLocal: String(marker?.start_local || "").trim(),
        summary:
          isEnglish(locale)
            ? String(marker?.summary_en || "").trim()
            : String(marker?.summary_zh || "").trim(),
        isCurrent: false,
        isPeakWindow: false,
        suppressionLevel: String(marker?.suppression_level || "").trim(),
      };
    })
    .filter((marker) => marker.index >= 0);
  const currentTafMarker =
    currentMinutes !== null
      ? tafMarkers.find((marker) => {
          const start = hmToMinutes(normalizeHm(marker.startLocal));
          const end = hmToMinutes(normalizeHm(marker.endLocal));
          return start !== null && end !== null && currentMinutes >= start && currentMinutes <= end;
        }) || null
      : null;
  const nextTafMarker =
    currentMinutes !== null && !currentTafMarker
      ? tafMarkers.find((marker) => {
          const start = hmToMinutes(normalizeHm(marker.startLocal));
          return start !== null && start > currentMinutes;
        }) || null
      : null;
  const peakWindowTafMarker =
    peakWindowStartMinutes !== null && peakWindowEndMinutes !== null
      ? tafMarkers.find((marker) => {
          const start = hmToMinutes(normalizeHm(marker.startLocal));
          const end = hmToMinutes(normalizeHm(marker.endLocal));
          return (
            start !== null &&
            end !== null &&
            start <= peakWindowEndMinutes &&
            end >= peakWindowStartMinutes
          );
        }) || null
      : null;
  tafMarkers.forEach((marker) => {
    const isPrimaryTafMarker =
      sameMarker(marker, currentTafMarker) || sameMarker(marker, nextTafMarker);
    const isPeakReferenceMarker = sameMarker(marker, peakWindowTafMarker);
    if (isPrimaryTafMarker) {
      marker.isCurrent = true;
      tafCurrentMarkerPoints[marker.index] = tafMarkerValue;
    }
    if (isPeakReferenceMarker) {
      marker.isPeakWindow = true;
      if (!isPrimaryTafMarker) {
        tafPeakWindowMarkerPoints[marker.index] = tafMarkerValue - 0.15;
      }
    }
  });
  const formatTafLegendMarker = (
    marker:
      | { displayType?: string | null; startLocal?: string | null; endLocal?: string | null; summary?: string | null }
      | null
      | undefined,
  ) => {
    if (!marker) return "";
    const range = `${marker.startLocal || "--:--"}-${marker.endLocal || "--:--"}`;
    const status = String(marker.summary || "").trim();
    return status
      ? `${marker.displayType || ""} ${range} ${status}`.trim()
      : `${marker.displayType || ""} ${range}`.trim();
  };

  const legendParts: string[] = [];
  if (!suppressAnkaraMgmObservation && detail.mgm?.temp != null) {
    legendParts.push(`MGM: ${detail.mgm.temp}${detail.temp_symbol}`);
  }
  if (!hasMgmHourly && Math.abs(offset) > 0.3) {
    const sign = offset > 0 ? "+" : "";
    legendParts.push(
      isEnglish(locale)
        ? `DEB offset ${sign}${offset.toFixed(1)}${detail.temp_symbol} vs OM`
        : `DEB 偏移 ${sign}${offset.toFixed(1)}${detail.temp_symbol} vs OM`,
    );
  }
  if (calibratedPath.adjustmentDelta != null) {
    const sign = calibratedPath.adjustmentDelta > 0 ? "+" : "";
    legendParts.push(
      isEnglish(locale)
        ? `DEB calibrated path applies latest observation bias ${sign}${calibratedPath.adjustmentDelta.toFixed(1)}${detail.temp_symbol}.`
        : `DEB 修正路径使用最新观测偏差 ${sign}${calibratedPath.adjustmentDelta.toFixed(1)}${detail.temp_symbol}。`,
    );
  }
  if (hasMgmHourly) {
    const hourly = detail.hourly || {};
    const hasPrimaryHourly =
      Array.isArray(hourly.times) &&
      Array.isArray(hourly.temps) &&
      Math.min(hourly.times.length, hourly.temps.length) > 0;
    const mgmIsForecastBase = !hasPrimaryHourly && isTurkishMgmCity(detail);
    legendParts.push(
      isEnglish(locale)
        ? mgmIsForecastBase
          ? "Using MGM hourly forecast as the DEB curve base"
          : "MGM hourly forecast is shown as official hourly guidance"
        : mgmIsForecastBase
          ? "已使用 MGM 小时预报作为 DEB 曲线基底"
          : "MGM 小时预报作为官方小时指引显示",
    );
  }
  if ((detail.trend?.recent?.length || 0) > 0 || observationSource.length > 0) {
    const recentData = sortObservationItemsByTime(
      observationSource.length > 0
        ? [...observationSource]
        : [...(detail.trend?.recent || [])],
    );
    const recentText = recentData
      .slice(-4)
      .map((item) => `${item.temp}${detail.temp_symbol}@${item.time}`)
      .join(" -> ");
    legendParts.push(`${observationDisplayTag}: ${recentText}`);
  }
  if (airportMetarSource.length > 0) {
    const airportRecentText = sortObservationItemsByTime([...airportMetarSource])
      .slice(-4)
      .map((item) => `${item.temp}${detail.temp_symbol}@${item.time}`)
      .join(" -> ");
    legendParts.push(
      isEnglish(locale)
        ? `${metarFallbackTag}: ${airportRecentText}`
        : `${metarFallbackTag}: ${airportRecentText}`,
    );
  }
  if (detail.metar_status?.stale_for_today) {
    const dateText = detail.metar_status.last_observation_local_date || "";
    const tempText =
      detail.metar_status.last_temp != null
        ? `${detail.metar_status.last_temp}${detail.temp_symbol}`
        : "";
    legendParts.push(
      isEnglish(locale)
        ? `No same-day ${metarFallbackTag} report yet; latest report${dateText ? ` was ${dateText}` : ""}${tempText ? ` at ${tempText}` : ""}.`
        : `今日暂无同日 ${metarFallbackTag} 报文；最近一报${dateText ? `为 ${dateText}` : ""}${tempText ? `，${tempText}` : ""}。`,
    );
  }
  if (shouldUseMetarFallback) {
    legendParts.push(
      isEnglish(locale)
        ? `Official ${observationTag} feed is sparse today, so the continuous observation line switches to ${metarFallbackTag}.`
        : `今日官方 ${observationTag} 点位较稀疏，连续实测线改用 ${metarFallbackTag}。`,
    );
  }
  if (usingMirrorFallback) {
    legendParts.push(
      isEnglish(locale)
        ? "Dense observation feed matched the forecast curve exactly, so it was ignored for this chart refresh."
        : "本次高密度观测源与预测曲线逐点重合，已忽略该异常源。",
    );
  } else if (observationCode === "hko") {
    legendParts.push(
      isEnglish(locale)
        ? "This city uses HKO official readings. The chart keeps official HKO points instead of switching to airport METAR."
        : "该城市按 HKO 官方读数展示；图中保留 HKO 官方点位，不切换到机场 METAR 连续线。",
    );
  } else if (observationCode === "noaa") {
    const noaaCode = getNoaaStationCode(detail);
    legendParts.push(
      isEnglish(locale)
        ? `This city settles on NOAA ${noaaCode} using the finalized highest rounded whole-degree Celsius Temp reading; the plotted line is a settlement reference.`
        : `该城市按 NOAA ${noaaCode} 最终完成质控后的最高整度摄氏 Temp 读数结算；图中曲线仅作为结算参考线。`,
    );
  }
  if (tafMarkers.length) {
    const primaryTafMarker = currentTafMarker || nextTafMarker;
    if (primaryTafMarker) {
      legendParts.push(
        isEnglish(locale)
          ? `Current TAF: ${formatTafLegendMarker(primaryTafMarker)}`
          : `当前 TAF：${formatTafLegendMarker(primaryTafMarker)}`,
      );
    }
    if (peakWindowTafMarker && !sameMarker(peakWindowTafMarker, primaryTafMarker)) {
      legendParts.push(
        isEnglish(locale)
          ? `Peak-window TAF: ${formatTafLegendMarker(peakWindowTafMarker)}`
          : `峰值窗口 TAF：${formatTafLegendMarker(peakWindowTafMarker)}`,
      );
    }
    legendParts.push(
      isEnglish(locale)
        ? "Use the current TAF segment as primary; peak-window segments are reference only."
        : "以当前 TAF 时段为准，峰值窗口时段仅作参考。",
    );
  }

  const debPastSeries = buildSeriesPoints(times, debPast);
  const debFutureSeries = buildSeriesPoints(times, debFuture);
  const debSeries = buildSeriesPoints(times, debTemps);
  const calibratedFutureSeries = buildSeriesPoints(times, calibratedFuture);
  const tempsSeries = buildSeriesPoints(times, temps);
  const mgmHourlySeries = buildSeriesPoints(times, mgmHourlyPoints);
  const metarSeries = buildObservationPointSeries(observationSource);
  const airportMetarSeries = buildObservationPointSeries(airportMetarSource);
  const mgmSeries =
    !suppressAnkaraMgmObservation && detail.mgm?.temp != null && detail.mgm?.time
      ? buildObservationPointSeries([{ time: detail.mgm.time, temp: detail.mgm.temp }])
      : [];
  const tafCurrentMarkerSeries = tafMarkers
    .filter((marker) => marker.isCurrent)
    .map((marker) => ({
      marker,
      x: hmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue,
    }))
    .filter((point) => point.x > 0);
  const tafPeakWindowMarkerSeries = tafMarkers
    .filter((marker) => marker.isPeakWindow && !marker.isCurrent)
    .map((marker) => ({
      marker,
      x: hmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue - 0.15,
    }))
    .filter((point) => point.x > 0);
  const tafMarkerSeries = tafMarkers
    .map((marker) => ({
      marker,
      x: hmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue,
    }))
    .filter((point) => point.x > 0);
  const xMin = times.length ? hmToMinutes(times[0]) ?? 0 : 0;
  const xMax = times.length ? hmToMinutes(times[times.length - 1]) ?? 24 * 60 : 24 * 60;

  return {
    currentIndex,
    datasets: {
      airportMetarPoints,
      airportMetarSeries,
      calibratedFuture,
      calibratedFutureSeries,
      calibrationAdjustmentDelta: calibratedPath.adjustmentDelta,
      debFuture,
      debFutureSeries,
      debPast,
      debPastSeries,
      debSeries,
      hasMgmHourly,
      metarPoints,
      metarSeries,
      mgmHourlyPoints,
      mgmHourlySeries,
      mgmPoints,
      mgmSeries,
      offset,
      tafCurrentMarkerPoints,
      tafCurrentMarkerSeries,
      tafMarkerPoints,
      tafMarkerSeries,
      tafPeakWindowMarkerPoints,
      tafPeakWindowMarkerSeries,
      temps,
      tempsSeries,
    },
    observationLabel:
    observationCode === "noaa" &&
    !shouldUseMetarFallback
        ? isEnglish(locale)
          ? `${observationDisplayTag} Settlement Reference`
          : `${observationDisplayTag} 结算参考`
        : isEnglish(locale)
          ? `${observationDisplayTag} Observation`
          : `${observationDisplayTag} 实况`,
    legendText: legendParts.join(" | "),
    max,
    min,
    tafMarkers,
    tickLabels: buildTemperatureTickLabels(times),
    times,
    xMax,
    xMin,
    yTickStep,
  };
}
