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
  const panelPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "RunwayObservationsPanel.tsx",
  );
  const monitorPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "monitoring",
    "MonitorPanel.tsx",
  );

  const shellPartsSource = fs.readFileSync(shellPartsPath, "utf8");
  const dashboardSource = fs.readFileSync(dashboardPath, "utf8");
  assert(
    shellPartsSource.includes('"runway"'),
    "scan terminal content view must include a runway tab state",
  );
  assert(
    dashboardSource.includes("跑道观测") && dashboardSource.includes('setActiveView("runway")'),
    "dashboard tabs must expose 跑道观测 next to 市场监控",
  );
  assert(
    fs.existsSync(panelPath),
    "RunwayObservationsPanel.tsx must render the dedicated runway tab body",
  );
  const panelSource = fs.readFileSync(panelPath, "utf8");
  assert(
    panelSource.includes("AMSC AWOS") &&
      panelSource.includes("TDZ") &&
      panelSource.includes("MID") &&
      panelSource.includes("END"),
    "runway tab must identify AMSC AWOS and show TDZ/MID/END point temperatures",
  );
  assert(
    panelSource.includes('key: "qingdao"') &&
      panelSource.includes("青岛") &&
      panelSource.includes("ZSQD"),
    "runway tab must include Qingdao / ZSQD AMSC AWOS runway observations",
  );
  assert(
    panelSource.includes("RKSI") &&
      panelSource.includes("RKPK") &&
      panelSource.includes("runway_pairs") &&
      panelSource.includes("runway_temps"),
    "runway tab must also own Seoul/Busan AMOS runway-pair observations",
  );
  const monitorSource = fs.readFileSync(monitorPath, "utf8");
  assert(
    monitorSource.includes("ignoreRunway: KOREA_RUNWAY_MONITOR_KEYS.has(key)") &&
      monitorSource.includes("showRunwayRows = !KOREA_RUNWAY_MONITOR_KEYS.has(key)"),
    "market monitor must not render Seoul/Busan runway data after it moves to the runway tab",
  );
}
