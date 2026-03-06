import { NextResponse } from "next/server";

const API_BASE =
  process.env.POLYWEATHER_API_BASE_URL || "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/cities`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 120 },
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
      { error: "Failed to fetch cities", detail: String(error) },
      { status: 500 },
    );
  }
}
