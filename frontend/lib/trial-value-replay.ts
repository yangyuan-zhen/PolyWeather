"use client";

export const TRIAL_VALUE_REPLAY_STORAGE_KEY = "polyweather:trial-value-replay:v1";
const TRIAL_VALUE_REPLAY_SESSION_KEY = "polyweather:trial-value-replay:session:v1";
const MAX_REPLAY_CITIES = 24;

export type TrialValueReplaySnapshot = {
  firstActiveAt: string | null;
  lastActiveAt: string | null;
  lastCityName: string | null;
  lastSignalLabel: string | null;
  lastUserId: string | null;
  terminalVisits: number;
  rowsAvailableMax: number;
  signalsViewed: number;
  citiesViewed: string[];
};

export type RecordTrialValueReplayInput = {
  userId?: string | null;
  cityName?: string | null;
  signalLabel?: string | null;
  rowsAvailable?: number | null;
  activeAt?: string | null;
};

export type TrialValueReplaySummary = {
  hasUsageEvidence: boolean;
  headline: string;
  bullets: string[];
  primaryCta: string;
};

const EMPTY_REPLAY: TrialValueReplaySnapshot = {
  firstActiveAt: null,
  lastActiveAt: null,
  lastCityName: null,
  lastSignalLabel: null,
  lastUserId: null,
  terminalVisits: 0,
  rowsAvailableMax: 0,
  signalsViewed: 0,
  citiesViewed: [],
};

function safeNowIso() {
  return new Date().toISOString();
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function finiteCount(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function buildExpiryBullet(raw: string | null | undefined, isEn: boolean) {
  const expiryMs = Date.parse(String(raw || ""));
  if (!Number.isFinite(expiryMs)) return null;
  const hoursLeft = Math.ceil((expiryMs - Date.now()) / 3_600_000);
  if (hoursLeft <= 0) {
    return isEn
      ? "The trial window is closing now; upgrade to avoid losing access."
      : "试用窗口正在结束，现在升级可避免访问中断。";
  }
  if (hoursLeft < 48) {
    return isEn
      ? `Trial access ends in ${hoursLeft}h.`
      : `试用剩余 ${hoursLeft} 小时。`;
  }
  const daysLeft = Math.ceil(hoursLeft / 24);
  return isEn
    ? `Trial access ends in ${daysLeft} days.`
    : `试用剩余 ${daysLeft} 天。`;
}

function uniqCities(values: unknown) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const city = cleanText(value);
    const key = city.toLowerCase();
    if (!city || seen.has(key)) return;
    seen.add(key);
    result.push(city);
  });
  return result.slice(0, MAX_REPLAY_CITIES);
}

function normalizeSnapshot(value: unknown): TrialValueReplaySnapshot {
  const raw = typeof value === "object" && value ? value as Record<string, unknown> : {};
  return {
    firstActiveAt: cleanText(raw.firstActiveAt) || null,
    lastActiveAt: cleanText(raw.lastActiveAt) || null,
    lastCityName: cleanText(raw.lastCityName) || null,
    lastSignalLabel: cleanText(raw.lastSignalLabel) || null,
    lastUserId: cleanText(raw.lastUserId) || null,
    terminalVisits: finiteCount(raw.terminalVisits),
    rowsAvailableMax: finiteCount(raw.rowsAvailableMax),
    signalsViewed: finiteCount(raw.signalsViewed),
    citiesViewed: uniqCities(raw.citiesViewed),
  };
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readTrialValueReplay(storage = getStorage()) {
  if (!storage) return EMPTY_REPLAY;
  try {
    const raw = storage.getItem(TRIAL_VALUE_REPLAY_STORAGE_KEY);
    if (!raw) return EMPTY_REPLAY;
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return EMPTY_REPLAY;
  }
}

export function recordTrialValueReplay(input: RecordTrialValueReplayInput) {
  const storage = getStorage();
  if (!storage) return readTrialValueReplay(null);

  const now = cleanText(input.activeAt) || safeNowIso();
  const userId = cleanText(input.userId) || null;
  const cityName = cleanText(input.cityName);
  const signalLabel = cleanText(input.signalLabel);
  const previous = readTrialValueReplay(storage);
  const citiesViewed = uniqCities([
    cityName,
    ...previous.citiesViewed,
  ]);
  const sessionStorage = getSessionStorage();
  const sessionKey = `${TRIAL_VALUE_REPLAY_SESSION_KEY}:${userId || "anonymous"}`;
  const shouldCountVisit = !sessionStorage?.getItem(sessionKey);
  if (shouldCountVisit) {
    try {
      sessionStorage?.setItem(sessionKey, "1");
    } catch {}
  }

  const next: TrialValueReplaySnapshot = {
    firstActiveAt: previous.firstActiveAt || now,
    lastActiveAt: now,
    lastCityName: cityName || previous.lastCityName,
    lastSignalLabel: signalLabel || previous.lastSignalLabel,
    lastUserId: userId || previous.lastUserId,
    terminalVisits: previous.terminalVisits + (shouldCountVisit ? 1 : 0),
    rowsAvailableMax: Math.max(previous.rowsAvailableMax, finiteCount(input.rowsAvailable)),
    signalsViewed: Math.max(previous.signalsViewed, citiesViewed.length),
    citiesViewed,
  };

  try {
    storage.setItem(TRIAL_VALUE_REPLAY_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function buildTrialValueReplaySummary(
  snapshot: TrialValueReplaySnapshot,
  options: { isEn: boolean; trialExpiresAt?: string | null },
): TrialValueReplaySummary {
  const { isEn } = options;
  const cities = snapshot.citiesViewed.length;
  const rows = snapshot.rowsAvailableMax;
  const visits = snapshot.terminalVisits;
  const lastCity = snapshot.lastCityName;
  const hasUsageEvidence = Boolean(cities > 0 || visits > 0 || rows > 0);
  const expiryBullet = buildExpiryBullet(options.trialExpiresAt, isEn);

  if (!hasUsageEvidence) {
    const fallbackBullets = isEn
      ? [
          "Keep settlement-source priority and live observation context available.",
          "Keep the terminal active when the trial window closes.",
          "Upgrade now to avoid losing the workflow you just unlocked.",
        ]
      : [
          "继续保留结算源优先、实时观测和温度信号上下文。",
          "试用结束后终端访问不会中断。",
          "现在升级，避免刚解锁的工作流被暂停。",
        ];
    return {
      hasUsageEvidence,
      headline: isEn
        ? "Your trial has unlocked the Pro terminal, live observations, and city-level signal views."
        : "你本次试用已经解锁 Pro 终端、实时观测和城市级信号视图。",
      bullets: (expiryBullet ? [expiryBullet, ...fallbackBullets] : fallbackBullets).slice(0, 3),
      primaryCta: isEn ? "Keep access" : "保持访问",
    };
  }

  const headline = isEn
    ? `Your trial has already reviewed ${cities || rows || 1} weather signal${cities === 1 ? "" : "s"}.`
    : `你本次试用已经查看 ${cities || rows || 1} 个天气信号。`;
  const bullets = isEn
    ? [
        visits > 1 ? `${visits} terminal sessions recorded.` : "Your terminal workflow is already active.",
        rows > 0 ? `${rows} city opportunities were available in the Pro terminal.` : "Live city-level signals stay unlocked on Pro.",
        lastCity ? `Latest signal checked: ${lastCity}.` : "Keep settlement-source and observation context online.",
      ]
    : [
        visits > 1 ? `已记录 ${visits} 次终端使用。` : "你的终端工作流已经启动。",
        rows > 0 ? `Pro 终端本次提供了 ${rows} 个城市机会。` : "Pro 会继续解锁城市级实时信号。",
        lastCity ? `最近查看：${lastCity}。` : "继续保留结算源和实时观测上下文。",
      ];

  return {
    hasUsageEvidence,
    headline,
    bullets: (expiryBullet ? [expiryBullet, ...bullets] : bullets).slice(0, 3),
    primaryCta: isEn ? "Keep access" : "保持访问",
  };
}
