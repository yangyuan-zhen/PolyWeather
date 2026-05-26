"use client";

import { useEffect } from "react";

/**
 * Warms the backend cache for public API endpoints while the user reads
 * the landing page, so the first terminal load after login is faster.
 *
 * - /api/cities  (public, triggers Python process warmup and connection pool init)
 * - scan terminal (protected — skipped here; prefetched by the terminal
 *   component's stagger loading after login)
 */
export function PreloadTerminalData() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof fetch !== "function") return;

    const controller = new AbortController();

    // Delay 2s so the landing page critical assets load first
    const t = setTimeout(
      () =>
        fetch("/api/cities", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        }).catch(() => {}),
      2000,
    );

    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, []);

  return null;
}
