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
  const [aiForecast, setAiForecast] = useState<AiCityForecastState>({
    status: "idle",
  });
  const [aiRefreshToken, setAiRefreshToken] = useState(0);
  const aiForecastKey = useMemo(
    () => buildAiCityForecastKey({ detail, detailCityName, locale, report }),
    [detail, detailCityName, locale, report],
  );

  useEffect(() => {
    if (!enabled || !aiForecastKey) {
      setAiForecast({ status: "idle" });
      return;
    }
    let cancelled = false;
    const cacheKey = buildAiCityForecastCacheKey(aiForecastKey);
    const requestKey = buildAiCityForecastRequestKey(cacheKey, aiRefreshToken);
    const readyCachedState = readReadyCachedAiForecastState(
      cacheKey,
      aiRefreshToken,
    );
    if (readyCachedState) {
      setAiForecast(readyCachedState);
      return () => {
        cancelled = true;
      };
    }
    const loadingState = buildAiCityLoadingForecastState({
      cacheKey,
      detail,
      isEn,
      report,
    });
    setAiForecast(loadingState);
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
