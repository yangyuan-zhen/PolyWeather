import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  type BackendHeaderBuildResult,
} from "@/lib/backend-auth";
import { isLocalOpsAccessHost } from "@/lib/ops-local-access";

function hasBearerAuth(request: NextRequest) {
  const raw = request.headers.get("authorization");
  if (!raw) return false;
  const parts = raw.trim().split(/\s+/);
  return parts.length === 2 && parts[0].toLowerCase() === "bearer" && Boolean(parts[1]);
}

function isLocalOpsAccessRequest(request: NextRequest) {
  const requestHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;
  return (
    isLocalOpsAccessHost(requestHost) ||
    isLocalOpsAccessHost(request.nextUrl.hostname)
  );
}

export function requireOpsProxyAuth(
  request: NextRequest,
  auth: BackendHeaderBuildResult,
): NextResponse | null {
  if (isLocalOpsAccessRequest(request)) return null;
  if (auth.authUserId || hasBearerAuth(request)) return null;
  return applyAuthResponseCookies(
    NextResponse.json(
      { error: "Unauthorized", detail: "Supabase session required" },
      { status: 401 },
    ),
    auth.response,
  );
}
