import {
  __build72hChartDataForTest,
} from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function buildHourly() {
  const times: string[] = [];
  for (let day = 11; day <= 13; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      times.push(`2026-08-${day}T${String(hour).padStart(2, "0")}:00`);
    }
  }
  const curves: Record<string, Array<number | null>> = {
    ECMWF: times.map((_, index) => 30 + (index % 5)),
    GFS: times.map((_, index) => 31 + (index % 4)),
    ICON: times.map((_, index) => 29 + (index % 6)),
  };
  return {
    modelTimes: times,
    modelCurves: curves,
    localDate: "2026-08-11",
    localTime: "2026-08-11 10:00",
    debHourlyPath: {
      times: ["10:00", "11:00", "12:00"],
      temps: [31.5, 32.0, 33.0],
    },
    multiModelDaily: {
      "2026-08-11": { deb: { prediction: 33.5 } },
      "2026-08-12": { deb: { prediction: 30.2 } },
      "2026-08-13": { deb: { prediction: 29.8 } },
    },
    settlementTodayObs: [
      { time: "2026-08-11T09:00:00Z", temp: 28.5 },
      { time: "2026-08-11T10:00:00Z", temp: 29.2 },
    ],
  };
}

export function runTests() {
  const row = {
    city: "beijing",
    tz_offset_seconds: 8 * 3600,
    local_date: "2026-08-11",
    temp_symbol: "°C",
  } as any;

  const { data, series } = __build72hChartDataForTest(row, buildHourly() as any);

  assert(data.length === 72, `72h chart must span 72 rows, got ${data.length}`);
  assert(
    data[0].ts === Date.UTC(2026, 7, 11, 0, 0),
    "first row must be local midnight (chart ts convention: local wall time as UTC epoch)",
  );
  assert(
    data[0].label === "8/11 00:00" && data[24].label === "8/12 00:00" && data[48].label === "8/13 00:00",
    "72h rows must carry M/D HH:00 labels so the x axis shows the three day boundaries",
  );

  // Median / min / max aggregation per hour.
  const first = data[0];
  assert(first.model_median === 30, `median of [30,31,29] must be 30, got ${first.model_median}`);
  assert(first.model_min === 29, `min of [30,31,29] must be 29, got ${first.model_min}`);
  assert(first.model_max === 31, `max of [30,31,29] must be 31, got ${first.model_max}`);

  const keys = series.map((item) => item.key);
  assert(
    keys.includes("observation") &&
      keys.includes("model_median") &&
      keys.includes("model_min") &&
      keys.includes("model_max") &&
      keys.includes("deb_72h"),
    `72h chart must expose observation/model_median/model_min/model_max/deb_72h series, got ${keys.join(",")}`,
  );

  // Observation series: 09:00 UTC = 17:00 local on 8/11 -> row index 17.
  const obsSeries = series.find((item) => item.key === "observation");
  assert(obsSeries?.values[17] === 28.5, "observation value must land on the correct hour slot");

  // DEB anchors: today's hourly path (10:00 local -> index 10) plus daily noon anchors.
  const debSeries = series.find((item) => item.key === "deb_72h");
  assert(debSeries?.values[10] === 31.5, "today DEB hourly path must map to 10:00 local");
  assert(
    debSeries?.values[36] === 30.2,
    "tomorrow DEB daily anchor must map to 2026-08-12 noon slot",
  );

  // Empty model curves -> empty chart (graceful).
  const empty = __build72hChartDataForTest(row, {
    modelTimes: [],
    modelCurves: {},
  } as any);
  assert(empty.data.length === 0 && empty.series.length === 0, "missing model curves must yield empty chart");
}
