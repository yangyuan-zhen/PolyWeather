import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";
import {
  finishProxyTimedResponse,
  type ProxyTimer,
} from "@/lib/proxy-timing";
import { NO_STORE_CACHE_CONTROL } from "@/lib/proxy-cache-policy";

const PASSTHROUGH_UPSTREAM_STATUSES = new Set([
  400,
  401,
  402,
  403,
  404,
  409,
  422,
  429,
]);

function shouldExposeProxyErrorDetail() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.POLYWEATHER_EXPOSE_PROXY_ERROR_DETAIL === "true"
  );
}

function looksLikeHtmlDocument(value: string) {
  const text = String(value || "").trim().toLowerCase();
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    /<title>[^<]*(50\d|cloudflare|polyweather\.top)/i.test(String(value || ""))
  );
}

function extractSafeUpstreamJsonMessage(rawDetail: string) {
  try {
    const parsed = JSON.parse(String(rawDetail || "")) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const message = [parsed.detail, parsed.error, parsed.message].find(
      (item) => typeof item === "string" && item.trim(),
    );
    if (typeof message !== "string") return "";
    const trimmed = message.trim();
    return looksLikeHtmlDocument(trimmed) ? "" : trimmed;
  } catch {
    return "";
  }
}

export function clientStatusFromUpstream(status: number) {
  if (PASSTHROUGH_UPSTREAM_STATUSES.has(status)) {
    return status;
  }
  return 502;
}

export function buildUpstreamErrorResponse(
  upstreamStatus: number,
  rawDetail: string,
  options?: {
    detailLimit?: number;
    error?: string;
    extraDebug?: Record<string, unknown>;
  },
) {
  const safeJsonMessage = extractSafeUpstreamJsonMessage(rawDetail);
  const body: Record<string, unknown> = {
    error: options?.error || safeJsonMessage || "Upstream request failed",
    upstream_status: upstreamStatus,
  };

  if (shouldExposeProxyErrorDetail()) {
    body.detail = String(rawDetail || "").slice(0, options?.detailLimit ?? 300);
    if (options?.extraDebug) {
      body.proxy_debug = options.extraDebug;
    }
  }

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": NO_STORE_CACHE_CONTROL,
      "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
    },
    status: clientStatusFromUpstream(upstreamStatus),
  });
}

export function buildProxyExceptionResponse(
  error: unknown,
  options: {
    status?: number;
    publicMessage: string;
    extra?: Record<string, unknown>;
  },
) {
  const body: Record<string, unknown> = {
    error: options.publicMessage,
    ...(options.extra || {}),
  };

  if (shouldExposeProxyErrorDetail()) {
    body.detail = String(error);
  }

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": NO_STORE_CACHE_CONTROL,
      "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
    },
    status: options.status ?? 500,
  });
}

export async function proxyBackendJsonGet(
  req: NextRequest,
  options: {
    cacheControl?: string;
    cacheControlForData?: (data: unknown) => string | undefined;
    conditionalResponse?: boolean;
    detailLimit?: number;
    error?: string;
    fetchCache?: RequestCache;
    includeSupabaseIdentity?: boolean;
    publicMessage: string;
    revalidateSeconds?: number;
    signal?: AbortSignal;
    statusOnException?: number;
    timeoutPublicMessage?: string;
    timeoutResponse?: () => NextResponse;
    timing?: ProxyTimer;
    url: string;
  },
) {
  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  const timing = options.timing;
  try {
    auth = await (timing
      ? timing.measure("auth_headers", () =>
          buildBackendRequestHeaders(req, {
            includeSupabaseIdentity: options.includeSupabaseIdentity ?? false,
          }),
        )
      : buildBackendRequestHeaders(req, {
          includeSupabaseIdentity: options.includeSupabaseIdentity ?? false,
        }));
    const res = await (timing
      ? timing.measure("backend_fetch", () =>
          fetch(options.url, {
            headers: auth!.headers,
            ...(options.fetchCache
              ? { cache: options.fetchCache }
              : { next: { revalidate: options.revalidateSeconds ?? 30 } }),
            signal: options.signal,
          }),
        )
      : fetch(options.url, {
          headers: auth.headers,
          ...(options.fetchCache
            ? { cache: options.fetchCache }
            : { next: { revalidate: options.revalidateSeconds ?? 30 } }),
          signal: options.signal,
        }));
    const backendServerTiming = res.headers.get("server-timing") || "";
    if (!res.ok) {
      const raw = await (timing
        ? timing.measure("backend_read", () => res.text())
        : res.text());
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: options.detailLimit,
        error: options.error,
      });
      const withCookies = applyAuthResponseCookies(response, auth.response);
      return timing
        ? finishProxyTimedResponse(withCookies, timing, `upstream_${res.status}`, {
            backendServerTiming,
          })
        : withCookies;
    }

    const data = await (timing
      ? timing.measure("backend_read", () => res.json())
      : res.json());
    const responseCacheControl =
      options.cacheControlForData?.(data) ?? options.cacheControl;
    const response =
      responseCacheControl && options.conditionalResponse !== false
        ? buildCachedJsonResponse(req, data, responseCacheControl)
        : NextResponse.json(data, {
            headers: responseCacheControl
              ? {
                  "Cache-Control": responseCacheControl,
                  "Cloudflare-CDN-Cache-Control": responseCacheControl,
                }
              : undefined,
          });
    const withCookies = applyAuthResponseCookies(response, auth.response);
    return timing
      ? finishProxyTimedResponse(withCookies, timing, "ok", {
          backendServerTiming,
        })
      : withCookies;
  } catch (error) {
    const timedOut = options.signal?.aborted === true;
    const response =
      timedOut && options.timeoutResponse
        ? options.timeoutResponse()
        : buildProxyExceptionResponse(error, {
            publicMessage:
              timedOut && options.timeoutPublicMessage
                ? options.timeoutPublicMessage
                : options.publicMessage,
            status: timedOut ? 504 : options.statusOnException,
          });
    const withCookies = auth
      ? applyAuthResponseCookies(response, auth.response)
      : response;
    const outcome =
      timedOut && options.timeoutResponse
        ? "timeout_fallback"
        : timedOut
          ? "timeout"
          : "exception";
    return timing
      ? finishProxyTimedResponse(withCookies, timing, outcome)
      : withCookies;
  }
}
