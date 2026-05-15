"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { scanTerminalClient } from "@/components/dashboard/scan-terminal/scan-terminal-client";
import type { AiCityForecastState } from "@/components/dashboard/scan-terminal/types";
import type { CityDetail } from "@/lib/dashboard-types";
import {
  buildAiCityErrorForecastState,
  buildAiCityForecastCacheKey,
  buildAiCityForecastKey,
  buildAiCityForecastRequestKey,
  buildAiCityLoadingForecastState,
  buildAiCityProgressForecastState,
  buildAiCityReadyForecastState,
  readReadyCachedAiForecastState,
} from "./ai-city-forecast-stream-state";

const AI_CITY_READ_SOFT_TIMEOUT_MS = 4_500;

export function useAiCityForecast({
  detail,
  detailCityName,
  isEn,
  locale,
  report,
  enabled = true,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  enabled?: boolean;
  isEn: boolean;
  locale: string;
  report: string;
}) {
  const [aiRefreshToken, setAiRefreshToken] = useState(0);
  const aiForecastKey = useMemo(
    () => buildAiCityForecastKey({ detail, detailCityName, locale, report }),
    [detail, detailCityName, locale, report],
  );

  const [aiForecast, setAiForecast] = useState<AiCityForecastState>(() => {
    if (!enabled || !aiForecastKey) return { status: "idle" };
    const cacheKey = buildAiCityForecastCacheKey(aiForecastKey);
    const cached = readReadyCachedAiForecastState(cacheKey, 0);
    if (cached) return cached;
    return { status: "idle" };
  });

  useEffect(() => {
    if (!enabled || !aiForecastKey) {
      setAiForecast({ status: "idle" });
      return;
    }
    let cancelled = false;
    let resolved = false;
    const cacheKey = buildAiCityForecastCacheKey(aiForecastKey);
    const requestKey = buildAiCityForecastRequestKey(cacheKey, aiRefreshToken);

    // If cache was loaded into initial state and no force refresh, skip
    if (aiRefreshToken === 0) {
      const cached = readReadyCachedAiForecastState(cacheKey, 0);
      if (cached) {
        setAiForecast(cached);
        return () => { cancelled = true; };
      }
    }

    const loadingState = buildAiCityLoadingForecastState({
      cacheKey,
      detail,
      isEn,
      report,
    });
    setAiForecast(loadingState);
    const softTimeoutId = window.setTimeout(() => {
      if (cancelled || resolved) return;
      const fallbackState = buildAiCityErrorForecastState({
        cacheKey,
        detail,
        error: "ai_soft_timeout_fallback",
        isEn,
        report,
      });
      setAiForecast(fallbackState);
    }, AI_CITY_READ_SOFT_TIMEOUT_MS);
    void scanTerminalClient.streamAiCityRead({
      city: detailCityName,
      forceRefresh: aiRefreshToken > 0,
      locale,
      onProgress: (progress) => {
        if (cancelled) return;
        setAiForecast((current) =>
          buildAiCityProgressForecastState({
            cacheKey,
            current,
            isEn,
            progress,
          }) ?? current,
        );
      },
      requestKey,
    })
      .then((payload) => {
        if (!payload) return;
        resolved = true;
        window.clearTimeout(softTimeoutId);
        const readyState = buildAiCityReadyForecastState({
          cacheKey,
          detail,
          isEn,
          payload,
          report,
        });
        if (!cancelled) {
          setAiForecast(readyState);
        }
      })
      .catch((error) => {
        resolved = true;
        window.clearTimeout(softTimeoutId);
        const errorState = buildAiCityErrorForecastState({
          cacheKey,
          detail,
          error,
          isEn,
          report,
        });
        if (!cancelled) {
          setAiForecast(errorState);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(softTimeoutId);
    };
  }, [
    aiForecastKey,
    aiRefreshToken,
    detail,
    detailCityName,
    enabled,
    isEn,
    locale,
    report,
  ]);

  const refreshAiForecast = useCallback(() => {
    setAiRefreshToken((current) => current + 1);
  }, []);

  return { aiForecast, refreshAiForecast };
}
