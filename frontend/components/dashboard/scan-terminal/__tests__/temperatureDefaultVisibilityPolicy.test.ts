import {
  __buildTemperatureChartDataForTest,
  __getObservationDisplayMetricsForTest,
  __getVisibleTemperatureSeriesForTest,
  __isTemperatureSeriesVisibleByDefaultForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function seriesByKey(series: Array<{ key: string }>, key: string) {
  return series.find((item) => item.key === key);
}

export function runTests() {
  const guangzhou = {
    city: "guangzhou",
    local_date: "2026-05-25",
    local_time: "10:00",
    tz_offset_seconds: 8 * 60 * 60,
    airport: "ZGGG",
    deb_prediction: 31,
    runway_plate_history: {
      "02L/20R": [
        { time: "00:05", temp: 29.1 },
        { time: "00:35", temp: 29.3 },
      ],
      "01L/19R": [
        { time: "00:05", temp: 28.7 },
        { time: "00:35", temp: 28.9 },
      ],
    },
    settlement_today_obs: [
      { time: "00:05", temp: 29.0 },
      { time: "00:35", temp: 29.2 },
    ],
    metar_today_obs: [
      { time: "00:05", temp: 28.0 },
      { time: "00:35", temp: 28.5 },
    ],
  } as any;

  const hourly = {
    localTime: "10:00",
    times: ["00:00", "00:30"],
    temps: [29, 30],
    modelCurves: {
      ECMWF: [30.1, 30.2],
      GFS: [29.7, 29.9],
    },
  } as any;

  const { series } = __buildTemperatureChartDataForTest(guangzhou, hourly, "1D");
  const defaultVisibleSeries = __getVisibleTemperatureSeriesForTest("guangzhou", series, {});

  const settlementRunway = seriesByKey(series, "runway_02L_20R") as any;
  assert(settlementRunway, "settlement runway should use a stable runway-pair key");
  assert(settlementRunway.label.includes("结算跑道"), "settlement runway should be labeled as settlement runway");
  assert(settlementRunway.color === "#009688", "settlement runway should use the highlight cyan color");
  assert(settlementRunway.featured === true, "settlement runway should be featured");
  assert(!settlementRunway.dashed, "settlement runway should be solid");

  const auxiliaryRunway = seriesByKey(series, "runway_01L_19R") as any;
  assert(auxiliaryRunway, "auxiliary runway should be displayed by default in the chart data");
  assert(auxiliaryRunway.dashed === true, "auxiliary runway should be dashed");
  assert(auxiliaryRunway.featured !== true, "auxiliary runway should not be featured");

  assert(seriesByKey(series, "settlement"), "settlement/HKO observation series should still be present when runway data exists");
  assert(seriesByKey(series, "metar"), "METAR observation series should be present by its own key");

  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "runway_02L_20R"),
    "runway series should be visible by default",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "settlement"),
    "settlement/HKO observations should be visible by default",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "metar"),
    "METAR observations should be visible by default",
  );
  assert(
    !__isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "model_curve_ECMWF"),
    "multi-model curves should be hidden by default",
  );
  assert(
    !defaultVisibleSeries.some((item) => item.key === "model_curve_ECMWF"),
    "hidden multi-model curves should not affect the active chart series by default",
  );
  assert(
    __getVisibleTemperatureSeriesForTest("guangzhou", series, { model_curve_ECMWF: true }).some(
      (item) => item.key === "model_curve_ECMWF",
    ),
    "users should still be able to enable a hidden multi-model curve from the legend",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("paris", "model_curve_AROME HD"),
    "Paris AROME HD should be the only default-visible model curve exception",
  );

  const shenzhen = __buildTemperatureChartDataForTest(
    {
      city: "shenzhen",
      local_date: "2026-05-25",
      local_time: "10:00",
      tz_offset_seconds: 8 * 60 * 60,
      metar_context: {
        station: "Lau Fau Shan",
        station_label: "HKO Lau Fau Shan",
        today_obs: [
          { time: "00:05", temp: 28.4 },
          { time: "00:35", temp: 28.5 },
        ],
      },
    } as any,
    null,
    "1D",
  );
  assert(seriesByKey(shenzhen.series, "metar"), "Shenzhen/Lau Fau Shan observations should stay as METAR/HKO observations, not runway data");
  assert(!shenzhen.series.some((item) => item.key.startsWith("runway_")), "Shenzhen should not be treated as an AMSC runway city");

  const chengduFromAmosSnapshot = __buildTemperatureChartDataForTest(
    {
      city: "chengdu",
      local_date: "2026-05-26",
      local_time: "05:25",
      tz_offset_seconds: 8 * 60 * 60,
      airport: "ZUUU",
    } as any,
    {
      localTime: "05:25",
      times: ["00:00", "06:00", "12:00", "18:00"],
      temps: [24, 28, 31, 27],
      amos: {
        observation_time: "2026-05-25T21:25:00+00:00",
        observation_time_local: "2026-05-26 05:25:00",
        runway_obs: {
          runway_pairs: [
            ["02L", "20R"],
            ["02R", "20L"],
          ],
          temperatures: [
            [24.4, null],
            [24.2, null],
          ],
          point_temperatures: [
            { runway: "02L/20R", tdz_temp: 24.4, mid_temp: null, end_temp: 24.8 },
            { runway: "02R/20L", tdz_temp: 24.2, mid_temp: null, end_temp: 24.6 },
          ],
        },
      },
    } as any,
    "1D",
  );

  const chengduSettlementRunway = seriesByKey(chengduFromAmosSnapshot.series, "runway_02L_20R") as any;
  assert(chengduSettlementRunway, "AMOS runway_obs snapshot should still create the settlement runway chart line");
  assert(chengduSettlementRunway.color === "#009688", "AMOS snapshot settlement runway should use highlight cyan");
  assert(chengduSettlementRunway.featured === true, "AMOS snapshot settlement runway should be featured");
  assert(!chengduSettlementRunway.dashed, "AMOS snapshot settlement runway should be solid");

  const chengduAuxRunway = seriesByKey(chengduFromAmosSnapshot.series, "runway_02R_20L") as any;
  assert(chengduAuxRunway, "AMOS runway_obs snapshot should create auxiliary runway chart lines");
  assert(chengduAuxRunway.dashed === true, "AMOS snapshot auxiliary runway should be dashed");

  const newYorkMetrics = __getObservationDisplayMetricsForTest(
    {
      city: "new york",
      local_date: "2026-05-25",
      local_time: "17:30",
      tz_offset_seconds: -4 * 60 * 60,
      current_temp: 0,
      current_max_so_far: 0,
      metar_context: {
        airport_max_so_far: 0,
      },
    } as any,
    {
      localTime: "17:30",
      times: ["00:00"],
      temps: [55],
      airportCurrent: {
        temp: 73.9,
        max_so_far: 73.9,
      },
      metarTodayObs: [
        { time: "16:51", temp: 73.9 },
        { time: "15:51", temp: 73.0 },
        { time: "00:34", temp: 55.0 },
      ],
    } as any,
    null,
  );

  assert(newYorkMetrics.currentRunwayTemp === 73.9, "weather-station header should use detail METAR/current temp before stale row zero");
  assert(newYorkMetrics.observedHighMetar === 73.9, "METAR high header should use detail METAR high before stale row zero");

  const newYorkWithMadis = __buildTemperatureChartDataForTest(
    {
      city: "new york",
      local_date: "2026-05-25",
      local_time: "17:30",
      tz_offset_seconds: -4 * 60 * 60,
      airport: "KLGA",
    } as any,
    {
      localTime: "17:30",
      times: ["00:00", "06:00", "12:00", "18:00"],
      temps: [55, 57, 65, 72],
      airportPrimary: {
        source_code: "madis_hfmetar",
        source_label: "NOAA MADIS",
      },
      airportPrimaryTodayObs: [
        ["16:51", 73.9],
        ["15:51", 73],
        ["15:47", 71.6],
        ["15:44", 72],
      ],
      metarTodayObs: [{ time: "16:51", temp: 73.9 }],
    } as any,
    "1D",
  );
  const madisSeries = seriesByKey(newYorkWithMadis.series, "madis") as any;
  assert(madisSeries, "US MADIS airport-primary observations should render as a dedicated chart series");
  assert(madisSeries.label.includes("MADIS"), "US MADIS series should be labeled as NOAA MADIS instead of plain METAR");
  assert(madisSeries.values.filter((value: number | null) => value !== null).length >= 2, "MADIS series should keep sub-hourly observations");
}
