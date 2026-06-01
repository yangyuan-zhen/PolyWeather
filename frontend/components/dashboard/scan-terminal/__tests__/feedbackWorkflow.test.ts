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
  const chartSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx"),
    "utf8",
  );
  const modalPath = path.join(projectRoot, "components", "dashboard", "scan-terminal", "UserFeedbackModal.tsx");
  const opsSidebarSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminSidebar.tsx"),
    "utf8",
  );
  const opsApiSource = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");

  assert(fs.existsSync(modalPath), "terminal must ship a user feedback modal component");
  const modalSource = fs.readFileSync(modalPath, "utf8");

  assert(
    dashboardSource.includes("onFeedbackClick") &&
      dashboardSource.includes("<UserFeedbackModal") &&
      dashboardSource.includes("setFeedbackDraft"),
    "terminal sidebar must expose a feedback entry that opens the shared modal",
  );
  assert(
    chartSource.includes("onReportIssue") &&
      chartSource.includes("Bug") &&
      chartSource.includes("detailError"),
    "each chart must expose a report-this-chart action with chart loading/error context",
  );
  assert(
    modalSource.includes("/api/feedback") &&
      modalSource.includes("getAnalyticsClientId") &&
      modalSource.includes("navigator.userAgent") &&
      modalSource.includes("type=\"textarea\"") === false,
    "feedback modal must submit to the feedback API and attach client/session diagnostics without using invalid textarea input types",
  );
  assert(
    opsSidebarSource.includes("/ops/feedback") &&
      opsApiSource.includes("feedback(") &&
      opsApiSource.includes("updateFeedbackStatus"),
    "ops must expose a feedback inbox in navigation and API client",
  );
}
