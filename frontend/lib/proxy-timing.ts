import type { NextRequest, NextResponse } from "next/server";

export type ProxyTimingStage = {
  durationMs: number;
  name: string;
};

export type ProxyTimer = {
  hasAuthorization: boolean;
  hasSupabaseCookie: boolean;
  measure<T>(name: string, action: () => Promise<T>): Promise<T>;
  measureSync<T>(name: string, action: () => T): T;
  route: string;
  stages: ProxyTimingStage[];
  totalMs(): number;
};

function proxyNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function hasRequestSupabaseSessionCookie(req: NextRequest) {
  return req.cookies.getAll().some((cookie) => {
    const name = cookie.name.toLowerCase();
    const value = String(cookie.value || "").trim();
    return Boolean(
      value &&
        (name === "supabase-auth-token" ||
          (name.startsWith("sb-") && name.includes("-auth-token"))),
    );
  });
}

export function createProxyTimer(req: NextRequest, route: string): ProxyTimer {
  const startedAt = proxyNowMs();
  const stages: ProxyTimingStage[] = [];
  const recordStage = (name: string, stageStartedAt: number) => {
    stages.push({
      durationMs: Math.round((proxyNowMs() - stageStartedAt) * 10) / 10,
      name,
    });
  };

  return {
    hasAuthorization: Boolean(req.headers.get("authorization")),
    hasSupabaseCookie: hasRequestSupabaseSessionCookie(req),
    async measure<T>(name: string, action: () => Promise<T>) {
      const stageStartedAt = proxyNowMs();
      try {
        return await action();
      } finally {
        recordStage(name, stageStartedAt);
      }
    },
    measureSync<T>(name: string, action: () => T) {
      const stageStartedAt = proxyNowMs();
      try {
        return action();
      } finally {
        recordStage(name, stageStartedAt);
      }
    },
    route,
    stages,
    totalMs() {
      return Math.round((proxyNowMs() - startedAt) * 10) / 10;
    },
  };
}

function formatServerTiming(stages: ProxyTimingStage[]) {
  return stages
    .map(({ durationMs, name }) => {
      const safeName = name.replace(/[^A-Za-z0-9_-]/g, "_");
      return `${safeName};dur=${Math.max(0, durationMs).toFixed(1)}`;
    })
    .join(", ");
}

export function finishProxyTimedResponse(
  response: NextResponse,
  timer: ProxyTimer,
  outcome: string,
  extra?: { backendServerTiming?: string },
) {
  const total = timer.totalMs();
  const ownServerTiming = formatServerTiming(
    [...timer.stages, { durationMs: total, name: "total" }].map((stage) => ({
      ...stage,
      name: `${timer.route}_${stage.name}`,
    })),
  );
  const backendServerTiming = String(extra?.backendServerTiming || "").trim();
  response.headers.set(
    "Server-Timing",
    backendServerTiming
      ? `${ownServerTiming}, ${backendServerTiming}`
      : ownServerTiming,
  );
  console.info(
    "[api-proxy-timing]",
    JSON.stringify({
      hasAuthorization: timer.hasAuthorization,
      hasSupabaseCookie: timer.hasSupabaseCookie,
      outcome,
      route: timer.route,
      stages: timer.stages,
      status: response.status,
      totalMs: total,
    }),
  );
  return response;
}
