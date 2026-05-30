"use client";

import { useEffect } from "react";

export function LandingAnalytics() {
  useEffect(() => {
    let active = true;
    void import("@/lib/app-analytics").then(({ markAnalyticsOnce, trackAppEvent }) => {
      if (!active) return;
      if (markAnalyticsOnce("landing_view", "session")) {
        trackAppEvent("landing_view", { entry: "landing" });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
