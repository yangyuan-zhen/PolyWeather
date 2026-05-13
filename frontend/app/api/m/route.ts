import { NextRequest, NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return new NextResponse("API not configured", { status: 500 });
  }
  const isCards = req.nextUrl.searchParams.get("cards") === "1";
  const asJson = req.nextUrl.searchParams.get("json") === "1";
  const path = asJson ? "/m/json" : isCards ? "/m/cards" : "/m";
  const auth = await buildBackendRequestHeaders(req, { includeSupabaseIdentity: false });
  const res = await fetch(`${API_BASE}${path}`, { headers: auth.headers });
  if (asJson) {
    return NextResponse.json(await res.json());
  }
  const html = await res.text();
  return new NextResponse(html, {
    status: res.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
