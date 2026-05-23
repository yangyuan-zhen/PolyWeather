export const WALLETCONNECT_PROJECT_ID = String(
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
).trim();
export const WALLETCONNECT_POLYGON_RPC_URL = String(
  process.env.NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL ||
    "https://polygon-bor-rpc.publicnode.com",
).trim();
export const TELEGRAM_GROUP_URL = "https://t.me/+Se93RpNQ58FhYmZh";
export const TELEGRAM_BOT_URL = String(
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || "https://t.me/WeatherQuant_bot",
).trim();
export const TELEGRAM_TOPICS_GROUP_URL = TELEGRAM_GROUP_URL;
export const SUBSCRIPTION_HELP_HREF = "/subscription-help";
export const PAYMENT_RECOVERY_STORAGE_KEY = "polyweather:lastPaymentRecovery";
export const PAYMENT_RECOVERY_TTL_MS = 6 * 60 * 60 * 1000;
export const WALLET_REQUEST_TIMEOUT_MS = 60_000;
export const WALLET_TRANSACTION_REQUEST_TIMEOUT_MS = 120_000;

