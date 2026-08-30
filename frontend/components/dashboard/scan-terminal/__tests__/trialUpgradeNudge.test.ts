import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const dashboardSource = fs.readFileSync(
    path.join(process.cwd(), "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );

  assert(
    dashboardSource.includes("isTrialTerminalAccess") &&
      dashboardSource.includes("trialUpgradeLabel") &&
      dashboardSource.includes('href="/account?checkout=1"'),
    "terminal header must show a non-blocking trial countdown with a direct Pro upgrade entry",
  );

  assert(
    dashboardSource.includes("subscriptionPlanCode") &&
      dashboardSource.includes("signup_trial"),
    "terminal trial upgrade nudge must be driven by the active trial subscription plan, not a generic subscribed state",
  );
}
