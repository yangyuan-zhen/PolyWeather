"use client";

import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
  hasDirectBackendApiBaseUrl,
} from "@/lib/backend-api";
import type {
  ArbitrageCitiesResponse,
  ArbitrageOverview,
} from "@/lib/arbitrage-types";

export type FetchArbitrageOverviewOptions = {
  city: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
};

export type FetchArbitrageCitiesOptions = {
  signal?: AbortSignal;
};

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

async function fetchOverview({
  city,
  forceRefresh = false,
  signal,
}: FetchArbitrageOverviewOptions) {
  const params = new URLSearchParams({
    city,
    force_refresh: String(forceRefresh),
  });
  if (forceRefresh) {
    params.set("_ts", String(Date.now()));
  }
  const directBackend = hasDirectBackendApiBaseUrl();
  const headers = directBackend
    ? await buildBrowserBackendHeaders({ Accept: "application/json" })
    : new Headers({ Accept: "application/json" });
  return readJsonOrThrow<ArbitrageOverview>(
    `/api/arbitrage/overview?${params.toString()}`,
    {
      cache: forceRefresh || directBackend ? "no-store" : "default",
      headers,
      signal,
    },
  );
}

// 加载套利可用城市列表；后端接口不可用时由调用方静默回退到静态列表。
async function fetchCities({ signal }: FetchArbitrageCitiesOptions = {}) {
  const directBackend = hasDirectBackendApiBaseUrl();
  const headers = directBackend
    ? await buildBrowserBackendHeaders({ Accept: "application/json" })
    : new Headers({ Accept: "application/json" });
  return readJsonOrThrow<ArbitrageCitiesResponse>("/api/arbitrage/cities", {
    cache: "no-store",
    headers,
    signal,
  });
}

export const arbitrageClient = {
  fetchOverview,
  fetchCities,
};
