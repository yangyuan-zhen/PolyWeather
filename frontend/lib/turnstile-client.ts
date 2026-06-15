export function getConfiguredTurnstileSiteKey() {
  return String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
}

export function isTurnstileEnabled() {
  return Boolean(getConfiguredTurnstileSiteKey());
}

export function getTurnstileTokenForAction(
  token: string | null | undefined,
  action: string,
  options?: { message?: string },
) {
  if (!isTurnstileEnabled()) return undefined;
  const normalized = String(token || "").trim();
  if (!normalized) {
    throw new Error(
      options?.message ||
        `Complete the security check before continuing (${action}).`,
    );
  }
  return normalized;
}
