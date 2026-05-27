import { __buildTemperatureTooltipRowsForTest } from "@/components/dashboard/scan-terminal/TemperatureTooltipContent";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const data = [
    {
      ts: Date.UTC(2026, 4, 27, 9, 10),
      label: "09:10:00",
      runway_35R_17L: 26,
      gfs: 24.2,
      deb: null,
    },
    {
      ts: Date.UTC(2026, 4, 27, 14, 0),
      label: "14:00:00",
      runway_35R_17L: null,
      gfs: null,
      deb: 26.7,
    },
    {
      ts: Date.UTC(2026, 4, 27, 19, 0),
      label: "19:00:00",
      runway_35R_17L: null,
      gfs: 24.8,
      deb: 23.5,
    },
  ];
  const series = [
    { key: "runway_35R_17L", label: "35R/17L 结算跑道", color: "#009688" },
    { key: "gfs", label: "GFS", color: "#10b981" },
    { key: "deb", label: "DEB Forecast", color: "#f97316" },
  ];

  const rows = __buildTemperatureTooltipRowsForTest(data[1], data, series);

  assert(
    !rows.some((row) => row.key === "runway_35R_17L"),
    "runway tooltip rows should not use nearest-value fallback when the active x slot has no runway value",
  );
  assert(
    rows.some((row) => row.key === "deb" && row.value === 26.7),
    "tooltip should still show direct values at the active x slot",
  );
  assert(
    rows.some((row) => row.key === "gfs" && row.value === 24.2),
    "non-runway sparse series should keep nearest-value fallback",
  );
}
