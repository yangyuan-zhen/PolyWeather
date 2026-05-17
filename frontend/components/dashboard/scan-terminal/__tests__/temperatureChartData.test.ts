import { getTemperatureChartData } from "@/lib/chart-utils";
import type { CityDetail } from "@/lib/dashboard-types";
import { buildDebBaselinePath } from "@/lib/temperature-chart-paths";

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
}
