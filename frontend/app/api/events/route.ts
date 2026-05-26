import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const upstreamUrl = new URL(`${API_BASE.replace(/\/+$/, "")}/api/events`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });

  const upstream = await fetch(upstreamUrl.toString(), {
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      Cookie: req.headers.get("cookie") || "",
    },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `SSE upstream failed with HTTP ${upstream.status}` },
      { status: upstream.status || 502 },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
