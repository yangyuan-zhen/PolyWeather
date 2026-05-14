export function formatHttpErrorMessage(
  status: number,
  statusText?: string | null,
  body?: string | null,
) {
  const base = `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  const rawBody = String(body || "").trim();
  if (!rawBody) return base;

  let detail = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const value = parsed.detail ?? parsed.error ?? parsed.message;
    if (value != null) {
      detail =
        typeof value === "string" ? value : JSON.stringify(value);
    }
  } catch {
    // keep raw body
  }

  const normalized = detail.replace(/\s+/g, " ").trim();
  if (!normalized) return base;
  return `${base}: ${normalized.slice(0, 300)}`;
}
