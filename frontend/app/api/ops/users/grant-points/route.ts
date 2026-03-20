import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const auth = await buildBackendRequestHeaders(req);
    const body = await req.text();
    const res = await fetch(`${API_BASE}/api/ops/users/grant-points`, {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const raw = await res.text();
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to grant points", detail: String(error) },
      { status: 500 },
    );
  }
}
