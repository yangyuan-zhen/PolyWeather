import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const opsApi = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const opsTypes = fs.readFileSync(path.join(projectRoot, "types", "ops.ts"), "utf8");
  const sidebar = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminSidebar.tsx"),
    "utf8",
  );
  const paymentsPage = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "payments", "PaymentsPageClient.tsx"),
    "utf8",
  );

  assert(
    opsApi.includes("auditLog(") &&
      opsApi.includes("/api/ops/audit-log") &&
      opsApi.includes("refunds(") &&
      opsApi.includes("/api/ops/refunds") &&
      opsApi.includes("updateRefund("),
    "ops API client must expose audit log and refund case endpoints",
  );
  assert(
    opsTypes.includes("OpsAuditEvent") &&
      opsTypes.includes("RefundCase") &&
      opsTypes.includes("refund_case_id") &&
      opsTypes.includes("refund_status"),
    "ops types must model audit events, refund cases, and incident refund metadata",
  );
  assert(
    sidebar.includes("/ops/audit-log") && sidebar.includes("审计日志"),
    "ops sidebar must expose the unified audit log page",
  );
  assert(
    paymentsPage.includes("退款工单") &&
      paymentsPage.includes("refund_case_id") &&
      paymentsPage.includes("refund_status") &&
      paymentsPage.includes("opsApi.refunds"),
    "ops payment page must surface refund cases next to payment incidents",
  );

  const auditRoute = path.join(projectRoot, "app", "api", "ops", "audit-log", "route.ts");
  const refundsRoute = path.join(projectRoot, "app", "api", "ops", "refunds", "route.ts");
  const refundUpdateRoute = path.join(projectRoot, "app", "api", "ops", "refunds", "[caseId]", "route.ts");
  for (const route of [auditRoute, refundsRoute, refundUpdateRoute]) {
    const source = fs.readFileSync(route, "utf8");
    assert(
      source.includes("requireOpsProxyAuth") && source.includes("no-store"),
      `${path.basename(path.dirname(route))} ops proxy route must be admin-protected and uncached`,
    );
  }
}
