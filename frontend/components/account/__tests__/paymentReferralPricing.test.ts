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
  const unlockProOverlay = fs.readFileSync(
    path.join(projectRoot, "components", "subscription", "UnlockProOverlay.tsx"),
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
    "account payment plan cards must only display the 5 USDC discounted monthly price after verified /bind eligibility",
  );
  assert(
    useBilling.includes("telegramGroupPriceApplies") &&
      useBilling.includes("isTelegramPrivateGroupPriceEligible") &&
      useBilling.includes("backend?.telegram_pricing") &&
      useBilling.includes("!telegramGroupPriceApplies"),
    "billing must not let referral first-month pricing override the lower verified monthly price",
  );
  assert(
    !accountCenter.includes(["private", "Group", "Monthly", "Plan"].join("")) &&
      !accountCopy.includes(["Private", "group", "monthly"].join(" ")) &&
      !accountCopy.includes(["私", "密", "群", "月", "付"].join("")),
    "account plan card and checkout overlay should not expose a separate discounted monthly label",
  );
  assert(
    accountCenter.includes("overlayPlanLabel") &&
      accountCenter.includes("overlayPeriodLabel") &&
      !accountCenter.includes(`copy.${["private", "Group", "Monthly", "Plan"].join("")}`) &&
      unlockProOverlay.includes("planLabel") &&
      unlockProOverlay.includes("USDC") &&
      !unlockProOverlay.includes("<span className={s.price}>${planPriceUsd.toFixed(2)}</span>") &&
      !unlockProOverlay.includes('<span className={s.summaryUnit}>USD</span>'),
    "checkout overlay must display payment amounts as USDC without exposing the discounted-price source label",
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
