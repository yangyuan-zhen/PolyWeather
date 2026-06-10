export type ProxyCachePolicy = {
  fetchMode: "no-store" | "revalidate";
  responseCacheControl: string;
  revalidateSeconds?: number;
};

export const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

export const CLOUDFLARE_EDGE_TTL_SEC = {
  cityDetail: 60,
  cityDetailStale: 300,
  cityList: 300,
  cityListStale: 3600,
  landingPage: 600,
  scanTerminal: 300,
  scanTerminalStale: 900,
  staticAsset: 31536000,
  systemStatus: 60,
} as const;

export function buildPublicEdgeCacheControl(
  sMaxageSeconds: number,
  staleWhileRevalidateSeconds = Math.max(sMaxageSeconds * 3, 30),
  browserMaxAgeSeconds = 0,
) {
  return [
    "public",
    `max-age=${Math.max(0, Math.floor(browserMaxAgeSeconds))}`,
    `s-maxage=${Math.max(1, Math.floor(sMaxageSeconds))}`,
    `stale-while-revalidate=${Math.max(0, Math.floor(staleWhileRevalidateSeconds))}`,
  ].join(", ");
}

export function isForceRefreshValue(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function buildForceRefreshProxyCachePolicy(
  forceRefresh: string | null | undefined,
  revalidateSeconds: number = CLOUDFLARE_EDGE_TTL_SEC.scanTerminal,
): ProxyCachePolicy {
  if (isForceRefreshValue(forceRefresh)) {
    return {
      fetchMode: "no-store",
      responseCacheControl: NO_STORE_CACHE_CONTROL,
    };
  }
  return {
    fetchMode: "revalidate",
    responseCacheControl: buildPublicEdgeCacheControl(
      revalidateSeconds,
      Math.max(revalidateSeconds * 3, CLOUDFLARE_EDGE_TTL_SEC.scanTerminalStale),
    ),
    revalidateSeconds,
  };
}

export function buildCityDetailProxyCachePolicy(
  forceRefresh: string | null | undefined,
  revalidateSeconds: number = CLOUDFLARE_EDGE_TTL_SEC.cityDetail,
): ProxyCachePolicy {
  if (isForceRefreshValue(forceRefresh)) {
    return {
      fetchMode: "no-store",
      responseCacheControl: NO_STORE_CACHE_CONTROL,
    };
  }
  return {
    fetchMode: "revalidate",
    responseCacheControl: buildPublicEdgeCacheControl(
      revalidateSeconds,
      Math.max(revalidateSeconds * 3, CLOUDFLARE_EDGE_TTL_SEC.cityDetailStale),
      Math.min(revalidateSeconds, 30),
    ),
    revalidateSeconds,
  };
}

export function buildCityListCacheControl() {
  return buildPublicEdgeCacheControl(
    CLOUDFLARE_EDGE_TTL_SEC.cityList,
    CLOUDFLARE_EDGE_TTL_SEC.cityListStale,
  );
}

export function buildStaticCityListFallbackCacheControl() {
  return buildPublicEdgeCacheControl(
    CLOUDFLARE_EDGE_TTL_SEC.cityList,
    CLOUDFLARE_EDGE_TTL_SEC.cityListStale,
  );
}

export function buildScanTerminalResponseCacheControl(
  data: unknown,
  readyCacheControl: string,
) {
  if (!data || typeof data !== "object") {
    return NO_STORE_CACHE_CONTROL;
  }
  const payload = data as { stale?: unknown; status?: unknown };
  const status = String(payload.status || "").trim().toLowerCase();
  if (payload.stale === true || (status && status !== "ready")) {
    return NO_STORE_CACHE_CONTROL;
  }
  return readyCacheControl;
}
