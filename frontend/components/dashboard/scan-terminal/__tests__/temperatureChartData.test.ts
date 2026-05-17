import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
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
  assert(
    chartData?.datasets.debSeries.some((point) => point.labelTime === "08:00" && point.y === 20),
    "temperature chart should normalize ISO hourly times into HH:mm points",
  );
  assert(
    chartData?.datasets.debSeries.some((point) => point.labelTime === "10:00" && point.y === 24),
    "temperature chart should keep normalized hourly temperatures on the curve",
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
    ankaraChartData?.datasets.debSeries.length === 48,
    "DEB original path must cover the full 00:00-23:30 chart day even when city hourly data is partial",
  );
  assert(
    ankaraChartData?.datasets.debSeries.some((point) => point.labelTime === "00:00") &&
      ankaraChartData?.datasets.debSeries.some((point) => point.labelTime === "23:30"),
    "DEB original path must include both start-of-day and end-of-day points",
  );
  assert(
    ankaraChartData?.datasets.calibratedFutureSeries.length,
    "Ankara chart should still expose a calibrated path when observation points exist",
  );
}
