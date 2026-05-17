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
import { normalizeTemperatureSymbol } from "@/lib/temperature-utils";
import { formatTafMarkerType } from "@/lib/taf-utils";
import {
  hmToMinutes,
  interpolateSeriesAtMinutes,
  normalizeHm,
} from "@/lib/time-utils";

function isEnglish(locale: Locale) {
  return locale === "en-US";
}
function findNearestTimeIndex(
  times: string[],
  targetTime?: string | null,
) {
  const targetMinutes = hmToMinutes(targetTime);
  if (targetMinutes == null || !times.length) return -1;
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const minute = hmToMinutes(time);
    if (minute == null) return;
    const delta = Math.abs(minute - targetMinutes);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function buildTemperatureTickLabels(times: string[]) {
  const lastIndex = Math.max(0, times.length - 1);
  return times.map((time, index) => {
    if (index === 0 || index === lastIndex) return time;
    const minute = hmToMinutes(time);
    if (minute == null) return "";
    const hour = Math.floor(minute / 60);
    const minutePart = minute % 60;
    if (minutePart !== 0) return "";
    return hour % 2 === 0 ? time : "";
  });
}

function getNiceTemperatureScale(values: number[], tempSymbol?: string | null) {
  const numericValues = values.filter((value) => Number.isFinite(Number(value)));
  if (!numericValues.length) {
    return { max: 1, min: 0, step: 1 };
  }

  const rawMin = Math.min(...numericValues);
  const rawMax = Math.max(...numericValues);
  const spread = Math.max(0.1, rawMax - rawMin);
  const isFahrenheit = normalizeTemperatureSymbol(tempSymbol) === "°F";
  const padding = Math.max(isFahrenheit ? 1.5 : 0.8, spread * 0.12);
  const paddedMin = rawMin - padding;
  const paddedMax = rawMax + padding;
  const paddedSpread = Math.max(0.1, paddedMax - paddedMin);
  const candidates = isFahrenheit ? [1, 2, 5, 10, 20] : [0.5, 1, 2, 5, 10];
  let step =
    candidates.find((candidate) => candidate >= paddedSpread / 4) ||
    candidates[candidates.length - 1];
  let min = Math.floor(paddedMin / step) * step;
  let max = Math.ceil(paddedMax / step) * step;

  if (min < 0 && rawMin >= 0 && rawMin <= step * 1.25) min = 0;
  if (max <= min) max = min + step * 4;

  while ((max - min) / step + 1 > 6) {
    const nextStep = candidates.find((candidate) => candidate > step);
    if (!nextStep) break;
    step = nextStep;
    min = Math.floor(paddedMin / step) * step;
    max = Math.ceil(paddedMax / step) * step;
    if (min < 0 && rawMin >= 0 && rawMin <= step * 1.25) min = 0;
  }

  return { max, min, step };
}

function buildSeriesPoints(
  times: string[],
  values: Array<number | null | undefined>,
) {
  return times
    .map((time, index) => {
      const x = hmToMinutes(time);
      const y = values[index];
      return x != null && y != null && Number.isFinite(Number(y))
        ? { index, labelTime: time, x, y: Number(y) }
        : null;
    })
    .filter(
      (point): point is { index: number; labelTime: string; x: number; y: number } =>
        point != null,
    );
}

function buildObservationPoints(items: Array<{ time?: string; temp?: number | null }>) {
  return items
    .map((item) => {
      const labelTime = normalizeHm(String(item.time || ""));
      const x = hmToMinutes(labelTime);
      const y = item.temp;
      return x != null && y != null && Number.isFinite(Number(y))
        ? { labelTime: labelTime || "", x, y: Number(y) }
        : null;
    })
    .filter((point): point is { labelTime: string; x: number; y: number } => point != null);
}

function clampTemperatureDelta(value: number, min = -4, max = 4) {
  return Math.min(Math.max(value, min), max);
}

function buildCalibratedFuturePath({
  observations,
  times,
  debTemps,
  currentMinutes,
  reversionMinutes,
}: {
  observations: Array<{ time?: string | null; temp?: number | null }>;
  times: string[];
  debTemps: Array<number | null>;
  currentMinutes: number | null;
  reversionMinutes?: number | null;
}) {
  if (!times.length || !observations.length) {
    return {
      adjustmentDelta: null as number | null,
      future: new Array(times.length).fill(null) as Array<number | null>,
    };
  }

  const normalizedObservations = dedupeObservationItems(observations);
  const latestObservationMinute = normalizedObservations.reduce<number | null>(
    (latest, item) => {
      const minute = hmToMinutes(item.time);
      if (minute == null) return latest;
      return latest == null ? minute : Math.max(latest, minute);
    },
    null,
  );
  if (latestObservationMinute == null && currentMinutes == null) {
    return {
      adjustmentDelta: null as number | null,
      future: new Array(times.length).fill(null) as Array<number | null>,
    };
  }
  // In practice the backend `local_time` can lag the latest METAR/official
  // observation by one refresh cycle. Anchor the future line to the newest
  // observation when it is newer, otherwise the "no future obs" guard can
  // suppress the calibrated path even though the user already sees a fresh
  // green observation point on the chart.
  const pathStartMinutes =
    latestObservationMinute == null || currentMinutes == null
      ? latestObservationMinute ?? currentMinutes ?? 0
      : Math.max(currentMinutes, latestObservationMinute);

  const deltas = normalizedObservations
    .map((item) => {
      const minute = hmToMinutes(item.time);
      const observed = Number(item.temp);
      if (
        minute == null ||
        minute > pathStartMinutes + 30 ||
        !Number.isFinite(observed)
      ) {
        return null;
      }
      const expected = interpolateSeriesAtMinutes(times, debTemps, minute);
      if (expected == null || !Number.isFinite(expected)) return null;
      return {
        delta: clampTemperatureDelta(observed - expected),
        minute,
      };
    })
    .filter(
      (item): item is { delta: number; minute: number } => item != null,
    )
    .slice(-3);

  if (!deltas.length) {
    return {
      adjustmentDelta: null as number | null,
      future: new Array(times.length).fill(null) as Array<number | null>,
    };
  }

  const weighted = deltas.reduce(
    (acc, item, index) => {
      const weight = index + 1;
      return {
        total: acc.total + item.delta * weight,
        weight: acc.weight + weight,
      };
    },
    { total: 0, weight: 0 },
  );
  const adjustmentDelta = Number(
    clampTemperatureDelta(weighted.total / Math.max(weighted.weight, 1)).toFixed(
      1,
    ),
  );

  const lastSeriesMinute = times
    .map((time) => hmToMinutes(time))
    .filter((minute): minute is number => minute != null)
    .at(-1);
  const returnToBaselineMinute =
    reversionMinutes != null && reversionMinutes > pathStartMinutes
      ? reversionMinutes
      : lastSeriesMinute != null && lastSeriesMinute > pathStartMinutes
        ? lastSeriesMinute
        : pathStartMinutes + 6 * 60;

  const future = times.map((time, index) => {
    const minute = hmToMinutes(time);
    const base = debTemps[index];
    if (
      minute == null ||
      minute < pathStartMinutes ||
      base == null ||
      !Number.isFinite(base)
    ) {
      return null;
    }
    const progressToEvening = Math.min(
      Math.max(
        (minute - pathStartMinutes) /
          Math.max(returnToBaselineMinute - pathStartMinutes, 1),
        0,
      ),
      1,
    );
    // Strongest right after the latest observation, then smoothly fades back
    // to the unchanged DEB baseline by evening/sunset. This keeps one METAR
    // point from dragging the whole-day forecast away from the base path.
    const decay = Math.pow(1 - progressToEvening, 1.35);
    return Number((base + adjustmentDelta * decay).toFixed(1));
  });

  return { adjustmentDelta, future };
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
  const rawTimes = Array.isArray(hourly.times) ? hourly.times : [];
  const rawTemps = Array.isArray(hourly.temps) ? hourly.temps : [];
  const validEntries = rawTimes
    .map((time, index) => ({
      tail: normalizeHm(String(time || "").trim()) || "",
      value: Number(rawTemps[index]),
    }))
    .filter((entry) => entry.tail !== "");
  const dataByHour = new Map<string, number | null>();
  validEntries.forEach((entry) => {
    dataByHour.set(entry.tail, Number.isFinite(entry.value) ? entry.value : null);
  });
  const getHourTemp = (h: number): number | null => {
    const key = `${String(h).padStart(2, "0")}:00`;
    return dataByHour.has(key) ? dataByHour.get(key)! : null;
  };
  const times: string[] = [];
  const temps: Array<number | null> = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    times.push(`${hh}:00`);
    temps.push(getHourTemp(h));
    if (h < 23) {
      const a = getHourTemp(h);
      const b = getHourTemp(h + 1);
      times.push(`${hh}:30`);
      temps.push(a != null && b != null ? Number((a + (b - a) * 0.5).toFixed(1)) : a ?? b);
    }
  }
  const suppressAnkaraMgmObservation = isTurkishMgmCity(detail);

  if (!times.length) return null;

  const currentIndex = findNearestTimeIndex(times, detail.local_time);
  const omMax = detail.forecast?.today_high;
  const debMax = detail.deb?.prediction;
  const offset =
    debMax != null && omMax != null ? Number(debMax) - Number(omMax) : 0;
  const debTemps = temps.map((temp) =>
    temp != null && Number.isFinite(temp)
      ? Number((temp + offset).toFixed(1))
      : null,
  );
  const debPast = debTemps.map((temp, index) =>
    currentIndex >= 0 && index <= currentIndex ? temp : null,
  );
  const debFuture = debTemps.map((temp, index) =>
    currentIndex < 0 || index >= currentIndex ? temp : null,
  );

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

  const metarPoints = new Array(times.length).fill(null);
  observationSource.forEach((item) => {
    const index = findNearestTimeIndex(times, String(item.time || ""));
    const temp = Number(item.temp);
    if (index >= 0 && Number.isFinite(temp)) {
      const existing = metarPoints[index];
      // Multiple reports can land in the same hour bucket. Keep the peak
      // value so an intrahour high is not hidden by a later weaker report.
      metarPoints[index] =
        existing == null ? temp : Math.max(Number(existing), temp);
    }
  });
  const airportMetarPoints = new Array(times.length).fill(null);
  airportMetarSource.forEach((item) => {
    const index = findNearestTimeIndex(times, String(item.time || ""));
    const temp = Number(item.temp);
    if (index >= 0 && Number.isFinite(temp)) {
      const existing = airportMetarPoints[index];
      airportMetarPoints[index] =
        existing == null ? temp : Math.max(Number(existing), temp);
    }
  });
  const calibrationObservationSource = dedupeObservationItems(
    metarObservationSource.length ? metarObservationSource : observationSource,
  );
  const calibratedPath = buildCalibratedFuturePath({
    observations: calibrationObservationSource,
    times,
    debTemps,
    currentMinutes: hmToMinutes(detail.local_time),
    reversionMinutes:
      hmToMinutes(detail.forecast?.sunset) ?? hmToMinutes("18:00"),
  });
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
  const mgmHourlyRows = Array.isArray(detail.mgm?.hourly)
    ? detail.mgm?.hourly || []
    : [];
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
  const normalizeTafHm = (value: unknown): string | null => {
    const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const chartHmToMinutes = (value: string | null) => {
    if (!value) return null;
    const [hourPart, minutePart] = value.split(":");
    const hour = Number.parseInt(hourPart || "", 10);
    const minute = Number.parseInt(minutePart || "", 10);
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return hour * 60 + minute;
  };
  const currentMinutes = chartHmToMinutes(normalizeTafHm(detail.local_time));
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
          const start = chartHmToMinutes(normalizeTafHm(marker.startLocal));
          const end = chartHmToMinutes(normalizeTafHm(marker.endLocal));
          return start !== null && end !== null && currentMinutes >= start && currentMinutes <= end;
        }) || null
      : null;
  const nextTafMarker =
    currentMinutes !== null && !currentTafMarker
      ? tafMarkers.find((marker) => {
          const start = chartHmToMinutes(normalizeTafHm(marker.startLocal));
          return start !== null && start > currentMinutes;
        }) || null
      : null;
  const peakWindowTafMarker =
    peakWindowStartMinutes !== null && peakWindowEndMinutes !== null
      ? tafMarkers.find((marker) => {
          const start = chartHmToMinutes(normalizeTafHm(marker.startLocal));
          const end = chartHmToMinutes(normalizeTafHm(marker.endLocal));
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
  if (!hasMgmHourly && debMax != null && omMax != null && Math.abs(offset) > 0.3) {
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
        ? `METAR-calibrated path applies latest observation bias ${sign}${calibratedPath.adjustmentDelta.toFixed(1)}${detail.temp_symbol}.`
        : `修正路径使用最新 METAR 偏差 ${sign}${calibratedPath.adjustmentDelta.toFixed(1)}${detail.temp_symbol}。`,
    );
  }
  if (hasMgmHourly) {
    legendParts.push(
      isEnglish(locale)
        ? "Using MGM hourly forecast to replace DEB curve"
        : "已使用 MGM 小时预报替代 DEB 曲线",
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
  const metarSeries = buildObservationPoints(observationSource);
  const airportMetarSeries = buildObservationPoints(airportMetarSource);
  const mgmSeries =
    !suppressAnkaraMgmObservation && detail.mgm?.temp != null && detail.mgm?.time
      ? buildObservationPoints([{ time: detail.mgm.time, temp: detail.mgm.temp }])
      : [];
  const tafCurrentMarkerSeries = tafMarkers
    .filter((marker) => marker.isCurrent)
    .map((marker) => ({
      marker,
      x: chartHmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue,
    }))
    .filter((point) => point.x > 0);
  const tafPeakWindowMarkerSeries = tafMarkers
    .filter((marker) => marker.isPeakWindow && !marker.isCurrent)
    .map((marker) => ({
      marker,
      x: chartHmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue - 0.15,
    }))
    .filter((point) => point.x > 0);
  const tafMarkerSeries = tafMarkers
    .map((marker) => ({
      marker,
      x: chartHmToMinutes(marker.labelTime) ?? 0,
      y: tafMarkerValue,
    }))
    .filter((point) => point.x > 0);
  const xMin = times.length ? chartHmToMinutes(times[0]) ?? 0 : 0;
  const xMax = times.length ? chartHmToMinutes(times[times.length - 1]) ?? 24 * 60 : 24 * 60;

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
