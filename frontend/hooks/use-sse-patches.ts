"use client";

import { useEffect, useSyncExternalStore } from "react";
import { resolveBackendApiUrl } from "@/lib/backend-api";

const V1_EVENT_TYPE = "city_observation_patch.v1";

export type CityPatch = {
  type?: string;
  city: string;
  changes: Record<string, unknown>;
  revision: number;
  ts?: number;
};

type ObservationPatchV1 = {
  type?: string;
  city?: string;
  source?: string;
  obs_time?: string | null;
  observed_at_utc?: string | null;
  observed_at_local?: string | null;
  city_local_date?: string | null;
  city_timezone?: string | null;
  city_utc_offset_seconds?: number | null;
  source_cadence_sec?: number | null;
  revision?: number;
  ts?: number;
  payload?: Record<string, unknown>;
};

const latestPatches = new Map<string, CityPatch>();
const latestRevisions = new Map<string, number>();
const cityListeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();
const resyncListeners = new Set<() => void>();
const subscribedCities = new Map<string, number>();

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let patchVersion = 0;
let resyncVersion = 0;
let lastRevision = 0;
let useFallbackUrl = false;
let activeConnectionKey = "";

function normalizeCityKey(city: string | null | undefined) {
  return String(city || "").trim().toLowerCase();
}

function subscribedCityList() {
  return Array.from(subscribedCities.keys()).sort();
}

function notify(city: string) {
  patchVersion += 1;
  cityListeners.get(city)?.forEach((listener) => listener());
  globalListeners.forEach((listener) => listener());
}

function notifyResync(latestServerRevision: number | null) {
  if (latestServerRevision !== null) {
    lastRevision = Math.max(lastRevision, latestServerRevision);
  }
  resyncVersion += 1;
  resyncListeners.forEach((listener) => listener());
  globalListeners.forEach((listener) => listener());
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function buildSseUrl(baseUrl: string) {
  const params = new URLSearchParams();
  const cities = subscribedCityList();
  if (cities.length) {
    params.set("cities", cities.join(","));
  }
  if (lastRevision > 0) {
    params.set("since_revision", String(lastRevision));
  }
  params.set("replay_limit", "500");

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function currentConnectionKey() {
  return `${useFallbackUrl ? "fallback" : "direct"}:${subscribedCityList().join("|")}:${lastRevision}`;
}

function scheduleReconnect() {
  if (reconnectTimer || typeof window === "undefined" || subscribedCities.size === 0) return;
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
  activeConnectionKey = "";
}

function reconnectNow() {
  if (typeof window === "undefined") return;
  clearReconnectTimer();
  closeEventSource();
  connectSsePatches();
}

function connectSsePatches() {
  if (typeof window === "undefined" || eventSource || subscribedCities.size === 0) return;

  const baseUrl = useFallbackUrl ? "/api/events" : resolveBackendApiUrl("/api/events");
  const url = buildSseUrl(baseUrl);
  activeConnectionKey = currentConnectionKey();

  try {
    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      reconnectAttempt = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        applySsePatch(JSON.parse(event.data));
      } catch (err) {
        console.error("[SSE] Failed to parse message JSON payload:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("[SSE] Connection error or stream closed:", err);
      closeEventSource();
      if (!useFallbackUrl && url !== "/api/events") {
        useFallbackUrl = true;
      }
      scheduleReconnect();
    };
  } catch (err) {
    console.error("[SSE] Exception thrown while instantiating EventSource:", err);
    closeEventSource();
    if (!useFallbackUrl && baseUrl !== "/api/events") {
      useFallbackUrl = true;
    }
    scheduleReconnect();
  }
}

function ensureSsePatchConnection() {
  if (subscribedCities.size === 0) {
    closeEventSource();
    clearReconnectTimer();
    return;
  }
  if (eventSource && activeConnectionKey === currentConnectionKey()) return;
  reconnectNow();
}

function registerCitySubscription(city: string) {
  const cityKey = normalizeCityKey(city);
  if (!cityKey) return () => {};

  const previousCount = subscribedCities.get(cityKey) ?? 0;
  subscribedCities.set(cityKey, previousCount + 1);
  if (previousCount === 0) {
    ensureSsePatchConnection();
  }

  return () => {
    const nextCount = (subscribedCities.get(cityKey) ?? 1) - 1;
    if (nextCount <= 0) {
      subscribedCities.delete(cityKey);
    } else {
      subscribedCities.set(cityKey, nextCount);
    }
    ensureSsePatchConnection();
  };
}

function normalizeLegacyPatch(patch: Partial<CityPatch>): CityPatch | null {
  const city = normalizeCityKey(patch.city);
  const changes = patch.changes;
  const revision = Number(patch.revision);
  if (!city || !changes || typeof changes !== "object" || !Number.isFinite(revision)) {
    return null;
  }
  return {
    type: "city_patch",
    city,
    changes: changes as Record<string, unknown>,
    revision,
    ts: typeof patch.ts === "number" ? patch.ts : Date.now(),
  };
}

function normalizeV1Patch(patch: ObservationPatchV1): CityPatch | null {
  const city = normalizeCityKey(patch.city);
  const revision = Number(patch.revision);
  const payload = patch.payload;
  if (!city || !payload || typeof payload !== "object" || !Number.isFinite(revision)) {
    return null;
  }

  const changes: Record<string, unknown> = {
    ...payload,
    source: typeof patch.source === "string" ? patch.source : payload.source,
    obs_time: typeof patch.obs_time === "string" ? patch.obs_time : payload.obs_time,
    observed_at_utc: typeof patch.observed_at_utc === "string" ? patch.observed_at_utc : payload.observed_at_utc,
    observed_at_local: typeof patch.observed_at_local === "string" ? patch.observed_at_local : payload.observed_at_local,
    city_local_date: typeof patch.city_local_date === "string" ? patch.city_local_date : payload.city_local_date,
    city_timezone: typeof patch.city_timezone === "string" ? patch.city_timezone : payload.city_timezone,
    city_utc_offset_seconds: typeof patch.city_utc_offset_seconds === "number" ? patch.city_utc_offset_seconds : payload.city_utc_offset_seconds,
    source_cadence_sec: typeof patch.source_cadence_sec === "number" ? patch.source_cadence_sec : payload.source_cadence_sec,
    schema_type: V1_EVENT_TYPE,
  };

  return {
    type: V1_EVENT_TYPE,
    city,
    changes,
    revision,
    ts: typeof patch.ts === "number" ? patch.ts : Date.now(),
  };
}

function normalizeIncomingPatch(payload: unknown): CityPatch | null {
  if (!payload || typeof payload !== "object") return null;
  const patch = payload as Partial<CityPatch> & ObservationPatchV1;
  if (patch.type === "city_patch" || !patch.type) {
    return normalizeLegacyPatch(patch);
  }
  if (patch.type === V1_EVENT_TYPE) {
    return normalizeV1Patch(patch);
  }
  return null;
}

export function applySsePatch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const event = payload as { type?: string; latest_revision?: number };

  if (event.type === "connected" || event.type === "heartbeat") {
    return false;
  }

  if (event.type === "resync_required") {
    const latestServerRevision = Number(event.latest_revision);
    notifyResync(Number.isFinite(latestServerRevision) ? latestServerRevision : null);
    return true;
  }

  const normalizedPatch = normalizeIncomingPatch(payload);
  if (!normalizedPatch) return false;

  const previousRevision = latestRevisions.get(normalizedPatch.city) ?? 0;
  if (normalizedPatch.revision <= previousRevision) return false;

  latestRevisions.set(normalizedPatch.city, normalizedPatch.revision);
  latestPatches.set(normalizedPatch.city, normalizedPatch);
  lastRevision = Math.max(lastRevision, normalizedPatch.revision);
  notify(normalizedPatch.city);
  return true;
}

export function getLatestPatchesSnapshot() {
  return latestPatches;
}

export function useSsePatchVersion() {
  return useSyncExternalStore(
    (listener) => {
      globalListeners.add(listener);
      return () => globalListeners.delete(listener);
    },
    () => patchVersion,
    () => 0,
  );
}

export function useSseResyncVersion() {
  return useSyncExternalStore(
    (listener) => {
      resyncListeners.add(listener);
      return () => resyncListeners.delete(listener);
    },
    () => resyncVersion,
    () => 0,
  );
}

export function useLatestPatch(city: string | null | undefined) {
  const cityKey = normalizeCityKey(city);

  useEffect(() => {
    if (!cityKey) return undefined;
    return registerCitySubscription(cityKey);
  }, [cityKey]);

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
export const __buildSseUrlForTest = buildSseUrl;
