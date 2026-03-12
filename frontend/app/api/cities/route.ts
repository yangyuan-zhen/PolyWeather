import { NextRequest, NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${API_BASE}/api/cities`, {
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
      "public, max-age=0, s-maxage=300, stale-while-revalidate=1800",
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch cities", detail: String(error) },
      { status: 500 },
    );
  }
}
