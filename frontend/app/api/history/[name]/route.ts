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
  const url = `${API_BASE}/api/history/${encodeURIComponent(name)}`;

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
    return buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch history", detail: String(error) },
      { status: 500 },
    );
  }
}
