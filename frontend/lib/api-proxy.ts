import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";

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
  const body: Record<string, unknown> = {
    error: options?.error || "Upstream request failed",
    upstream_status: upstreamStatus,
  };

  if (shouldExposeProxyErrorDetail()) {
    body.detail = String(rawDetail || "").slice(0, options?.detailLimit ?? 300);
    if (options?.extraDebug) {
      body.proxy_debug = options.extraDebug;
    }
  }

  return NextResponse.json(body, {
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

  return NextResponse.json(body, { status: options.status ?? 500 });
}

export async function proxyBackendJsonGet(
  req: NextRequest,
  options: {
    cacheControl?: string;
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
    url: string;
  },
) {
  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  try {
    auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: options.includeSupabaseIdentity ?? false,
    });
    const res = await fetch(options.url, {
      headers: auth.headers,
      ...(options.fetchCache
        ? { cache: options.fetchCache }
        : { next: { revalidate: options.revalidateSeconds ?? 30 } }),
      signal: options.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: options.detailLimit,
        error: options.error,
      });
      return applyAuthResponseCookies(response, auth.response);
    }

    const data = await res.json();
    const response =
      options.cacheControl && options.conditionalResponse !== false
        ? buildCachedJsonResponse(req, data, options.cacheControl)
        : NextResponse.json(data, {
            headers: options.cacheControl
              ? { "Cache-Control": options.cacheControl }
              : undefined,
          });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const timedOut = options.signal?.aborted === true;
    const response = buildProxyExceptionResponse(error, {
      publicMessage:
        timedOut && options.timeoutPublicMessage
          ? options.timeoutPublicMessage
          : options.publicMessage,
      status: timedOut ? 504 : options.statusOnException,
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  }
}
