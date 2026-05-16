"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import type { useDashboardStore } from "@/hooks/useDashboardStore";
import {
  findDetailForCity,
  isFullEnoughForDeepAnalysis,
} from "@/components/dashboard/scan-terminal/city-detail-utils";
import {
  findRowForCity,
  normalizeCityKey,
  prettifyCityName,
} from "@/components/dashboard/scan-terminal/decision-utils";
import type { AiPinnedCity } from "@/components/dashboard/scan-terminal/types";

type DashboardStore = ReturnType<typeof useDashboardStore>;

export function useAiPinnedCityWorkspace({
  locale,
  store,
  timeSortedRows,
}: {
  locale: string;
  store: DashboardStore;
  timeSortedRows: ScanOpportunityRow[];
}) {
  const [aiPinnedCities, setAiPinnedCities] = useState<AiPinnedCity[]>([]);
  const aiFullHydrationRef = useRef<Set<string>>(new Set());
  const aiHydrationQueueRef = useRef<string[]>([]);
  const aiHydrationRunningRef = useRef(false);
  const aiHydrationRetriesRef = useRef<Map<string, number>>(new Map());

  const runAiHydrationQueue = useCallback(async () => {
    if (aiHydrationRunningRef.current) return;
    aiHydrationRunningRef.current = true;
    try {
      while (aiHydrationQueueRef.current.length > 0) {
        const nextCity = aiHydrationQueueRef.current.shift();
        const key = normalizeCityKey(nextCity || "");
        if (!nextCity || !key) continue;
        const existingDetail = findDetailForCity(store.cityDetailsByName, nextCity);
        try {
          const detail = await store.ensureCityDetail(
            nextCity,
            false,
            "full",
          );
          if (!isFullEnoughForDeepAnalysis(detail)) {
            const retries = aiHydrationRetriesRef.current.get(key) || 0;
            if (retries >= 3) {
              aiFullHydrationRef.current.delete(key);
              aiHydrationRetriesRef.current.delete(key);
            } else {
              aiHydrationRetriesRef.current.set(key, retries + 1);
            }
          }
        } catch {
          const retries = aiHydrationRetriesRef.current.get(key) || 0;
          if (retries >= 3) {
            aiFullHydrationRef.current.delete(key);
            aiHydrationRetriesRef.current.delete(key);
          } else {
            aiHydrationRetriesRef.current.set(key, retries + 1);
          }
        }
      }
    } finally {
      aiHydrationRunningRef.current = false;
      if (aiHydrationQueueRef.current.length > 0) {
        void runAiHydrationQueue();
      }
    }
  }, [store.cityDetailsByName, store.ensureCityDetail]);

  const queueAiFullHydration = useCallback(
    (cityName: string) => {
      const key = normalizeCityKey(cityName);
      if (!key || aiFullHydrationRef.current.has(key)) return;
      aiFullHydrationRef.current.add(key);
      aiHydrationQueueRef.current.push(cityName);
      void runAiHydrationQueue();
    },
    [runAiHydrationQueue],
  );

  const addAiPinnedCity = useCallback((cityName: string) => {
    const cleanName = String(cityName || "").trim();
    const key = normalizeCityKey(cleanName);
    if (!key) return;
    const matchedRow = findRowForCity(timeSortedRows, cleanName);
    const prettyName = prettifyCityName(cleanName);
    const displayName =
      matchedRow?.city_display_name ||
      matchedRow?.display_name ||
      getLocalizedCityName(cleanName, prettyName || cleanName, locale) ||
      prettyName ||
      cleanName;
    setAiPinnedCities((current) => {
      const existing = current.findIndex(
        (item) => normalizeCityKey(item.cityName) === key,
      );
      const nextItem = {
        cityName: matchedRow?.city || cleanName,
        displayName,
        addedAt: Date.now(),
      };
      if (existing >= 0) {
        const next = [...current];
        next[existing] = { ...next[existing], ...nextItem };
        return [
          next[existing],
          ...next.filter((_, index) => index !== existing),
        ];
      }
      return [nextItem, ...current].slice(0, 8);
    });
    queueAiFullHydration(matchedRow?.city || cleanName);
  }, [locale, queueAiFullHydration, timeSortedRows]);

  const removeAiPinnedCity = useCallback((cityName: string) => {
    const key = normalizeCityKey(cityName);
    aiFullHydrationRef.current.delete(key);
    aiHydrationQueueRef.current = aiHydrationQueueRef.current.filter(
      (queuedCity) => normalizeCityKey(queuedCity) !== key,
    );
    setAiPinnedCities((current) =>
      current.filter((item) => normalizeCityKey(item.cityName) !== key),
    );
  }, []);

  const refreshAiPinnedCityDetail = useCallback(
    async (cityName: string) => {
      const key = normalizeCityKey(cityName);
      if (key) {
        aiFullHydrationRef.current.delete(key);
      }
      await store.ensureCityDetail(cityName, true, "full");
    },
    [store.ensureCityDetail],
  );

  useEffect(() => {
    aiPinnedCities.forEach((item) => {
      const key = normalizeCityKey(item.cityName);
      if (!key || aiFullHydrationRef.current.has(key)) return;
      const retries = aiHydrationRetriesRef.current.get(key) || 0;
      if (retries >= 3) return;
      const detail = findDetailForCity(store.cityDetailsByName, item.cityName);
      const needsFullHydration = !isFullEnoughForDeepAnalysis(detail);
      if (!needsFullHydration) return;
      queueAiFullHydration(item.cityName);
    });
  }, [aiPinnedCities, queueAiFullHydration, store.cityDetailsByName]);

  return {
    addAiPinnedCity,
    aiPinnedCities,
    refreshAiPinnedCityDetail,
    removeAiPinnedCity,
  };
}
