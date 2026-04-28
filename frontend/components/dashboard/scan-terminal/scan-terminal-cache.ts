"use client";

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function buildStorageKey(
  prefix: string,
  parts: Array<string | null | undefined>,
) {
  return `${prefix}:${parts
    .map((part) => encodeURIComponent(String(part || "").trim()))
    .join(":")}`;
}

export function readCachedPayload<T>(key: string, ttlMs: number): T | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; payload?: T };
    if (!parsed?.payload) return null;
    if (Date.now() - Number(parsed.cachedAt || 0) > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeCachedPayload<T>(key: string, payload: T) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ cachedAt: Date.now(), payload }));
  } catch {
    // Ignore quota/privacy-mode failures; network fallbacks still work.
  }
}

export function removeCachedPayload(key: string) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore privacy-mode failures; the next network request can still proceed.
  }
}
