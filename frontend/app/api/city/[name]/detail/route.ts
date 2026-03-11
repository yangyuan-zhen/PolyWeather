import { NextRequest, NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";

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
  const marketSlug = req.nextUrl.searchParams.get("market_slug");
  const targetDate = req.nextUrl.searchParams.get("target_date");
  const searchParams = new URLSearchParams({
    force_refresh: forceRefresh,
  });
  if (marketSlug) {
    searchParams.set("market_slug", marketSlug);
  }
  if (targetDate) {
    searchParams.set("target_date", targetDate);
  }
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/detail?${searchParams.toString()}`;

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
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch city detail aggregate", detail: String(error) },
      { status: 500 },
    );
  }
}
