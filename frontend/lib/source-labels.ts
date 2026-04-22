export function normalizeObservationSourceLabel(
  value?: string | null,
  fallback = "METAR",
) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const lowered = raw.toLowerCase();
  if (
    lowered === "wu" ||
    lowered === "wunderground"
  ) {
    return "METAR";
  }
  if (lowered.includes("wunderground")) {
    return raw.replace(/wunderground/gi, "METAR");
  }
  return raw;
}

export function normalizeObservationSourceCode(value?: string | null) {
  const code = String(value || "").trim().toLowerCase();
  if (code === "wu" || code === "wunderground") return "metar";
  return code;
}
