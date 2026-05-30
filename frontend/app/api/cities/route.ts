import { NextRequest } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { buildCachedJsonResponse } from "@/lib/http-cache";
import { STATIC_CITY_LIST } from "@/lib/static-cities";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const CITIES_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const STATIC_CITIES_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
const CITIES_BACKEND_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_CITIES_BACKEND_TIMEOUT_MS || 1000,
);

function staticCitiesFallback(req: NextRequest, reason: string) {
  const response = buildCachedJsonResponse(
    req,
    {
      cities: STATIC_CITY_LIST,
      source: "static_fallback",
      stale: true,
    },
    STATIC_CITIES_CACHE_CONTROL,
  );
  response.headers.set("x-polyweather-cities-source", "static-fallback");
  response.headers.set("x-polyweather-cities-fallback-reason", reason);
  return response;
}

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return staticCitiesFallback(req, "missing-api-base");
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CITIES_BACKEND_TIMEOUT_MS);

  try {
    const response = await proxyBackendJsonGet(req, {
      cacheControl: CITIES_CACHE_CONTROL,
      publicMessage: "Failed to fetch cities",
      revalidateSeconds: 60,
      signal: abortController.signal,
      statusOnException: 504,
      timeoutPublicMessage: "Cities backend timed out",
      url: `${API_BASE}/api/cities`,
    });

    if (response.status >= 500) {
      return staticCitiesFallback(
        req,
        response.status === 504 ? "backend-timeout" : "backend-error",
      );
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
