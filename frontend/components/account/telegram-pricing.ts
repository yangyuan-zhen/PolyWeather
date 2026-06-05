import type { TelegramPricing } from "./types";

export function isTelegramPrivateGroupPriceEligible(
  pricing?: TelegramPricing | null,
) {
  return Boolean(
    pricing?.is_private_group_member ||
      pricing?.pricing_source === "telegram_private_group_member",
  );
}

export function telegramPrivateGroupAmountUsdc(
  pricing?: TelegramPricing | null,
) {
  if (!isTelegramPrivateGroupPriceEligible(pricing)) return "";
  const amount = String(pricing?.amount_usdc || "").trim();
  const numeric = Number(amount);
  return Number.isFinite(numeric) && numeric > 0 ? amount : "";
}
