import type { CityDetail, CitySummary } from "@/lib/types";

async function readError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    const msg = data?.error ? String(data.error) : fallback;
    const detail = data?.detail ? ` ${String(data.detail)}` : "";
    return `${msg}${detail}`.trim();
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

export async function getCities(): Promise<CitySummary[]> {
  const res = await fetch("/api/cities", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to load cities (${res.status})`));
  }
  const data = await res.json();
  return data.cities ?? [];
}

export async function getCityDetail(
  cityName: string,
  forceRefresh = false,
): Promise<CityDetail> {
  const slug = cityName.replace(/\s/g, "-");
  const res = await fetch(
    `/api/city/${encodeURIComponent(slug)}?force_refresh=${forceRefresh}`,
    {
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(
      await readError(res, `Failed to load city detail (${res.status})`),
    );
  }
  return await res.json();
}
