const DEFAULT_ALLOWED_PAYMENT_HOSTS = [
  "polyweather-pro.vercel.app",
  "localhost",
  "127.0.0.1",
];

function normalizeHost(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function getAllowedPaymentHosts(): string[] {
  const configured = String(
    process.env.NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS ||
      process.env.POLYWEATHER_PAYMENT_ALLOWED_HOSTS ||
      "",
  )
    .split(",")
    .map((item) => normalizeHost(item))
    .filter(Boolean);

  if (!configured.length) {
    return DEFAULT_ALLOWED_PAYMENT_HOSTS;
  }

  return Array.from(new Set([...configured, "localhost", "127.0.0.1"]));
}

export function isPaymentHostAllowed(hostname: string | undefined | null): boolean {
  const normalized = normalizeHost(hostname);
  if (!normalized) return false;
  return getAllowedPaymentHosts().includes(normalized);
}

export function getCurrentPaymentHost(): string {
  if (typeof window === "undefined") return "";
  return normalizeHost(window.location.hostname || window.location.host);
}

