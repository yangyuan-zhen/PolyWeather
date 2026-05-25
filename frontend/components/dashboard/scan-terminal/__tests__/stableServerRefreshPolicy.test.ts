import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const queryPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "use-scan-terminal-query.ts",
  );
  const dashboardPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "ScanTerminalDashboard.tsx",
  );
  const dashboardClientPath = path.join(projectRoot, "lib", "dashboard-client.ts");
  const airportEvidencePath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "AirportEvidencePanel.tsx",
  );

  const querySource = fs.readFileSync(queryPath, "utf8");
  const dashboardSource = fs.readFileSync(dashboardPath, "utf8");
  const dashboardClientSource = fs.readFileSync(dashboardClientPath, "utf8");
  const airportEvidenceSource = fs.readFileSync(airportEvidencePath, "utf8");

  assert(
    querySource.includes("fetchScanTerminal") &&
      querySource.includes("showLoading: false"),
    "web auto refresh must read cached scan data instead of forcing a full server scan",
  );
  assert(
    dashboardSource.includes("CityRegionList") &&
      dashboardSource.includes("Panel") &&
      dashboardSource.includes("decisionLabel"),
    "scan terminal must use new institutional terminal layout with CityRegionList + decisionLabel",
  );
  assert(
    airportEvidenceSource.includes("SETTLEMENT_RUNWAY_PAIRS") &&
      airportEvidenceSource.includes("chongqing") &&
      airportEvidenceSource.includes("seoul") &&
      !airportEvidenceSource.includes("busan:"),
    "settlement runway mapping must cover all active settlement cities without mixing in non-settlement airports",
  );
  assert(
    dashboardClientSource.includes('CACHE_KEY = "polyWeather_v2_chart_full_day"'),
    "city detail cache key must be bumped so old partial chart detail caches are not reused",
  );
}
