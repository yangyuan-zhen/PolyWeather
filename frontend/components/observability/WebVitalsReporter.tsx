"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

const TRACKED_METRICS = new Set(["INP", "LCP", "FCP"]);
const WEB_VITALS_ENABLED =
  process.env.NEXT_PUBLIC_POLYWEATHER_WEB_VITALS === "true";

export function WebVitalsReporter() {
  const pathname = usePathname();

  if (!WEB_VITALS_ENABLED) {
    return null;
  }

  useReportWebVitals((metric) => {
    if (!TRACKED_METRICS.has(metric.name)) {
      return;
    }

    const payload = {
      id: metric.id,
      metric: metric.name,
      navigationType: metric.navigationType,
      pathname: pathname || "/",
      rating: metric.rating,
      value: metric.value,
    };

    const body = JSON.stringify(payload);
    const url = "/api/vitals";

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }

    void fetch(url, {
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  });

  return null;
}
