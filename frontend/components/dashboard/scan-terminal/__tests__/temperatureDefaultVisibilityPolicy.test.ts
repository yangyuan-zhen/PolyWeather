import {
  __buildTemperatureChartDataForTest,
  __getActiveTemperatureSeriesForTest,
  __getDebPeakWindowRangeForTest,
  __getLiveObservationLabelsForTest,
  __getObservationDisplayMetricsForTest,
  __getVisibleTemperatureSeriesForTest,
  __isTemperatureSeriesVisibleByDefaultForTest,
  __mergePatchIntoHourlyForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function seriesByKey(series: Array<{ key: string }>, key: string) {
  return series.find((item) => item.key === key);
}

function runwayKey(rwy: string) {
  return `runway_${rwy.split("/").map((part) => part.trim().toUpperCase()).join("_")}`;
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
}
