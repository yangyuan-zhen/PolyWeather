import { NextResponse } from "next/server";
import {
  getVitalsSummary,
  normalizeMetricName,
  recordVitalsSample,
} from "@/lib/vitals-store";

type VitalsPayload = {
  id?: string;
  metric?: string;
  navigationType?: string;
  pathname?: string;
  rating?: string;
  value?: number;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VitalsPayload;
    const metric = normalizeMetricName(payload.metric);
    if (!metric) {
      return NextResponse.json({ ok: false, error: "metric is required" }, { status: 400 });
    }

    const pathname = String(payload.pathname || "/");
    const rating = String(payload.rating || "unknown");
    const value = Number(payload.value);
    const navigationType = String(payload.navigationType || "unknown");
    const id = String(payload.id || "");
    const ts = Date.now();

    if (!Number.isFinite(value)) {
      return NextResponse.json({ ok: false, error: "value must be finite" }, { status: 400 });
    }

    recordVitalsSample({
      id,
      metric,
      navigationType,
      pathname,
      rating,
      timestamp: ts,
      value,
    });

    // Keep this lightweight: log for now, can be wired to a persistent sink later.
    console.info(
      `[vitals] metric=${metric} path=${pathname} value=${Number.isFinite(value) ? value : "NaN"} rating=${rating} nav=${navigationType} id=${id}`,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[vitals] failed to parse payload", error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetRoute = String(searchParams.get("route") || "").trim();
  const summary = getVitalsSummary();

  if (!targetRoute) {
    return NextResponse.json({ ok: true, ...summary });
  }

  return NextResponse.json({
    ok: true,
    generatedAt: summary.generatedAt,
    route: targetRoute,
    metrics: summary.routes[targetRoute] || {},
  });
}
