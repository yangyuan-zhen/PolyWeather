import type { IntradayMeteorologySignal } from "@/lib/dashboard-types";

export const TODAY_MARKET_SCAN_AUTO_REFRESH_MS = 5 * 60 * 1000;

export function normalizeMarketValue(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100));
  return Math.max(0, Math.min(1, numeric));
}

export function formatMinuteAxisLabel(value: number) {
  if (!Number.isFinite(value)) return "";
  const total = Math.max(0, Math.round(value));
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatMarketPercent(value?: number | null) {
  const normalized = normalizeMarketValue(value);
  if (normalized == null) return "--";
  return `${(normalized * 100).toFixed(1)}%`;
}

export function formatBucketLabel(
  bucket?: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | null;
    temp?: number | null;
  } | null,
) {
  if (!bucket) return "--";
  const direct =
    String(bucket.label || "").trim() ||
    String(bucket.bucket || "").trim() ||
    String(bucket.range || "").trim();
  if (direct) {
    let str = direct.toUpperCase().replace(/\s+/g, "");
    str = str.replace(/°?C($|\+|-)/g, "℃$1");
    if (!str.includes("℃") && /[0-9]/.test(str)) {
      str += "℃";
    }
    return str;
  }

  const temp = Number(bucket.value ?? bucket.temp);
  if (Number.isFinite(temp)) {
    return `${Math.round(temp)}℃`;
  }
  return "--";
}

export function parseBucketBoundaries(
  bucket?: {
    label?: string | null;
    bucket?: string | null;
    range?: string | null;
    value?: number | null;
    temp?: number | null;
  } | null,
) {
  if (!bucket) return null;
  const raw =
    String(bucket.label || "").trim() ||
    String(bucket.bucket || "").trim() ||
    String(bucket.range || "").trim();
  if (!raw) return null;
  const numbers = Array.from(raw.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );
  if (!numbers.length) return null;
  if (raw.includes("+")) {
    return {
      lower: numbers[0] ?? null,
      upper: null as number | null,
      boundaryLabel: `${numbers[0]}°C`,
    };
  }
  if (numbers.length >= 2) {
    return {
      lower: numbers[0],
      upper: numbers[1],
      boundaryLabel: null as string | null,
    };
  }
  return {
    lower: numbers[0],
    upper: null as number | null,
    boundaryLabel: `${numbers[0]}°C`,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parseClockMinutes(value?: string | null) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function parseLeadingNumber(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parsePercentFromText(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 100);
  }
  const text = String(value || "").trim();
  const percentMatch = text.match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const numeric = Number(percentMatch[1]);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : null;
  }
  return parseLeadingNumber(text);
}

export function formatConfidenceLabel(value?: string | null, locale = "zh-CN") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "high") return locale === "en-US" ? "High" : "高";
  if (normalized === "medium") return locale === "en-US" ? "Medium" : "中";
  if (normalized === "low") return locale === "en-US" ? "Low" : "低";
  return locale === "en-US" ? "Pending" : "待确认";
}

export function formatSignalDirection(value?: string | null, locale = "zh-CN") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "support")
    return locale === "en-US" ? "Support" : "支持升温";
  if (normalized === "suppress")
    return locale === "en-US" ? "Suppress" : "压制峰值";
  return locale === "en-US" ? "Neutral" : "中性";
}

export function formatSignalStrength(value?: string | null, locale = "zh-CN") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "strong") return locale === "en-US" ? "Strong" : "强";
  if (normalized === "medium") return locale === "en-US" ? "Medium" : "中";
  return locale === "en-US" ? "Weak" : "弱";
}

export function signalTone(signal?: IntradayMeteorologySignal | null) {
  const direction = String(signal?.direction || "")
    .trim()
    .toLowerCase();
  if (direction === "support") return "cyan";
  if (direction === "suppress") return "amber";
  return "blue";
}

export function localizedText(
  locale: string,
  primary?: string | null,
  english?: string | null,
) {
  const en = String(english || "").trim();
  const value = String(primary || "").trim();
  if (locale === "en-US" && en) return en;
  return value || en;
}

export function localizedList(
  locale: string,
  primary?: string[] | null,
  english?: string[] | null,
) {
  const en = Array.isArray(english)
    ? english.filter((item) => String(item || "").trim())
    : [];
  const value = Array.isArray(primary)
    ? primary.filter((item) => String(item || "").trim())
    : [];
  if (locale === "en-US" && en.length) return en;
  return value.length ? value : en;
}

export function getTrendMetricVisual(metric: {
  label?: string;
  value?: string;
  tone?: string;
}) {
  const label = String(metric.label || "").toLowerCase();
  const value = String(metric.value || "");
  const numeric = parseLeadingNumber(value);

  if (label.includes("降水") || label.includes("precip")) {
    const precipPercent = parsePercentFromText(value);
    if (precipPercent == null) return null;
    return {
      mode: "fill" as const,
      percent: precipPercent,
      tone: "cold" as const,
    };
  }

  if (numeric == null) return null;

  if (label.includes("温度") || label.includes("temp")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 4) * 50, 0, 100),
      tone: numeric >= 0 ? ("warm" as const) : ("cold" as const),
    };
  }

  if (label.includes("露点") || label.includes("dew")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 3) * 50, 0, 100),
      tone: numeric >= 0 ? ("warm" as const) : ("cold" as const),
    };
  }

  if (label.includes("气压") || label.includes("pressure")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 4) * 50, 0, 100),
      tone: numeric >= 0 ? ("warm" as const) : ("cold" as const),
    };
  }

  if (label.includes("云量") || label.includes("cloud")) {
    return {
      mode: "center" as const,
      percent: clamp(50 + (numeric / 40) * 50, 0, 100),
      tone: numeric >= 0 ? ("cold" as const) : ("warm" as const),
    };
  }

  return null;
}
