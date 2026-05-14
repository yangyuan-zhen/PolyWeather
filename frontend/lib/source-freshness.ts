import type { CityDetail, ObservationFreshness } from "@/lib/dashboard-types";
import { normalizeObservationSourceCode } from "@/lib/source-labels";

export type MonitorFreshnessLevel = "fresh" | "aging" | "stale" | "unknown";
export type ObservationFreshnessStatus =
  | "fresh"
  | "expected_wait"
  | "delayed"
  | "stale"
  | "offline"
  | "unknown";

type SourceProfile = {
  code: string;
  label: string;
  nativeUpdateIntervalSec: number;
  freshWindowSec: number;
  expectedGraceSec: number;
  staleAfterSec: number;
  pollIntervalSec: number;
};

const DEFAULT_SOURCE_PROFILE: SourceProfile = {
  code: "metar",
  label: "METAR",
  nativeUpdateIntervalSec: 900,
  freshWindowSec: 600,
  expectedGraceSec: 900,
  staleAfterSec: 3600,
  pollIntervalSec: 300,
};

const SOURCE_PROFILES: Record<string, SourceProfile> = {
  amsc_awos: {
    code: "amsc_awos",
    label: "AMSC AWOS",
    nativeUpdateIntervalSec: 60,
    freshWindowSec: 180,
    expectedGraceSec: 180,
    staleAfterSec: 900,
    pollIntervalSec: 60,
  },
  amos: {
    code: "amos",
    label: "AMOS",
    nativeUpdateIntervalSec: 60,
    freshWindowSec: 180,
    expectedGraceSec: 180,
    staleAfterSec: 900,
    pollIntervalSec: 60,
  },
  jma: {
    code: "jma",
    label: "JMA",
    nativeUpdateIntervalSec: 600,
    freshWindowSec: 900,
    expectedGraceSec: 600,
    staleAfterSec: 2700,
    pollIntervalSec: 300,
  },
  fmi: {
    code: "fmi",
    label: "FMI",
    nativeUpdateIntervalSec: 600,
    freshWindowSec: 900,
    expectedGraceSec: 600,
    staleAfterSec: 2700,
    pollIntervalSec: 300,
  },
  knmi: {
    code: "knmi",
    label: "KNMI",
    nativeUpdateIntervalSec: 600,
    freshWindowSec: 900,
    expectedGraceSec: 600,
    staleAfterSec: 2700,
    pollIntervalSec: 300,
  },
  hko: {
    code: "hko",
    label: "HKO",
    nativeUpdateIntervalSec: 600,
    freshWindowSec: 900,
    expectedGraceSec: 600,
    staleAfterSec: 2700,
    pollIntervalSec: 300,
  },
  cwa: {
    code: "cwa",
    label: "CWA",
    nativeUpdateIntervalSec: 600,
    freshWindowSec: 900,
    expectedGraceSec: 600,
    staleAfterSec: 2700,
    pollIntervalSec: 300,
  },
  mgm: {
    code: "mgm",
    label: "MGM",
    nativeUpdateIntervalSec: 900,
    freshWindowSec: 900,
    expectedGraceSec: 900,
    staleAfterSec: 3600,
    pollIntervalSec: 300,
  },
  metar: DEFAULT_SOURCE_PROFILE,
  noaa: DEFAULT_SOURCE_PROFILE,
  wunderground: DEFAULT_SOURCE_PROFILE,
  nmc: {
    code: "nmc",
    label: "NMC",
    nativeUpdateIntervalSec: 3600,
    freshWindowSec: 3600,
    expectedGraceSec: 1800,
    staleAfterSec: 7200,
    pollIntervalSec: 600,
  },
};

function canonicalSourceCode(value?: string | null) {
  const code = normalizeObservationSourceCode(value || "metar");
  if (!code) return "metar";
  if (code.includes("amsc")) return "amsc_awos";
  if (code.includes("amos")) return "amos";
  if (code.includes("jma")) return "jma";
  if (code.includes("fmi")) return "fmi";
  if (code.includes("knmi")) return "knmi";
  if (code.includes("hko")) return "hko";
  if (code.includes("cwa")) return "cwa";
  if (code.includes("mgm")) return "mgm";
  if (code.includes("noaa")) return "noaa";
  if (code.includes("nmc")) return "nmc";
  return code;
}

export function getObservationSourceProfile(sourceCode?: string | null): SourceProfile {
  const code = canonicalSourceCode(sourceCode);
  return SOURCE_PROFILES[code] || { ...DEFAULT_SOURCE_PROFILE, code };
}

function parseDate(value?: string | null): Date | null {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes("T")) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoOrNull(date: Date | null) {
  return date ? date.toISOString() : null;
}

export function buildObservationFreshness({
  ageMin,
  ingestedAt,
  now = new Date(),
  observedAt,
  observedAtLocal,
  sourceCode,
  sourceLabel,
}: {
  ageMin?: number | null;
  ingestedAt?: string | null;
  now?: Date;
  observedAt?: string | null;
  observedAtLocal?: string | null;
  sourceCode?: string | null;
  sourceLabel?: string | null;
}): ObservationFreshness {
  const profile = getObservationSourceProfile(sourceCode || sourceLabel);
  const observedDate = parseDate(observedAt || null);
  const ageSec =
    typeof ageMin === "number"
      ? Math.max(0, Math.round(ageMin * 60))
      : observedDate
        ? Math.max(0, Math.round((now.getTime() - observedDate.getTime()) / 1000))
        : null;
  const expectedNext =
    observedDate == null
      ? null
      : new Date(observedDate.getTime() + profile.nativeUpdateIntervalSec * 1000);

  let status: ObservationFreshnessStatus = "unknown";
  let reason = "";
  if (ageSec == null) {
    status = "unknown";
    reason = "observation_time_missing";
  } else if (ageSec <= profile.freshWindowSec) {
    status = "fresh";
    reason = "within_native_fresh_window";
  } else if (ageSec <= profile.nativeUpdateIntervalSec + profile.expectedGraceSec) {
    status = "expected_wait";
    reason = "within_source_expected_cadence";
  } else if (ageSec <= profile.staleAfterSec) {
    status = "delayed";
    reason = "past_expected_cadence";
  } else {
    status = "stale";
    reason = "past_stale_threshold";
  }

  return {
    age_sec: ageSec,
    expected_next_update_at: isoOrNull(expectedNext),
    freshness_reason: reason,
    freshness_status: status,
    ingested_at: ingestedAt || null,
    native_update_interval_sec: profile.nativeUpdateIntervalSec,
    observed_at: observedDate ? observedDate.toISOString() : observedAt || null,
    observed_at_local: observedAtLocal || null,
    source_code: profile.code,
    source_label: sourceLabel || profile.label,
  };
}

export function getObservationFreshness(detail?: CityDetail | null) {
  if (!detail) return null;
  const hasAmosRunway =
    (detail.amos?.runway_obs?.temperatures?.length || 0) > 0 ||
    (detail.amos?.runway_temps?.length || 0) > 0;
  if (hasAmosRunway || detail.amos?.source === "amos" || detail.amos?.source === "amsc_awos") {
    return buildObservationFreshness({
      observedAt: detail.amos?.observation_time || null,
      observedAtLocal:
        detail.amos?.observation_time_local ||
        detail.airport_current?.obs_time ||
        detail.current?.obs_time ||
        null,
      sourceCode: detail.amos?.source || "amos",
      sourceLabel: detail.amos?.source_label || (detail.amos?.source === "amsc_awos" ? "AMSC AWOS" : "AMOS"),
    });
  }
  const currentSource = canonicalSourceCode(
    detail.current?.source_code ||
      detail.current?.settlement_source ||
      detail.current?.settlement_source_label ||
      "",
  );
  if (
    detail.current?.freshness &&
    currentSource &&
    currentSource !== "metar" &&
    currentSource !== "wunderground"
  ) {
    return detail.current.freshness;
  }
  const embedded =
    detail.airport_current?.freshness ||
    detail.current?.freshness ||
    detail.airport_primary?.freshness ||
    null;
  if (embedded) return embedded;

  const ac = detail.airport_current;
  const current = detail.current;
  const sourceCode =
    ac?.source_code ||
    current?.settlement_source ||
    current?.settlement_source_label ||
    "metar";
  const ageMin = ac?.obs_age_min ?? current?.obs_age_min ?? null;
  return buildObservationFreshness({
    ageMin,
    observedAt: ac?.report_time || current?.report_time || null,
    observedAtLocal: ac?.obs_time || current?.obs_time || null,
    sourceCode,
    sourceLabel: ac?.source_label || current?.settlement_source_label || undefined,
  });
}

export function getMonitorFreshnessLevel(
  freshness: ObservationFreshness | null | undefined,
  fallbackAgeMin: number | null | undefined,
): MonitorFreshnessLevel {
  if (freshness?.freshness_status) {
    if (freshness.freshness_status === "fresh") return "fresh";
    if (
      freshness.freshness_status === "expected_wait" ||
      freshness.freshness_status === "delayed"
    ) {
      return "aging";
    }
    if (
      freshness.freshness_status === "stale" ||
      freshness.freshness_status === "offline"
    ) {
      return "stale";
    }
  }
  if (fallbackAgeMin == null) return "unknown";
  if (fallbackAgeMin < 20) return "fresh";
  if (fallbackAgeMin < 45) return "aging";
  return "stale";
}

function freshnessDueAt(freshness: ObservationFreshness | null | undefined) {
  const due = parseDate(freshness?.expected_next_update_at || null);
  return due?.getTime() ?? null;
}

export function shouldRefreshMonitorCity({
  detail,
  now = new Date(),
  trigger,
}: {
  detail?: CityDetail | null;
  now?: Date;
  trigger: "initial" | "interval" | "manual";
}) {
  if (trigger === "initial" || trigger === "manual") return true;
  if (!detail) return true;
  const freshness = getObservationFreshness(detail);
  if (
    freshness?.freshness_status === "stale" ||
    freshness?.freshness_status === "offline" ||
    freshness?.freshness_status === "delayed"
  ) {
    return true;
  }
  const dueAt = freshnessDueAt(freshness);
  if (dueAt != null) return dueAt <= now.getTime();

  const ageMin = detail.airport_current?.obs_age_min ?? detail.current?.obs_age_min ?? null;
  if (ageMin == null) return true;
  const profile = getObservationSourceProfile(freshness?.source_code);
  return ageMin * 60 >= profile.nativeUpdateIntervalSec;
}

export function getMonitorRefreshCadenceMs(sourceCodes: Array<string | null | undefined>) {
  const pollSec = sourceCodes.length
    ? Math.min(
        ...sourceCodes.map((source) => getObservationSourceProfile(source).pollIntervalSec),
      )
    : 60;
  return Math.max(60_000, pollSec * 1000);
}
