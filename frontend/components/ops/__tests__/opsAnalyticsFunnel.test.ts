import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const opsApi = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const analyticsPage = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "analytics", "AnalyticsPageClient.tsx"),
    "utf8",
  );
  const overviewPage = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "overview", "OverviewPageClient.tsx"),
    "utf8",
  );
  const appAnalytics = fs.readFileSync(path.join(projectRoot, "lib", "app-analytics.ts"), "utf8");
  const analyticsRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "analytics", "events", "route.ts"),
    "utf8",
  );
  const authMeRoute = fs.readFileSync(path.join(projectRoot, "app", "api", "auth", "me", "route.ts"), "utf8");

  assert(
    opsApi.includes('"landing_view", "enter_terminal", "login_start", "signup_success", "trial_created", "payment_start", "payment_success"') &&
      opsApi.includes("diagnostics?:") &&
      opsApi.includes("traffic?:") &&
      opsApi.includes("uniqueActors"),
    "ops funnel API client must preserve the full standard funnel and expose diagnostics/traffic dimensions",
  );
  assert(
    analyticsPage.includes("落地页访问") &&
      analyticsPage.includes("进入终端") &&
      analyticsPage.includes("注册成功") &&
      analyticsPage.includes("鉴权降级") &&
      analyticsPage.includes("来源与设备") &&
      analyticsPage.includes("paymentSuccess?.count") &&
      !analyticsPage.includes("总注册") &&
      !analyticsPage.includes("点击高级功能"),
    "ops analytics page must show the real funnel semantics instead of stale index-based labels",
  );
  assert(
    overviewPage.includes("stepByKey.payment_success?.count") &&
      !overviewPage.includes("steps[5]?.count"),
    "ops overview must derive paid conversion from payment_success by key, not from a brittle funnel index",
  );
  assert(
    appAnalytics.includes("referrer: document.referrer") &&
      appAnalytics.includes("device_type: getDeviceType()") &&
      analyticsRoute.includes("cf-ipcountry") &&
      analyticsRoute.includes("user_agent"),
    "client analytics events must carry source, country, and device metadata for acquisition analysis",
  );
  assert(
    authMeRoute.includes('event_type: "degraded_auth_profile"') &&
      authMeRoute.includes("response_mode") &&
      authMeRoute.includes("trackAuthDiagnosticEvent"),
    "auth/me fallback paths must emit degraded_auth_profile diagnostics for ops monitoring",
  );
}
