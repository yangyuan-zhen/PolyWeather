import { NextRequest, NextResponse } from "next/server";

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
  const params = new URLSearchParams();
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh");
  const targetDate = req.nextUrl.searchParams.get("target_date");

  if (forceRefresh != null) {
    params.set("force_refresh", forceRefresh);
  }
  if (targetDate) {
    params.set("target_date", targetDate);
  }

  const qs = params.toString();
  const url = `${API_BASE}/api/polymarket/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
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
      { error: "Failed to fetch polymarket snapshot", detail: String(error) },
      { status: 500 },
    );
  }
}
