import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";
import {
  buildFullDayChartData,
  mergeHourlyWithLiveObservations,
  mergePatchIntoHourly,
  mergeRowObservationIntoHourly,
  seedHourlyForecastFromRow,
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
  const seededGuangzhou = seedHourlyForecastFromRow(guangzhouRow);
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
}
