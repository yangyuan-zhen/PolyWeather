import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountCenter = fs.readFileSync(
    path.join(projectRoot, "components", "account", "AccountCenter.tsx"),
    "utf8",
  );
  const accountCopy = fs.readFileSync(
    path.join(projectRoot, "components", "account", "account-copy.ts"),
    "utf8",
  );
  const useAccountPayment = fs.readFileSync(
    path.join(projectRoot, "components", "account", "useAccountPayment.ts"),
    "utf8",
  );
  const usePaymentFlow = fs.readFileSync(
    path.join(projectRoot, "components", "account", "usePaymentFlow.ts"),
    "utf8",
  );
  const types = fs.readFileSync(
    path.join(projectRoot, "components", "account", "types.ts"),
    "utf8",
  );

  assert(
    accountCopy.includes("3天试用") &&
      accountCopy.includes("付费 Telegram 群") &&
      accountCopy.includes("邀请码"),
    "account copy must describe trial limits and referral code UI",
  );
  assert(
    accountCenter.includes("copy.trialPaidGroupLocked") &&
      accountCenter.includes("copy.referralInviteLimit") &&
      accountCenter.includes("applyReferralCode"),
    "account center must expose trial paid-group gating and referral controls",
  );
  assert(
    accountCenter.includes("pro_quarterly") &&
      accountCenter.includes("79.9") &&
      accountCenter.includes("29.9"),
    "account center must show monthly and quarterly Pro prices",
  );
  assert(
    !useAccountPayment.includes("monthlyPlanList") &&
      !usePaymentFlow.includes("monthlyPlanList"),
    "payment hooks must not filter checkout plans down to monthly only",
  );
  assert(
    types.includes("ReferralSummary") &&
      types.includes("referral?: ReferralSummary | null") &&
      types.includes("duration_days: number"),
    "account auth and payment types must include referral summary and plan durations",
  );
}
