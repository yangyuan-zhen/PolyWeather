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
  const chartSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx"),
    "utf8",
  );
  const chartCanvasSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx"),
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
  assert(
    dashboardSource.includes("if (!cityInSlot || !rowForSlot)") &&
      dashboardSource.includes("handleSelectCityForSlot(slotIndex, null);"),
    "stale saved chart slots must render the empty city picker instead of a row=null Temperature Chart",
  );
  assert(
    chartSource.includes("setLiveTemp(null);") &&
      chartSource.includes("lastAppliedPatchRevisionRef.current = 0;"),
    "switching city slots must clear the previous live temperature so Fahrenheit values cannot leak into Celsius charts",
  );
  assert(
    chartSource.includes('compact ? "min-h-0" : "min-h-[300px]"') &&
      chartCanvasSource.includes("const minChartHeight = compact ? 120 : 220") &&
      chartCanvasSource.includes('compact ? "min-h-[120px]" : "min-h-[220px]"'),
    "compact grid charts must not force desktop minimum heights that get clipped inside 3x3 terminal slots",
  );
  const signedOutBlock = dashboardSource.slice(
    dashboardSource.indexOf('if (event === "SIGNED_OUT")'),
    dashboardSource.indexOf('} else if (event === "TOKEN_REFRESHED"'),
  );
  assert(
    signedOutBlock.includes("await supabase.auth.getSession()") &&
      signedOutBlock.includes("mergeAccessStateWithAuthPayload(prev, payload)") &&
      signedOutBlock.indexOf("await supabase.auth.getSession()") <
        signedOutBlock.indexOf("setProAccess(createEmptyAccess(false))"),
    "terminal auth listener must re-check the current Supabase session before clearing access on SIGNED_OUT events",
  );
}
