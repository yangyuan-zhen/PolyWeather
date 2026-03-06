import { NextRequest, NextResponse } from "next/server";

const API_BASE =
  process.env.POLYWEATHER_API_BASE_URL || "http://127.0.0.1:8000";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}?force_refresh=${forceRefresh}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Backend returned ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch city detail", detail: String(error) },
      { status: 500 },
    );
  }
}
