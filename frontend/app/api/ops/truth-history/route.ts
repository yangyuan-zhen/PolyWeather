import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const auth = await buildBackendRequestHeaders(req);
    const url = new URL(`${API_BASE}/api/ops/truth-history`);
    for (const key of ["city", "date_from", "date_to", "limit"]) {
      const value = req.nextUrl.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString(), {
      headers: auth.headers,
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
      { error: "Failed to fetch truth history", detail: String(error) },
      { status: 500 },
    );
  }
}
