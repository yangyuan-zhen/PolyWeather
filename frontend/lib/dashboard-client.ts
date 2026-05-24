"use client";

import {
  CityDetail,
  CityListItem,
  CitySummary,
  MarketScan,
  ScanTerminalFilters,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";
import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
} from "@/lib/backend-api";
import { formatHttpErrorMessage } from "@/lib/http-error";

const CACHE_KEY = "polyWeather_v2_chart_full_day";
const CACHE_TTL_MS = 30 * 60 * 1000;
const SCAN_TERMINAL_CLIENT_TIMEOUT_MS = 35_000;
const CITY_DETAIL_CLIENT_TIMEOUT_MS = 35_000;
const pendingCityDetailRequests = new Map<string, Promise<CityDetail>>();
const pendingCitySummaryRequests = new Map<string, Promise<CitySummary>>();
const pendingCityMarketScanRequests = new Map<
  string,
  Promise<{
    fetched_at?: string | null;
    market_scan?: MarketScan | null;
    selected_date?: string | null;
  }>
>();
const pendingScanTerminalRequests = new Map<string, Promise<ScanTerminalResponse>>();
const pendingScanTerminalAiRequests = new Map<string, Promise<ScanTerminalResponse>>();
const PRIORITY_WARM_SESSION_KEY = "polyWeather_priority_warm_v1";

type CityCacheMeta = {
  cachedAt: number;
  revision: string;
};

type CityCacheBundle = {
  details: Record<string, CityDetail>;
  meta: Record<string, CityCacheMeta>;
};

function normalizeCityName(cityName: string) {
  return encodeURIComponent(String(cityName).replace(/\s/g, "-"));
}

function normalizeDetailDepth(depth?: "panel" | "market" | "nearby" | "full") {
  if (depth === "full") return "full";
  if (depth === "nearby") return "nearby";
  if (depth === "market") return "market";
  return "panel";
}

async function fetchJson<T>(
  url: string,
  options?: { cache?: RequestCache; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs;
  const controller =
    timeoutMs && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  const timeoutId =
    controller &&
    typeof window !== "undefined" &&
    typeof window.setTimeout === "function"
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const headers = await buildBrowserBackendHeaders({
    Accept: "application/json",
  });

  let response: Response;
  try {
    response = await fetchBackendApi(url, {
      headers,
      cache: options?.cache ?? "default",
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(timeoutId);
      }
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      formatHttpErrorMessage(response.status, response.statusText, body),
    );
  }

  return response.json() as Promise<T>;
}

function isStaleMarketSlugResponse(payload: {
  market_scan?: MarketScan | null;
} | null | undefined) {
  const scan = payload?.market_scan;
  const reason = String(scan?.reason || "").toLowerCase();
  return (
    scan?.available === false &&
    (reason.includes("market_slug not found") ||
      reason.includes("specified market_slug not found") ||
      reason.includes("slug not found"))
  );
}

function isClient() {
  return typeof window !== "undefined";
}

function normalizeRevisionPart(value: unknown) {
  return value == null ? "" : String(value);
}

export function getCityRevision(source?: CityDetail | CitySummary | null) {
  if (!source) return "";
  const modelDaily =
    "multi_model_daily" in source && source.multi_model_daily
      ? source.multi_model_daily?.[source.local_date || ""]
      : null;
  const modelFootprint = modelDaily?.models || ("multi_model" in source ? source.multi_model : null);
  const forecastFootprint =
    "forecast" in source && Array.isArray(source.forecast?.daily)
      ? source.forecast.daily
          .map((item) => `${normalizeRevisionPart(item?.date)}:${normalizeRevisionPart(item?.max_temp)}`)
          .join("|")
      : "";
  const marketScan = "market_scan" in source ? source.market_scan : null;
  const marketFootprint = marketScan
    ? [
        normalizeRevisionPart(marketScan.selected_slug),
        normalizeRevisionPart(marketScan.market_price),
        normalizeRevisionPart(marketScan.yes_buy),
        normalizeRevisionPart(marketScan.yes_sell),
        normalizeRevisionPart(marketScan.no_buy),
        normalizeRevisionPart(marketScan.no_sell),
        normalizeRevisionPart(marketScan.price_analysis?.best_side),
        normalizeRevisionPart(
          Array.isArray(marketScan.all_buckets)
            ? marketScan.all_buckets
                .slice(0, 6)
                .map(
                  (bucket) =>
                    `${normalizeRevisionPart(bucket?.temp ?? bucket?.value)}:${normalizeRevisionPart(
                      bucket?.market_price ?? bucket?.yes_buy,
                    )}`,
                )
                .join(",")
            : "",
        ),
      ].join("|")
    : "";
  return [
    normalizeRevisionPart(source.updated_at),
    normalizeRevisionPart(source.current?.obs_time),
    normalizeRevisionPart(source.current?.temp),
    normalizeRevisionPart(source.deb?.prediction),
    normalizeRevisionPart(
      modelFootprint && typeof modelFootprint === "object"
        ? Object.keys(modelFootprint)
            .sort()
            .map((key) => `${key}:${normalizeRevisionPart(modelFootprint[key])}`)
            .join("|")
        : "",
    ),
    normalizeRevisionPart(forecastFootprint),
    normalizeRevisionPart(marketFootprint),
  ].join("|");
}

export function toCitySummary(detail: CityDetail): CitySummary {
  return {
    name: detail.name,
    display_name: detail.display_name,
    icao: detail.risk?.icao,
    local_time: detail.local_time,
    temp_symbol: detail.temp_symbol,
    current: {
      obs_time: detail.current?.obs_time,
      temp: detail.current?.temp,
    },
    deb: {
      prediction: detail.deb?.prediction,
    },
    deviation_monitor: detail.deviation_monitor,
    risk: {
      level: detail.risk?.level,
      warning: detail.risk?.warning,
    },
    updated_at: detail.updated_at,
  };
}

function isFresh(meta?: CityCacheMeta | null) {
  return Boolean(meta && Date.now() - meta.cachedAt < CACHE_TTL_MS);
}

function readLegacyCache(raw: string): CityCacheBundle {
  const parsed = JSON.parse(raw) as {
    timestamp?: number;
    data?: Record<string, CityDetail>;
  };
  const details = parsed.data || {};
  const cachedAt = parsed.timestamp || 0;
  const freshDetails: Record<string, CityDetail> = {};
  const meta: Record<string, CityCacheMeta> = {};
  Object.entries(details).forEach(([cityName, detail]) => {
    const nextMeta = {
      cachedAt,
      revision: getCityRevision(detail),
    };
    if (!isFresh(nextMeta)) return;
    freshDetails[cityName] = detail;
    meta[cityName] = nextMeta;
  });
  return { details: freshDetails, meta };
}

export const dashboardClient = {
  clearCityDetailCache() {
    if (!isClient()) return;
    try {
      window.sessionStorage?.removeItem(CACHE_KEY);
    } catch {
      // Storage can be unavailable in embedded/private browser contexts.
    }
  },

  async getCities() {
    const data = await fetchJson<{ cities?: CityListItem[] }>("/api/cities");
    return data.cities || [];
  },

  sendPriorityWarmHint(timezone?: string | null) {
    if (!isClient()) return;
    if (
      typeof fetch !== "function" ||
      typeof Intl === "undefined" ||
      !window.sessionStorage
    ) {
      return;
    }
    const tz = String(
      timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    ).trim();
    if (!tz) return;
    const cacheKey = `${PRIORITY_WARM_SESSION_KEY}:${tz}`;
    try {
      if (window.sessionStorage.getItem(cacheKey)) return;
      window.sessionStorage.setItem(cacheKey, "1");
    } catch {
      return;
    }
    const params = new URLSearchParams({ timezone: tz });
    void fetch(`/api/system/priority-warm?${params.toString()}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "default",
      keepalive: true,
    }).catch(() => {});
  },

  async getCitySummary(cityName: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    const requestKey = `${cityName}::${force ? "force" : "cached"}`;
    const existing = pendingCitySummaryRequests.get(requestKey);
    if (existing) {
      return existing;
    }

    const request = fetchJson<CitySummary>(
      `/api/city/${normalizeCityName(cityName)}/summary?force_refresh=${force}`,
      force ? { cache: "no-store" } : undefined,
    ).finally(() => {
      pendingCitySummaryRequests.delete(requestKey);
    });

    pendingCitySummaryRequests.set(requestKey, request);
    return request;
  },

  async getCityDetail(
    cityName: string,
    options?: { force?: boolean; depth?: "panel" | "market" | "nearby" | "full" },
  ) {
    const force = options?.force ?? false;
    const depth = normalizeDetailDepth(options?.depth);
    if (!force) {
      const requestKey = `${cityName}::${depth}::cached`;
      const existing = pendingCityDetailRequests.get(requestKey);
      if (existing) {
        return existing;
      }

      const request = fetchJson<CityDetail>(
        `/api/city/${normalizeCityName(cityName)}?force_refresh=false&depth=${depth}`,
        { timeoutMs: CITY_DETAIL_CLIENT_TIMEOUT_MS },
      ).finally(() => {
        pendingCityDetailRequests.delete(requestKey);
      });

      pendingCityDetailRequests.set(requestKey, request);
      return request;
    }

    const params = new URLSearchParams({
      force_refresh: "true",
      depth,
      _ts: String(Date.now()),
    });
    return fetchJson<CityDetail>(
      `/api/city/${normalizeCityName(cityName)}?${params.toString()}`,
      { cache: "no-store", timeoutMs: CITY_DETAIL_CLIENT_TIMEOUT_MS },
    );
  },

  async getCityMarketScan(
    cityName: string,
    options?: {
      force?: boolean;
      lite?: boolean;
      marketSlug?: string | null;
      targetDate?: string | null;
    },
  ) {
    const force = options?.force ?? false;
    const params = new URLSearchParams({
      force_refresh: String(force),
      _ts: String(Date.now()),
    });
    if (options?.targetDate) {
      params.set("target_date", options.targetDate);
    }
    if (options?.marketSlug) {
      params.set("market_slug", options.marketSlug);
    }
    if (options?.lite) {
      params.set("lite", "true");
    }
    const requestKey = [
      cityName,
      force ? "force" : "cached",
      options?.lite ? "lite" : "full",
      options?.targetDate || "",
      options?.marketSlug || "",
    ].join("::");
    if (!force) {
      const existing = pendingCityMarketScanRequests.get(requestKey);
      if (existing) {
        return existing;
      }
    }
    type MarketScanPayload = {
      fetched_at?: string | null;
      market_scan?: MarketScan | null;
      selected_date?: string | null;
    };
    const request = (async () => {
      const payload = await fetchJson<MarketScanPayload>(
        `/api/city/${normalizeCityName(cityName)}/market-scan?${params.toString()}`,
        force ? { cache: "no-store" } : undefined,
      );
      if (!force && options?.marketSlug && isStaleMarketSlugResponse(payload)) {
        const fallbackParams = new URLSearchParams({
          force_refresh: "false",
          _ts: String(Date.now()),
        });
        if (options?.lite) {
          fallbackParams.set("lite", "true");
        }
        return fetchJson<MarketScanPayload>(
          `/api/city/${normalizeCityName(cityName)}/market-scan?${fallbackParams.toString()}`,
        );
      }
      return payload;
    })().finally(() => {
      pendingCityMarketScanRequests.delete(requestKey);
    });
    if (!force) {
      pendingCityMarketScanRequests.set(requestKey, request);
    }
    return request;
  },

  async getScanTerminal(
    filters: ScanTerminalFilters,
    options?: { force?: boolean },
  ) {
    const force = options?.force ?? false;
    const params = new URLSearchParams({
      scan_mode: String(filters.scan_mode),
      min_price: String(filters.min_price),
      max_price: String(filters.max_price),
      min_edge_pct: String(filters.min_edge_pct),
      min_liquidity: String(filters.min_liquidity),
      high_liquidity_only: String(filters.high_liquidity_only),
      market_type: String(filters.market_type),
      time_range: String(filters.time_range),
      limit: String(filters.limit),
      force_refresh: String(force),
    });
    const requestKey = `${params.toString()}::${force ? "force" : "cached"}`;
    if (!force) {
      const existing = pendingScanTerminalRequests.get(requestKey);
      if (existing) {
        return existing;
      }
    }
    const request = fetchJson<ScanTerminalResponse>(
      `/api/scan/terminal?${params.toString()}`,
      {
        cache: force ? "no-store" : "default",
        timeoutMs: SCAN_TERMINAL_CLIENT_TIMEOUT_MS,
      },
    ).finally(() => {
      pendingScanTerminalRequests.delete(requestKey);
    });
    if (!force) {
      pendingScanTerminalRequests.set(requestKey, request);
    }
    return request;
  },

  async reviewScanTerminalWithAi(payload: {
    filters: ScanTerminalFilters;
    snapshotId?: string | null;
  }) {
    const snapshotId = String(payload.snapshotId || "").trim();
    const requestKey = [
      snapshotId || "latest",
      JSON.stringify(payload.filters || {}),
    ].join("::");
    const existing = pendingScanTerminalAiRequests.get(requestKey);
    if (existing) {
      return existing;
    }
    const request = buildBrowserBackendHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
    }).then((headers) => fetchBackendApi("/api/scan/terminal/ai", {
      method: "POST",
      headers,
      cache: "default",
      body: JSON.stringify({
        filters: payload.filters,
        snapshot_id: snapshotId || null,
      }),
    }))
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(
            formatHttpErrorMessage(response.status, response.statusText, body),
          );
        }
        return response.json() as Promise<ScanTerminalResponse>;
      })
      .finally(() => {
        pendingScanTerminalAiRequests.delete(requestKey);
      });
    pendingScanTerminalAiRequests.set(requestKey, request);
    return request;
  },


  isCityDetailFresh(meta?: CityCacheMeta | null) {
    return isFresh(meta);
  },

  readCityDetailCacheBundle() {
    if (!isClient()) {
      return {
        details: {},
        meta: {},
      } satisfies CityCacheBundle;
    }

    try {
      const cached = window.sessionStorage.getItem(CACHE_KEY);
      if (!cached) {
        return {
          details: {},
          meta: {},
        } satisfies CityCacheBundle;
      }

      const parsed = JSON.parse(cached) as
        | {
            entries?: Record<
              string,
              { cachedAt?: number; detail?: CityDetail; revision?: string }
            >;
          }
        | {
            timestamp?: number;
            data?: Record<string, CityDetail>;
          };

      if ("entries" in parsed && parsed.entries) {
        const details: Record<string, CityDetail> = {};
        const meta: Record<string, CityCacheMeta> = {};
        Object.entries(parsed.entries).forEach(([cityName, entry]) => {
          if (!entry?.detail) return;
          const nextMeta = {
            cachedAt: entry.cachedAt || 0,
            revision: entry.revision || getCityRevision(entry.detail),
          };
          if (!isFresh(nextMeta)) return;
          details[cityName] = entry.detail;
          meta[cityName] = nextMeta;
        });
        return { details, meta };
      }

      return readLegacyCache(cached);
    } catch {
      return {
        details: {},
        meta: {},
      } satisfies CityCacheBundle;
    }
  },

  readCityDetailCache() {
    return this.readCityDetailCacheBundle().details;
  },

  writeCityDetailCacheBundle(
    details: Record<string, CityDetail>,
    meta: Record<string, CityCacheMeta>,
  ) {
    if (!isClient()) return;
    // Keep only the 12 most-recently-accessed cities to prevent sessionStorage bloat
    const MAX_CACHED_CITIES = 12;
    const allEntries = Object.entries(details).map(([cityName, detail]) => ({
      cityName,
      cachedAt: meta[cityName]?.cachedAt || 0,
      detail,
      revision: meta[cityName]?.revision || getCityRevision(detail),
    }));
    const topEntries = allEntries
      .sort((a, b) => b.cachedAt - a.cachedAt)
      .slice(0, MAX_CACHED_CITIES);
    const entries = Object.fromEntries(
      topEntries.map((e) => [e.cityName, { cachedAt: e.cachedAt, detail: e.detail, revision: e.revision }]),
    );
    try {
      window.sessionStorage?.setItem(CACHE_KEY, JSON.stringify({ entries }));
    } catch {
      // Storage can be unavailable in embedded/private browser contexts.
    }
  },

  writeCityDetailCache(data: Record<string, CityDetail>) {
    const now = Date.now();
    const meta = Object.fromEntries(
      Object.entries(data).map(([cityName, detail]) => [
        cityName,
        { cachedAt: now, revision: getCityRevision(detail) },
      ]),
    );
    this.writeCityDetailCacheBundle(data, meta);
  },
};
