import {
  __buildTemperatureChartDataForTest,
  __getActiveTemperatureSeriesForTest,
  __getDebPeakWindowRangeForTest,
  __getLiveObservationLabelsForTest,
  __getObservationDisplayMetricsForTest,
  __getPeakGlowStateForTest,
  __getWundergroundDailyHighForTest,
  __getVisibleTemperatureSeriesForTest,
  __formatCityLocalDateForTest,
  __formatCityLocalDateTimeForTest,
  __isTemperatureSeriesVisibleByDefaultForTest,
  __mergePatchIntoHourlyForTest,
  __selectCompactSecondaryTempForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";
import { __buildTemperatureTooltipRowsForTest } from "@/components/dashboard/scan-terminal/TemperatureTooltipContent";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function seriesByKey(series: Array<{ key: string }>, key: string) {
  return series.find((item) => item.key === key);
}

export function runTests() {
  {
    const originalDateNow = Date.now;
    const originalGetTimezoneOffsetForCityDate = Date.prototype.getTimezoneOffset;
    try {
      Date.now = () => Date.UTC(2026, 5, 15, 14, 0, 0);
      Date.prototype.getTimezoneOffset = function () {
        return 0;
      };
      assert(
        __formatCityLocalDateForTest(9 * 60 * 60) === "2026-06-15",
        "Tokyo local date should be formatted from UTC plus city offset, independent of browser timezone",
      );
      assert(
        __formatCityLocalDateTimeForTest(9 * 60 * 60) === "2026-06-15 23:00:00",
        "Tokyo update time should be formatted from UTC plus city offset, independent of browser timezone",
      );
      Date.prototype.getTimezoneOffset = function () {
        return -8 * 60;
      };
      assert(
        __formatCityLocalDateForTest(9 * 60 * 60) === "2026-06-15",
        "Tokyo local date should not change when the browser timezone changes",
      );
      assert(
        __formatCityLocalDateTimeForTest(9 * 60 * 60) === "2026-06-15 23:00:00",
        "Tokyo update time should not change when the browser timezone changes",
      );
    } finally {
      Date.now = originalDateNow;
      Date.prototype.getTimezoneOffset = originalGetTimezoneOffsetForCityDate;
    }
  }

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
      { ts: Date.UTC(2026, 4, 27, 0, 0), hourly_forecast: 22.0, madis: 25.0 },
      { ts: Date.UTC(2026, 4, 27, 4, 0), hourly_forecast: 21.6, madis: 24.4 },
      { ts: Date.UTC(2026, 4, 27, 8, 12), hourly_forecast: 22.1, madis: 25.0 },
      { ts: Date.UTC(2026, 4, 27, 12, 0), hourly_forecast: 26.8, madis: null },
      { ts: Date.UTC(2026, 4, 27, 15, 0), hourly_forecast: 28.0, madis: null },
      { ts: Date.UTC(2026, 4, 27, 18, 0), hourly_forecast: 25.0, madis: null },
    ] as any, [
      {
        key: "madis",
        label: "METAR",
        source: "METAR",
        color: "#0284c7",
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

  assert(
    __getWundergroundDailyHighForTest({
      wundergroundCurrent: { max_so_far: 26 },
      airportCurrent: { max_so_far: 27 },
      airportPrimary: { max_so_far: 27 },
    } as any) === 26,
    "WU display should use Wunderground historical.json high before airport/METAR highs",
  );
  assert(
    __getWundergroundDailyHighForTest({
      airportCurrent: { max_so_far: 27 },
      airportPrimary: { max_so_far: 27 },
    } as any) === null,
    "WU display should not fall back to airport/METAR highs when historical.json is missing",
  );

  const guangzhou = {
    city: "guangzhou",
    local_date: "2026-05-25",
    local_time: "10:00",
    tz_offset_seconds: 8 * 60 * 60,
    airport: "ZGGG",
    deb_prediction: 31,
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
  const activeDefaultSeries = __getActiveTemperatureSeriesForTest("guangzhou", series, {});

  assert(seriesByKey(series, "settlement"), "settlement/HKO observation series should be present");
  assert(seriesByKey(series, "metar"), "METAR observation series should be present by its own key");

  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "settlement"),
    "settlement/HKO observations should be visible by default",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "metar"),
    "METAR observations should be visible by default outside Hong Kong and Shenzhen",
  );
  assert(
    activeDefaultSeries.some((item) => item.key === "metar"),
    "non-Hong Kong/Shenzhen airport METAR observations should be part of the active chart series by default",
  );
  assert(
    !__getVisibleTemperatureSeriesForTest("guangzhou", series, { metar: false }).some(
      (item) => item.key === "metar",
    ),
    "users should still be able to hide the airport METAR series from the legend",
  );
  assert(
    !__isTemperatureSeriesVisibleByDefaultForTest("hong kong", "metar"),
    "Hong Kong airport METAR observations should stay hidden by default because HKO is the primary local station",
  );
  assert(
    !__isTemperatureSeriesVisibleByDefaultForTest("Lau Fau Shan", "metar"),
    "Lau Fau Shan airport METAR observations should stay hidden by default because HKO is the primary local station",
  );
  assert(
    !__isTemperatureSeriesVisibleByDefaultForTest("shenzhen", "metar"),
    "Shenzhen airport METAR observations should stay hidden by default because HKO is the primary local station",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("Lau Fau Shan", "madis"),
    "Lau Fau Shan HKO observations should remain visible by default",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("shenzhen", "madis"),
    "Shenzhen HKO observations should remain visible by default",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("new york", "madis"),
    "airport-primary weather-station observations should be visible by default",
  );

  [
    { city: "amsterdam", airport: "EHAM", sourceCode: "knmi", sourceLabel: "KNMI" },
    { city: "tel aviv", airport: "LLBG", sourceCode: "ims", sourceLabel: "IMS Lod Airport" },
    { city: "helsinki", airport: "EFHK", sourceCode: "fmi", sourceLabel: "FMI" },
    { city: "tokyo", airport: "RJTT", sourceCode: "jma_amedas", sourceLabel: "JMA" },
    { city: "singapore", airport: "WSSS", sourceCode: "singapore_mss", sourceLabel: "MSS" },
    { city: "panama city", airport: "MPMG", sourceCode: "ncm", sourceLabel: "NCM" },
    { city: "brussels", airport: "EBBR", sourceCode: "aeroweb", sourceLabel: "AeroWeb" },
  ].forEach(({ city: stationCity, airport, sourceCode, sourceLabel }) => {
    const stationChart = __buildTemperatureChartDataForTest(
      {
        city: stationCity,
        local_date: "2026-05-29",
        local_time: "17:03",
        tz_offset_seconds: 2 * 60 * 60,
        airport,
      } as any,
      {
        localTime: "17:03",
        times: ["00:00", "06:00", "12:00", "18:00"],
        temps: [19, 18, 27, 20],
        airportPrimary: {
          source_code: sourceCode,
          source_label: sourceLabel,
          temp: 19.0,
          obs_time: "2026-05-29T15:03:00Z",
        },
        airportPrimaryTodayObs: [
          { time: "2026-05-29T13:00:00Z", temp: 26.2 },
          { time: "2026-05-29T14:00:00Z", temp: 24.5 },
          { time: "2026-05-29T15:00:00Z", temp: 19.9 },
        ],
      } as any,
      "1D",
    );
    const stationDefaultSeries = __getActiveTemperatureSeriesForTest(
      stationCity,
      stationChart.series as any,
      {},
    );
    assert(
      stationDefaultSeries.some((item: any) => item.key === "madis" && item.label === sourceLabel),
      `${stationCity} ${sourceLabel} weather-station curve should be visible by default`,
    );
  });

  const ankaraMgmWithMetarBackup = __buildTemperatureChartDataForTest(
    {
      city: "ankara",
      local_date: "2026-05-29",
      local_time: "17:28",
      tz_offset_seconds: 3 * 60 * 60,
      airport: "LTAC",
      metar_today_obs: [
        { time: "2026-05-29T12:00:00Z", temp: 15.0 },
        { time: "2026-05-29T13:00:00Z", temp: 16.0 },
        { time: "2026-05-29T14:00:00Z", temp: 17.0 },
      ],
    } as any,
    {
      localTime: "17:28",
      times: ["00:00", "06:00", "12:00", "18:00"],
      temps: [15, 14, 16, 15],
      airportPrimary: {
        source_code: "mgm",
        source_label: "MGM",
        temp: 14.0,
        obs_time: "2026-05-29T14:28:00Z",
      },
      airportPrimaryTodayObs: [
        { time: "2026-05-29T13:28:00Z", temp: 17.0 },
        { time: "2026-05-29T14:28:00Z", temp: 14.0 },
      ],
    } as any,
    "1D",
  );
  const ankaraDefaultSeries = __getActiveTemperatureSeriesForTest(
    "ankara",
    ankaraMgmWithMetarBackup.series as any,
    {},
  );
  assert(
    ankaraDefaultSeries.some((item: any) => item.key === "madis" && item.label === "MGM"),
    "Ankara MGM airport-primary weather-station curve should be visible by default",
  );
  assert(
    ankaraDefaultSeries.some((item: any) => item.key === "metar"),
    "Ankara local METAR backup curve should remain visible by default because MGM history can be incomplete",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("guangzhou", "model_curve_ECMWF"),
    "multi-model curves should be visible by default for all cities",
  );
  assert(
    defaultVisibleSeries.some((item) => item.key === "model_curve_ECMWF"),
    "multi-model curves should now affect the active chart series by default",
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
    "Paris AROME HD should be visible by default like all other model curves",
  );
  assert(
    __isTemperatureSeriesVisibleByDefaultForTest("paris", "model_curve_ECMWF"),
    "Paris ECMWF should also be visible by default since all model curves are now default-visible",
  );
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

  const hongKongCowinAndHko = __buildTemperatureChartDataForTest(
    {
      city: "hong kong",
      local_date: "2026-05-27",
      local_time: "10:42",
      tz_offset_seconds: 8 * 60 * 60,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "10:42",
      times: ["00:00", "12:00", "18:00"],
      temps: [27.2, 30.9, 27.6],
      airportPrimary: {
        source_code: "cowin_obs",
        source_label: "CoWIN 6087",
        station_label: "保良局陳守仁小學 1min (CoWIN)",
        temp: 31.3,
        obs_time: "2026-05-27T02:42:00Z",
      },
      airportPrimaryTodayObs: [
        ["2026-05-27T02:40:00Z", 31.1],
        ["2026-05-27T02:41:00Z", 31.2],
        ["2026-05-27T02:42:00Z", 31.3],
      ],
      settlementTodayObs: [
        { time: "2026-05-27T02:30:00Z", temp: 31.0 },
        { time: "2026-05-27T02:40:00Z", temp: 31.2 },
      ],
    } as any,
    "1D",
  );
  const hongKongCowinSeries = seriesByKey(hongKongCowinAndHko.series, "settlement") as any;
  const hongKongHkoSeries = seriesByKey(hongKongCowinAndHko.series, "madis") as any;
  assert(hongKongCowinSeries?.label === "CoWIN 6087", "Hong Kong should render CoWIN 6087 as the reference-station curve");
  assert(
    hongKongCowinSeries.values.filter((value: number | null) => value !== null).length >= 2,
    "Hong Kong CoWIN 6087 curve should use airportPrimaryTodayObs history points",
  );
  assert(hongKongHkoSeries?.label === "HKO", "Hong Kong HKO settlement observations should remain visible as the HKO curve");

  const hongKongMetrics = __getObservationDisplayMetricsForTest(
    {
      city: "hong kong",
      local_date: "2026-06-06",
      local_time: "16:48",
      tz_offset_seconds: 8 * 60 * 60,
      current_temp: 30.4,
      current_max_so_far: 30.4,
      temp_symbol: "°C",
    } as any,
    {
      localTime: "16:48",
      times: ["00:00", "12:00", "18:00", "23:00"],
      temps: [28.0, 31.0, 29.0, 28.0],
      settlementTodayObs: [
        { time: "14:00", temp: 30.4 },
        { time: "16:40", temp: 28.1 },
      ],
      airportPrimary: {
        temp: 28.7,
        obs_time: "2026-06-06T16:48:00+08:00",
        source_code: "cowin_obs",
        source_label: "CoWIN 6087",
      },
      airportPrimaryTodayObs: [
        { time: "16:47", temp: 28.6 },
        { time: "16:48", temp: 28.7 },
      ],
    } as any,
  );
  assert(
    hongKongMetrics.currentRunwayTemp === 28.7,
    "Hong Kong primary compact stat should stay on the latest CoWIN reference-station point",
  );
  assert(
    (hongKongMetrics as any).currentMetarTemp === 28.1,
    "Hong Kong secondary compact stat should have the latest HKO point separate from the HKO daily high",
  );
  assert(
    hongKongMetrics.observedHighMetar === 30.4,
    "Hong Kong HKO daily high should still be available for expanded daily-high summaries",
  );
  assert(
    __selectCompactSecondaryTempForTest({
      isHKO: true,
      isShenzhen: false,
      displayMetarTemp: (hongKongMetrics as any).currentMetarTemp,
      observedHighMetar: hongKongMetrics.observedHighMetar,
    }) === 28.1,
    "Hong Kong compact HKO stat should render the latest HKO point, not the HKO daily high",
  );
  assert(
    __selectCompactSecondaryTempForTest({
      isHKO: false,
      isShenzhen: false,
      displayMetarTemp: 72.0,
      observedHighMetar: 73.9,
    }) === 72.0,
    "non-HKO compact secondary stat should render the latest METAR/current point, not the daily high",
  );

  const wuhanEarlyMorningMetrics = __getObservationDisplayMetricsForTest(
    {
      city: "wuhan",
      local_date: "2026-06-16",
      local_time: "04:23",
      tz_offset_seconds: 8 * 60 * 60,
      current_temp: 22.8,
      current_max_so_far: 33.0,
      temp_symbol: "°C",
      metar_context: {
        airport_current_temp: 23.0,
        airport_max_so_far: 33.0,
        airport_obs_time: "04:00",
      },
    } as any,
    {
      localTime: "04:23",
      times: ["00:00", "04:00", "12:00", "18:00"],
      temps: [24.0, 23.0, 33.0, 29.0],
      settlementTodayObs: [
        { time: "04:00", temp: 23.0 },
      ],
      airportCurrent: {
        temp: 23.0,
        max_so_far: 33.0,
        obs_time: "2026-06-16T04:00:00+08:00",
      },
    } as any,
  );
  assert(
    wuhanEarlyMorningMetrics.currentMetarTemp === 23.0,
    "Wuhan early-morning METAR current metric should use the latest settlement point",
  );
  assert(
    wuhanEarlyMorningMetrics.observedHighMetar === 33.0,
    "Wuhan METAR daily high can remain available separately from the compact current stat",
  );
  assert(
    __selectCompactSecondaryTempForTest({
      isHKO: false,
      isShenzhen: false,
      displayMetarTemp: (wuhanEarlyMorningMetrics as any).currentMetarTemp,
      observedHighMetar: wuhanEarlyMorningMetrics.observedHighMetar,
    }) === 23.0,
    "Wuhan compact METAR settlement stat should not show a stale daily high at 04:23",
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

  const istanbulMgmOnlySeries = __buildTemperatureChartDataForTest(
    {
      city: "istanbul",
      local_date: "2026-05-29",
      local_time: "15:10",
      tz_offset_seconds: 3 * 60 * 60,
      current_temp: 18,
      current_max_so_far: 18,
      airport: "LTFM",
    } as any,
    {
      localTime: "15:10",
      times: [],
      temps: [],
      airportPrimary: {
        source_code: "mgm",
        source_label: "MGM",
        temp: 18.2,
        obs_time: "2026-05-29T12:10:00Z",
      },
      airportCurrent: {
        source_code: "metar",
        source_label: "METAR",
        temp: 17,
        obs_time: "14:50",
      },
      airportPrimaryTodayObs: [
        { time: "2026-05-29T12:00:00Z", temp: 18 },
        { time: "2026-05-29T12:05:00Z", temp: 18.1 },
      ],
    } as any,
    "1D",
  );
  const istanbulMgmSeries = seriesByKey(istanbulMgmOnlySeries.series as any, "madis") as any;
  assert(istanbulMgmSeries?.label === "MGM", "Istanbul airport-primary series should be labeled MGM");
  assert(
    istanbulMgmSeries.values.some((value: number | null) => value === 18.2),
    "MGM series should append the latest MGM airport-primary observation",
  );
  assert(
    !istanbulMgmSeries.values.some((value: number | null) => value === 17),
    "MGM series should not mix METAR airportCurrent points into the MGM airport-station line",
  );

  const ankaraMgmWithMetarLabel = __buildTemperatureChartDataForTest(
    {
      city: "ankara",
      local_date: "2026-05-29",
      local_time: "18:48",
      tz_offset_seconds: 3 * 60 * 60,
      current_temp: 14,
      airport: "LTAC",
    } as any,
    {
      localTime: "18:48",
      times: [],
      temps: [],
      airportPrimary: {
        source_code: "mgm",
        source_label: "METAR",
        temp: 14,
        obs_time: "2026-05-29T15:48:00Z",
      },
      airportCurrent: {
        source_code: "metar",
        source_label: "METAR",
        temp: 17,
        obs_time: "18:20",
      },
      airportPrimaryTodayObs: [
        { time: "2026-05-29T15:00:00Z", temp: 14 },
        { time: "2026-05-29T15:30:00Z", temp: 15 },
      ],
      metarTodayObs: [
        { time: "2026-05-29T15:20:00Z", temp: 17 },
      ],
    } as any,
    "1D",
  );
  const ankaraMgmSeries = seriesByKey(ankaraMgmWithMetarLabel.series as any, "madis") as any;
  const ankaraMetarSeries = seriesByKey(ankaraMgmWithMetarLabel.series as any, "metar") as any;
  assert(ankaraMgmSeries?.label === "MGM", "Ankara MGM airport-primary series should be labeled MGM even if payload source_label says METAR");
  assert(ankaraMetarSeries?.label === "METAR", "Ankara METAR backup series should keep the METAR label");

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

  const qingdaoPartialDetailFullDay = __buildTemperatureChartDataForTest(
    {
      city: "qingdao",
      local_date: "2026-05-26",
      local_time: "11:11",
      tz_offset_seconds: 8 * 60 * 60,
      deb_prediction: 22,
    } as any,
    {
      localDate: "2026-05-26",
      localTime: "11:11",
      times: ["00:00", "06:00", "09:00", "10:00"],
      temps: [22, 18.5, 19.1, 19.6],
      debPrediction: 22,
    } as any,
    "1D",
  );
  assert(
    qingdaoPartialDetailFullDay.data[0]?.ts === qingdaoDayStart,
    "All-day view should keep the local-day start even when Qingdao detail data is partial",
  );
  assert(
    qingdaoPartialDetailFullDay.data.some((point) => point.ts === qingdaoDayEnd - 60 * 60 * 1000),
    "All-day view should keep an end-of-day axis slot even when Qingdao detail data only reaches the morning",
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
}
