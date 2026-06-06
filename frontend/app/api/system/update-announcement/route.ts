import { NextResponse } from "next/server";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const BACKEND = API_BASE ? `${API_BASE}/api/system/update-announcement` : "";

export async function GET() {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(BACKEND, { cache: "no-store" });
    const raw = await res.text();
    return new NextResponse(raw, {
      status: res.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch update announcement",
    });
  }
}
