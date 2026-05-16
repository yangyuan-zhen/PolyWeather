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
}
