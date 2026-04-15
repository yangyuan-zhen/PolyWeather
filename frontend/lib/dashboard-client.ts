"use client";

import {
  CityDetail,
  CityListItem,
  CitySummary,
  HistoryPayload,
} from "@/lib/dashboard-types";

const CACHE_KEY = "polyWeather_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
const pendingCityDetailRequests = new Map<string, Promise<CityDetail>>();
const pendingHistoryRequests = new Map<string, Promise<HistoryPayload>>();
const pendingCitySummaryRequests = new Map<string, Promise<CitySummary>>();

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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
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
  const meta = Object.fromEntries(
    Object.entries(details).map(([cityName, detail]) => [
      cityName,
      {
        cachedAt,
        revision: getCityRevision(detail),
      },
    ]),
  );
  return { details, meta };
}

export const dashboardClient = {
  clearCityDetailCache() {
    if (!isClient()) return;
    window.sessionStorage.removeItem(CACHE_KEY);
  },

  async getCities() {
    const data = await fetchJson<{ cities?: CityListItem[] }>("/api/cities");
    return data.cities || [];
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
    );
  },

  async getHistory(cityName: string, options?: { includeRecords?: boolean }) {
    const includeRecords = options?.includeRecords === true;
    const requestKey = `${normalizeCityName(cityName)}::${
      includeRecords ? "full" : "preview"
    }`;
    const existing = pendingHistoryRequests.get(requestKey);
    if (existing) {
      return existing;
    }

    const params = new URLSearchParams();
    if (includeRecords) {
      params.set("include_records", "true");
    }

    const request = fetchJson<HistoryPayload>(
      `/api/history/${normalizeCityName(cityName)}${
        params.size ? `?${params.toString()}` : ""
      }`,
    )
      .then((data) => ({
        ...data,
        full_count: Number(data.full_count || 0),
        has_more: data.has_more === true,
        history: Array.isArray(data.history) ? data.history : [],
        mode: (data.mode === "full" ? "full" : "preview") as
          | "full"
          | "preview",
        preview_count: Number(data.preview_count || 0),
      }))
      .finally(() => {
        pendingHistoryRequests.delete(requestKey);
      });

    pendingHistoryRequests.set(requestKey, request);
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
          details[cityName] = entry.detail;
          meta[cityName] = {
            cachedAt: entry.cachedAt || 0,
            revision: entry.revision || getCityRevision(entry.detail),
          };
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
    const entries = Object.fromEntries(
      Object.entries(details).map(([cityName, detail]) => [
        cityName,
        {
          cachedAt: meta[cityName]?.cachedAt || Date.now(),
          detail,
          revision: meta[cityName]?.revision || getCityRevision(detail),
        },
      ]),
    );
    window.sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ entries }),
    );
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
