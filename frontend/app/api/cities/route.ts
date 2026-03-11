import { NextResponse } from "next/server";
import { buildBackendRequestHeaders } from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET() {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${API_BASE}/api/cities`, {
      headers: buildBackendRequestHeaders(),
      next: { revalidate: 120 },
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
      { error: "Failed to fetch cities", detail: String(error) },
      { status: 500 },
    );
  }
}
