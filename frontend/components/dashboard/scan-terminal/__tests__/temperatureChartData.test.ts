import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";
import { buildChartTimeAxis, buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import {
  buildFullDayChartData,
  mergeObservationSnapshotIntoHourly,
  mergeHourlyWithLiveObservations,
  mergePatchIntoHourly,
  mergeRowObservationIntoHourly,
  observationPayloadToSnapshot,
  readCachedHourlyForInitialRow,
  rememberHourlyDetailSnapshot,
  selectInitialHourlyForRowChange,
  seedChartRenderStateFromRow,
  toFullChartDetail,
  _hourlyCache,
} from "@/components/dashboard/scan-terminal/temperature-chart-logic";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}±${tolerance}, got ${actual}`);
  }
}

export function runTests() {
  const fullDayHourlyTimes = Array.from(
    { length: 24 },
    (_, hour) => `${String(hour).padStart(2, "0")}:00`,
  );
  const fullDayHourlyTemps = Array.from({ length: 24 }, (_, hour) => hour);
  const fullDayAxis = buildChartTimeAxis(fullDayHourlyTimes, fullDayHourlyTemps, null, false);
  assert(fullDayAxis.times.length === 48, "detail mini chart axis should expose all 48 half-hour slots");
  assert(fullDayAxis.times[47] === "23:30", "detail mini chart axis should end at 23:30");
  assert(fullDayAxis.temps[47] === 23, "23:30 should fall back to the 23:00 hourly temperature");

  const lateNightDetailChart = getTemperatureChartData(
    {
      name: "late-night-city",
      display_name: "Late Night City",
      local_date: "2026-05-16",
      local_time: "23:55",
      temp_symbol: "°C",
      hourly: {
        times: fullDayHourlyTimes,
        temps: fullDayHourlyTemps,
      },
      forecast: { today_high: 23 },
      deb: { prediction: 23 },
      metar_today_obs: [{ time: "23:55", temp: 24.5 }],
    } as CityDetail,
    "zh-CN",
  );
  assert(lateNightDetailChart, "late-night detail chart should exist");
  assert(lateNightDetailChart?.times.at(-1) === "23:30", "detail mini chart should keep 23:30 as the final slot");
  assert(lateNightDetailChart?.xMax === 1410, "detail mini chart xMax should be 23:30 expressed as minutes");
  const lateNightSlot = lateNightDetailChart?.times.indexOf("23:30") ?? -1;
  assert(lateNightSlot === 47, "23:30 should be the last detail chart slot");
  assert(
    lateNightDetailChart?.datasets.metarPoints[lateNightSlot] === 24.5,
    "23:55 observations should land in the 23:30 slot instead of being compressed to 23:00 or wrapped to 00:00",
  );
  assert(
    lateNightDetailChart?.datasets.metarPoints[0] == null,
    "23:55 observations should not wrap to the 00:00 slot",
  );

  const chartData = getTemperatureChartData(
    {
      name: "test-city",
      display_name: "Test City",
      local_date: "2026-05-16",
      local_time: "10:00",
      temp_symbol: "°C",
      hourly: {
        times: [
          "2026-05-16T08:00:00+08:00",
          "2026-05-16T09:00:00+08:00",
          "2026-05-16T10:00:00+08:00",
          "2026-05-16T11:00:00+08:00",
        ],
        temps: [20, 22, 24, 26],
      },
      forecast: { today_high: 28 },
      deb: { prediction: 28 },
    } as CityDetail,
    "zh-CN",
  );

  assert(chartData, "temperature chart data should exist for ISO datetime hourly input");
  // hourly max=26, DEB=28 → offset=+2; temps shift from [20,22,24,26] to [22,24,26,28]
  assert(
    chartData?.datasets.debSeries.some((point) => point.labelTime === "08:00" && point.y === 22),
    "temperature chart should normalize ISO hourly times and apply DEB offset based on hourly max",
  );
  assert(
    chartData?.datasets.debSeries.some((point) => point.labelTime === "10:00" && point.y === 26),
    "temperature chart should keep normalized hourly temperatures shifted by offset",
  );

  const correctedHourlyPathChart = buildFullDayChartData(
    {
      city: "shanghai",
      local_date: "2026-05-16",
      local_time: "12:00",
      temp_symbol: "°C",
      deb_prediction: 30,
      tz_offset_seconds: 8 * 3600,
    } as any,
    {
      forecastTodayHigh: 29,
      debPrediction: 30,
      localDate: "2026-05-16",
      localTime: "12:00",
      times: ["10:00", "12:00", "14:00"],
      temps: [24, 29, 25],
      debHourlyPath: {
        source: "deb_hourly_peak_corrected.v1",
        times: ["10:00", "12:00", "14:00"],
        temps: [25.1, 28.0, 26.0],
      },
    } as any,
    true,
  );
  const correctedDebSeries = correctedHourlyPathChart.series.find((item) => item.key === "hourly_forecast");
  const correctedDebValues = correctedHourlyPathChart.data
    .map((item) => item.hourly_forecast)
    .filter((value) => value !== null && value !== undefined);
  assert(correctedDebSeries, "corrected hourly DEB path should still render as DEB Forecast");
  assert(correctedDebValues.includes(28.0), `chart should use backend deb.hourly_path before rebuilding a shifted curve; got ${correctedDebValues.join(",")}`);

  const independentModelTimelineChart = buildFullDayChartData(
    {
      city: "madrid",
      local_date: "2026-06-11",
      local_time: "20:00",
      temp_symbol: "°C",
      tz_offset_seconds: 2 * 3600,
    } as any,
    {
      forecastTodayHigh: 31,
      debPrediction: 31,
      localDate: "2026-06-11",
      localTime: "20:00",
      times: ["08:00", "09:00", "10:00"],
      temps: [20, 25, 22],
      modelTimes: ["15:00", "16:00", "17:00"],
      modelCurves: {
        ECMWF: [24, 32, 25],
      },
    } as any,
    true,
  );
  const independentModelPeak = independentModelTimelineChart.data.find(
    (point) => point.model_curve_ECMWF === 32,
  );
  assert(
    independentModelPeak?.label === "16:00:00",
    `multi-model curves must use models_hourly.times instead of hourly.times; got ${independentModelPeak?.label}`,
  );

  const floatingIsoModelTimelineChart = buildFullDayChartData(
    {
      city: "paris",
      local_date: "2026-06-14",
      local_time: "12:00",
      temp_symbol: "°C",
      tz_offset_seconds: 2 * 3600,
    } as any,
    {
      forecastTodayHigh: 24,
      debPrediction: 24,
      localDate: "2026-06-14",
      localTime: "12:00",
      times: ["00:00", "12:00", "23:00"],
      temps: [18, 21, 16],
      modelTimes: Array.from({ length: 24 }, (_, hour) => `2026-06-14T${String(hour).padStart(2, "0")}:00`),
      modelCurves: {
        ECMWF: Array.from({ length: 24 }, (_, hour) => hour),
      },
    } as any,
    true,
  );
  const floatingIsoModelLatePoint = floatingIsoModelTimelineChart.data.find(
    (point) => point.label === "23:00:00" && point.model_curve_ECMWF === 23,
  );
  assert(
    floatingIsoModelLatePoint,
    "floating ISO model times without an explicit timezone must stay on the city-local clock so late-day forecast points do not disappear",
  );

  const staleDetailWithCurrentRowChart = buildFullDayChartData(
    {
      city: "paris",
      local_date: "2026-06-16",
      local_time: "14:59",
      temp_symbol: "°C",
      tz_offset_seconds: 2 * 3600,
    } as any,
    {
      forecastTodayHigh: 24,
      debPrediction: 24,
      localDate: "2026-06-14",
      localTime: "11:00",
      times: ["00:00", "12:00", "23:00"],
      temps: [18, 21, 16],
      modelTimes: Array.from({ length: 72 }, (_, index) => {
        const date = index < 24 ? "2026-06-14" : index < 48 ? "2026-06-15" : "2026-06-16";
        const hour = index % 24;
        return `${date}T${String(hour).padStart(2, "0")}:00`;
      }),
      modelCurves: {
        ECMWF: Array.from({ length: 72 }, (_, index) => index),
      },
    } as any,
    true,
  );
  const currentDayModelLatePoint = staleDetailWithCurrentRowChart.data.find(
    (point) => point.label === "23:00:00" && point.model_curve_ECMWF === 71,
  );
  assert(
    currentDayModelLatePoint,
    "chart should use the current scan row local date when cached detail localDate is older so today's model curve is drawn through 23:00",
  );

  _hourlyCache.clear();
  _hourlyCache.set("madrid:10m", {
    ts: Date.now(),
    data: {
      localDate: "2026-06-16",
      localTime: "15:46",
      times: [],
      temps: [],
      airportPrimary: {
        temp: 28.8,
        obs_time: "2026-06-16T13:46:00Z",
      },
      airportPrimaryTodayObs: [["2026-06-16T13:46:00Z", 28.8]],
    } as any,
  });
  const observationOnlyInitialCache = readCachedHourlyForInitialRow("madrid", "10m");
  assert(
    observationOnlyInitialCache === null,
    "observation-only hourly cache entries must not block loading the full city detail payload",
  );
  _hourlyCache.clear();

  const correctedDetailChart = getTemperatureChartData(
    {
      name: "shanghai",
      display_name: "Shanghai",
      local_date: "2026-05-16",
      local_time: "12:00",
      temp_symbol: "°C",
      hourly: {
        times: ["10:00", "12:00", "14:00"],
        temps: [24, 29, 25],
      },
      forecast: { today_high: 29 },
      deb: {
        prediction: 30,
        hourly_path: {
          source: "deb_hourly_peak_corrected.v1",
          times: ["10:00", "12:00", "14:00"],
          temps: [25.1, 28.0, 26.0],
        },
      },
    } as CityDetail,
    "zh-CN",
  );
  assert(
    correctedDetailChart?.datasets.debSeries.some((point) => point.labelTime === "12:00" && point.y === 28.0),
    "detail temperature chart should use backend deb.hourly_path before fallback baseline",
  );

  const ankaraChartData = getTemperatureChartData(
    {
      name: "ankara",
      display_name: "Ankara",
      local_date: "2026-05-17",
      local_time: "13:00",
      temp_symbol: "°C",
      current: {
        temp: 18,
        obs_time: "2026-05-17T10:50:00Z",
        settlement_source: "mgm",
      },
      forecast: { today_high: null },
      deb: { prediction: 24 },
      mgm: {
        hourly: [
          { time: "11:00", temp: 19 },
          { time: "12:00", temp: 21 },
          { time: "13:00", temp: 22 },
          { time: "14:00", temp: 23 },
        ],
      },
      metar_today_obs: [{ time: "13:00", temp: 22 }],
    } as unknown as CityDetail,
    "zh-CN",
  );

  assert(
    ankaraChartData?.datasets.debSeries.some((point) => point.labelTime === "13:00"),
    "Ankara chart should build the DEB original path from MGM hourly data when Open-Meteo hourly is unavailable",
  );
  assert(
    (ankaraChartData?.datasets.debSeries.length ?? 0) >= 4,
    "Ankara chart should build the DEB original path from MGM hourly data",
  );
  assert(
    ankaraChartData?.datasets.debSeries.some((point) => point.labelTime === "13:00"),
    "Ankara DEB path must include the MGM hourly point at 13:00",
  );
  assert(
    ankaraChartData?.datasets.calibratedFutureSeries.length,
    "Ankara chart should still expose a calibrated path when observation points exist",
  );

  // ── Moscow 场景：forecast.today_high 不可靠 → DEB offset 优先用 hourly 自身 max ──
  const moscowTimes = [
    "00:00", "00:30", "01:00", "01:30", "02:00", "02:30",
    "03:00", "03:30", "04:00", "04:30", "05:00", "05:30",
    "06:00", "06:30", "07:00", "07:30", "08:00", "08:30",
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
    "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
    "18:00", "18:30", "19:00", "19:30", "20:00", "20:30",
    "21:00", "21:30", "22:00", "22:30", "23:00", "23:30",
  ];
  const moscowTemps = moscowTimes.map((t) => {
    const h = Number.parseInt(t.split(":")[0], 10);
    // Peak at 15:00 = 24.7, typical diurnal curve
    if (h <= 6) return 12 + h * 1.0;
    if (h <= 12) return 18 + (h - 6) * 0.9;
    if (h <= 15) return 23.4 + (h - 12) * 0.43;
    return 24.7 - (h - 15) * 1.2;
  });
  // Ensure the max is exactly 24.7 at 15:00
  const peakIndex = moscowTimes.indexOf("15:00");
  moscowTemps[peakIndex] = 24.7;

  const moscowBaseline = buildDebBaselinePath(
    moscowTimes,
    moscowTemps,
    24.5, // DEB prediction
    "13:00", // local time
    21.4, // forecast.today_high — unreliable!
    null, // no MGM
  );

  assert(
    Math.abs(moscowBaseline.offset) < 1.0,
    `Moscow: DEB offset should use hourly max (24.7) not forecast.today_high (21.4); got offset=${moscowBaseline.offset}`,
  );
  assertNear(
    moscowBaseline.offset,
    -0.2,
    0.3,
    "Moscow: DEB 24.5 vs hourly max 24.7 → offset ≈ -0.2",
  );
  // 验证后半段曲线没有被整体抬升 +3.1
  const moscowAfternoon = moscowBaseline.debTemps[peakIndex + 6]; // 18:00
  assert(
    moscowAfternoon != null && moscowAfternoon < 22,
    `Moscow 18:00 should not be inflated by unreliable forecast.today_high; got ${moscowAfternoon}`,
  );

  // ── Ankara 部分小时数据：DEB 路径覆盖全天 48 点 ──
  const ankaraPartial = buildDebBaselinePath(
    ["11:00", "12:00", "13:00", "14:00"],
    [19, 21, 22, 23],
    24,
    "13:00",
    null,
    null,
  );
  assert(
    ankaraPartial.debTemps.length === 4,
    "Ankara partial: input 4 hours → output 4 points (interpolation handled by fillTemperaturePathForFullDay)",
  );
  // hourly max=23, DEB=24 → offset=+1
  assertNear(ankaraPartial.offset, 1, 0.01, "Ankara partial: hourly max=23, DEB=24 → offset=+1");
  // DEB path should still cover the partial day
  const ankaraValid = ankaraPartial.debTemps.filter((t) => t != null && Number.isFinite(t));
  assert(ankaraValid.length >= 4, "Ankara partial: all input points should be valid");

  // ── 正常城市：完整 hourly → offset 基于 hourly max ──
  const normalHourlyTimes = moscowTimes;
  const normalHourlyTemps = moscowTimes.map((t) => {
    const h = Number.parseInt(t.split(":")[0], 10);
    return 18 + Math.sin(((h - 6) / 12) * Math.PI) * 7; // peak ~25 at 12:00
  });
  const normalBaseline = buildDebBaselinePath(
    normalHourlyTimes,
    normalHourlyTemps,
    27, // DEB 2° above hourly max
    "10:00",
    26, // forecast.today_high close to reality
    null,
  );
  assertNear(
    normalBaseline.offset,
    2.0,
    0.5,
    "Normal city: DEB 27 vs hourly max ~25 → offset ≈ +2",
  );
  // Full 48-point coverage
  assert(
    normalBaseline.debTemps.length === 48,
    "Normal city: full 48-point DEB path",
  );
  assert(
    normalBaseline.debPast.some((t) => t != null) && normalBaseline.debFuture.some((t) => t != null),
    "Normal city: both past and future portions should have data",
  );

  const guangzhouRow = {
    city: "guangzhou",
    local_date: "2026-06-10",
    local_time: "12:45",
    current_temp: 28.4,
    current_max_so_far: 29,
    temp_symbol: "°C",
    tz_offset_seconds: 8 * 3600,
    metar_context: {
      source: "amsc_awos",
      station_label: "AMSC AWOS",
      airport_current_temp: 28.4,
      airport_obs_time: "12:45",
      airport_max_so_far: 29,
    },
  } as any;
  const seededGuangzhou = seedChartRenderStateFromRow(guangzhouRow);
  const guangzhouLiveChart = buildFullDayChartData(guangzhouRow, seededGuangzhou, false);
  const guangzhouSettlementRunway = guangzhouLiveChart.series.find((item) => item.key === "runway_02L_20R");
  assert(
    guangzhouSettlementRunway?.values.some((value) => value === 28.4),
    "row-seeded runway cities must plot the latest scan-row observation immediately instead of waiting for city detail",
  );

  const guangzhouPatched = mergePatchIntoHourly(seededGuangzhou, {
    city: "guangzhou",
    revision: 42,
    changes: {
      temp: 28.8,
      observed_at_local: "12:48",
      obs_time: "12:48",
      source: "amsc_awos",
      runway_points: [{ runway: "02L/20R", temp: 28.8 }],
    },
  });
  const guangzhouPatchedChart = buildFullDayChartData(guangzhouRow, guangzhouPatched, false);
  const patchedRunway = guangzhouPatchedChart.series.find((item) => item.key === "runway_02L_20R");
  assert(
    patchedRunway?.values.some((value) => value === 28.8),
    "SSE runway patches must append directly to the chart series without waiting for a force-refreshed detail payload",
  );

  const guangzhouLaterRow = {
    ...guangzhouRow,
    current_temp: 29.1,
    local_time: "12:51",
    sse_revision: 43,
    metar_context: {
      ...guangzhouRow.metar_context,
      airport_current_temp: 29.1,
      airport_obs_time: "12:51",
      airport_max_so_far: 29.1,
    },
  } as any;
  const guangzhouRowMerged = mergeRowObservationIntoHourly(seededGuangzhou, guangzhouLaterRow);
  const guangzhouRowMergedChart = buildFullDayChartData(guangzhouLaterRow, guangzhouRowMerged, false);
  const rowMergedRunway = guangzhouRowMergedChart.series.find((item) => item.key === "runway_02L_20R");
  assert(
    rowMergedRunway?.values.some((value) => value === 29.1),
    "same-city scan row observation changes must merge into chart state without requiring an active-slot click",
  );

  const staleDetail = {
    ...seededGuangzhou,
    forecastDaily: [{ date: "2026-06-10", max_temp: 31, min_temp: 24 }] as any,
    probabilities: { engine: "legacy", distribution: [{ value: 30, probability: 0.4 }] },
    runwayPlateHistory: {
      "02L/20R": [{ timestamp: "12:45", temp_c: 28.4, value: 28.4 }],
    },
    airportPrimaryTodayObs: [["12:45", 28.4]],
    airportCurrent: { temp: 28.4, obs_time: "12:45", max_so_far: 29 },
    airportPrimary: { temp: 28.4, obs_time: "12:45", max_so_far: 29 },
  } as any;
  const mergedAfterStaleDetail = mergeHourlyWithLiveObservations(staleDetail, guangzhouPatched, guangzhouRow);
  const mergedAfterStaleDetailChart = buildFullDayChartData(guangzhouRow, mergedAfterStaleDetail, false);
  const preservedPatchRunway = mergedAfterStaleDetailChart.series.find((item) => item.key === "runway_02L_20R");
  assert(
    preservedPatchRunway?.values.some((value) => value === 28.8),
    "stale full-detail responses must not overwrite a newer live SSE observation point",
  );
  const olderAutoRefreshDetail = {
    ...seededGuangzhou,
    localDate: "2026-06-10",
    localTime: "12:45",
    times: ["12:00", "12:45"],
    temps: [27.8, 28.4],
    probabilities: { engine: "stale", distribution: [{ value: 28, probability: 0.2 }] },
    runwayPlateHistory: {
      "02L/20R": [{ timestamp: "12:45", temp_c: 28.4, value: 28.4 }],
    },
    airportCurrent: { temp: 28.4, obs_time: "12:45", max_so_far: 28.4 },
    airportPrimary: { temp: 28.4, obs_time: "12:45", max_so_far: 28.4 },
    airportPrimaryTodayObs: [["12:45", 28.4]],
  } as any;
  const newerVisibleDetail = {
    ...seededGuangzhou,
    localDate: "2026-06-10",
    localTime: "12:55",
    times: ["12:00", "12:55"],
    temps: [27.8, 29.2],
    probabilities: { engine: "fresh", distribution: [{ value: 29, probability: 0.7 }] },
    runwayPlateHistory: {
      "02L/20R": [{ timestamp: "12:55", temp_c: 29.2, value: 29.2 }],
    },
    airportCurrent: { temp: 29.2, obs_time: "12:55", max_so_far: 29.2 },
    airportPrimary: { temp: 29.2, obs_time: "12:55", max_so_far: 29.2 },
    airportPrimaryTodayObs: [["12:55", 29.2]],
  } as any;
  const mergedAfterOlderAutoRefresh = mergeHourlyWithLiveObservations(
    olderAutoRefreshDetail,
    newerVisibleDetail,
    guangzhouRow,
  );
  assert(
    mergedAfterOlderAutoRefresh?.times.includes("12:55") &&
      !mergedAfterOlderAutoRefresh?.times.includes("12:45"),
    "older automatic detail refreshes must not roll a newer visible chart curve back to stale timestamps",
  );
  assert(
    mergedAfterOlderAutoRefresh?.probabilities?.engine === "fresh",
    "older automatic detail refreshes must preserve the newer visible chart probability payload",
  );

  const richGuangzhouDetail = {
    ...seededGuangzhou,
    localDate: "2026-06-10",
    localTime: "12:50",
    times: ["00:00", "12:00", "18:00"],
    temps: [25, 31, 28],
    debPrediction: 32.2,
    debHourlyPath: {
      times: ["00:00", "12:00", "18:00"],
      temps: [25.2, 32.2, 28.4],
    },
    modelTimes: ["00:00", "12:00", "18:00"],
    modelCurves: {
      GFS: [25, 31.5, 28],
      ECMWF: [24.8, 32, 28.2],
    },
    multiModelDaily: {
      GFS: { high: 31.5 },
      ECMWF: { high: 32 },
    },
    airportPrimary: { temp: 28.4, obs_time: "12:50", max_so_far: 31 },
    airportPrimaryTodayObs: [["12:50", 28.4]],
  } as any;
  const freshObservationOnlyDetail = {
    ...seededGuangzhou,
    localDate: "2026-06-10",
    localTime: "12:55",
    times: ["00:00", "12:00", "18:00"],
    temps: [25, 31, 28],
    debPrediction: null,
    debHourlyPath: null,
    modelTimes: undefined,
    modelCurves: undefined,
    multiModelDaily: {},
    airportPrimary: { temp: 28.9, obs_time: "12:55", max_so_far: 31 },
    airportPrimaryTodayObs: [["12:55", 28.9]],
  } as any;
  const mergedFreshObservationWithRichDetail = mergeHourlyWithLiveObservations(
    freshObservationOnlyDetail,
    richGuangzhouDetail,
    guangzhouRow,
  );
  assert(
    mergedFreshObservationWithRichDetail?.debPrediction === 32.2,
    "fresh observation-only detail refreshes must preserve the existing DEB prediction",
  );
  assert(
    Object.keys(mergedFreshObservationWithRichDetail?.modelCurves || {}).length === 2,
    "fresh observation-only detail refreshes must preserve existing multi-model hourly curves",
  );
  assert(
    Object.keys(mergedFreshObservationWithRichDetail?.multiModelDaily || {}).length === 2,
    "fresh observation-only detail refreshes must preserve existing multi-model daily payloads",
  );
  assert(
    mergedFreshObservationWithRichDetail?.airportPrimary?.obs_time === "12:55",
    "fresh observation-only detail refreshes must still update the live observation timestamp",
  );

  const guangzhouNonUsMadisChart = buildFullDayChartData(
    {
      city: "guangzhou",
      local_date: "2026-06-10",
      local_time: "12:55",
      tz_offset_seconds: 8 * 60 * 60,
      airport: "ZGGG",
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-06-10",
      localTime: "12:55",
      times: ["00:00", "12:00", "18:00"],
      temps: [25, 31, 28],
      airportPrimary: {
        source_code: "madis_hfmetar",
        source_label: "NOAA MADIS",
        station_code: "ZGGG",
        temp: 28.9,
        obs_time: "2026-06-10T04:55:00Z",
      },
      airportPrimaryTodayObs: [["2026-06-10T04:55:00Z", 28.9]],
    } as any,
    false,
  );
  const guangzhouNonUsMadisSeries = guangzhouNonUsMadisChart.series.find((item) => item.key === "madis");
  assert(
    guangzhouNonUsMadisSeries?.label === "ZGGG METAR",
    "NOAA MADIS label should be reserved for US airports; non-US airport-primary fallback should use METAR wording",
  );

  const parisImplicitAirportPrimaryChart = buildFullDayChartData(
    {
      city: "paris",
      local_date: "2026-06-16",
      local_time: "14:24",
      tz_offset_seconds: 2 * 60 * 60,
      airport: "LFPB",
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-06-16",
      localTime: "14:24",
      times: ["00:00", "12:00", "18:00"],
      temps: [14, 20, 18],
      airportPrimary: {
        temp: 20.0,
        obs_time: "2026-06-16T12:24:00Z",
      },
      airportPrimaryTodayObs: [["2026-06-16T12:00:00Z", 20.0]],
      metarTodayObs: [["2026-06-16T12:00:00Z", 20.0]],
    } as any,
    false,
  );
  const parisImplicitAirportPrimarySeries = parisImplicitAirportPrimaryChart.series.find((item) => item.key === "madis");
  assert(
    parisImplicitAirportPrimarySeries?.label === "LFPB METAR",
    "non-US airport-primary fallback without explicit source metadata must not default to NOAA MADIS",
  );

  const parisAirportDisplayNameChart = buildFullDayChartData(
    {
      city: "paris",
      local_date: "2026-06-16",
      local_time: "14:59",
      tz_offset_seconds: 2 * 60 * 60,
      airport: "Paris-Le Bourget 机场",
      metar_context: {
        station: "LFPB",
        station_label: "Paris-Le Bourget Airport",
      },
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-06-16",
      localTime: "14:59",
      times: ["00:00", "12:00", "18:00"],
      temps: [14, 20, 18],
      settlementStationCode: "LFPB",
      settlementStationLabel: "Paris-Le Bourget Airport",
      airportPrimary: {
        temp: 20.0,
        obs_time: "2026-06-16T12:59:00Z",
      },
      airportPrimaryTodayObs: [
        ["2026-06-16T10:00:00Z", 18],
        ["2026-06-16T12:00:00Z", 20],
      ],
      metarTodayObs: [
        ["2026-06-16T10:30:00Z", 18],
        ["2026-06-16T12:30:00Z", 20],
      ],
    } as any,
    false,
  );
  const parisAirportDisplayNameSeries = parisAirportDisplayNameChart.series.find((item) => item.key === "madis");
  assert(
    parisAirportDisplayNameSeries?.label === "LFPB METAR",
    `airport-primary fallback must prefer station code over display name; got ${parisAirportDisplayNameSeries?.label}`,
  );
  assert(
    !parisAirportDisplayNameChart.series.some((item) => item.key === "metar"),
    "same-station airport-primary observations should suppress the redundant METAR line even when cadences differ",
  );

  const ankaraScanSeedChart = buildFullDayChartData(
    {
      city: "ankara",
      local_date: "2026-06-14",
      local_time: "15:10",
      tz_offset_seconds: 3 * 60 * 60,
      airport: "Esenboğa 机场",
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-06-14",
      localTime: "15:10",
      times: ["00:00", "12:00", "18:00"],
      temps: [15, 19, 18],
      airportPrimary: {
        temp: 19,
        obs_time: "2026-06-14T12:10:00Z",
      },
      airportPrimaryTodayObs: [["2026-06-14T12:10:00Z", 19]],
    } as any,
    false,
  );
  const ankaraScanSeedSeries = ankaraScanSeedChart.series.find((item) => item.key === "madis");
  assert(
    ankaraScanSeedSeries?.label === "MGM",
    "Ankara scan-row-seeded airport-primary curve should default to MGM instead of NOAA MADIS when source metadata is missing",
  );

  const guangzhouRunwayWithBadMadisChart = buildFullDayChartData(
    {
      city: "guangzhou",
      local_date: "2026-06-10",
      local_time: "12:55",
      tz_offset_seconds: 8 * 60 * 60,
      airport: "ZGGG",
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-06-10",
      localTime: "12:55",
      times: ["00:00", "12:00", "18:00"],
      temps: [25, 31, 28],
      airportPrimary: {
        source_code: "madis_hfmetar",
        source_label: "NOAA MADIS",
        station_code: "ZGGG",
        temp: 28.9,
        obs_time: "2026-06-10T04:55:00Z",
      },
      airportPrimaryTodayObs: [["2026-06-10T04:55:00Z", 28.9]],
      runwayPlateHistory: {
        "02L/20R": [
          { timestamp: "12:51", temp_c: 28, value: 28 },
          { timestamp: "12:55", temp_c: 28.4, value: 28.4 },
        ],
      },
    } as any,
    false,
  );
  assert(
    guangzhouRunwayWithBadMadisChart.series.some((item) => item.key === "runway_02L_20R"),
    "Guangzhou runway history should render the settlement runway line",
  );
  assert(
    !guangzhouRunwayWithBadMadisChart.series.some((item) => item.key === "madis"),
    "AMSC runway cities should not show a redundant NOAA MADIS aggregate series when runway observations are present",
  );

  const chengduDetail = {
    forecastTodayHigh: null,
    debPrediction: 31,
    debQuality: null,
    debHourlyPath: null,
    localDate: "2026-06-10",
    localTime: "13:46",
    times: [],
    temps: [],
    modelCurves: undefined,
    runwayPlateHistory: {
      "02L/20R": [
        { timestamp: "13:35", temp_c: 29.6, value: 29.6 },
        { timestamp: "13:39", temp_c: 29.8, value: 29.8 },
        { timestamp: "13:43", temp_c: 30.4, value: 30.4 },
      ],
    },
    runwayBandHistory: undefined,
    amos: null,
    current: null,
    airportCurrent: { temp: 28, obs_time: "13:00", max_so_far: 28 },
    airportPrimary: { temp: 28, obs_time: "13:00", max_so_far: 28 },
    forecastDaily: [],
    multiModelDaily: {},
    probabilities: null,
    airportPrimaryTodayObs: [["13:00", 28]],
  } as any;
  const staleChengduRow = {
    city: "chengdu",
    local_date: "2026-06-07",
    local_time: "21:37",
    current_temp: 21.0,
    current_max_so_far: 25.0,
    temp_symbol: "°C",
    tz_offset_seconds: 8 * 3600,
    runway_plate_history: {
      "02L/20R": [
        { time: "2026-06-07T13:20:00+00:00", temp: 21.2 },
        { time: "2026-06-07T13:30:00+00:00", temp: 21.4 },
      ],
    },
  } as any;
  const chengduMerged = mergeRowObservationIntoHourly(chengduDetail, staleChengduRow);
  const chengduChart = buildFullDayChartData(
    {
      city: "chengdu",
      local_date: "2026-06-10",
      local_time: "13:46",
      temp_symbol: "°C",
      tz_offset_seconds: 8 * 3600,
    } as any,
    chengduMerged,
    false,
  );
  const chengduSettlementRunway = chengduChart.series.find((item) => item.key === "runway_02L_20R");
  assert(
    chengduSettlementRunway?.values.some((value) => value === 30.4),
    "current-date Chengdu detail runway history should remain visible after receiving a stale scan row",
  );
  assert(
    !chengduSettlementRunway?.values.some((value) => value !== null && value <= 22),
    "stale previous-day Chengdu scan rows must not append a fake latest runway point to current-date detail",
  );
  assert(
    chengduMerged?.airportCurrent?.temp === 28,
    "stale previous-day scan rows must not replace current-date detail airport conditions",
  );

  const shenzhenRow = {
    city: "shenzhen",
    local_date: "2026-06-10",
    local_time: "12:03",
    current_temp: 31.2,
    current_max_so_far: 31.2,
    temp_symbol: "°C",
    tz_offset_seconds: 8 * 3600,
  } as any;
  const shenzhenFullDetail = {
    ...seedChartRenderStateFromRow(shenzhenRow),
    localDate: "2026-06-10",
    localTime: "12:00",
    times: ["10:00", "11:00", "12:00"],
    temps: [28, 30, 31],
    modelTimes: ["10:00", "11:00", "12:00"],
    modelCurves: {
      ECMWF: [28.2, 30.1, 31.1],
      GFS: [27.9, 29.8, 30.9],
    },
    debPrediction: 33,
    debHourlyPath: {
      source: "deb_hourly_consensus",
      times: ["10:00", "11:00", "12:00"],
      temps: [29, 31, 33],
    },
    multiModelDaily: {
      "2026-06-10": {
        deb: { prediction: 33 },
        models: { ECMWF: 33.2, GFS: 32.7 },
      },
    },
  } as any;
  const shenzhenUpdatedRow = {
    ...shenzhenRow,
    local_time: "12:07",
    current_temp: 31.6,
    current_max_so_far: 31.6,
  } as any;
  const shenzhenInitialAfterReturn = selectInitialHourlyForRowChange({
    previousCity: "shenzhen",
    previousHourly: shenzhenFullDetail,
    row: shenzhenUpdatedRow,
  });
  assert(
    shenzhenInitialAfterReturn?.modelCurves?.ECMWF?.length === 3,
    "returning to terminal must keep existing multi-model curves while the detail refresh is pending",
  );
  assert(
    shenzhenInitialAfterReturn?.debHourlyPath?.temps?.includes(33),
    "returning to terminal must keep the existing DEB hourly path while the detail refresh is pending",
  );
  assert(
    shenzhenInitialAfterReturn?.airportCurrent?.temp === 31.6,
    "returning to terminal should still merge the newest scan-row observation into the preserved detail",
  );

  const hongKongCachedDetail = {
    ...seedChartRenderStateFromRow({ ...shenzhenRow, city: "hongkong" } as any),
    localDate: "2026-06-10",
    times: ["10:00", "11:00"],
    temps: [29.5, 30.2],
    modelCurves: { ECMWF: [29.8, 30.5] },
    debPrediction: 31,
    debHourlyPath: {
      source: "deb_hourly_consensus",
      times: ["10:00", "11:00"],
      temps: [30, 31],
    },
  } as any;
  const hongKongRow = {
    ...shenzhenRow,
    city: "hongkong",
    local_time: "12:10",
    current_temp: 30.7,
  } as any;
  const hongKongInitialAfterSelect = selectInitialHourlyForRowChange({
    cachedHourly: hongKongCachedDetail,
    previousCity: "shenzhen",
    previousHourly: shenzhenFullDetail,
    row: hongKongRow,
  });
  assert(
    hongKongInitialAfterSelect?.modelCurves?.ECMWF?.length === 2 &&
      hongKongInitialAfterSelect?.debHourlyPath?.temps?.includes(31),
    "selecting a city with cached detail must render cached multi-model and DEB immediately instead of falling back to an empty row seed",
  );
  assert(
    !hongKongInitialAfterSelect?.modelCurves?.GFS,
    "selecting a different city must not leak the previous city's model curves",
  );

  const uncachedNewCityInitial = selectInitialHourlyForRowChange({
    previousCity: "shenzhen",
    previousHourly: shenzhenFullDetail,
    row: { ...shenzhenRow, city: "tokyo" } as any,
  });
  assert(
    !uncachedNewCityInitial?.modelCurves?.ECMWF &&
      !uncachedNewCityInitial?.debHourlyPath,
    "selecting an uncached different city must not show another city's model and DEB curves",
  );

  const chengduCacheKey = "chengdu:1m";
  _hourlyCache.delete(chengduCacheKey);
  const cachedChengduRow = {
    city: "chengdu",
    local_date: "2026-06-15",
    local_time: "2026-06-15T09:00:00Z",
    current_temp: 26.4,
    current_max_so_far: 26.4,
    temp_symbol: "°C",
    tz_offset_seconds: 8 * 3600,
    metar_context: { source: "amsc_awos" },
  } as any;
  rememberHourlyDetailSnapshot("chengdu", "1m", seedChartRenderStateFromRow(cachedChengduRow) as any);
  assert(
    !_hourlyCache.has(chengduCacheKey),
    "instant-restore cache must not persist a row-only seed that would block the full detail fetch",
  );

  const cachedChengduDetail = toFullChartDetail({
    ...seedChartRenderStateFromRow(cachedChengduRow),
    localDate: "2026-06-15",
    times: ["08:00", "09:00"],
    temps: [25.8, 26.4],
    modelTimes: ["08:00", "09:00"],
    modelCurves: { ECMWF: [26.1, 26.5] },
    debHourlyPath: {
      source: "deb_hourly_consensus",
      times: ["08:00", "09:00"],
      temps: [30.1, 30.9],
    },
    runwayPlateHistory: {
      "02L/20R": [{ timestamp: "2026-06-15T08:55:00Z", temp_c: 26.2 }],
    },
  } as any);
  if (!cachedChengduDetail) throw new Error("test fixture should produce a full chart detail");
  const cachedChengduLivePatch = mergePatchIntoHourly(cachedChengduDetail, {
    city: "chengdu",
    revision: 7,
    changes: {
      temp: 26.8,
      observed_at_utc: "2026-06-15T09:03:00Z",
      runway_points: [{ runway: "02L/20R", temp: 26.8 }],
    },
  } as any);
  const cachedChengduPatchedDetail = toFullChartDetail(cachedChengduLivePatch);
  if (!cachedChengduPatchedDetail) throw new Error("live-merged detail should preserve full chart detail fields");
  rememberHourlyDetailSnapshot("chengdu", "1m", cachedChengduPatchedDetail);
  const restoredChengdu = _hourlyCache.get(chengduCacheKey)?.data;
  assert(
    restoredChengdu?.modelCurves?.ECMWF?.length === 2 &&
      restoredChengdu?.debHourlyPath?.temps?.includes(30.9),
    "instant-restore cache must keep the full DEB and multi-model detail after live merges",
  );
  assert(
    (restoredChengdu?.runwayPlateHistory?.["02L/20R"] || []).length === 2,
    "instant-restore cache must include live-merged runway history so returning to terminal shows it immediately",
  );

  const observationOnlyPayload = {
    city: "chengdu",
    local_date: "2026-06-15",
    local_time: "17:45",
    airport_current: {
      temp: 27.1,
      obs_time: "2026-06-15T17:45:00+08:00",
      source_code: "amsc_awos",
      source_label: "AMSC AWOS",
    },
    airport_primary: {
      temp: 27.1,
      obs_time: "2026-06-15T17:45:00+08:00",
      source_code: "amsc_awos",
      source_label: "AMSC AWOS",
    },
    metar_today_obs: [
      {
        time: "17:45",
        temp: 27.1,
        obs_time: "2026-06-15T17:45:00+08:00",
        source_code: "amsc_awos",
      },
    ],
    runway_plate_history: {
      "02L/20R": [{ time: "2026-06-15T17:45:00+08:00", tdz_temp: 27.1, end_temp: 26.8 }],
    },
  };
  const observationSnapshot = observationPayloadToSnapshot(observationOnlyPayload as any);
  if (!observationSnapshot) throw new Error("test observation payload should produce an observation snapshot");
  const observationMergedChengdu = mergeObservationSnapshotIntoHourly(
    cachedChengduDetail,
    observationSnapshot,
  );
  assert(
    observationMergedChengdu?.airportCurrent?.temp === 27.1 &&
      observationMergedChengdu?.airportPrimary?.source_code === "amsc_awos",
    "observation endpoint snapshot should update the current observation block",
  );
  assert(
    observationMergedChengdu?.modelCurves?.ECMWF?.length === 2 &&
      observationMergedChengdu?.debHourlyPath?.temps?.includes(30.9),
    "observation endpoint snapshot must not clear DEB or multi-model chart detail",
  );
  assert(
    (observationMergedChengdu?.runwayPlateHistory?.["02L/20R"] || []).length === 2,
    "observation endpoint snapshot should append fresh runway history onto cached detail history",
  );

  _hourlyCache.clear();
  for (let i = 0; i < 180; i += 1) {
    const row = {
      city: `cache-city-${i}`,
      local_date: "2026-06-15",
      local_time: "2026-06-15T09:00:00Z",
      current_temp: 20 + i / 100,
      current_max_so_far: 20 + i / 100,
      temp_symbol: "°C",
      tz_offset_seconds: 0,
    } as any;
    const cacheDetail = toFullChartDetail({
      ...seedChartRenderStateFromRow(row),
      times: ["09:00"],
      temps: [20 + i / 100],
      modelTimes: ["09:00"],
      modelCurves: { ECMWF: [20 + i / 100] },
    } as any);
    if (cacheDetail) rememberHourlyDetailSnapshot(`cache-city-${i}`, "10m", cacheDetail);
  }
  assert(
    _hourlyCache.size <= 160,
    "hourly detail memory cache must be bounded so many mounted chart instances cannot leak entries indefinitely",
  );
  assert(
    !_hourlyCache.has("cachecity0:10m") && _hourlyCache.has("cachecity179:10m"),
    "hourly detail memory cache should evict oldest entries first while retaining the newest chart detail",
  );
}
