export type ProxyCachePolicy = {
  fetchMode: "no-store" | "revalidate";
  responseCacheControl: string;
  revalidateSeconds?: number;
};

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
      responseCacheControl: "no-store, max-age=0",
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
      responseCacheControl: "no-store, max-age=0",
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
