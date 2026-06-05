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
  const telegramPricing = fs.readFileSync(
    path.join(projectRoot, "components", "account", "telegram-pricing.ts"),
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
    useAccountPayment.includes("applyTelegramGroupPricingToPlanList") &&
      useAccountPayment.includes("backend?.telegram_pricing") &&
      useAccountPayment.includes("isTelegramPrivateGroupPriceEligible") &&
      telegramPricing.includes("is_private_group_member") &&
      telegramPricing.includes("telegram_private_group_member") &&
      !telegramPricing.includes("is_group_member") &&
      useAccountPayment.includes('=== "pro_monthly"') &&
      useAccountPayment.includes("amount_usdc: telegramAmountUsdc"),
    "account payment plan cards must only display the 5 USDC private Telegram group monthly price after private /bind verification",
  );
  assert(
    useBilling.includes("telegramGroupPriceApplies") &&
      useBilling.includes("isTelegramPrivateGroupPriceEligible") &&
      useBilling.includes("backend?.telegram_pricing") &&
      useBilling.includes("!telegramGroupPriceApplies"),
    "billing must not let referral first-month pricing override the lower private Telegram group monthly price",
  );
  assert(
    accountCenter.includes("privateGroupMonthlyPlan") &&
      accountCopy.includes("Private group monthly") &&
      accountCopy.includes("私密群月付"),
    "account plan card must label the 5 USDC price as a private Telegram group monthly price",
  );
  assert(
    types.includes("ReferralSummary") &&
      types.includes("referral?: ReferralSummary | null") &&
      types.includes("is_private_group_member?: boolean") &&
      types.includes("duration_days: number") &&
      types.includes("max_discount_usdc_by_plan"),
    "account auth and payment types must include referral summary, private Telegram pricing, and plan durations",
  );
}
