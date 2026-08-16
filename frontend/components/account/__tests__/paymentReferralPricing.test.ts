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
  const useBilling = fs.readFileSync(
    path.join(projectRoot, "components", "account", "useBilling.ts"),
    "utf8",
  );
  const types = fs.readFileSync(
    path.join(projectRoot, "components", "account", "types.ts"),
    "utf8",
  );

  assert(
    accountCopy.includes("3天试用") &&
      accountCopy.includes("邀请码"),
    "account copy must describe trial limits and referral code UI",
  );
  assert(
    accountCenter.includes("copy.referralInviteLimit") &&
      accountCenter.includes("applyReferralCode"),
    "account center must expose referral controls",
  );
  assert(
    accountCenter.includes("pro_quarterly") &&
      accountCenter.includes("79.9") &&
      accountCenter.includes("29.9"),
    "account center must show monthly and quarterly Pro prices",
  );
  assert(
    accountCopy.includes("20 USDC") &&
      accountCopy.includes("+3500 积分") &&
      accountCopy.includes("月付订单最多抵扣 3 USDC") &&
      accountCopy.includes("季度订单最多抵扣 8 USDC") &&
      !accountCopy.includes("群内有效发言"),
    "account copy must describe balanced referral points and remove group-message points",
  );
  assert(
    !useAccountPayment.includes("monthlyPlanList") &&
      !usePaymentFlow.includes("monthlyPlanList"),
    "payment hooks must not filter checkout plans down to monthly only",
  );
  assert(
    !useAccountPayment.includes("telegram") &&
      !useAccountPayment.includes("applyTelegramGroupPricingToPlanList") &&
      !useAccountPayment.includes("telegramPricing"),
    "account payment hook must not apply Telegram group pricing to checkout plans",
  );
  assert(
    !useBilling.includes("telegram") &&
      !useBilling.includes("telegramGroupPriceApplies") &&
      !useBilling.includes("bind_token"),
    "billing hook must not read Telegram group pricing or bind-token flows",
  );
  assert(
    !accountCenter.includes(["private", "Group", "Monthly", "Plan"].join("")) &&
      !accountCopy.includes(["Private", "group", "monthly"].join(" ")) &&
      !accountCopy.includes(["私", "密", "群", "月", "付"].join("")),
    "account plan card should not expose a separate discounted monthly label",
  );
  assert(
    accountCenter.includes("displayPlanList.map") &&
      accountCenter.includes("plan.amount_usdc") &&
      accountCenter.includes("USDC") &&
      !accountCenter.includes(`copy.${["private", "Group", "Monthly", "Plan"].join("")}`) &&
      !accountCenter.includes("overlayPlanLabel") &&
      !accountCenter.includes("overlayPeriodLabel"),
    "payment management must display payment amounts as USDC without relying on the removed checkout overlay",
  );
  assert(
    types.includes("ReferralSummary") &&
      types.includes("referral?: ReferralSummary | null") &&
      !types.includes("TelegramPricing") &&
      !types.includes("telegram_pricing") &&
      !types.includes("is_private_group_member") &&
      !types.includes("weekly_points") &&
      !types.includes("weekly_rank") &&
      types.includes("duration_days: number") &&
      types.includes("max_discount_usdc_by_plan"),
    "account auth and payment types must include referral summary and plan durations, without Telegram pricing or weekly leaderboard fields",
  );
}
