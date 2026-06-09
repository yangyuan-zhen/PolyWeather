export type ProxyCachePolicy = {
  fetchMode: "no-store" | "revalidate";
  responseCacheControl: string;
  revalidateSeconds?: number;
};

const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

export function isForceRefreshValue(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function buildForceRefreshProxyCachePolicy(
  forceRefresh: string | null | undefined,
  revalidateSeconds = 15,
): ProxyCachePolicy {
  if (isForceRefreshValue(forceRefresh)) {
    return {
      fetchMode: "no-store",
      responseCacheControl: NO_STORE_CACHE_CONTROL,
    };
  }
  return {
    fetchMode: "revalidate",
    responseCacheControl: `public, max-age=0, s-maxage=${revalidateSeconds}, stale-while-revalidate=${Math.max(
      revalidateSeconds * 3,
      30,
    )}`,
    revalidateSeconds,
  };
}

export function buildCityDetailProxyCachePolicy(
  forceRefresh: string | null | undefined,
  revalidateSeconds = 15,
): ProxyCachePolicy {
  if (isForceRefreshValue(forceRefresh)) {
    return {
      fetchMode: "no-store",
      responseCacheControl: NO_STORE_CACHE_CONTROL,
    };
  }
  return {
    fetchMode: "revalidate",
    responseCacheControl: `public, max-age=${revalidateSeconds}, s-maxage=${revalidateSeconds}, stale-while-revalidate=${Math.max(
      revalidateSeconds * 3,
      30,
    )}`,
    revalidateSeconds,
  };
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
