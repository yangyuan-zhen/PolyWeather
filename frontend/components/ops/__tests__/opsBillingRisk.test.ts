import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const opsApi = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const paymentsPage = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "payments", "PaymentsPageClient.tsx"),
    "utf8",
  );
  const billingRiskRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "ops", "billing-risk", "route.ts"),
    "utf8",
  );
  const paymentsRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "ops", "payments", "route.ts"),
    "utf8",
  );

  assert(
    opsApi.includes("billingRisk") &&
      opsApi.includes("/api/ops/billing-risk") &&
      opsApi.includes("/api/ops/payments"),
    "ops client must expose billing risk and successful payments endpoints",
  );
  assert(
    paymentsPage.includes("支付与邀请风控流水") &&
      paymentsPage.includes("试用漏开") &&
      paymentsPage.includes("Intent 卡住") &&
      paymentsPage.includes("积分异常") &&
      paymentsPage.includes("推荐奖励结算") &&
      paymentsPage.includes("月度邀请封顶"),
    "ops payment page must surface trial, stuck intent, referral, points, and monthly-cap risk signals",
  );
  assert(
    billingRiskRoute.includes("requireOpsProxyAuth") &&
      billingRiskRoute.includes("/api/ops/billing-risk") &&
      billingRiskRoute.includes("no-store"),
    "billing risk proxy must stay ops-admin protected and uncached",
  );
  assert(
    paymentsRoute.includes("requireOpsProxyAuth") &&
      paymentsRoute.includes("/api/ops/payments") &&
      paymentsRoute.includes("no-store"),
    "ops payments proxy must stay ops-admin protected and uncached",
  );
}
