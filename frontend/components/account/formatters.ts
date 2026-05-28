import { PAYMENT_RECOVERY_STORAGE_KEY } from "./constants";

export function chainIdToDisplayName(chainId: number | undefined | null): string {
  if (chainId === 137) return "Polygon";
  if (chainId === 1) return "Ethereum Mainnet";
  if (chainId) return `Chain ID ${chainId}`;
  return "Polygon";
}

export function chainIdToExplorerBase(chainId: number | undefined | null): string {
  if (chainId === 1) return "https://etherscan.io";
  if (chainId === 137) return "https://polygonscan.com";
  return "";
}

export function formatTime(value: string | undefined | null, locale: string) {
  if (!value) return "--";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "--";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    return "--";
  }
}

export function parseSubscriptionExpiry(value: string | undefined | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  const diffMs = dt.getTime() - Date.now();
  return {
    raw,
    date: dt,
    expired: diffMs <= 0,
    daysLeft: Math.ceil(diffMs / 86_400_000),
  };
}

export function shortAddress(address: string) {
  const text = String(address || "");
  if (!text.startsWith("0x") || text.length < 12) return text || "--";
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

export function clearStoredPaymentRecovery() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
}

