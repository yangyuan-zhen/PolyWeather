import {
  __buildTemperatureChartDataForTest,
  __getActiveTemperatureSeriesForTest,
  __getDebPeakWindowRangeForTest,
  __getLiveObservationLabelsForTest,
  __getObservationDisplayMetricsForTest,
  __getPeakGlowStateForTest,
  __getVisibleTemperatureSeriesForTest,
  __isTemperatureSeriesVisibleByDefaultForTest,
  __mergePatchIntoHourlyForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function seriesByKey(series: Array<{ key: string }>, key: string) {
  return series.find((item) => item.key === key);
}

function runwayKey(rwy: string) {
  return `runway_${rwy.split("/").map((part) => part.trim().toUpperCase()).join("_")}`;
}

export function runTests() {
  const peakGlowSeries = [
    {
      key: "madis",
      label: "METAR",
      source: "METAR",
      color: "#0284c7",
      values: [26.0, 30.35, 30.4, null],
    },
  ] as any;
  const peakGlowData = [
    { ts: Date.UTC(2026, 4, 27, 10, 0), hourly_forecast: 26, madis: 26.0 },
    { ts: Date.UTC(2026, 4, 27, 11, 0), hourly_forecast: 29, madis: 30.35 },
    { ts: Date.UTC(2026, 4, 27, 12, 0), hourly_forecast: 32, madis: 30.4 },
    { ts: Date.UTC(2026, 4, 27, 13, 0), hourly_forecast: 32, madis: null },
  ] as any;

  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°C", current_max_so_far: 30.5 } as any, peakGlowData, peakGlowSeries).state === "near_peak",
    "city chart should enter near-peak glow from observed daily high proximity without requiring a DEB curve",
  );
  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°C", current_max_so_far: 30.6 } as any, peakGlowData, [
      { ...peakGlowSeries[0], values: [26.0, 29.75, 29.8, null] },
    ] as any).state === "watch",
    "city chart should enter watch glow when live temperature is near the observed daily high but not close enough for near-peak",
  );
  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°C" } as any, peakGlowData, [
      { ...peakGlowSeries[0], values: [26.0, 29.0, 30.4, null] },
    ] as any).state === "breakout",
    "city chart should use breakout glow when live observations print a new intraday high without referencing DEB",
  );
  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°C" } as any, [
      { ts: Date.UTC(2026, 4, 27, 10, 0), hourly_forecast: 26, madis: 26.0 },
      { ts: Date.UTC(2026, 4, 27, 11, 0), hourly_forecast: 30, madis: 30.0 },
      { ts: Date.UTC(2026, 4, 27, 12, 0), hourly_forecast: 32, madis: 31.8 },
      { ts: Date.UTC(2026, 4, 27, 13, 0), hourly_forecast: 30, madis: 30.8 },
      { ts: Date.UTC(2026, 4, 27, 14, 0), hourly_forecast: 27, madis: 30.2 },
    ] as any, [
      { ...peakGlowSeries[0], values: [26.0, 30.0, 31.8, 30.8, 30.2] },
    ] as any).state === "cooling",
    "city chart should show cooling state from observed rollover without using the DEB forecast curve",
  );
  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°F", current_max_so_far: 88 } as any, peakGlowData, [
      { ...peakGlowSeries[0], values: [80, 86.3, 86.4, null] },
    ] as any).state === "watch",
    "US Fahrenheit charts should convert Celsius thresholds against observed highs before deciding peak glow state",
  );
  assert(
    __getPeakGlowStateForTest({ temp_symbol: "°C", current_max_so_far: 25.0 } as any, [
      { ts: Date.UTC(2026, 4, 27, 0, 0), hourly_forecast: 22.0, runway: 25.0 },
      { ts: Date.UTC(2026, 4, 27, 4, 0), hourly_forecast: 21.6, runway: 24.4 },
      { ts: Date.UTC(2026, 4, 27, 8, 12), hourly_forecast: 22.1, runway: 25.0 },
      { ts: Date.UTC(2026, 4, 27, 12, 0), hourly_forecast: 26.8, runway: null },
      { ts: Date.UTC(2026, 4, 27, 15, 0), hourly_forecast: 28.0, runway: null },
      { ts: Date.UTC(2026, 4, 27, 18, 0), hourly_forecast: 25.0, runway: null },
    ] as any, [
      {
        key: "runway_20R_02L",
        label: "20R/02L",
        source: "Runway",
        color: "#009688",
        values: [25.0, 24.4, 25.0, null, null, null],
      },
      {
        key: "hourly_forecast",
        label: "DEB Forecast",
        source: "DEB Hourly",
        color: "#f97316",
        values: [22.0, 21.6, 22.1, 26.8, 28.0, 25.0],
      },
    ] as any).state === "none",
    "morning observations near the intraday observed high should not trigger peak glow before the forecast hot window",
  );

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
  const activeDefaultSeries = __getActiveTemperatureSeriesForTest("guangzhou", series, {}, true);

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
    activeDefaultSeries.some((item) => item.key === "runway_02L_20R"),
    "settlement runway should remain in the active chart series by default",
  );
  assert(
    activeDefaultSeries.some((item) => item.key === "runway_01L_19R"),
    "auxiliary runway should remain in the active chart series by default",
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
    defaultVisibleSeries.some((item) => item.key === "hourly_forecast"),
    "DEB fusion forecast should be visible by default",
  );

  const debPeakWindowChart = __buildTemperatureChartDataForTest(
    {
      city: "beijing",
      local_date: "2026-05-26",
      local_time: "12:00",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 35,
    } as any,
    {
      localTime: "12:00",
      times: [
        "00:00", "01:00", "02:00", "03:00", "04:00", "05:00",
        "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
        "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
        "18:00", "19:00", "20:00", "21:00", "22:00", "23:00",
      ],
      temps: [
        20, 20.5, 21, 21.5, 22, 23,
        24, 25, 26, 27, 29, 31,
        32, 33, 34.2, 35, 34.4, 33.3,
        31.8, 30.2, 28.5, 27, 25.5, 24,
      ],
      debPrediction: 35,
    } as any,
    "1D",
  );
  const debPeakWindowRange = __getDebPeakWindowRangeForTest(
    debPeakWindowChart.data,
    debPeakWindowChart.series as any,
  );
  assert(debPeakWindowRange, "default chart view should derive an auto high-temperature window from the DEB curve");
  const debPeakWindowRows = debPeakWindowChart.data.slice(debPeakWindowRange![0], debPeakWindowRange![1] + 1);
  const debPeakWindowStart = debPeakWindowRows[0].ts;
  const debPeakWindowEnd = debPeakWindowRows[debPeakWindowRows.length - 1].ts;
  assert(
    debPeakWindowStart <= Date.UTC(2026, 4, 26, 11, 0, 0) &&
      debPeakWindowEnd >= Date.UTC(2026, 4, 26, 19, 0, 0),
    "DEB peak auto window should cover roughly peak -4h through peak +4h by default",
  );
  assert(
    debPeakWindowEnd - debPeakWindowStart <= 12 * 60 * 60 * 1000,
    "DEB peak auto window should not expand beyond 12 hours",
  );

  const postPeakWindowChart = __buildTemperatureChartDataForTest(
    {
      city: "beijing",
      local_date: "2026-05-26",
      local_time: "21:10",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 35,
      runway_plate_history: {
        "19/01": [
          { time: "2026-05-26T10:00:00+08:00", temp: 29.8 },
          { time: "2026-05-26T15:00:00+08:00", temp: 34.9 },
          { time: "2026-05-26T21:00:00+08:00", temp: 28.6 },
        ],
      },
    } as any,
    {
      localTime: "21:10",
      times: [
        "00:00", "01:00", "02:00", "03:00", "04:00", "05:00",
        "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
        "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
        "18:00", "19:00", "20:00", "21:00", "22:00", "23:00",
      ],
      temps: [
        20, 20.5, 21, 21.5, 22, 23,
        24, 25, 26, 27, 29, 31,
        32, 33, 34.2, 35, 34.4, 33.3,
        31.8, 30.2, 28.5, 27, 25.5, 24,
      ],
      debPrediction: 35,
    } as any,
    "1D",
  );
  const postPeakWindowRange = __getDebPeakWindowRangeForTest(
    postPeakWindowChart.data,
    postPeakWindowChart.series as any,
  );
  assert(postPeakWindowRange, "post-peak default chart view should still derive from the DEB peak window");
  const postPeakWindowRows = postPeakWindowChart.data.slice(postPeakWindowRange![0], postPeakWindowRange![1] + 1);
  const postPeakWindowStart = postPeakWindowRows[0].ts;
  const postPeakWindowEnd = postPeakWindowRows[postPeakWindowRows.length - 1].ts;
  assert(
    postPeakWindowEnd >= Date.UTC(2026, 4, 26, 21, 0, 0),
    "After the peak window, default high-temperature view should extend to the latest live observation",
  );
  assert(
    postPeakWindowEnd - postPeakWindowStart <= 12 * 60 * 60 * 1000,
    "Post-peak high-temperature view should keep a bounded 12-hour window",
  );

  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("paris", "model_curve_AROME HD"),
    "Paris AROME HD should be the only default-visible model curve exception",
  );
  assert(
    __getVisibleTemperatureSeriesForTest(
      "paris",
      [{ key: "model_curve_AROME HD" }, { key: "model_curve_ECMWF" }] as any,
      {},
    ).some((item) => item.key === "model_curve_AROME HD"),
    "Paris AROME HD should be active in the default visible series",
  );

  const settlementRunwayCases = [
    ["beijing", "19/01"],
    ["shanghai", "17L/35R"],
    ["guangzhou", "02L/20R"],
    ["chengdu", "02L/20R"],
    ["chongqing", "20R/02L"],
    ["wuhan", "04/22"],
    ["seoul", "15R/33L"],
  ] as const;
  settlementRunwayCases.forEach(([city, settlementRwy]) => {
    const chart = __buildTemperatureChartDataForTest(
      {
        city,
        local_date: "2026-05-25",
        local_time: "10:00",
        tz_offset_seconds: 8 * 60 * 60,
        runway_plate_history: {
          [settlementRwy]: [
            { time: "00:05", temp: 25.1 },
            { time: "00:35", temp: 25.3 },
          ],
          "99/00": [
            { time: "00:05", temp: 24.1 },
            { time: "00:35", temp: 24.3 },
          ],
        },
      } as any,
      { localTime: "10:00", times: ["00:00", "00:30"], temps: [25, 26] } as any,
      "1D",
    );
    const highlighted = seriesByKey(chart.series, runwayKey(settlementRwy)) as any;
    assert(highlighted, `${city} settlement runway should be present`);
    assert(highlighted.label.includes("结算跑道"), `${city} settlement runway should be labeled`);
    assert(highlighted.color === "#009688", `${city} settlement runway should use highlight cyan`);
    assert(highlighted.featured === true, `${city} settlement runway should be featured`);
    assert(!highlighted.dashed, `${city} settlement runway should be solid`);
    const auxiliary = seriesByKey(chart.series, "runway_99_00") as any;
    assert(auxiliary?.dashed === true, `${city} auxiliary runway should be dashed`);
  });

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

  const shenzhenAirportPrimaryHko = __buildTemperatureChartDataForTest(
    {
      city: "shenzhen",
      local_date: "2026-05-27",
      local_time: "07:55",
      tz_offset_seconds: 8 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "07:55",
      times: ["10:00", "14:00", "18:00"],
      temps: [30.2, 31.8, 30.7],
      airportPrimary: {
        source_code: "hko",
        source_label: "HKO",
        temp: 29.9,
        obs_time: "2026-05-26T23:55:00Z",
      },
      airportPrimaryTodayObs: [
        ["2026-05-26T23:15:00Z", 29.5],
        ["2026-05-26T23:25:00Z", 29.7],
        ["2026-05-26T23:35:00Z", 29.9],
      ],
    } as any,
    "1D",
  );
  const shenzhenHkoSeries = seriesByKey(shenzhenAirportPrimaryHko.series, "settlement") as any;
  assert(shenzhenHkoSeries?.label === "HKO", "Shenzhen airport-primary HKO history should render as the HKO observation series");
  assert(
    shenzhenHkoSeries.values.filter((value: number | null) => value !== null).length >= 2,
    "Shenzhen HKO observation series should include the airportPrimaryTodayObs curve points",
  );

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

  const shanghaiWithEmptyRunwayHistory = __buildTemperatureChartDataForTest(
    {
      city: "shanghai",
      local_date: "2026-05-27",
      local_time: "07:59",
      tz_offset_seconds: 8 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "07:59",
      times: ["10:00", "14:00", "18:00"],
      temps: [25, 28, 24],
      runwayPlateHistory: {},
      amos: {
        observation_time_local: "2026-05-27 07:59:00",
        runway_obs: {
          runway_pairs: [
            ["35R", "17L"],
            ["34L", "16R"],
          ],
          temperatures: [
            [25.8],
            [25.4],
          ],
          point_temperatures: [
            { runway: "35R/17L", tdz_temp: 25.8, mid_temp: null, end_temp: 26.2 },
            { runway: "34L/16R", tdz_temp: 25.4, mid_temp: null, end_temp: 25.7 },
          ],
        },
      },
    } as any,
    "1D",
  );
  assert(
    seriesByKey(shanghaiWithEmptyRunwayHistory.series, runwayKey("35R/17L")),
    "empty runwayPlateHistory should fall back to AMOS runway_obs so runway cities still draw runway curves",
  );

  const busanWithRunwayHistory = __buildTemperatureChartDataForTest(
    {
      city: "busan",
      local_date: "2026-05-27",
      local_time: "08:20",
      tz_offset_seconds: 9 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "08:20",
      times: ["00:00", "12:00", "18:00", "23:00"],
      temps: [19.6, 21.1, 20.0, 19.0],
      airportPrimary: {
        source_code: "amos",
        source_label: "AMOS",
        temp: 21.0,
        obs_time: "2026-05-26T23:20:00Z",
      },
      airportPrimaryTodayObs: [
        ["2026-05-26T23:19:00Z", 21.0],
        ["2026-05-26T23:20:00Z", 21.0],
      ],
      runwayPlateHistory: {
        "SR/SL": [
          { time: "2026-05-26T23:19:00Z", temp: 20.9 },
          { time: "2026-05-26T23:20:00Z", temp: 21.1 },
        ],
      },
    } as any,
    "1D",
  );
  assert(
    !seriesByKey(busanWithRunwayHistory.series, "madis"),
    "Busan should not render the AMOS aggregate airport-primary series when runway sensor data is available",
  );
  const busanRunway = seriesByKey(busanWithRunwayHistory.series, runwayKey("SR/SL")) as any;
  assert(busanRunway, "Busan SR/SL runway history should render as the runway curve");
  assert(busanRunway.featured === true, "Busan SR/SL should be treated as the settlement runway");
  assert(busanRunway.label.includes("结算跑道"), "Busan SR/SL should be labeled as the settlement runway");

  const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  let busanUtcPointLabel: string | null = null;
  try {
    Date.prototype.getTimezoneOffset = function () {
      return -8 * 60;
    };
    const busanUtcTimestampChart = __buildTemperatureChartDataForTest(
      {
        city: "busan",
        local_date: "2026-05-27",
        local_time: "09:58",
        tz_offset_seconds: 9 * 60 * 60,
        temp_symbol: "°C",
      } as any,
      {
        localTime: "09:58",
        times: ["00:00", "12:00", "18:00", "23:00"],
        temps: [19.6, 21.1, 20.0, 19.0],
        runwayPlateHistory: {
          "SR/SL": [
            { time: "2026-05-27T00:57:00Z", temp: 21.4 },
            { time: "2026-05-27T00:58:00Z", temp: 21.5 },
          ],
        },
      } as any,
      "1D",
    );
    busanUtcPointLabel =
      (busanUtcTimestampChart.data.find((point: any) => point[runwayKey("SR/SL")] === 21.5) as any)?.label || null;
  } finally {
    Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
  }
  assert(
    busanUtcPointLabel === "09:58:00",
    "UTC runway observation timestamps should render at the city-local time regardless of the browser timezone",
  );

  const busanMergedHourly = __mergePatchIntoHourlyForTest(
    {
      localTime: "08:19",
      times: ["00:00", "12:00", "18:00", "23:00"],
      temps: [19.6, 21.1, 20.0, 19.0],
      runwayPlateHistory: {
        "SR/SL": [{ time: "2026-05-26T23:19:00Z", temp: 20.9 }],
      },
    } as any,
    {
      type: "city_observation_patch.v1",
      city: "busan",
      revision: 21,
      changes: {
        temp: 21.1,
        obs_time: "2026-05-26T23:20:00Z",
        source: "amos",
        amos: {
          source: "amos",
          icao: "RKPK",
          runway_obs: {
            runway_pairs: [["S R", "S L"]],
            temperatures: [[21.1, 12.4]],
          },
        },
      },
    } as any,
  );
  const busanMergedChart = __buildTemperatureChartDataForTest(
    {
      city: "busan",
      local_date: "2026-05-27",
      local_time: "08:20",
      tz_offset_seconds: 9 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    busanMergedHourly as any,
    "1D",
  );
  const busanMergedRunway = seriesByKey(busanMergedChart.series, runwayKey("SR/SL")) as any;
  assert(busanMergedRunway, "AMOS runway_obs patch should append Busan SR/SL into runway history");
  assert(
    busanMergedRunway.values.some((value: number | null) => value === 21.1),
    "AMOS runway_obs patch should use the runway temperature, not ignore the SR/SL point",
  );

  const busanSnapshotWithLocalAndUtc = __buildTemperatureChartDataForTest(
    {
      city: "busan",
      local_date: "2026-05-27",
      local_time: "09:58",
      tz_offset_seconds: 9 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "09:58",
      times: ["00:00", "12:00", "18:00", "23:00"],
      temps: [19.6, 21.1, 20.0, 19.0],
      amos: {
        source: "amos",
        observation_time: "2026-05-27T00:58:00Z",
        observation_time_local: "2026-05-27 09:58:00",
        runway_obs: {
          runway_pairs: [["S R", "S L"]],
          temperatures: [[21.5, 12.4]],
        },
      },
    } as any,
    "1D",
  );
  const busanSnapshotLabels = busanSnapshotWithLocalAndUtc.data
    .filter((point: any) => point[runwayKey("SR/SL")] === 21.5)
    .map((point: any) => point.label);
  assert(
    busanSnapshotLabels.includes("09:58:00"),
    "AMOS snapshot fallback should prefer UTC observation_time over naive observation_time_local for chart positioning",
  );

  const busanCurrentOnly = __buildTemperatureChartDataForTest(
    {
      city: "busan",
      local_date: "2026-05-27",
      local_time: "08:20",
      tz_offset_seconds: 9 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "08:20",
      times: ["00:00", "12:00", "18:00", "23:00"],
      temps: [19.6, 21.1, 20.0, 19.0],
      amos: {
        source: "amos",
        observation_time: "2026-05-26T23:20:00Z",
        runway_obs: {
          runway_pairs: [["S R", "S L"]],
          temperatures: [[21.1, 12.4]],
        },
      },
    } as any,
    "1D",
  );
  const busanCurrentRunway = seriesByKey(busanCurrentOnly.series, runwayKey("SR/SL")) as any;
  const busanCurrentValues = (busanCurrentRunway?.values || []).filter((value: number | null) => value !== null);
  assert(
    !busanCurrentValues.includes(12.4),
    "AMOS temp/dew tuples should not be misread as two runway temperature samples",
  );

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

  const istanbulLabels = __getLiveObservationLabelsForTest(
    {
      city: "istanbul",
      airport: "LTFM",
      metar_context: {
        source: "mgm",
        station_label: "MGM Istanbul Airport",
      },
    } as any,
    null,
  );
  assert(
    istanbulLabels.runwayHeaderLabel === "气象站实测",
    "Istanbul/MGM should be labeled as weather-station observations, not runway observations",
  );
  assert(
    istanbulLabels.runwayHighLabel === "气象站",
    "Istanbul/MGM high label should be weather station",
  );

  const panamaLabels = __getLiveObservationLabelsForTest(
    {
      city: "panama city",
      airport: "MPMG",
      metar_context: {
        source: "metar",
        station: "MPMG",
        station_label: "MPMG METAR",
      },
    } as any,
    null,
  );
  assert(
    panamaLabels.runwayHeaderLabel === "机场报文",
    "Panama City/MPMG should be labeled as an airport METAR report when no station or runway sensor feed exists",
  );
  assert(
    panamaLabels.runwayHighLabel === "机场报文",
    "Panama City high label should use airport METAR report wording, not weather-station or runway wording",
  );

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
        ["2026-05-25T16:51", 73.9],
        ["2026-05-25T15:51", 73],
        ["2026-05-25T15:47", 71.6],
        ["2026-05-25T15:44", 72],
      ],
      metarTodayObs: [{ time: "2026-05-25T16:51", temp: 73.9 }],
    } as any,
    "1D",
  );
  const madisSeries = seriesByKey(newYorkWithMadis.series, "madis") as any;
  assert(madisSeries, "US MADIS airport-primary observations should render as a dedicated chart series");
  assert(madisSeries.label.includes("MADIS"), "US MADIS series should be labeled as NOAA MADIS instead of plain METAR");
  assert(madisSeries.values.filter((value: number | null) => value !== null).length >= 2, "MADIS series should keep sub-hourly observations");

  const torontoWithLatestAirportReport = __buildTemperatureChartDataForTest(
    {
      city: "toronto",
      local_date: "2026-05-27",
      local_time: "19:16",
      tz_offset_seconds: -4 * 60 * 60,
      airport: "CYYZ",
      temp_symbol: "°C",
    } as any,
    {
      localTime: "19:16",
      times: ["10:00", "13:00", "16:00", "19:00"],
      temps: [23, 26, 27, 26],
      airportPrimary: {
        source_code: "metar",
        source_label: "METAR",
        temp: 26,
        obs_time: "2026-05-27T23:16:00Z",
      },
      airportPrimaryTodayObs: [
        ["2026-05-27T21:00:00Z", 27],
        ["2026-05-27T22:00:00Z", 28],
        ["2026-05-27T23:00:00Z", 27],
      ],
    } as any,
    "1D",
  );
  const latestAirportPoint = torontoWithLatestAirportReport.data.find(
    (point) => point.label === "19:16:00" && point.madis === 26,
  );
  assert(
    latestAirportPoint,
    "latest airport/METAR report should be appended to the live chart series even when history stops earlier",
  );

  const torontoCanonicalPatchHourly = __mergePatchIntoHourlyForTest(
    {
      localTime: "19:15",
      localDate: "2026-05-27",
      times: ["10:00", "13:00", "16:00", "19:00"],
      temps: [23, 26, 27, 26],
      airportPrimaryTodayObs: [],
    } as any,
    {
      type: "city_observation_patch.v1",
      city: "toronto",
      revision: 13,
      changes: {
        temp: 26,
        source: "metar",
        observed_at_utc: "2026-05-27T23:16:00Z",
        observed_at_local: "2026-05-27T19:16:00-04:00",
        city_local_date: "2026-05-27",
        city_timezone: "America/Toronto",
      },
    } as any,
  );
  assert(
    torontoCanonicalPatchHourly,
    "v1 canonical patch should merge into hourly forecast",
  );
  const torontoCanonicalPatchChart = __buildTemperatureChartDataForTest(
    {
      city: "toronto",
      local_date: "2026-05-27",
      local_time: "19:16",
      tz_offset_seconds: -4 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    torontoCanonicalPatchHourly as any,
    "1D",
  );
  assert(
    torontoCanonicalPatchHourly.localDate === "2026-05-27",
    "v1 canonical patch should update hourly localDate from city_local_date",
  );
  assert(
    torontoCanonicalPatchChart.data.some((point) => point.label === "19:16:00" && point.madis === 26),
    "v1 canonical patch observed_at_utc should render at the city-local chart time",
  );

  const newYorkMinuteStream = __buildTemperatureChartDataForTest(
    {
      city: "new york",
      local_date: "2026-05-25",
      local_time: "10:04",
      tz_offset_seconds: -4 * 60 * 60,
      airport: "KLGA",
    } as any,
    {
      localTime: "10:04",
      times: ["00:00", "06:00", "12:00", "18:00"],
      temps: [55, 57, 65, 72],
      airportPrimary: {
        source_code: "madis_hfmetar",
        source_label: "NOAA MADIS",
      },
      airportPrimaryTodayObs: [
        ["2026-05-25T14:01:00Z", 73.1],
        ["2026-05-25T14:02:00Z", 73.4],
        ["2026-05-25T14:03:00Z", 73.8],
      ],
    } as any,
    "1D",
  );
  assert(
    newYorkMinuteStream.data.length < 120,
    "1D live chart should use real timestamp rows instead of preallocating 1440 empty full-day minute slots",
  );
  const minuteLabels = newYorkMinuteStream.data
    .filter((point) => point.madis !== null)
    .map((point) => point.label);
  assert(
    minuteLabels.includes("10:01:00") &&
      minuteLabels.includes("10:02:00") &&
      minuteLabels.includes("10:03:00"),
    "live observation chart should preserve real observation timestamps on the x-axis",
  );

  const longLivedSingleObservation = __buildTemperatureChartDataForTest(
    {
      city: "ankara",
      local_date: "2026-05-26",
      local_time: "14:28",
      tz_offset_seconds: 3 * 60 * 60,
      current_temp: 21.9,
      current_max_so_far: 21.9,
      airport: "LTAC",
    } as any,
    {
      localTime: "14:28",
      times: [],
      temps: [],
      airportPrimary: {
        source_code: "mgm",
        source_label: "MGM",
        temp: 21.9,
        max_so_far: 21.9,
      },
      airportPrimaryTodayObs: [["2026-05-26T11:28:00Z", 21.9]],
    } as any,
    "1D",
  );
  assert(
    longLivedSingleObservation.series.some(
      (item) => item.key === "current" && item.values.filter((value: number | null) => value !== null).length >= 2,
    ),
    "long-lived chart with only one fresh observation should keep a renderable current reference line instead of an invisible single-point series",
  );

  const chengduMergedHourly = __mergePatchIntoHourlyForTest(
    {
      localTime: "05:25",
      times: ["00:00", "06:00", "12:00", "18:00"],
      temps: [24, 28, 31, 27],
      runwayPlateHistory: {
        "02L/20R": [{ time: "05:20", temp: 24.2 }],
      },
    } as any,
    {
      type: "city_observation_patch.v1",
      city: "chengdu",
      revision: 12,
      changes: {
        temp: 24.8,
        obs_time: "2026-05-26 05:26:00",
        source: "amsc_awos",
        runway_points: [
          {
            runway: "02L/20R",
            temp: 25.1,
            tdz_temp: 24.7,
            mid_temp: 24.9,
            end_temp: 25.1,
            target_runway_max: 25.1,
          },
        ],
      },
    } as any,
  );
  const chengduMergedChart = __buildTemperatureChartDataForTest(
    {
      city: "chengdu",
      local_date: "2026-05-26",
      local_time: "05:26",
      tz_offset_seconds: 8 * 60 * 60,
    } as any,
    chengduMergedHourly as any,
    "1D",
  );
  const chengduMergedRunway = seriesByKey(chengduMergedChart.series, "runway_02L_20R") as any;
  assert(chengduMergedRunway, "v1 runway_points patch should update the runway series");
  assert(
    chengduMergedRunway.values.some((value: number | null) => value === 25.1),
    "v1 runway_points patch should append the latest runway max point to the chart",
  );

  const shanghaiDebFromDetail = __buildTemperatureChartDataForTest(
    {
      city: "shanghai",
      local_date: "2026-05-26",
      local_time: "14:00",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 0,
    } as any,
    {
      localTime: "14:00",
      times: ["00:00", "12:00", "18:00"],
      temps: [24.2, 31.5, 26.5],
      debPrediction: 29.3,
    } as any,
    "1D",
  );
  const shanghaiDebSeries = seriesByKey(shanghaiDebFromDetail.series, "hourly_forecast") as any;
  const shanghaiDebValues = shanghaiDebSeries.values.filter((value: number | null): value is number => value !== null);
  assert(
    Math.max(...shanghaiDebValues) === 29.3,
    "DEB curve should use full-detail deb.prediction before stale terminal row deb_prediction",
  );
  assert(
    Math.min(...shanghaiDebValues) > 20,
    "DEB curve should not be pulled into an impossible negative range by stale row deb_prediction=0",
  );

  const qingdaoFullDay = __buildTemperatureChartDataForTest(
    {
      city: "qingdao",
      local_date: "2026-05-26",
      local_time: "23:30",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 22,
      runway_plate_history: {
        "16/34": [
          { time: "2026-05-25T23:30:00+08:00", temp: 23.8 },
          { time: "2026-05-26T00:05:00+08:00", temp: 23.5 },
          { time: "2026-05-26T12:00:00+08:00", temp: 21.6 },
        ],
      },
    } as any,
    {
      localTime: "23:30",
      times: ["00:00", "06:00", "12:00", "18:00", "23:00"],
      temps: [24, 19, 21.5, 21.5, 20],
      debPrediction: 22,
    } as any,
    "1D",
  );
  const qingdaoDayStart = Date.UTC(2026, 4, 26, 0, 0, 0);
  const qingdaoDayEnd = Date.UTC(2026, 4, 27, 0, 0, 0);
  assert(
    qingdaoFullDay.data.every((point) => point.ts >= qingdaoDayStart && point.ts < qingdaoDayEnd),
    "Full-day chart should clamp observation history to the selected local_date so DEB does not appear broken after cross-day runway history",
  );
  assert(
    qingdaoFullDay.data[0]?.ts === qingdaoDayStart,
    "Full-day chart should start at local 00:00 when the DEB hourly path has a midnight point",
  );

  const chongqingRolledToNextDay = __buildTemperatureChartDataForTest(
    {
      city: "chongqing",
      local_date: "2026-05-26",
      local_time: "23:50",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 22,
    } as any,
    {
      localDate: "2026-05-27",
      localTime: "00:34",
      times: ["00:00", "06:00", "12:00", "18:00", "23:00"],
      temps: [25.2, 25.6, 28.4, 27.6, 26.1],
      debPrediction: 30.1,
    } as any,
    "1D",
  );
  const chongqingNextDayStart = Date.UTC(2026, 4, 27, 0, 0, 0);
  const chongqingNextDayEnd = Date.UTC(2026, 4, 28, 0, 0, 0);
  assert(
    chongqingRolledToNextDay.data.every((point) => point.ts >= chongqingNextDayStart && point.ts < chongqingNextDayEnd),
    "Full-day chart should switch to the city-detail localDate after local midnight instead of keeping stale terminal row.local_date",
  );
  const chongqingNextDayDeb = seriesByKey(chongqingRolledToNextDay.series, "hourly_forecast") as any;
  const chongqingNextDayDebValues = chongqingNextDayDeb.values.filter((value: number | null): value is number => value !== null);
  assert(
    Math.max(...chongqingNextDayDebValues) === 30.1,
    "DEB curve should use the next local day's detail debPrediction after local midnight",
  );

  // ── Runway range band and runway_max test ──
  const shanghaiWithBand = __buildTemperatureChartDataForTest(
    {
      city: "shanghai",
      local_date: "2026-05-26",
      local_time: "14:00",
      tz_offset_seconds: 8 * 60 * 60,
    } as any,
    {
      localTime: "14:00",
      times: ["00:00", "12:00", "18:00"],
      temps: [24.2, 31.5, 26.5],
      runwayBandHistory: [
        { time: "2026-05-26T00:00:00+08:00", high_temp: 26.0, low_temp: 24.0, avg_temp: 25.0 },
        { time: "2026-05-26T12:00:00+08:00", high_temp: 32.0, low_temp: 29.0, avg_temp: 30.5 },
      ]
    } as any,
    "1D",
  );

  const runwayMaxSeries = seriesByKey(shanghaiWithBand.series, "runway_max") as any;
  assert(runwayMaxSeries, "runway_max series should be present when runwayBandHistory is provided");
  assert(runwayMaxSeries.color === "#009688", "runway_max series should use the primary teal color");
  assert(runwayMaxSeries.featured === true, "runway_max series should be featured");

  // Verify that runway_band exists on some data rows
  const bandPoints = shanghaiWithBand.data.filter((d) => d.runway_band !== null);
  assert(bandPoints.length >= 2, "runway_band tuples should be binned into data slots");
  const firstBand = bandPoints[0].runway_band;
  assert(Array.isArray(firstBand) && firstBand[0] === 24.0 && firstBand[1] === 26.0, "runway_band tuple values should match input limits");

  // ── Legacy Gaussian probability overlay test ──
  const gaussianOverlayChart = __buildTemperatureChartDataForTest(
    {
      city: "toronto",
      local_date: "2026-05-27",
      local_time: "14:00",
      tz_offset_seconds: -4 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localDate: "2026-05-27",
      localTime: "14:00",
      times: ["10:00", "14:00", "18:00"],
      temps: [24, 27, 23],
      probabilities: {
        mu: 27.4,
        engine: "legacy",
        distribution_all: [
          { value: 26, probability: 0.18, range: "[25.5~26.5)" },
          { value: 27, probability: 0.42, range: "[26.5~27.5)" },
          { value: 28, probability: 0.31, range: "[27.5~28.5)" },
        ],
      },
    } as any,
    "1D",
  ) as any;

  const gaussianOverlay = gaussianOverlayChart.probabilityOverlay;
  assert(gaussianOverlay, "legacy Gaussian probabilities should be exposed as a chart overlay");
  assert(gaussianOverlay.muLine?.value === 27.4, "legacy Gaussian μ should become a reference line");
  assert(
    gaussianOverlay.bands.some(
      (band: any) => band.value === 27 && band.lower === 26.5 && band.upper === 27.5 && band.probability === 0.42,
    ),
    "legacy Gaussian buckets should become horizontal probability temperature bands",
  );
  assert(
    !gaussianOverlayChart.series.some((series: any) => String(series.key || "").includes("probability")),
    "legacy Gaussian probability distribution should not be rendered as a time-series line",
  );
}
