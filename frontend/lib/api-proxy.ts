import { NextResponse } from "next/server";

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
