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
  const statusButtonPath = path.join(projectRoot, "components", "dashboard", "scan-terminal", "UserFeedbackStatusButton.tsx");
  const opsSidebarSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminSidebar.tsx"),
    "utf8",
  );
  const opsApiSource = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const feedbackRouteSource = fs.readFileSync(path.join(projectRoot, "app", "api", "feedback", "route.ts"), "utf8");

  assert(fs.existsSync(modalPath), "terminal must ship a user feedback modal component");
  assert(fs.existsSync(statusButtonPath), "terminal must ship a user-facing feedback status notification component");
  const modalSource = fs.readFileSync(modalPath, "utf8");
  const statusButtonSource = fs.readFileSync(statusButtonPath, "utf8");
  const statusHelperSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "feedback-status.ts"),
    "utf8",
  );

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
      modalSource.includes("getSupabaseBrowserClient") &&
      modalSource.includes("hasSupabasePublicEnv") &&
      modalSource.includes(".auth.getSession()") &&
      modalSource.includes("readOnly={Boolean(loginEmailContact)}") &&
      modalSource.includes("onSubmitted") &&
      modalSource.includes("navigator.userAgent") &&
      modalSource.includes("type=\"textarea\"") === false,
    "feedback modal must submit to the feedback API, lock contact to the login email when available, notify the dashboard after success, and attach client/session diagnostics without using invalid textarea input types",
  );
  assert(
    feedbackRouteSource.includes("export async function GET") &&
      feedbackRouteSource.includes("method: \"GET\"") &&
      feedbackRouteSource.includes("limit"),
    "feedback API proxy must expose a GET endpoint for the current user's feedback status list",
  );
  assert(
    dashboardSource.includes("<UserFeedbackStatusButton") &&
      dashboardSource.includes("feedbackRefreshKey") &&
      dashboardSource.includes("setFeedbackRefreshKey"),
    "terminal header must expose a small feedback status notification icon and refresh it after submissions",
  );
  assert(
    statusButtonSource.includes("/api/feedback") &&
      statusButtonSource.includes("localStorage") &&
      statusButtonSource.includes("Bell") &&
      statusHelperSource.includes("triaged") &&
      statusHelperSource.includes("resolved"),
    "feedback status notification must poll the user feedback API, badge unseen status changes, and translate handled states",
  );
  assert(
    opsSidebarSource.includes("/ops/feedback") &&
      opsApiSource.includes("feedback(") &&
      opsApiSource.includes("updateFeedbackStatus"),
    "ops must expose a feedback inbox in navigation and API client",
  );
}
