import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const shellPartsPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "ScanTerminalShellParts.tsx",
  );
  const dashboardPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "ScanTerminalDashboard.tsx",
  );
  const runwayPanelPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "RunwayObservationsPanel.tsx",
  );
  const monitorPanelPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "monitoring",
    "MonitorPanel.tsx",
  );

  const shellPartsSource = fs.readFileSync(shellPartsPath, "utf8");
  const dashboardSource = fs.readFileSync(dashboardPath, "utf8");

  assert(
    !shellPartsSource.includes('"monitor"') && !shellPartsSource.includes('"runway"'),
    "scan terminal content views must not include market monitor or runway tabs",
  );
  assert(
    shellPartsSource.includes('"city-list"') &&
      dashboardSource.includes("MobileCityPicker") &&
      dashboardSource.includes('setActiveView("city-list")'),
    "mobile web should expose the city-list view via MobileCityPicker",
  );
  assert(
    !dashboardSource.includes('setActiveView("monitor")') &&
      !dashboardSource.includes('setActiveView("runway")') &&
      !dashboardSource.includes("市场监控") &&
      !dashboardSource.includes("跑道观测"),
    "dashboard must not expose market monitor or runway observation tabs",
  );
  assert(!fs.existsSync(runwayPanelPath), "dedicated runway observation panel must be removed");
  assert(!fs.existsSync(monitorPanelPath), "dedicated market monitor panel must be removed");
}
