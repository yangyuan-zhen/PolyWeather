import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const types = fs.readFileSync(path.join(projectRoot, "components", "account", "types.ts"), "utf8");
  const accountCenter = fs.readFileSync(
    path.join(projectRoot, "components", "account", "AccountCenter.tsx"),
    "utf8",
  );

  assert(
    types.includes("points_ledger") &&
      types.includes("PointsLedgerSummary") &&
      types.includes("PointsLedgerEntry"),
    "auth/me account types must include points ledger summary and entries",
  );
  assert(
    accountCenter.includes("points_ledger") &&
      accountCenter.includes("积分来源") &&
      accountCenter.includes("feedback_reward") &&
      accountCenter.includes("ops_manual_grant"),
    "account center must display point source explainability from auth/me",
  );
}
