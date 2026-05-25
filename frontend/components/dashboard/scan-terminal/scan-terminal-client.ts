"use client";

import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
} from "@/lib/backend-api";
import type {
  CityDetail,
  MarketScan,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";

export type RemoteData<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "success"; data: T; freshAt: number }
  | { status: "error"; error: string; previous?: T };

export const scanTerminalQueryPolicy = {
  autoRefreshMs: 10 * 60_000,
  manualForceRefreshCooldownMs: 2 * 60_000,
} as const;

type TerminalQueryOptions = {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  timezoneOffsetSeconds?: number | null;
  tradingRegion?: string;
};

type CityDetailQueryOptions = {
  depth?: "panel" | "market" | "nearby" | "full";
  forceRefresh?: boolean;
  marketSlug?: string | null;
  signal?: AbortSignal;
  targetDate?: string | null;
};

function getRemoteError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readPreviousRemoteData<T>(remote: RemoteData<T>): T | undefined {
  if (remote.status === "success") return remote.data;
  if ("previous" in remote) return remote.previous;
  return undefined;
}

export function toRemoteLoading<T>(current: RemoteData<T>): RemoteData<T> {
  return {
    status: "loading",
    previous: readPreviousRemoteData(current),
  };
}

export function toRemoteSuccess<T>(data: T): RemoteData<T> {
  return {
    data,
    freshAt: Date.now(),
    status: "success",
  };
}

export function toRemoteError<T>(
  error: unknown,
  current: RemoteData<T>,
): RemoteData<T> {
  return {
    error: getRemoteError(error),
    previous: readPreviousRemoteData(current),
    status: "error",
  };
}

export function shouldSkipManualTerminalRefresh({
  hasCurrentData,
  lastForcedRefreshAt,
  now = Date.now(),
}: {
  hasCurrentData: boolean;
  lastForcedRefreshAt: number;
  now?: number;
}) {
  return (
    hasCurrentData &&
    lastForcedRefreshAt > 0 &&
    now - lastForcedRefreshAt < scanTerminalQueryPolicy.manualForceRefreshCooldownMs
  );
}

export function shouldRunAutoTerminalRefresh({
  documentHidden,
  isLoading,
}: {
  documentHidden: boolean;
  isLoading: boolean;
}) {
  return !documentHidden && !isLoading;
}

async function readJsonOrThrow<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchBackendApi(path, init);
  if (response.ok) return response.json() as Promise<T>;

  let message = `HTTP ${response.status}`;
  try {
    const payload = await response.json();
    message = String(payload?.error || payload?.detail || message);
  } catch {
    try {
      const raw = await response.text();
      message = raw ? `${message} · ${raw.slice(0, 240)}` : message;
    } catch {
      // Keep HTTP status message.
    }
  }
  throw new Error(message);
}

async function getTerminal({
  forceRefresh = false,
  signal,
  timezoneOffsetSeconds,
  tradingRegion,
}: TerminalQueryOptions = {}) {
  const params = new URLSearchParams({
    scan_mode: "tradable",
    min_price: "0.05",
    max_price: "0.95",
    min_edge_pct: "2",
    min_liquidity: "500",
    market_type: "maxtemp",
    time_range: "today",
    limit: "180",
    force_refresh: String(forceRefresh),
  });
  if (tradingRegion && tradingRegion !== "all") {
    params.set("trading_region", tradingRegion);
  }
  if (Number.isFinite(timezoneOffsetSeconds)) {
    params.set("timezone_offset_seconds", String(Math.trunc(Number(timezoneOffsetSeconds))));
  }
  if (forceRefresh) {
    params.set("_ts", String(Date.now()));
  }
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return readJsonOrThrow<ScanTerminalResponse>(
    `/api/scan/terminal?${params.toString()}`,
    {
      cache: "no-store",
      headers,
      signal,
    },
  );
}

async function getCityDetail(city: string, options: CityDetailQueryOptions = {}) {
  const params = new URLSearchParams({
    depth: options.depth || "full",
    force_refresh: String(options.forceRefresh ?? false),
  });
  if (options.marketSlug) params.set("market_slug", options.marketSlug);
  if (options.targetDate) params.set("target_date", options.targetDate);
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return readJsonOrThrow<CityDetail>(
    `/api/city/${encodeURIComponent(city)}/detail?${params.toString()}`,
    {
      cache: "no-store",
      headers,
      signal: options.signal,
    },
  );
}

export const scanTerminalClient = {
  getCityDetail,
  getTerminal,
};
