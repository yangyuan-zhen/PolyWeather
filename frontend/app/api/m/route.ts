import { NextRequest, NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json({ error: "API not configured" }, { status: 500 });
  }
  const auth = await buildBackendRequestHeaders(req, { includeSupabaseIdentity: false });
  const res = await fetch(`${API_BASE}/m/json`, { headers: auth.headers });
  return NextResponse.json(await res.json());
}
