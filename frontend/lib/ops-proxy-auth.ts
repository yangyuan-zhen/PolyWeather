import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  type BackendHeaderBuildResult,
} from "@/lib/backend-auth";

function hasBearerAuth(request: NextRequest) {
  const raw = request.headers.get("authorization");
  if (!raw) return false;
  const parts = raw.trim().split(/\s+/);
  return parts.length === 2 && parts[0].toLowerCase() === "bearer" && Boolean(parts[1]);
}

export function requireOpsProxyAuth(
  request: NextRequest,
  auth: BackendHeaderBuildResult,
): NextResponse | null {
  if (auth.authUserId || hasBearerAuth(request)) return null;
  return applyAuthResponseCookies(
    NextResponse.json(
      { error: "Unauthorized", detail: "Supabase session required" },
      { status: 401 },
    ),
    auth.response,
  );
}
