import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );
  const selectorSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "GridLayoutSelector.tsx"),
    "utf8",
  );

  assert(
    dashboardSource.includes("MAX_TERMINAL_CHARTS = 9"),
    "terminal dashboard must cap the desktop homepage at 9 charts",
  );
  assert(
    dashboardSource.includes("MOBILE_TERMINAL_CHARTS = 1"),
    "terminal dashboard must document that mobile renders exactly one chart",
  );
  assert(
    dashboardSource.includes("clampGridSide") &&
      dashboardSource.includes("Math.min(MAX_TERMINAL_CHARTS"),
    "terminal grid dimensions must be clamped before rendering or persisting",
  );
  assert(
    dashboardSource.includes("mobileChartRow") &&
      dashboardSource.includes("建议横屏") &&
      dashboardSource.includes("Rotate to landscape") &&
      dashboardSource.includes("disableClose={true}"),
    "mobile terminal should render one selected chart and suggest landscape for the full grid",
  );
  assert(
    selectorSource.includes("[1, 2, 3].map") &&
      selectorSource.includes("grid grid-cols-3"),
    "grid selector must expose at most a 3 by 3 chart layout",
  );
}
