export function normalizeTemperatureSymbol(value?: string | null) {
  return String(value || "").toUpperCase().includes("F") ? "°F" : "°C";
}

export function formatTemperatureValue(
  value: number | null | undefined,
  symbol?: string | null,
  options?: { signed?: boolean; digits?: number },
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const digits = options?.digits ?? 0;
  const sign = options?.signed && numeric >= 0 ? "+" : "";
  return `${sign}${numeric.toFixed(digits)}${normalizeTemperatureSymbol(symbol)}`;
}

export function normalizeTemperatureLabel(
  label?: string | null,
  fallbackSymbol?: string | null,
) {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const normalizedSymbol = normalizeTemperatureSymbol(fallbackSymbol);
  let next = raw.replace(/℃/gi, "°C");
  next = next.replace(/°?([CF])\b/gi, (_, unit: string) => `°${unit.toUpperCase()}`);
  if (!/[°][CF]/.test(next) && /\d/.test(next)) {
    next = `${next}${normalizedSymbol}`;
  }
  if (normalizedSymbol === "°F") {
    next = next.replace(/°C/g, "°F");
  } else {
    next = next.replace(/°F/g, "°C");
  }
  return next;
}
