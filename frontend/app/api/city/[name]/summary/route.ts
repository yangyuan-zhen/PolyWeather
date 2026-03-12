import { NextRequest, NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const { name } = await context.params;
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const bypassCache = forceRefresh === "true";
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/summary?force_refresh=${forceRefresh}`;

  try {
    const res = await fetch(url, {
      headers: buildBackendRequestHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 300) },
        { status: 502 },
      );
    }
    const data = await res.json();
    if (bypassCache) {
      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }
    return buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch city summary", detail: String(error) },
      { status: 500 },
    );
  }
}
