"use client";

import { useEffect, useSyncExternalStore } from "react";
import { resolveBackendApiUrl } from "@/lib/backend-api";

export type CityPatch = {
  type?: string;
  city: string;
  changes: Record<string, unknown>;
  revision: number;
  ts?: number;
};

const latestPatches = new Map<string, CityPatch>();
const latestRevisions = new Map<string, number>();
const cityListeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let patchVersion = 0;

function normalizeCityKey(city: string | null | undefined) {
  return String(city || "").trim().toLowerCase();
}

function notify(city: string) {
  patchVersion += 1;
  cityListeners.get(city)?.forEach((listener) => listener());
  globalListeners.forEach((listener) => listener());
}

function scheduleReconnect() {
  if (reconnectTimer || typeof window === "undefined") return;
  const delayMs = Math.min(30_000, 1_000 * Math.max(1, 2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSsePatches();
  }, delayMs);
}

function closeEventSource() {
  if (!eventSource) return;
  eventSource.close();
  eventSource = null;
}

function connectSsePatches() {
  if (typeof window === "undefined" || eventSource) return;
  closeEventSource();
  eventSource = new EventSource(resolveBackendApiUrl("/api/events"));

  eventSource.onopen = () => {
    reconnectAttempt = 0;
  };

  eventSource.onmessage = (event) => {
    try {
      applySsePatch(JSON.parse(event.data));
    } catch {
      // Ignore malformed frames; the stream stays alive.
    }
  };

  eventSource.onerror = () => {
    closeEventSource();
    scheduleReconnect();
  };
}

export function ensureSsePatchConnection() {
  connectSsePatches();
}

export function applySsePatch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const patch = payload as Partial<CityPatch>;
  if (patch.type && patch.type !== "city_patch") return false;
  const city = normalizeCityKey(patch.city);
  const changes = patch.changes;
  const revision = Number(patch.revision);
  if (!city || !changes || typeof changes !== "object" || !Number.isFinite(revision)) {
    return false;
  }

  const previousRevision = latestRevisions.get(city) ?? 0;
  if (revision <= previousRevision) return false;

  const normalizedPatch: CityPatch = {
    type: "city_patch",
    city,
    changes: changes as Record<string, unknown>,
    revision,
    ts: typeof patch.ts === "number" ? patch.ts : Date.now(),
  };
  latestRevisions.set(city, revision);
  latestPatches.set(city, normalizedPatch);
  notify(city);
  return true;
}

export function getLatestPatchesSnapshot() {
  return latestPatches;
}

export function useSsePatchVersion() {
  useEffect(() => {
    ensureSsePatchConnection();
  }, []);

  return useSyncExternalStore(
    (listener) => {
      globalListeners.add(listener);
      return () => globalListeners.delete(listener);
    },
    () => patchVersion,
    () => 0,
  );
}

export function useLatestPatch(city: string | null | undefined) {
  const cityKey = normalizeCityKey(city);

  useEffect(() => {
    ensureSsePatchConnection();
  }, []);

  return useSyncExternalStore(
    (listener) => {
      if (!cityKey) return () => {};
      const listeners = cityListeners.get(cityKey) ?? new Set<() => void>();
      listeners.add(listener);
      cityListeners.set(cityKey, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) cityListeners.delete(cityKey);
      };
    },
    () => (cityKey ? latestPatches.get(cityKey) ?? null : null),
    () => null,
  );
}

export const __applySsePatchForTest = applySsePatch;
