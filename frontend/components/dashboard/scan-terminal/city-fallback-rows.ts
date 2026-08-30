import type { CityListItem, ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  REGIONS,
  getCityRegion,
  type RegionKey,
} from "@/components/dashboard/scan-terminal/continent-grouping";

const CITY_LIST_CACHE_KEY = "polyweather_city_list_v1";
export const CITY_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CityListCacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function normalizeCityKey(value: string) {
  return String(value || "").trim().toLowerCase();
}

function getCityListCacheStorage(storage?: CityListCacheStorage): CityListCacheStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCachedCityList(
  storage?: CityListCacheStorage,
  now = Date.now(),
): CityListItem[] | null {
  const cacheStorage = getCityListCacheStorage(storage);
  if (!cacheStorage) return null;
  try {
    const raw = cacheStorage.getItem(CITY_LIST_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const age = now - Number(cached.ts || 0);
    if (age < 0 || age >= CITY_LIST_CACHE_TTL_MS || !Array.isArray(cached.cities)) {
      return null;
    }
    return cached.cities as CityListItem[];
  } catch {
    try { cacheStorage.removeItem(CITY_LIST_CACHE_KEY); } catch {}
  }
  return null;
}

export function writeCachedCityList(
  cities: CityListItem[],
  storage?: CityListCacheStorage,
  now = Date.now(),
) {
  const cacheStorage = getCityListCacheStorage(storage);
  if (!cacheStorage || !Array.isArray(cities) || !cities.length) return;
  try {
    cacheStorage.setItem(
      CITY_LIST_CACHE_KEY,
      JSON.stringify({ ts: now, cities }),
    );
  } catch {}
}

function tempSymbolForCity(city: CityListItem) {
  return city.temp_unit === "fahrenheit" ? "°F" : "°C";
}

function regionFromTzOffset(tzOffsetSeconds: number): (typeof REGIONS)[number] {
  const hours = tzOffsetSeconds / 3600;
  if (hours >= 8) return REGIONS[0];
  if (hours >= 7) return REGIONS[1];
  if (hours >= 4.5) return REGIONS[2];
  if (hours >= 2) return REGIONS[3];
  if (hours >= -2) return REGIONS[4];
  if (hours >= -4) return REGIONS[5];
  return REGIONS[6];
}

function resolveRegion(cityKey: string, tzOffsetSeconds: number) {
  const configuredRegion = getCityRegion({ city: cityKey, id: `region:${cityKey}` } as ScanOpportunityRow);
  if (configuredRegion) {
    return REGIONS.find((region) => region.key === configuredRegion) || regionFromTzOffset(tzOffsetSeconds);
  }
  return regionFromTzOffset(tzOffsetSeconds);
}

export function cityListItemsToScanRows(cities: CityListItem[]): ScanOpportunityRow[] {
  return cities
    .filter((city) => normalizeCityKey(city.name))
    .map((city) => {
      const cityKey = normalizeCityKey(city.name);
      const region = resolveRegion(cityKey, city.utc_offset_seconds ?? 0);
      return {
        active: true,
        airport: city.airport || city.icao || null,
        city: cityKey,
        city_display_name: city.display_name || city.name,
        closed: false,
        current_temp: null,
        deb_prediction: null,
        display_name: city.display_name || city.name,
        id: `city-fallback:${cityKey}`,
        is_primary_signal: true,
        local_time: null,
        risk_level: city.risk_level || null,
        temp_symbol: tempSymbolForCity(city),
        tradable: false,
        trading_region: region.key as RegionKey,
        trading_region_label: region.labelEn,
        trading_region_label_zh: region.labelZh,
        trading_region_sort: region.sort,
        tz_offset_seconds: city.utc_offset_seconds ?? 0,
      };
    });
}

export function mergeScanRowsWithCityFallbackRows(
  scanRows: ScanOpportunityRow[],
  fallbackRows: ScanOpportunityRow[],
): ScanOpportunityRow[] {
  const merged = [...(scanRows || [])];
  const seen = new Set<string>();

  for (const row of merged) {
    const key = normalizeCityKey(row.city || row.city_display_name || row.display_name || "");
    if (key) seen.add(key);
  }

  for (const row of fallbackRows || []) {
    const key = normalizeCityKey(row.city || row.city_display_name || row.display_name || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged;
}
