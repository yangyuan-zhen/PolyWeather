import {
  __buildTemperatureChartDataForTest,
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
}
