import fs from "node:fs";
import path from "node:path";
import { __shouldKeepTemperatureChartLoadingForTest } from "@/components/dashboard/scan-terminal/TemperatureChartCanvas";

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
  const terminalPageSource = fs.readFileSync(
    path.join(projectRoot, "app", "terminal", "page.tsx"),
    "utf8",
  );
  const chartCanvasSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx"),
    "utf8",
  );
  const citySelectorSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "CitySelectorDropdown.tsx"),
    "utf8",
  );
  const scanQuerySource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "use-scan-terminal-query.ts"),
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
    !dashboardSource.includes("disableClose={visibleSlots.filter(Boolean).length <= 1}"),
    "desktop chart slots must allow clearing the last visible city so users can close a 1x1 chart",
  );
  assert(
    dashboardSource.includes("readStoredTerminalSlots") &&
      dashboardSource.includes("hasPersistedSlots") &&
      dashboardSource.includes("shouldAutofillInitialSlots"),
    "terminal slots must distinguish first-load default fill from a user-cleared all-empty layout",
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
    dashboardSource.includes("absolute left-1/2 top-12 z-50") &&
      !dashboardSource.includes("top-1/2 -translate-x-1/2 -translate-y-1/2"),
    "empty top-row slots must open the city selector downward so the search input is not clipped by the viewport header",
  );
  assert(
    citySelectorSource.includes("max-h-[calc(100vh-72px)]") &&
      citySelectorSource.includes("min-h-0 flex-1 overflow-y-auto"),
    "city selector dropdown must cap its viewport height and keep the result list scrollable",
  );
  assert(
    citySelectorSource.includes("MIN_DROPDOWN_TOP_PX") &&
      citySelectorSource.includes("viewportNudgeY") &&
      citySelectorSource.includes("getBoundingClientRect()"),
    "city selector dropdown must nudge itself inside the viewport when opened from top-row chart cards",
  );
  assert(
    terminalPageSource.includes("dynamic(") &&
      terminalPageSource.includes('import("@/components/dashboard/ScanTerminalDashboard")') &&
      terminalPageSource.includes("DashboardShellSkeleton") &&
      !terminalPageSource.includes('import { ScanTerminalDashboard } from "@/components/dashboard/ScanTerminalDashboard";'),
    "terminal route must dynamically load the heavy dashboard behind the shell skeleton",
  );
  assert(
    dashboardSource.includes('from "next/dynamic"') &&
      dashboardSource.includes('import("@/components/dashboard/scan-terminal/TrainingDashboard")') &&
      !dashboardSource.includes('import { TrainingDashboard } from "@/components/dashboard/scan-terminal/TrainingDashboard";'),
    "terminal dashboard must lazy-load the training analytics tab so Recharts stays out of the default terminal path",
  );
  assert(
    chartSource.includes('import { TemperatureChartCanvas } from "@/components/dashboard/scan-terminal/TemperatureChartCanvas";') &&
      !chartSource.includes("TemperatureChartCanvasFallback") &&
      !chartSource.includes("import(\"@/components/dashboard/scan-terminal/TemperatureChartCanvas\")"),
    "terminal temperature charts must load the Recharts canvas with the terminal route so visible cards do not sit behind a second-stage fallback",
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
  assert(
    dashboardSource.includes('event === "INITIAL_SESSION"') &&
      dashboardSource.indexOf('event === "INITIAL_SESSION"') <
        dashboardSource.indexOf('event === "TOKEN_REFRESHED"'),
    "terminal auth listener must hydrate access from Supabase INITIAL_SESSION events during first navigation from the landing page",
  );
  assert(
    dashboardSource.includes("useDeferredValue") &&
      dashboardSource.includes("deferredSearchQuery") &&
      dashboardSource.includes("[rows, deferredSearchQuery]"),
    "terminal search must defer expensive row filtering so typing stays responsive",
  );
  assert(
    scanQuerySource.includes("MAX_STALE_SCAN_CACHE_MS") &&
      scanQuerySource.includes("allowStale") &&
      scanQuerySource.includes("setCachedRows(readScanCache(tradingRegion || \"\", { allowStale: true }))"),
    "terminal data hook must render stale scan rows immediately while revalidating the first-screen API",
  );
  assert(
    citySelectorSource.includes("useDeferredValue") &&
      citySelectorSource.includes("deferredSearchQuery") &&
      citySelectorSource.includes("[rows, deferredSearchQuery, activeTab]"),
    "city selector search must defer expensive dropdown filtering so top-row selection stays responsive",
  );
  assert(
    dashboardSource.includes("accessDecisionPending") &&
      dashboardSource.includes("shouldShowPaywall") &&
      dashboardSource.indexOf("if (accessDecisionPending)") <
        dashboardSource.indexOf("if (shouldShowPaywall)"),
    "terminal must keep showing verification while access is undecided instead of flashing the paywall",
  );
  assert(
    dashboardSource.includes('trackAppEvent("enter_terminal"') &&
      dashboardSource.includes('entry: "terminal"'),
    "terminal must emit enter_terminal when an entitled user reaches the dashboard",
  );
  assert(
    chartCanvasSource.includes("memo(") &&
      chartCanvasSource.includes("TemperatureChartCanvasComponent"),
    "temperature chart canvas must be memoized so unrelated terminal state does not remount Recharts",
  );
  assert(
    dashboardSource.includes("const TerminalSidebar = memo(function TerminalSidebar") &&
      dashboardSource.includes("const [navExpanded, setNavExpanded] = useState(false);") &&
      dashboardSource.includes("transition-colors duration-150") &&
      !dashboardSource.includes("transition-all duration-200"),
    "terminal sidebar expand state must be isolated from the chart grid and must not animate width through transition-all",
  );
  assert(
    __shouldKeepTemperatureChartLoadingForTest({
      row: { city: "Moscow" } as any,
      isHourlyLoading: true,
      activeSeries: [],
      probabilityOverlay: null,
      zoomedData: [
        { label: "00:00", ts: 1 },
        { label: "05:00", ts: 2 },
      ],
    }),
    "temperature chart should show the loading skeleton while the first detail fetch is in flight and no drawable data exists",
  );
  assert(
    !__shouldKeepTemperatureChartLoadingForTest({
      row: { city: "Moscow" } as any,
      isHourlyLoading: false,
      activeSeries: [],
      probabilityOverlay: null,
      zoomedData: [
        { label: "00:00", ts: 1 },
        { label: "05:00", ts: 2 },
      ],
    }),
    "temperature chart must stop showing an indefinite loading overlay after the detail fetch finishes without drawable data",
  );
  assert(
    !__shouldKeepTemperatureChartLoadingForTest({
      row: { city: "Moscow" } as any,
      isHourlyLoading: false,
      activeSeries: [
        {
          key: "current",
          label: "Current reference",
          source: "Live",
          color: "#009688",
          values: [13, 13],
        },
      ] as any,
      probabilityOverlay: null,
      zoomedData: [
        { label: "00:00", ts: 1, current: 13 },
        { label: "05:00", ts: 2, current: 13 },
      ],
    }),
    "temperature chart should render once a visible series has drawable values",
  );
  assert(
    !__shouldKeepTemperatureChartLoadingForTest({
      row: { city: "Moscow" } as any,
      isHourlyLoading: true,
      activeSeries: [
        {
          key: "current",
          label: "Current reference",
          source: "Live",
          color: "#009688",
          values: [13, 13],
        },
      ] as any,
      probabilityOverlay: null,
      zoomedData: [
        { label: "00:00", ts: 1, current: 13 },
        { label: "05:00", ts: 2, current: 13 },
      ],
    }),
    "temperature chart must render seeded or cached data immediately while full detail continues loading in the background",
  );
}
