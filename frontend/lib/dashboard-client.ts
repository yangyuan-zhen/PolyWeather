"use client";

import {
  CityDetail,
  CityListItem,
  CitySummary,
  HistoryPayload,
  MarketScan,
  ScanTerminalFilters,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";

export type AssistantOpportunityContext = {
  city_name: string;
  city_display_name: string;
  airport?: string | null;
  risk_level: string;
  tradable: boolean;
  local_time?: string | null;
  current_temperature?: number | null;
  deb_prediction?: number | null;
  temp_symbol?: string | null;
  today_high?: number | null;
  market_question?: string | null;
  market_label?: string | null;
  selected_date?: string | null;
  best_side?: string | null;
  yes_price?: number | null;
  no_price?: number | null;
  edge_percent?: number | null;
  market_probability?: number | null;
  model_probability?: number | null;
  status?: string | null;
};

export type AssistantContextPayload = {
  snapshot_id: string;
  locale: string;
  generated_at: string;
  totals: {
    cities: number;
    tradable_markets: number;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
  };
  selected_city?: AssistantOpportunityContext | null;
  opportunities: AssistantOpportunityContext[];
  glossary: Array<{
    term: string;
    meaning: string;
  }>;
};

export type AssistantChatResponse = {
  answer: string;
  cached?: boolean;
  model?: string;
  refused?: boolean;
  snapshot_id?: string;
  suggestions?: string[];
};

const CACHE_KEY = "polyWeather_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
const pendingCityDetailRequests = new Map<string, Promise<CityDetail>>();
const pendingHistoryRequests = new Map<string, Promise<HistoryPayload>>();
const pendingCitySummaryRequests = new Map<string, Promise<CitySummary>>();
const pendingCityMarketScanRequests = new Map<
  string,
  Promise<{
    fetched_at?: string | null;
    market_scan?: MarketScan | null;
    selected_date?: string | null;
  }>
>();
const pendingAssistantRequests = new Map<string, Promise<AssistantChatResponse>>();
const pendingScanTerminalRequests = new Map<string, Promise<ScanTerminalResponse>>();
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

  sendPriorityWarmHint(timezone?: string | null) {
    if (!isClient()) return;
    const tz = String(
      timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    ).trim();
    if (!tz) return;
    const cacheKey = `${PRIORITY_WARM_SESSION_KEY}:${tz}`;
    if (window.sessionStorage.getItem(cacheKey)) return;
    window.sessionStorage.setItem(cacheKey, "1");
    const params = new URLSearchParams({ timezone: tz });
    void fetch(`/api/system/priority-warm?${params.toString()}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
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
    const request = fetchJson<{
      fetched_at?: string | null;
      market_scan?: MarketScan | null;
      selected_date?: string | null;
    }>(`/api/city/${normalizeCityName(cityName)}/market-scan?${params.toString()}`).finally(
      () => {
        pendingCityMarketScanRequests.delete(requestKey);
      },
    );
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
    ).finally(() => {
      pendingScanTerminalRequests.delete(requestKey);
    });
    if (!force) {
      pendingScanTerminalRequests.set(requestKey, request);
    }
    return request;
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

  async askAssistant(payload: {
    question: string;
    locale: string;
    snapshotId: string;
    context: AssistantContextPayload;
  }) {
    const question = String(payload.question || "").trim();
    const snapshotId = String(payload.snapshotId || "").trim();
    if (!question) {
      throw new Error("Question is required");
    }
    if (!snapshotId) {
      throw new Error("Snapshot id is required");
    }

    const requestKey = [
      snapshotId,
      payload.locale,
      question.toLowerCase(),
    ].join("::");
    const existing = pendingAssistantRequests.get(requestKey);
    if (existing) {
      return existing;
    }

    const request = fetch("/api/assistant/chat", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        question,
        locale: payload.locale,
        snapshot_id: snapshotId,
        context: payload.context,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<AssistantChatResponse>;
      })
      .finally(() => {
        pendingAssistantRequests.delete(requestKey);
      });

    pendingAssistantRequests.set(requestKey, request);
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
