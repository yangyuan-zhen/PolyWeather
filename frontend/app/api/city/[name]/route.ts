import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";
import { buildCachedJsonResponse } from "@/lib/http-cache";
import { buildCityDetailProxyCachePolicy } from "@/lib/proxy-cache-policy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function buildFallbackCityDetail(name: string, depth: string, summary: Record<string, any>) {
  const nowIso = new Date().toISOString();
  return {
    detail_depth: depth,
    name,
    display_name: summary?.display_name || name,
    lat: 0,
    lon: 0,
    utc_offset_seconds: summary?.utc_offset_seconds ?? null,
    temp_symbol: summary?.temp_symbol || "°C",
    local_time: summary?.local_time || "--:--",
    local_date: nowIso.slice(0, 10),
    risk: {
      level: summary?.risk?.level || "medium",
      warning: summary?.risk?.warning || null,
      airport: summary?.display_name || name,
      icao: summary?.icao || null,
    },
    current: {
      temp: summary?.current?.temp ?? null,
      max_so_far: summary?.current?.temp ?? null,
      max_temp_time: summary?.current?.obs_time || null,
      wu_settlement: null,
      settlement_source: summary?.current?.settlement_source || null,
      settlement_source_label: summary?.current?.settlement_source_label || null,
      station_code: summary?.icao || null,
      station_name: summary?.display_name || name,
      obs_time: summary?.current?.obs_time || null,
      obs_age_min: null,
      observation_status: "missing",
      wind_speed_kt: null,
      wind_dir: null,
      humidity: null,
      cloud_desc: null,
      clouds_raw: [],
      visibility_mi: null,
      wx_desc: null,
      raw_metar: null,
      report_time: null,
      receipt_time: null,
      obs_time_epoch: null,
    },
    deb: {
      prediction: summary?.deb?.prediction ?? null,
    },
    deviation_monitor: summary?.deviation_monitor || {},
    forecast: {
      today_high: null,
      daily: [],
      sunrise: null,
      sunset: null,
      sunshine_hours: null,
    },
    multi_model: {},
    probabilities: {
      mu: null,
      distribution: [],
      distribution_all: [],
      engine: "legacy",
      calibration_mode: "legacy",
      calibration_version: null,
      raw_mu: null,
      raw_sigma: null,
      calibrated_mu: null,
      calibrated_sigma: null,
      shadow_distribution: [],
      shadow_distribution_all: [],
    },
    trend: {
      direction: "unknown",
      recent: [],
      is_cooling: false,
      is_dead_market: false,
    },
    peak: {
      hours: [],
      first_h: null,
      last_h: null,
      status: "unknown",
    },
    dynamic_commentary: {
      summary: "",
      notes: [],
    },
    market_scan: null,
    intraday_meteorology: null,
    updated_at: summary?.updated_at || nowIso,
    fallback_source: "summary",
  };
}

function normalizeCityDetailPayload(data: unknown) {
  if (!data || typeof data !== "object") return data;
  const payload = data as Record<string, any>;
  if (!payload.market_scan && payload.market_scan_payload) {
    return {
      ...payload,
      market_scan: payload.market_scan_payload,
    };
  }
  return payload;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  if (!API_BASE) {
    const response = NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
    return response;
  }

  const { name } = await context.params;
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const depth = req.nextUrl.searchParams.get("depth") ?? "panel";
  const cachePolicy = buildCityDetailProxyCachePolicy(forceRefresh, 15);
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}?force_refresh=${forceRefresh}&depth=${encodeURIComponent(depth)}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(url, {
      headers: auth.headers,
      ...(cachePolicy.fetchMode === "no-store"
        ? { cache: "no-store" as const }
        : { next: { revalidate: cachePolicy.revalidateSeconds ?? 15 } }),
    });
    if (!res.ok) {
      const raw = await res.text();
      const summaryUrl = `${API_BASE}/api/city/${encodeURIComponent(name)}/summary?force_refresh=${forceRefresh}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: auth.headers,
        ...(cachePolicy.fetchMode === "no-store"
          ? { cache: "no-store" as const }
          : { next: { revalidate: 10 } }),
      });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        const response = buildCachedJsonResponse(
          req,
          buildFallbackCityDetail(name, depth, summaryData),
          cachePolicy.fetchMode === "no-store"
            ? cachePolicy.responseCacheControl
            : "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
        );
        response.headers.set("X-PolyWeather-Fallback", "summary");
        return applyAuthResponseCookies(response, auth.response);
      }

      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = normalizeCityDetailPayload(await res.json());
    const response = buildCachedJsonResponse(
      req,
      data,
      cachePolicy.responseCacheControl,
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch city detail",
    });
    return response;
  }
}
