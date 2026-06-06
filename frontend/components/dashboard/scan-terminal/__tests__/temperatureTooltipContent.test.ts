import {
  readFileSync,
} from "node:fs";
import path from "node:path";
import {
  __buildTemperatureTooltipProbabilityRowsForTest,
  __buildTemperatureTooltipRowsForTest,
} from "@/components/dashboard/scan-terminal/TemperatureTooltipContent";

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

  const probabilityRows = __buildTemperatureTooltipProbabilityRowsForTest(
    {
      engine: "legacy",
      muLine: { value: 27.4, label: "Gaussian μ 27.4°C" },
      bands: [
        {
          key: "legacy_probability_27_0",
          value: 27,
          lower: 26.5,
          upper: 27.5,
          probability: 0.42,
          label: "27°C 42%",
          opacity: 0.13,
        },
      ],
    },
    "°C",
    true,
  );

  assert(
    probabilityRows.length === 2,
    "temperature tooltip should show Gaussian μ and the leading probability bucket as compact context",
  );
  assert(
    probabilityRows.some((row) => row.key === "legacy_probability_mu" && row.value === "27.4°C") &&
      probabilityRows.some((row) => row.key === "legacy_probability_27_0" && row.value === "42%"),
    "temperature tooltip should format Gaussian μ and probability values without drawing a full probability band on the main chart",
  );

  const projectRoot = process.cwd();
  const chartCanvasSource = readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx"),
    "utf8",
  );
  assert(
    chartCanvasSource.includes("probabilityOverlay={probabilityOverlay}") &&
      !chartCanvasSource.includes("probabilityOverlay={null}"),
    "temperature chart canvas must pass probability overlay data into the tooltip instead of hiding Gaussian μ",
  );
}
